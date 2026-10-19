/**
 * A face → pointer, clicks and commands (pure; no DOM, no MediaPipe).
 *
 *  pointer   the nose tip inside the face outline (turning or tilting the head moves it, moving the whole
 *            head sideways does not), or the head's yaw and pitch; relative to a neutral pose taken while
 *            calibrating, mapped by headPointer.ts (fixed gains or a fit, direct or joystick).
 *  triggers  blink, long blink, wink left / right (eyeTriggers), mouth open (jawOpen), raised eyebrows
 *            (browInnerUp, held), smile (held), and a key or switch; each bound to an action (bindings.ts).
 *            In head + hand mode a pinch also presses.
 */
import { createGestureFrame, type FaceObservation, type GestureFrame } from './protocol';
import { PointerSmoother } from './pointerSmoother';
import { HeadPointer, type HeadRange, type PointerSource, type PointerStyle } from './headPointer';
import type { OneEuroTuning } from './oneEuro';
import { FrameClock, HoldTrigger, ThresholdSwitch } from './triggers';
import { PRESETS, type Bindings, type FaceTrigger } from './bindings';
import { DEFAULT_EYE_TIMING, EyeTriggers, smileGate, type EyeCalibration, type EyeTiming } from './eyeTriggers';

export interface HeadTuning {
  filter: OneEuroTuning;
  /** Multiplies the pointer's movement (the panel's sensitivity): gains or fit, and joystick speed. */
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
  /** At least this long without a face before it counts as lost (longer when results come slowly). */
  lostS: number;
  /** Eye triggers need this many results a second to time a blink; they switch back on at `eyeRateOn`. */
  eyeRateOff: number;
  eyeRateOn: number;
}

export const DEFAULT_HEAD_TUNING: HeadTuning = {
  filter: { minCutoff: 0.6, beta: 4, dCutoff: 1 },
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
  eyeRateOff: 13,
  eyeRateOn: 15,
};

/** Live trigger signals for the panel's meters: 0..1, 1 at the point the trigger fires. */
export type TriggerSignals = Record<FaceTrigger, number>;

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

/** The pointer source's raw signal for this face; null when it has none (no angles came with it). */
export function sourceSignal(face: FaceObservation, source: PointerSource, out: { x: number; y: number }): { x: number; y: number } | null {
  if (source === 'nose') return noseOffset(face, out);
  if (face.yaw === undefined || face.pitch === undefined) return null;
  out.x = face.yaw;
  out.y = face.pitch;
  return out;
}

export class HeadInterpreter {
  readonly frame: GestureFrame = createGestureFrame();
  readonly pointer: PointerSmoother;
  /** Source, style and fit of the pointer. */
  readonly mapper = new HeadPointer();
  /** This frame's raw source signal (see `sourceSignal`); `hasSignal` false when the face gave none. */
  readonly signal = { x: 0, y: 0 };
  hasSignal = false;
  /** The fit wizard is running: the pointer holds still (its Cancel sits under it) while the head roams. */
  pointerFrozen = false;
  readonly eyes: EyeTriggers;
  readonly clock = new FrameClock();
  readonly signals: TriggerSignals = { blink: 0, 'long-blink': 0, 'wink-left': 0, 'wink-right': 0, mouth: 0, brows: 0, smile: 0, key: 0 };
  /** This frame's eyeBlink levels (player's own sides) and smile, for the eye test. */
  readonly raw = { left: 0, right: 0, smile: 0 };
  /** Eye triggers are on: tracking is fast enough to time a blink. */
  eyesLive = false;
  /** The eye test is running: closing the eyes on request mustn't click or pause. */
  eyesSuspended = false;
  private bindings: Bindings = { ...PRESETS.classic };
  private calibration: EyeCalibration | null = null;
  private readonly mouth: ThresholdSwitch;
  private readonly brows: HoldTrigger;
  private readonly smile: HoldTrigger;
  private readonly neutral = { x: 0, y: 0 };
  private calibrationStart: number | null = null;
  private samples = 0;
  private readonly sum = { x: 0, y: 0 };
  private calibrated = false;
  private lastSeen = -Infinity;
  private paused = false;
  /** A drag toggled on (drag-toggle): the press stays down until the trigger fires again. */
  private toggled = false;
  private keyDown = false;
  /** Key presses since the last frame (a press and release can both fall between two frames). */
  private keyPresses = 0;
  private wasPressed = false;

