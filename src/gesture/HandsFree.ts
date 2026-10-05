/**
 * Hands-free controls (experimental, `?gestures`): a camera, MediaPipe in a worker, an interpreter for
 * the chosen mode and a router that acts like a mouse. Owns its own small DOM (a toggle, a panel with
 * the camera preview, the cursor) above the game UI. Loaded lazily: without the flag none of it, and
 * none of MediaPipe, is fetched.
 *
 * URL: `?gestures` (hand mode), `?gestures=head`, `?gestures=head-hand`; add `,cpu` to skip the GPU delegate.
 */
import type { GameBus } from '../game/events';
import { GestureRouter } from './GestureRouter';
import { DEFAULT_HAND_TUNING, HandInterpreter } from './handInterpreter';
import { HeadInterpreter } from './headInterpreter';
import { isTrackingMode, type Delegate, type GestureFrame, type TrackFrame, type TrackingMode } from './protocol';
import { Tracker, type TrackerStatus } from './Tracker';
import './handsFree.css';

export const HF_IDS = {
  root: 'hf-root',
  toggle: 'hf-toggle',
  panel: 'hf-panel',
  start: 'hf-start',
  status: 'hf-status',
  cursor: 'hf-cursor',
  recentre: 'hf-recentre',
  sensitivity: 'hf-sensitivity',
  dwell: 'hf-dwell',
  close: 'hf-close',
  mode: (mode: TrackingMode) => `hf-mode-${mode}`,
} as const;

const MODE_UI: Record<TrackingMode, { label: string; legend: string[] }> = {
  hand: {
    label: 'Hand',
    legend: [
      'Point with your hand: the cursor follows the gap between thumb and index finger',
      'Pinch thumb and index together to click; hold the pinch to drag (roads, fences)',
      'Make a fist and move it to drag the map; two fists apart / together to zoom',
      'Hold ✌ to rotate · hold 👎 for Esc (put back, put away, close)',
    ],
  },
  head: {
    label: 'Head',
    legend: [
      'Turn and tilt your head: the cursor follows your nose',
      'Open your mouth to click; keep it open to drag',
      'Rest on a button for a second to press it',
      'Hold a big smile to rotate · raise your eyebrows for Esc',
    ],
  },
  'head-hand': {
    label: 'Head + hand',
    legend: [
      'Turn and tilt your head to point',
      'Pinch with either hand, anywhere in view, to click; hold to drag',
      'Fist to drag the map · ✌ to rotate · 👎 for Esc',
    ],
  },
};

const HAND_GLYPH =
  '<svg class="hf-glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5V4a1.5 1.5 0 0 1 3 0v7.5"/><path d="M14 11.5V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.6 14a1.5 1.5 0 0 1 2.5-1.7L8 15"/></svg>';

/** MediaPipe's hand skeleton, for the preview. */
const HAND_BONES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const STATUS_TEXT: Record<TrackerStatus, string> = {
  off: 'Camera off',
  camera: 'Waiting for the camera…',
  loading: 'Loading the tracking model…',
  tracking: '',
  error: '',
};

/** Panel text and test attributes refresh at this rate, not per tracking frame. */
const STATUS_INTERVAL_MS = 150;

function parseFlag(value: string | null): { mode: TrackingMode; delegate: Delegate } {
  const tokens = (value ?? '').split(',').map((token) => token.trim());
  const mode = tokens.find(isTrackingMode) ?? 'hand';
  return { mode, delegate: tokens.includes('cpu') ? 'CPU' : 'GPU' };
}

export class HandsFree {
  private readonly root = document.createElement('div');
  private readonly tracker = new Tracker();
  private readonly hand = new HandInterpreter();
  /** Head + hand: the click comes from whichever hand pinches. */
  private readonly clickHand = new HandInterpreter({ ...DEFAULT_HAND_TUNING, pick: 'pinch' });
  private readonly head = new HeadInterpreter();
  private readonly router: GestureRouter;
  private mode: TrackingMode;
  private readonly delegate: Delegate;
  private readonly preview: HTMLCanvasElement;
  private readonly previewContext: CanvasRenderingContext2D | null;
  private readonly cursor: HTMLElement;
  private lastStatusMs = 0;
  /** Refreshes the panel while the camera is on, also between results (a stalled or slow worker shows). */
  private statusTimer = 0;
  private lastFrame: GestureFrame | null = null;

