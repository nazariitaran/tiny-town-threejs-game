/**
 * A face → pointer, click and commands (pure; no DOM, no MediaPipe).
 *
 *  pointer  where the nose tip sits inside the face outline: turning or tilting the head moves it, moving
 *           the whole head sideways does not. Relative to a neutral pose taken while calibrating.
 *  click    open the mouth (blendshape jawOpen), held open = drag · or, in head + hand mode, a pinch
 *  cancel   raise the eyebrows (browInnerUp) briefly · rotate: hold a broad smile
 */
import { createGestureFrame, type FaceObservation, type GestureFrame } from './protocol';
import { PointerSmoother } from './pointerSmoother';
import type { OneEuroTuning } from './oneEuro';
import { HoldTrigger, ThresholdSwitch } from './triggers';

export interface HeadTuning {
  filter: OneEuroTuning;
  /** Viewport fractions per unit of nose offset (offset = fraction of face width / height). */
  gainX: number;
  gainY: number;
  /** Multiplies both gains (the panel's sensitivity). */
  sensitivity: number;
  calibrateS: number;
  mouthOpen: number;
  mouthClosed: number;
  mouthFrames: number;
  browUp: number;
  smile: number;
  commandHoldS: number;
  /** Longer than other holds: people smile while they play. */
  smileHoldS: number;
  lostS: number;
}

export const DEFAULT_HEAD_TUNING: HeadTuning = {
  filter: { minCutoff: 0.6, beta: 4, dCutoff: 1 },
  gainX: 5,
  gainY: 7,
  sensitivity: 1,
  calibrateS: 0.6,
  mouthOpen: 0.4,
  mouthClosed: 0.2,
  mouthFrames: 2,
  browUp: 0.55,
  smile: 0.7,
  commandHoldS: 0.4,
  smileHoldS: 0.9,
  lostS: 0.3,
};

/**
 * The nose's offset inside the face: x > 0 when the head turns to its own right (towards screen right
 * in a mirror), y > 0 when it tilts down. Fractions of the face's width and height; 0 is not neutral.
 */
export function noseOffset(face: FaceObservation, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  const width = Math.abs(face.cheekLeft.x - face.cheekRight.x);
  const height = Math.abs(face.chin.y - face.forehead.y);
  const midX = (face.cheekLeft.x + face.cheekRight.x) / 2;
  const midY = (face.chin.y + face.forehead.y) / 2;
  // The camera sees the subject's right on image-left: turning right moves the nose to smaller x.
  out.x = width > 1e-6 ? (midX - face.nose.x) / width : 0;
  out.y = height > 1e-6 ? (face.nose.y - midY) / height : 0;
  return out;
}

export class HeadInterpreter {
  readonly frame: GestureFrame = createGestureFrame();
  readonly pointer: PointerSmoother;
  private readonly mouth: ThresholdSwitch;
  private readonly cancel: HoldTrigger;
  private readonly rotate: HoldTrigger;
  private readonly neutral = { x: 0, y: 0 };
  private calibrationStart: number | null = null;
  private samples = 0;
  private readonly sum = { x: 0, y: 0 };
  private calibrated = false;
  private lastSeen = -Infinity;
  private readonly offset = { x: 0, y: 0 };

  constructor(readonly tuning: HeadTuning = { ...DEFAULT_HEAD_TUNING }) {
    this.pointer = new PointerSmoother(tuning.filter, { backdateS: 0.15, holdS: 0.2 });
    this.mouth = new ThresholdSwitch(tuning.mouthOpen, tuning.mouthClosed, tuning.mouthFrames, true);
    this.cancel = new HoldTrigger(tuning.commandHoldS);
    this.rotate = new HoldTrigger(tuning.smileHoldS);
  }

  /** Take the current pose as neutral again (the pointer re-centres). */
  recalibrate(): void {
    this.calibrated = false;
    this.calibrationStart = null;
    this.samples = 0;
    this.sum.x = 0;
    this.sum.y = 0;
    this.pointer.reset();
  }

  /**
   * `externalPress`: in head + hand mode, the pinch decides the click (null: the mouth does).
   * A press edge from it should be reported through the same frame, so the click is back-dated here.
   */
  update(face: FaceObservation | null, t: number, externalPress: boolean | null = null): GestureFrame {
    const f = this.frame;
    const tuning = this.tuning;
    f.command = null;
    f.zoom = 1;
    f.grab = false;
    f.grabDx = 0;
    f.grabDy = 0;
    if (!face) {
      if (t - this.lastSeen >= tuning.lostS) this.lose();
      return f;
    }
    this.lastSeen = t;
    f.present = true;
    const offset = noseOffset(face, this.offset);

    if (!this.calibrated) {
      if (this.calibrationStart === null) this.calibrationStart = t;
      this.sum.x += offset.x;
      this.sum.y += offset.y;
      this.samples += 1;
      f.calibrating = true;
      f.x = 0.5;
      f.y = 0.5;
      f.pressed = false;
      f.pressure = 0;
      f.label = 'Hold still: centring';
      if (t - this.calibrationStart < tuning.calibrateS) return f;
      this.neutral.x = this.sum.x / this.samples;
      this.neutral.y = this.sum.y / this.samples;
      this.calibrated = true;
    }
    f.calibrating = false;

    const k = tuning.sensitivity;
    const sx = clamp01(0.5 + (offset.x - this.neutral.x) * tuning.gainX * k);
    const sy = clamp01(0.5 + (offset.y - this.neutral.y) * tuning.gainY * k);
    this.pointer.update(sx, sy, t);

    const shapes = face.blendshapes;
    const jaw = shapes.jawOpen ?? 0;
    let pressedNow: boolean;
    if (externalPress === null) {
      pressedNow = this.mouth.update(jaw) && this.mouth.on;
      f.pressed = this.mouth.on;
      f.pressure = f.pressed ? 1 : clamp01(jaw / tuning.mouthOpen);
    } else {
      pressedNow = externalPress && !f.pressed;
      f.pressed = externalPress;
    }
    if (pressedNow) this.pointer.pressAt(t);
    f.x = this.pointer.point.x;
    f.y = this.pointer.point.y;

    const quiet = !f.pressed;
    const brow = shapes.browInnerUp ?? 0;
    const smile = ((shapes.mouthSmileLeft ?? 0) + (shapes.mouthSmileRight ?? 0)) / 2;
    if (this.cancel.update(quiet && brow >= tuning.browUp, t)) f.command = 'cancel';
    if (this.rotate.update(quiet && smile >= tuning.smile && brow < tuning.browUp, t)) f.command = 'rotate';
    f.commandProgress = Math.max(this.cancel.progress, this.rotate.progress);
    f.label = f.pressed ? (externalPress === null ? 'Mouth open: click' : 'Pinch: click') : brow >= tuning.browUp ? 'Eyebrows up' : smile >= tuning.smile ? 'Smile' : 'Face';
    return f;
  }

  reset(): void {
    this.lose();
    this.recalibrate();
  }

  private lose(): void {
    const f = this.frame;
    f.present = false;
    f.pressed = false;
    f.pressure = 0;
    f.commandProgress = 0;
    f.label = '';
    this.mouth.reset();
    this.cancel.reset();
    this.rotate.reset();
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