  constructor(
    readonly tuning: HeadTuning = { ...DEFAULT_HEAD_TUNING },
    eyeTiming: EyeTiming = { ...DEFAULT_EYE_TIMING },
  ) {
    this.pointer = new PointerSmoother(tuning.filter, { backdateS: 0.15, holdS: 0.2 });
    this.mouth = new ThresholdSwitch(tuning.mouthOpen, tuning.mouthClosed, tuning.mouthFrames, true);
    this.brows = new HoldTrigger(tuning.commandHoldS);
    this.smile = new HoldTrigger(tuning.smileHoldS);
    this.eyes = new EyeTriggers(eyeTiming);
  }

  /** The bindings in force (winks already gated by the eye test) and the eye calibration. */
  configure(bindings: Bindings, calibration: EyeCalibration | null): void {
    this.bindings = { ...bindings };
    if (calibration !== this.calibration) {
      this.calibration = calibration;
      this.eyes.calibrate(calibration);
    }
    if (this.paused && !Object.values(bindings).includes('pause')) this.paused = false;
    if (this.toggled && !Object.values(bindings).includes('drag-toggle')) this.toggled = false;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Esc from anywhere ends a toggled drag. */
  releaseToggle(): void {
    this.toggled = false;
  }

  /** The switch key went down or up (between frames; read on the next one). */
  keyInput(down: boolean): void {
    if (down && !this.keyDown) this.keyPresses += 1;
    this.keyDown = down;
  }

  /** Take the current pose as neutral again (the pointer re-centres; a fit's ranges stay). */
  recalibrate(): void {
    this.calibrated = false;
    this.calibrationStart = null;
    this.samples = 0;
    this.sum.x = 0;
    this.sum.y = 0;
    this.pointer.reset();
    this.mapper.reset();
  }

  /** A new source re-centres (its signal has other units); a new style continues from where the pointer is. */
  configurePointer(source: PointerSource, style: PointerStyle, fit: HeadRange | null): void {
    const mapper = this.mapper;
    mapper.fit = fit;
    if (style !== mapper.style) {
      mapper.style = style;
      mapper.reset(this.pointer.point.x, this.pointer.point.y);
    }
    if (source !== mapper.source) {
      mapper.source = source;
      this.recalibrate();
    }
  }

  /** The neutral pose in source units, once calibrated. */
  get neutralPose(): { readonly x: number; readonly y: number } | null {
    return this.calibrated ? this.neutral : null;
  }

  /** Takes a measured neutral pose (the fit wizard's centre) instead of calibrating. */
  setNeutral(x: number, y: number): void {
    this.neutral.x = x;
    this.neutral.y = y;
    this.calibrated = true;
    this.calibrationStart = null;
  }

  /**
   * `externalPress`: in head + hand mode, the pinch (null: no hand). A press edge from it should be
   * reported through the same frame, so the click is back-dated here.
   */
  update(face: FaceObservation | null, t: number, externalPress: boolean | null = null): GestureFrame {
    const f = this.frame;
    const tuning = this.tuning;
    f.command = null;
    f.tap = false;
    f.zoom = 1;
    f.grab = false;
    f.grabDx = 0;
    f.grabDy = 0;
    this.clock.tick(t);
    const rate = this.clock.rate;
    this.eyesLive = this.eyesLive ? rate >= tuning.eyeRateOff : rate >= tuning.eyeRateOn;
    if (!face) {
      if (t - this.lastSeen >= this.clock.lostAfter(tuning.lostS)) this.lose();
      return f;
    }
    this.lastSeen = t;
    f.present = true;
    const signal = sourceSignal(face, this.mapper.source, this.signal);
    this.hasSignal = signal !== null;
    const shapes = face.blendshapes;

    if (!this.calibrated) {
      if (this.calibrationStart === null) this.calibrationStart = t;
      if (signal) {
        this.sum.x += signal.x;
        this.sum.y += signal.y;
        this.samples += 1;
      }
      f.calibrating = true;
      f.x = 0.5;
      f.y = 0.5;
      f.pressed = false;
      f.pressure = 0;
      f.label = 'Hold still: centring';
      this.keyPresses = 0;
      this.readRaw(shapes);
      if (t - this.calibrationStart < tuning.calibrateS || this.samples === 0) return f;
      this.neutral.x = this.sum.x / this.samples;
      this.neutral.y = this.sum.y / this.samples;
      this.calibrated = true;
    }
    f.calibrating = false;

    if (signal) {
      const dx = signal.x - this.neutral.x;
      const dy = signal.y - this.neutral.y;
      if (this.pointerFrozen) {
        this.mapper.measure(dx, dy);
        this.mapper.pause();
      } else {
        const target = this.mapper.update(dx, dy, t, tuning.sensitivity, this.pointer.isHolding(t) ? this.pointer.point : null);
        this.pointer.update(target.x, target.y, t);
      }
    } else {
      this.mapper.pause();
    }

    const bindings = this.bindings;
    const signals = this.signals;
    this.readRaw(shapes);
    const jaw = shapes.jawOpen ?? 0;
    const brow = shapes.browInnerUp ?? 0;
    const smile = this.raw.smile;

    // Level triggers: the mouth and the key hold while on; bound to anything else they fire when they come on.
    const mouthOn = this.mouth.update(jaw) && this.mouth.on;
    let levelHeld = false;
    let pressFrom = t - this.pointer.press.backdateS;
    if (bindings.mouth === 'hold') levelHeld ||= this.mouth.on;
    else if (mouthOn) this.fire('mouth', t - this.pointer.press.backdateS, t);
    const keyPresses = this.keyPresses;
    this.keyPresses = 0;
    if (bindings.key === 'hold') {
      if (keyPresses > 0 && !this.keyDown && !this.paused) this.tap(t, t);
      levelHeld ||= this.keyDown;
      if (this.keyDown && !this.mouth.on) pressFrom = t;
    } else if (keyPresses > 0) {
      this.fire('key', t, t);
    }

    const quiet = !levelHeld;
    if (this.brows.update(quiet && brow >= tuning.browUp, t)) this.fire('brows', this.brows.since ?? t, t);
    if (this.smile.update(quiet && smile >= tuning.smile && brow < tuning.browUp, t)) this.fire('smile', this.smile.since ?? t, t);

    // Eyes: off while too slow to time them, while smiling (the cheeks close them), and during the eye test.
    const eyesAllowed = this.eyesLive && !this.eyesSuspended && smile < smileGate(this.calibration) && this.usesEyes();
    const event = this.eyes.update(this.raw.left, this.raw.right, t, eyesAllowed);
    if (event) this.fire(event, this.eyes.from, t);
    if (this.eyes.holding && this.bindsEyeAction(this.eyes)) this.pointer.pin(this.eyes.from);
    else this.pointer.unpin();

    const pressed = !this.paused && (this.toggled || levelHeld || externalPress === true);
    if (pressed && !this.wasPressed && !f.tap) {
      if (externalPress === true && !this.toggled && !levelHeld) pressFrom = t - this.pointer.press.backdateS;
      this.pointer.pressAt(t, Math.min(pressFrom, t));
    }
    this.wasPressed = pressed;
    f.pressed = pressed;
    if (pressed) f.tap = false;
    f.paused = this.paused;
    f.x = this.pointer.point.x;
    f.y = this.pointer.point.y;

    signals.mouth = clamp01(jaw / tuning.mouthOpen);
    signals.brows = clamp01(brow / tuning.browUp);
    signals.smile = clamp01(smile / tuning.smile);
    signals.key = this.keyDown ? 1 : 0;
    signals['wink-left'] = this.eyes.level.left;
    signals['wink-right'] = this.eyes.level.right;
    signals.blink = Math.min(this.eyes.level.left, this.eyes.level.right);
    signals['long-blink'] = this.eyes.progress;
    f.pressure = pressed ? 1 : bindings.mouth === 'hold' ? signals.mouth : 0;
    f.commandProgress = Math.max(this.brows.progress, this.smile.progress, bindings['long-blink'] !== 'off' ? this.eyes.progress : 0);
    f.label = this.label(brow, smile, levelHeld, externalPress);
    return f;
  }

  reset(): void {
    this.lose();
    this.recalibrate();
    this.clock.reset();
    this.eyesLive = false;
    this.paused = false;
  }

  private readRaw(shapes: Record<string, number>): void {
    this.raw.left = shapes.eyeBlinkLeft ?? 0;
    this.raw.right = shapes.eyeBlinkRight ?? 0;
    this.raw.smile = ((shapes.mouthSmileLeft ?? 0) + (shapes.mouthSmileRight ?? 0)) / 2;
  }

  private usesEyes(): boolean {
    const b = this.bindings;
    return b.blink !== 'off' || b['long-blink'] !== 'off' || b['wink-left'] !== 'off' || b['wink-right'] !== 'off';
  }

  /** Whether the closure under way would do something (only then does the pointer hold still). */
  private bindsEyeAction(eyes: EyeTriggers): boolean {
    const b = this.bindings;
    if (eyes.shut.left && eyes.shut.right) return b.blink !== 'off' || b['long-blink'] !== 'off';
    return eyes.shut.left ? b['wink-left'] !== 'off' : b['wink-right'] !== 'off';
  }

  /** A one-shot trigger fired; `from` is where a click from it lands (when the gesture began). */
  private fire(trigger: FaceTrigger, from: number, t: number): void {
    const action = this.bindings[trigger];
    if (this.paused) {
      if (action === 'pause') {
        this.paused = false;
        this.frame.command = 'pause';
      }
      return;
    }
    switch (action) {
      case 'off':
      case 'hold':
        return;
      case 'click':
        if (!this.toggled) this.tap(from, t);
        return;
      case 'drag-toggle':
        this.toggled = !this.toggled;
        // Down and up both land where the gesture began.
        this.pointer.pressAt(t, Math.min(from, t));
        this.wasPressed = this.toggled;
        return;
      case 'cancel':
        this.toggled = false;
        this.frame.command = 'cancel';
        return;
      case 'rotate':
        this.frame.command = 'rotate';
        return;
      case 'pause':
        this.paused = true;
        this.toggled = false;
        this.frame.command = 'pause';
        return;
      case 'recentre':
        this.frame.command = 'recentre';
        this.recalibrate();
        return;
      default: {
        const never: never = action;
        return never;
      }
    }
  }

  private tap(from: number, t: number): void {
    this.frame.tap = true;
    this.pointer.pressAt(t, Math.min(from, t));
  }

  private label(brow: number, smile: number, levelHeld: boolean, externalPress: boolean | null): string {
    if (this.paused) return 'Paused';
    if (this.toggled) return 'Dragging';
    if (externalPress) return 'Pinch: click';
    if (levelHeld) return this.mouth.on ? 'Mouth open: click' : 'Key held: click';
    const eyes = this.eyes;
    if (eyes.shut.left && eyes.shut.right) return 'Eyes closed';
    if (eyes.shut.left || eyes.shut.right) return eyes.shut.left ? 'Left eye closed' : 'Right eye closed';
    if (brow >= this.tuning.browUp) return 'Eyebrows up';
    if (smile >= this.tuning.smile) return 'Smile';
    return 'Face';
  }

  private lose(): void {
    const f = this.frame;
    f.present = false;
    f.pressed = false;
    f.tap = false;
    f.pressure = 0;
    f.commandProgress = 0;
    f.label = '';
    this.mouth.reset();
    this.brows.reset();
    this.smile.reset();
    this.eyes.reset();
    this.pointer.unpin();
    this.mapper.pause();
    this.hasSignal = false;
    this.toggled = false;
    this.wasPressed = false;
    this.keyPresses = 0;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
