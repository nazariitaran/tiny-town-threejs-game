/**
 * The camera and the tracking worker. Each new camera frame goes to the worker as a transferred
 * ImageBitmap, but only when the previous one has come back, so a slow device drops frames instead of
 * queueing them (latency stays one inference long). Frames never leave the page.
 */
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import { assetUrl } from '../game/config';
import type { Delegate, FromWorker, ToWorker, TrackFrame, TrackingMode } from './protocol';

/** Self-hosted copies first (`node scripts/fetch-mediapipe-models.mjs`), then Google's model bucket. */
export const MODEL_SOURCES = {
  gesture: [
    'assets/mediapipe/gesture_recognizer.task',
    'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
  ],
  face: [
    'assets/mediapipe/face_landmarker.task',
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  ],
} as const;

export type TrackerStatus = 'off' | 'camera' | 'loading' | 'tracking' | 'error';

export interface TrackerStats {
  delegate: Delegate | null;
  loadMs: number | null;
  /** Smoothed MediaPipe time per frame (ms). */
  inferMs: number;
  /** Results per second. */
  fps: number;
  /** Camera frames skipped because the worker was still busy. */
  dropped: number;
  frames: number;
  modelUrls: string[];
  videoWidth: number;
  videoHeight: number;
}

/** The GPU delegate gets this long for its first frame, then an average under GPU_SLOW_MS over its first frames, or the worker restarts on the CPU. */
const GPU_FIRST_FRAME_MS = 4000;
const GPU_TRIAL_FRAMES = 10;
const GPU_SLOW_MS = 120;

/**
 * A software WebGL (SwiftShader, llvmpipe: VMs, CI, blocklisted GPUs) runs MediaPipe's GPU delegate
 * several times slower than its CPU one, so don't try it there.
 */
export function hasSoftwareGl(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    return true;
  }
}

/** A URL the worker can fetch: the worker's own base is its chunk, not the page. */
function absolute(url: string): string {
  return new URL(url, document.baseURI).href;
}

type VideoWithCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class Tracker {
  readonly video: VideoWithCallback = document.createElement('video');
  status: TrackerStatus = 'off';
  error: string | null = null;
  readonly stats: TrackerStats = { delegate: null, loadMs: null, inferMs: 0, fps: 0, dropped: 0, frames: 0, modelUrls: [], videoWidth: 0, videoHeight: 0 };
  onFrame: (frame: TrackFrame) => void = () => {};
  onStatus: (status: TrackerStatus) => void = () => {};

  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private busy = false;
  private frameHandle = 0;
  private usesFrameCallback = false;
  private lastVideoTime = -1;
  private fpsWindowStart = 0;
  private fpsCount = 0;
  /** Bumped by stop(), so a start() still awaiting the camera or the worker knows it was cancelled. */
  private generation = 0;
  private mode: TrackingMode = 'hand';
  private watchdog = 0;
  private trialMs = 0;

  constructor() {
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
  }

  get aspect(): number {
    return this.video.videoWidth > 0 && this.video.videoHeight > 0 ? this.video.videoWidth / this.video.videoHeight : 4 / 3;
  }

  async start(mode: TrackingMode, delegate: Delegate): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.mode = mode;
    this.error = null;
    this.setStatus('camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
      });
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      this.stats.videoWidth = this.video.videoWidth;
      this.stats.videoHeight = this.video.videoHeight;
      this.startWorker(delegate === 'GPU' && hasSoftwareGl() ? 'CPU' : delegate);
    } catch (error) {
      if (generation !== this.generation) return;
      const name = error instanceof DOMException ? error.name : '';
      this.fail(
        name === 'NotAllowedError'
          ? 'Camera permission was refused.'
          : name === 'NotFoundError'
          ? 'No camera found.'
          : error instanceof Error
          ? error.message
          : String(error),
      );
    }
  }

  private startWorker(delegate: Delegate): void {
    this.stopWorker();
    this.setStatus('loading');
    const mode = this.mode;
    const worker = new Worker(new URL('./tracker.worker.ts', import.meta.url), { type: 'module', name: 'tiny-town-tracking' });
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<FromWorker>) => this.onMessage(event.data);
    worker.onerror = (event) => this.fail(event.message || 'The tracking worker failed to start.');
    const sources = (urls: readonly string[]): string[] => urls.map((url) => absolute(url.startsWith('http') ? url : assetUrl(url)));
    this.post({
      type: 'init',
      wasmLoaderPath: absolute(wasmLoaderUrl),
      wasmBinaryPath: absolute(wasmBinaryUrl),
      gestureModel: mode !== 'head' ? sources(MODEL_SOURCES.gesture) : null,
      faceModel: mode !== 'hand' ? sources(MODEL_SOURCES.face) : null,
      delegate,
      // Two hands: two fists zoom, and in head + hand mode a second hand in view mustn't hide the one that pinches.
      numHands: 2,
    });
  }

  /** The GPU delegate turned out slow (or stuck): the same camera, a fresh worker on the CPU. */
  private fallBackToCpu(reason: string): void {
    console.warn(`[gestures] GPU delegate ${reason}; switching to the CPU.`);
    this.startWorker('CPU');
  }

  stop(): void {
    this.generation += 1;
    this.stopWorker();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.video.srcObject = null;
    if (this.status !== 'error') this.setStatus('off');
  }

  private stopWorker(): void {
    if (this.frameHandle) {
      if (this.usesFrameCallback) this.video.cancelVideoFrameCallback?.(this.frameHandle);
      else cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
    window.clearTimeout(this.watchdog);
    this.watchdog = 0;
    if (this.worker) {
      this.post({ type: 'close' });
      this.worker.terminate();
      this.worker = null;
    }
    this.busy = false;
    this.lastVideoTime = -1;
    this.trialMs = 0;
    this.stats.fps = 0;
    this.stats.inferMs = 0;
    this.stats.frames = 0;
  }

  private onMessage(message: FromWorker): void {
    if (message.type === 'ready') {
      this.stats.delegate = message.delegate;
      this.stats.loadMs = message.loadMs;
      this.stats.modelUrls = message.modelUrls;
      this.setStatus('tracking');
      this.fpsWindowStart = performance.now();
      this.fpsCount = 0;
      if (message.delegate === 'GPU') this.watchdog = window.setTimeout(() => this.fallBackToCpu('gave no first frame'), GPU_FIRST_FRAME_MS);
      this.schedule();
    } else if (message.type === 'error') {
      if (this.status === 'tracking') {
        console.warn('[gestures] frame failed:', message.message);
        this.busy = false;
      } else {
        this.fail(message.message);
      }
    } else {
      this.busy = false;
      const stats = this.stats;
      stats.frames += 1;
      if (stats.delegate === 'GPU' && stats.frames <= GPU_TRIAL_FRAMES) {
        window.clearTimeout(this.watchdog);
        this.trialMs += message.frame.inferMs;
        // The first frame includes shader compilation: judge the rest.
        if (stats.frames === 1) this.trialMs = 0;
        if (stats.frames === GPU_TRIAL_FRAMES && this.trialMs / (GPU_TRIAL_FRAMES - 1) > GPU_SLOW_MS) {
          this.fallBackToCpu(`took ${(this.trialMs / (GPU_TRIAL_FRAMES - 1)).toFixed(0)} ms a frame`);
          return;
        }
      }
      stats.inferMs = stats.inferMs === 0 ? message.frame.inferMs : stats.inferMs * 0.9 + message.frame.inferMs * 0.1;
      this.fpsCount += 1;
      const now = performance.now();
      if (now - this.fpsWindowStart >= 1000) {
        stats.fps = (this.fpsCount * 1000) / (now - this.fpsWindowStart);
        this.fpsWindowStart = now;
        this.fpsCount = 0;
      }
      this.onFrame(message.frame);
    }
  }

  private readonly onVideoFrame = (): void => {
    this.frameHandle = 0;
    if (!this.worker || this.status !== 'tracking') return;
    this.schedule();
    // Without requestVideoFrameCallback this runs per display frame: only send a new picture.
    if (!this.usesFrameCallback) {
      if (this.video.currentTime === this.lastVideoTime) return;
      this.lastVideoTime = this.video.currentTime;
    }
    if (this.busy) {
      this.stats.dropped += 1;
      return;
    }
    if (this.video.readyState < 2) return;
    this.busy = true;
    const t = performance.now() / 1000;
    createImageBitmap(this.video).then(
      (bitmap) => {
        if (!this.worker) {
          bitmap.close();
          return;
        }
        this.post({ type: 'frame', bitmap, t }, [bitmap]);
      },
      () => {
        this.busy = false;
      },
    );
  };

  private schedule(): void {
    if (this.frameHandle) return;
    this.usesFrameCallback = typeof this.video.requestVideoFrameCallback === 'function';
    this.frameHandle = this.usesFrameCallback ? this.video.requestVideoFrameCallback!(this.onVideoFrame) : requestAnimationFrame(this.onVideoFrame);
  }

  private post(message: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }

  private fail(message: string): void {
    this.error = message;
    this.setStatus('error');
    this.stop();
  }

  private setStatus(status: TrackerStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(status);
  }
}