  constructor(
    bus: GameBus,
    canvas: HTMLCanvasElement,
    flag: string | null,
  ) {
    const { mode, delegate } = parseFlag(flag);
    this.mode = mode;
    this.delegate = delegate;
    this.router = new GestureRouter(bus, canvas);
    this.root.id = HF_IDS.root;
    this.root.className = 'hf-root';
    this.root.innerHTML = this.template();
    document.body.append(this.root);
    this.preview = this.el<HTMLCanvasElement>('hf-preview-canvas');
    this.previewContext = this.preview.getContext('2d');
    this.cursor = this.el(HF_IDS.cursor);
    this.el('hf-preview').prepend(this.tracker.video);
    this.tracker.video.className = 'hf-video';

    this.tracker.onFrame = (frame) => this.onFrame(frame);
    this.tracker.onStatus = (status) => this.onStatus(status);
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    this.setPanelOpen(true);
    this.renderMode();
    this.onStatus('off');
  }

  dispose(): void {
    window.clearInterval(this.statusTimer);
    this.tracker.stop();
    this.router.release();
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('input', this.onInput);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    this.root.remove();
  }

  private template(): string {
    const modes = (Object.keys(MODE_UI) as TrackingMode[])
      .map((m) => `<button type="button" class="hf-mode" id="${HF_IDS.mode(m)}" data-mode="${m}" aria-pressed="false">${MODE_UI[m].label}</button>`)
      .join('');
    return `
      <button type="button" class="hf-toggle" id="${HF_IDS.toggle}" aria-expanded="true" aria-controls="${HF_IDS.panel}" title="Hands-free controls (experimental)">${HAND_GLYPH}<span>Hands-free</span><i class="hf-live" aria-hidden="true"></i></button>
      <section class="hf-panel" id="${HF_IDS.panel}" aria-label="Hands-free controls">
        <header class="hf-head">
          <h2>Hands-free <span class="hf-badge">Experimental</span></h2>
          <button type="button" class="hf-icon" id="${HF_IDS.close}" aria-label="Hide the panel" title="Hide the panel">×</button>
        </header>
        <div class="hf-modes" role="group" aria-label="Mode">${modes}</div>
        <div class="hf-preview" id="hf-preview"><canvas id="hf-preview-canvas" width="320" height="240" aria-hidden="true"></canvas><p class="hf-status" id="${HF_IDS.status}" aria-live="polite"></p></div>
        <button type="button" class="hf-btn hf-btn-primary" id="${HF_IDS.start}">Start camera</button>
        <details class="hf-legend" open><summary>Gestures</summary><ul id="hf-legend"></ul></details>
        <div class="hf-head-tools">
          <label class="hf-row">Sensitivity <input type="range" id="${HF_IDS.sensitivity}" min="0.5" max="2" step="0.1" value="1" /></label>
          <label class="hf-row hf-dwell-row"><input type="checkbox" id="${HF_IDS.dwell}" checked /> Rest on a button to press it</label>
          <button type="button" class="hf-btn" id="${HF_IDS.recentre}">Re-centre</button>
        </div>
        <p class="hf-note">Runs on this device with Google MediaPipe. The camera picture never leaves your browser.</p>
      </section>
      <div class="hf-cursor" id="${HF_IDS.cursor}" hidden><i class="hf-ring"></i><i class="hf-dot"></i></div>
    `;
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.root.querySelector<T>(`#${id}`)!;
  }

