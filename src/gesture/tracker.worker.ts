/**
 * Runs MediaPipe off the main thread: the page posts camera frames (ImageBitmaps, transferred), the
 * worker answers with the few landmarks the interpreters need. One frame in flight at a time.
 */
import { FaceLandmarker, GestureRecognizer } from '@mediapipe/tasks-vision';
import { FACE_POINTS, type Delegate, type FaceObservation, type FromWorker, type HandObservation, type Point3, type ToWorker, type WorkerInit } from './protocol';

/** The worker global (the project's TS lib is the DOM one). */
interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker): void;
  ModuleFactory?: unknown;
}
const scope = self as unknown as WorkerScope;

/** The blendshapes HeadInterpreter reads; the other 47 aren't posted. */
const BLENDSHAPES = new Set(['jawOpen', 'browInnerUp', 'mouthSmileLeft', 'mouthSmileRight']);

let recognizer: GestureRecognizer | null = null;
let faces: FaceLandmarker | null = null;
let lastTimestamp = -1;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === 'init') void init(message);
  else if (message.type === 'frame') detect(message.bitmap, message.t);
  else close();
};

async function init(options: WorkerInit): Promise<void> {
  const started = performance.now();
  try {
    const urls: string[] = [];
    const gestureModel = options.gestureModel ? await fetchFirst(options.gestureModel, urls) : null;
    const faceModel = options.faceModel ? await fetchFirst(options.faceModel, urls) : null;
    let delegate = options.delegate;
    try {
      await createTasks(options, delegate, gestureModel, faceModel);
    } catch (error) {
      if (delegate === 'CPU') throw error;
      console.warn('[gestures] GPU delegate failed, using CPU:', error);
      delegate = 'CPU';
      close();
      await createTasks(options, delegate, gestureModel, faceModel);
    }
    scope.postMessage({ type: 'ready', delegate, loadMs: Math.round(performance.now() - started), modelUrls: urls });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

async function createTasks(options: WorkerInit, delegate: Delegate, gestureModel: Uint8Array | null, faceModel: Uint8Array | null): Promise<void> {
  const fileset = { wasmLoaderPath: options.wasmLoaderPath, wasmBinaryPath: options.wasmBinaryPath };
  if (gestureModel) {
    await armLoader(options.wasmLoaderPath);
    recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: gestureModel.slice(), delegate },
      runningMode: 'VIDEO',
      numHands: options.numHands,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
  }
  if (faceModel) {
    await armLoader(options.wasmLoaderPath);
    faces = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: faceModel.slice(), delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    });
  }
}

/**
 * MediaPipe imports the loader and then clears `self.ModuleFactory`. In a module worker a second import
 * of the same URL is cached and doesn't run again, so the second task would find no factory: set it here.
 */
async function armLoader(url: string): Promise<void> {
  const loader = (await import(/* @vite-ignore */ url)) as { default?: unknown };
  if (loader.default) scope.ModuleFactory = loader.default;
}

/** The first URL that answers; its bytes. `used` collects the URL. */
async function fetchFirst(urls: readonly string[], used: string[]): Promise<Uint8Array> {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      // A dev server answers a missing public file with index.html: only accept a binary.
      if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) {
        failures.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      used.push(url);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not load a model (${failures.join('; ')})`);
}

function detect(bitmap: ImageBitmap, t: number): void {
  // MediaPipe needs strictly increasing timestamps (ms).
  const timestamp = Math.max(Math.round(t * 1000), lastTimestamp + 1);
  lastTimestamp = timestamp;
  const started = performance.now();
  const hands: HandObservation[] = [];
  let face: FaceObservation | null = null;
  try {
    if (recognizer) {
      const result = recognizer.recognizeForVideo(bitmap, timestamp);
      result.landmarks.forEach((landmarks, i) => {
        const gesture = result.gestures[i]?.[0];
        hands.push({
          landmarks: landmarks.map(point),
          handedness: result.handedness[i]?.[0]?.categoryName ?? '',
          gesture: gesture?.categoryName ?? 'None',
          gestureScore: gesture?.score ?? 0,
        });
      });
    }
    if (faces) {
      const result = faces.detectForVideo(bitmap, timestamp);
      const mesh = result.faceLandmarks[0];
      if (mesh) {
        const blendshapes: Record<string, number> = {};
        for (const category of result.faceBlendshapes[0]?.categories ?? []) {
          if (BLENDSHAPES.has(category.categoryName)) blendshapes[category.categoryName] = category.score;
        }
        face = {
          nose: point(mesh[FACE_POINTS.nose]),
          cheekRight: point(mesh[FACE_POINTS.cheekRight]),
          cheekLeft: point(mesh[FACE_POINTS.cheekLeft]),
          forehead: point(mesh[FACE_POINTS.forehead]),
          chin: point(mesh[FACE_POINTS.chin]),
          blendshapes,
        };
      }
    }
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    return;
  } finally {
    bitmap.close();
  }
  scope.postMessage({ type: 'result', frame: { t, hands, face, inferMs: performance.now() - started } });
}

function point(landmark: { x: number; y: number; z: number }): Point3 {
  return { x: landmark.x, y: landmark.y, z: landmark.z };
}

function close(): void {
  recognizer?.close();
  faces?.close();
  recognizer = null;
  faces = null;
}
