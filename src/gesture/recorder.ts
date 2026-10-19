/**
 * Records a tracking session to a JSON file and reads one back. Only tracking numbers are kept (landmarks,
 * face points, blendshapes, gesture names), never pictures. A file stays on the device unless it is shared.
 */
import { isTrackingMode, type FaceObservation, type HandObservation, type Point3, type TrackFrame, type TrackingMode } from './protocol';

export const TRACK_FORMAT = 'tiny-town-track';
export const TRACK_VERSION = 1;
export const MAX_RECORD_SECONDS = 120;
export const MAX_RECORD_FRAMES = 4000;

/** A tracking result as stored: `t` in seconds from the first frame, no timing of the worker. */
export type RecordedFrame = Omit<TrackFrame, 'inferMs'>;

export interface TrackFile {
  format: typeof TRACK_FORMAT;
  version: typeof TRACK_VERSION;
  startedAt: string;
  mode: TrackingMode;
  frames: RecordedFrame[];
}

function copyPoint(point: Point3): Point3 {
  return { x: point.x, y: point.y, z: point.z };
}

function copyFace(face: FaceObservation): FaceObservation {
  const blendshapes: Record<string, number> = {};
  for (const key of Object.keys(face.blendshapes)) blendshapes[key] = face.blendshapes[key];
  const copy: FaceObservation = {
    nose: copyPoint(face.nose),
    cheekRight: copyPoint(face.cheekRight),
    cheekLeft: copyPoint(face.cheekLeft),
    forehead: copyPoint(face.forehead),
    chin: copyPoint(face.chin),
    blendshapes,
  };
  if (face.yaw !== undefined && face.pitch !== undefined) {
    copy.yaw = face.yaw;
    copy.pitch = face.pitch;
  }
  return copy;
}

function copyHand(hand: HandObservation): HandObservation {
  return {
    landmarks: hand.landmarks.map(copyPoint),
    handedness: hand.handedness,
    gesture: hand.gesture,
    gestureScore: hand.gestureScore,
  };
}

export class TrackRecorder {
  private frames: RecordedFrame[] = [];
  private startedAt = '';
  private origin: number | null = null;
  private seconds = 0;
  private active = false;

  constructor(readonly mode: TrackingMode) {}

  /** Still taking frames: false before start, after stop, and once the cap is reached. */
  get recording(): boolean {
    return this.active;
  }

  /** Seconds from the first frame to the latest one kept. */
  get elapsed(): number {
    return this.seconds;
  }

  start(now: Date = new Date()): void {
    this.frames = [];
    this.startedAt = now.toISOString();
    this.origin = null;
    this.seconds = 0;
    this.active = true;
  }

  push(frame: TrackFrame): void {
    if (!this.active) return;
    if (this.origin === null) this.origin = frame.t;
    const t = frame.t - this.origin;
    if (t > MAX_RECORD_SECONDS) {
      this.active = false;
      return;
    }
    this.frames.push({ t, hands: frame.hands.map(copyHand), face: frame.face ? copyFace(frame.face) : null });
    this.seconds = t;
    if (t >= MAX_RECORD_SECONDS || this.frames.length >= MAX_RECORD_FRAMES) this.active = false;
  }

  stop(): void {
    this.active = false;
  }

  toJSON(): TrackFile {
    return { format: TRACK_FORMAT, version: TRACK_VERSION, startedAt: this.startedAt, mode: this.mode, frames: this.frames };
  }
}

/** `tiny-town-track-<mode>-<yyyymmdd-hhmm>.json`, in local time. */
export function trackFileName(mode: TrackingMode, when: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const day = `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}`;
  return `tiny-town-track-${mode}-${day}-${pad(when.getHours())}${pad(when.getMinutes())}.json`;
}

/** Saves the recording as a file download (the object URL is revoked after the click). */
export function downloadTrack(recorder: TrackRecorder): void {
  const file = recorder.toJSON();
  const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = trackFileName(file.mode, new Date(file.startedAt || Date.now()));
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Reading ------------------------------------------------------------------------------------

function fail(path: string, expected: string): never {
  throw new Error(`Not a Tiny Town track: ${path} should be ${expected}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'an object');
  return value as Record<string, unknown>;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'a finite number');
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'a string');
  return value;
}

function point(value: unknown, path: string): Point3 {
  const o = object(value, path);
  return { x: finite(o.x, `${path}.x`), y: finite(o.y, `${path}.y`), z: finite(o.z, `${path}.z`) };
}

function hand(value: unknown, path: string): HandObservation {
  const o = object(value, path);
  if (!Array.isArray(o.landmarks) || o.landmarks.length !== 21) fail(`${path}.landmarks`, 'an array of 21 points');
  return {
    landmarks: o.landmarks.map((p, i) => point(p, `${path}.landmarks[${i}]`)),
    handedness: text(o.handedness, `${path}.handedness`),
    gesture: text(o.gesture, `${path}.gesture`),
    gestureScore: finite(o.gestureScore, `${path}.gestureScore`),
  };
}

function face(value: unknown, path: string): FaceObservation {
  const o = object(value, path);
  const shapes = object(o.blendshapes, `${path}.blendshapes`);
  const blendshapes: Record<string, number> = {};
  for (const key of Object.keys(shapes)) blendshapes[key] = finite(shapes[key], `${path}.blendshapes.${key}`);
  const result: FaceObservation = {
    nose: point(o.nose, `${path}.nose`),
    cheekRight: point(o.cheekRight, `${path}.cheekRight`),
    cheekLeft: point(o.cheekLeft, `${path}.cheekLeft`),
    forehead: point(o.forehead, `${path}.forehead`),
    chin: point(o.chin, `${path}.chin`),
    blendshapes,
  };
  // Head angles are optional: older files and faces without the transformation matrix have none.
  if (o.yaw !== undefined || o.pitch !== undefined) {
    result.yaw = finite(o.yaw, `${path}.yaw`);
    result.pitch = finite(o.pitch, `${path}.pitch`);
  }
  return result;
}

function frame(value: unknown, path: string, previousT: number): RecordedFrame {
  const o = object(value, path);
  const t = finite(o.t, `${path}.t`);
  if (t < previousT) fail(`${path}.t`, 'not earlier than the frame before');
  if (!Array.isArray(o.hands)) fail(`${path}.hands`, 'an array');
  return {
    t,
    hands: o.hands.map((h, i) => hand(h, `${path}.hands[${i}]`)),
    face: o.face === null ? null : face(o.face, `${path}.face`),
  };
}

/** Validates a parsed track file and returns its frames; throws on anything else. */
export function parseTrack(json: unknown): RecordedFrame[] {
  const file = object(json, 'the file');
  if (file.format !== TRACK_FORMAT) fail('format', `"${TRACK_FORMAT}"`);
  if (file.version !== TRACK_VERSION) throw new Error(`Unsupported track version ${String(file.version)}; this build reads version ${TRACK_VERSION}`);
  text(file.startedAt, 'startedAt');
  if (!isTrackingMode(file.mode)) fail('mode', 'hand, head or head-hand');
  if (!Array.isArray(file.frames)) fail('frames', 'an array');
  if (file.frames.length > MAX_RECORD_FRAMES) throw new Error(`Track has ${file.frames.length} frames; the limit is ${MAX_RECORD_FRAMES}`);
  const frames: RecordedFrame[] = [];
  let previousT = 0;
  file.frames.forEach((value, i) => {
    const parsed = frame(value, `frames[${i}]`, previousT);
    previousT = parsed.t;
    frames.push(parsed);
  });
  return frames;
}