  private readonly onClick = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;
    if (button.id === HF_IDS.toggle) this.setPanelOpen(this.root.dataset.panel === 'closed');
    else if (button.id === HF_IDS.close) this.setPanelOpen(false);
    else if (button.id === HF_IDS.start) {
      if (this.tracker.status === 'off' || this.tracker.status === 'error') void this.start();
      else this.stop();
    } else if (button.id === HF_IDS.recentre) this.head.recalibrate();
    else if (button.dataset.mode && isTrackingMode(button.dataset.mode)) this.setMode(button.dataset.mode);
  };

  private readonly onInput = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    if (target.id === HF_IDS.sensitivity) this.head.tuning.sensitivity = Number(target.value);
    else if (target.id === HF_IDS.dwell) this.applyDwell();
  };

  /** A hidden page gets no frames: drop any press so nothing stays held. */
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.router.release();
  };

  private readonly onPageHide = (): void => {
    this.tracker.stop();
  };

  private setPanelOpen(open: boolean): void {
    this.root.dataset.panel = open ? 'open' : 'closed';
    this.el(HF_IDS.toggle).setAttribute('aria-expanded', String(open));
  }

  private setMode(mode: TrackingMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.renderMode();
    // Another mode needs other models: restart a running camera with them.
    if (this.tracker.status !== 'off' && this.tracker.status !== 'error') void this.start();
  }

  private renderMode(): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.hf-mode')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === this.mode));
    }
    this.el('hf-legend').innerHTML = MODE_UI[this.mode].legend.map((line) => `<li>${line}</li>`).join('');
    this.root.dataset.mode = this.mode;
    this.applyDwell();
  }

  private applyDwell(): void {
    const on = this.mode === 'head' && this.el<HTMLInputElement>(HF_IDS.dwell).checked;
    this.router.setDwell(on ? 1 : 0);
  }

  private async start(): Promise<void> {
    this.router.release();
    this.hand.reset();
    this.clickHand.reset();
    this.head.reset();
    await this.tracker.start(this.mode, this.delegate);
  }

  private stop(): void {
    this.tracker.stop();
    this.router.release();
    this.renderCursor();
  }

  private onStatus(status: TrackerStatus): void {
    this.root.dataset.status = status;
    const live = status !== 'off' && status !== 'error';
    if (live && !this.statusTimer) this.statusTimer = window.setInterval(() => this.renderStatus(true), STATUS_INTERVAL_MS * 2);
    if (!live) {
      window.clearInterval(this.statusTimer);
      this.statusTimer = 0;
    }
    this.el(HF_IDS.start).textContent = status === 'off' || status === 'error' ? 'Start camera' : 'Stop camera';
    if (status !== 'tracking') {
      this.router.release();
      this.renderCursor();
    }
    this.renderStatus(true);
  }

  private onFrame(track: TrackFrame): void {
    const t = track.t;
    let frame: GestureFrame;
    if (this.mode === 'hand') {
      frame = this.hand.update(track.hands, this.tracker.aspect, t);
    } else if (this.mode === 'head') {
      frame = this.head.update(track.face, t);
    } else {
      const hand = this.clickHand.update(track.hands, this.tracker.aspect, t);
      frame = this.head.update(track.face, t, hand.present && hand.pressed);
      frame.command ??= hand.command;
      frame.commandProgress = Math.max(frame.commandProgress, hand.commandProgress);
      frame.grab = hand.grab;
      frame.grabDx = hand.grabDx;
      frame.grabDy = hand.grabDy;
      if (hand.grab) frame.label = hand.label;
    }
    this.lastFrame = frame;
    this.router.apply(frame, t);
    this.renderCursor();
    this.drawPreview(track);
    this.renderStatus(false);
  }

  private renderCursor(): void {
    const cursor = this.cursor;
    const state = this.router.state;
    const visible = this.tracker.status === 'tracking' && state.present;
    cursor.hidden = !visible;
    if (!visible) return;
    cursor.style.transform = `translate3d(${state.x.toFixed(1)}px, ${state.y.toFixed(1)}px, 0)`;
    const frame = this.lastFrame;
    cursor.style.setProperty('--hf-pressure', (frame?.pressure ?? 0).toFixed(2));
    cursor.style.setProperty('--hf-progress', state.progress.toFixed(2));
    cursor.classList.toggle('is-pressed', state.pressed);
    cursor.classList.toggle('is-grab', state.grab);
    cursor.classList.toggle('is-ui', !state.overCanvas);
    cursor.classList.toggle('is-calibrating', frame?.calibrating === true);
  }

  private renderStatus(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastStatusMs < STATUS_INTERVAL_MS) return;
    this.lastStatusMs = now;
    const tracker = this.tracker;
    const stats = tracker.stats;
    const frame = this.lastFrame;
    const status = this.el(HF_IDS.status);
    if (tracker.status === 'error') {
      status.textContent = `Couldn't start: ${tracker.error ?? 'unknown error'}`;
    } else if (tracker.status === 'tracking') {
      const what = frame?.present ? frame.label : this.mode === 'hand' ? 'Show your hand to the camera' : 'Face the camera';
      status.textContent = `${what} · ${stats.inferMs.toFixed(0)} ms · ${stats.fps.toFixed(0)} fps · ${stats.delegate ?? ''}`;
    } else {
      status.textContent = STATUS_TEXT[tracker.status];
    }
    this.root.classList.toggle('is-live', tracker.status === 'tracking' || tracker.status === 'loading' || tracker.status === 'camera');
    // For tests and the smoke script.
    const data = this.root.dataset;
    const state = this.router.state;
    data.present = String(frame?.present === true);
    data.pressed = String(state.pressed);
    data.grab = String(state.grab);
    data.x = state.x.toFixed(0);
    data.y = state.y.toFixed(0);
    data.label = frame?.label ?? '';
    data.frames = String(stats.frames);
    data.inferMs = stats.inferMs.toFixed(1);
    data.loadMs = String(stats.loadMs ?? '');
    data.delegate = stats.delegate ?? '';
    data.fps = stats.fps.toFixed(1);
    data.dropped = String(stats.dropped);
    data.domClicks = String(this.router.counts.domClicks);
    data.canvasPresses = String(this.router.counts.canvasPresses);
    data.commands = String(this.router.counts.commands);
    data.models = stats.modelUrls.join(' ');
  }

  /** The camera picture (mirrored by CSS), the active region in hand mode, and what is tracked. */
  private drawPreview(track: TrackFrame): void {
    const ctx = this.previewContext;
    if (!ctx) return;
    const { width, height } = this.preview;
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    if (this.mode === 'hand') {
      // The region is defined mirrored; the canvas is mirrored by CSS, so draw it unmirrored.
      const r = DEFAULT_HAND_TUNING.region;
      ctx.strokeStyle = 'rgba(255, 249, 239, 0.7)';
      ctx.setLineDash([6, 6]);
      ctx.strokeRect((1 - r.right) * width, r.top * height, (r.right - r.left) * width, (r.bottom - r.top) * height);
      ctx.setLineDash([]);
    }
    const frame = this.lastFrame;
    for (const hand of track.hands) {
      const lm = hand.landmarks;
      ctx.strokeStyle = frame?.grab ? '#f4c44e' : frame?.pressed ? '#4a9be8' : '#5db36a';
      ctx.beginPath();
      for (const [a, b] of HAND_BONES) {
        ctx.moveTo(lm[a].x * width, lm[a].y * height);
        ctx.lineTo(lm[b].x * width, lm[b].y * height);
      }
      ctx.stroke();
    }
    const face = track.face;
    if (face) {
      ctx.fillStyle = frame?.pressed ? '#4a9be8' : '#5db36a';
      for (const point of [face.forehead, face.chin, face.cheekLeft, face.cheekRight]) {
        ctx.beginPath();
        ctx.arc(point.x * width, point.y * height, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#e0674f';
      ctx.beginPath();
      ctx.arc(face.nose.x * width, face.nose.y * height, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Mounts the hands-free controls; returns a disposer. `flag` is the `gestures` URL parameter's value. */
export function installHandsFree(bus: GameBus, canvas: HTMLCanvasElement, flag: string | null): () => void {
  const handsFree = new HandsFree(bus, canvas, flag);
  return () => handsFree.dispose();
}
