/**
 * What the tracking worker sees and what the interpreters make of it. Image coordinates are
 * MediaPipe's normalised ones: x, y in [0, 1] of the camera frame, unmirrored (as the camera sees you).
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface HandObservation {
  /** 21 points, MediaPipe hand order (0 wrist, 4 thumb tip, 8 index tip…). */
  landmarks: Point3[];
  /** As MediaPipe reports it, for a mirrored (selfie) image. */
  handedness: string;
  /** Canned gesture: None, Closed_Fist, Open_Palm, Pointing_Up, Thumb_Down, Thumb_Up, Victory, ILoveYou. */
  gesture: string;
  gestureScore: number;
}

/** MediaPipe face mesh indices of the points FaceObservation carries. */
export const FACE_POINTS = { nose: 1, cheekRight: 234, cheekLeft: 454, forehead: 10, chin: 152 } as const;

/** The few face points the head pointer needs, plus the blendshapes it reads. */
export interface FaceObservation {
  nose: Point3;
  /** The face outline at the cheeks (subject's right, left) and at the forehead and chin. */
  cheekRight: Point3;
  cheekLeft: Point3;
  forehead: Point3;
  chin: Point3;
  blendshapes: Record<string, number>;
}

export interface TrackFrame {
  /** Seconds, on the page clock. */
  t: number;
  hands: HandObservation[];
  face: FaceObservation | null;
  /** Time the worker spent in MediaPipe for this frame. */
  inferMs: number;
}

/** Hands: pinch to click; Head: the nose points, an open mouth clicks; Head + hand: the nose points, a pinch clicks. */
export type TrackingMode = 'hand' | 'head' | 'head-hand';

export const TRACKING_MODES: readonly TrackingMode[] = ['hand', 'head', 'head-hand'];

export function isTrackingMode(value: unknown): value is TrackingMode {
  return (TRACKING_MODES as readonly unknown[]).includes(value);
}

export type Delegate = 'GPU' | 'CPU';

export interface WorkerInit {
  type: 'init';
  wasmLoaderPath: string;
  wasmBinaryPath: string;
  /** Model URLs, tried in order. Null: that model isn't wanted. */
  gestureModel: string[] | null;
  faceModel: string[] | null;
  delegate: Delegate;
  numHands: number;
}

export interface WorkerFrame {
  type: 'frame';
  bitmap: ImageBitmap;
  t: number;
}

export type ToWorker = WorkerInit | WorkerFrame | { type: 'close' };

export type FromWorker =
  | { type: 'ready'; delegate: Delegate; loadMs: number; modelUrls: string[] }
  | { type: 'error'; message: string }
  | { type: 'result'; frame: TrackFrame };

/** What an interpreter makes of one frame; written in place, never reallocated. */
export interface GestureFrame {
  /** Someone is being tracked. */
  present: boolean;
  /** The pointer, in viewport fractions [0, 1]. */
  x: number;
  y: number;
  /** A click is held (pinch closed, mouth open). */
  pressed: boolean;
  /** 0..1 towards a press, for the cursor ring. */
  pressure: number;
  /** Fist: the hand drags the map. */
  grab: boolean;
  /** While grabbing: how far the hand moved since the last frame, in viewport fractions. */
  grabDx: number;
  grabDy: number;
  /** Two fists: zoom by this factor this frame (1 = none; > 1 = in). */
  zoom: number;
  /** A one-shot command recognised this frame. */
  command: 'rotate' | 'cancel' | null;
  /** 0..1 towards the command being held, for the cursor. */
  commandProgress: number;
  /** A short human label of what is recognised, for the panel. */
  label: string;
  /** Head modes: still finding the neutral pose. */
  calibrating: boolean;
}

export function createGestureFrame(): GestureFrame {
  return {
    present: false,
    x: 0.5,
    y: 0.5,
    pressed: false,
    pressure: 0,
    grab: false,
    grabDx: 0,
    grabDy: 0,
    zoom: 1,
    command: null,
    commandProgress: 0,
    label: '',
    calibrating: false,
  };
}
