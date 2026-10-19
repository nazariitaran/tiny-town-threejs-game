/**
 * Blinks and winks as triggers (pure; no DOM, no MediaPipe). Times are in seconds.
 *
 *  both eyes shut  shorter than blinkMinS: an ordinary blink, ignored · blinkMinS..pauseS: 'blink', on
 *                  re-opening · pauseS or longer: 'long-blink', at once, while still shut
 *  one eye shut    with the other clearly open for winkMinS: 'wink-left' / 'wink-right', on re-opening
 *
 * Left and right are the player's own eyes. MediaPipe's eyeBlinkLeft is the subject's left eye (checked
 * against the eyelid landmarks: covering the eye on image-left, the subject's right, raises eyeBlinkRight),
 * so the blendshape names are used as they are.
 */

export type EyeSide = 'left' | 'right';
export type EyeEvent = 'blink' | 'long-blink' | 'wink-left' | 'wink-right';

/** A player's eyes as measured by the eye test: eyeBlink levels open and shut, and the smile at rest. */
export interface EyeCalibration {
  open: { left: number; right: number };
  closed: { left: number; right: number };
  smile: number;
  /** Passed the one-eye test: that wink is reliable enough to bind. */
  winkLeft: boolean;
  winkRight: boolean;
}

export interface EyeTiming {
  blinkMinS: number;
  pauseS: number;
  winkMinS: number;
}

export const DEFAULT_EYE_TIMING: EyeTiming = { blinkMinS: 0.35, pauseS: 1.5, winkMinS: 0.2 };

/** Per eye: shut at `on`, open again at `off`; "clearly open" (the other eye in a wink) at or below `clear`. */
export interface EyeThreshold {
  open: number;
  on: number;
  off: number;
  clear: number;
}

const DEFAULT_THRESHOLD: EyeThreshold = { open: 0.1, on: 0.5, off: 0.35, clear: 0.3 };

/** Between a calibrated open and shut level: shut 60 % of the way, open again below 40 %, clearly open below 30 %. */
const ON = 0.6;
const OFF = 0.4;
const CLEAR = 0.3;
/** Smaller gaps than this between open and shut can't be told apart from noise. */
export const MIN_EYE_SPAN = 0.2;
/** A smile this strong (above the resting smile) narrows the eyes: no eye triggers while it lasts. */
const SMILE_GATE = 0.6;
const SMILE_OVER_REST = 0.25;

export function eyeThreshold(calibration: EyeCalibration | null, side: EyeSide): EyeThreshold {
  if (!calibration) return { ...DEFAULT_THRESHOLD };
  const open = calibration.open[side];
  const span = calibration.closed[side] - open;
  if (!(span >= MIN_EYE_SPAN)) return { ...DEFAULT_THRESHOLD };
  return { open, on: open + ON * span, off: open + OFF * span, clear: open + CLEAR * span };
}

/** The smile level above which eye triggers pause. */
export function smileGate(calibration: EyeCalibration | null): number {
  return Math.max(SMILE_GATE, (calibration?.smile ?? 0) + SMILE_OVER_REST);
}

export class EyeTriggers {
  /** Live closure per eye, 0 open … 1 at the shut threshold (for meters). */
  readonly level = { left: 0, right: 0 };
  readonly shut = { left: false, right: false };
  /** 0..1 towards a long blink while both eyes are shut. */
  progress = 0;
  /** When the eyes began to close for the current closure or the event just fired (where its click lands). */
  from = 0;
  /** A deliberate closure is under way (past an ordinary blink): the pointer should hold still. */
  holding = false;
  private left: EyeThreshold;
  private right: EyeThreshold;
  private lastOpen = -Infinity;
  /** Eyes seen open since the last reset: a closure already under way when triggers come on doesn't count. */
  private armed = false;
  private active = false;
  private bothSince: number | null = null;
  private bothLongest = 0;
  private longFired = false;
  private winkEye: EyeSide | null = null;
  private winkSince = 0;
  private winkValid = false;

  constructor(
    public timing: EyeTiming = { ...DEFAULT_EYE_TIMING },
    calibration: EyeCalibration | null = null,
  ) {
    this.left = eyeThreshold(calibration, 'left');
    this.right = eyeThreshold(calibration, 'right');
  }

  calibrate(calibration: EyeCalibration | null): void {
    this.left = eyeThreshold(calibration, 'left');
    this.right = eyeThreshold(calibration, 'right');
    this.reset();
  }

  /** `allowed` false (smiling, too slow, under test) drops any closure in progress. Returns the event this frame. */
  update(left: number, right: number, t: number, allowed = true): EyeEvent | null {
    this.level.left = closure(left, this.left);
    this.level.right = closure(right, this.right);
    if (!allowed) {
      this.reset();
      this.lastOpen = t;
      return null;
    }
    const shut = this.shut;
    shut.left = shut.left ? left > this.left.off : left >= this.left.on;
    shut.right = shut.right ? right > this.right.off : right >= this.right.on;
    const any = shut.left || shut.right;
    if (!this.active) {
      if (!any) {
        this.armed = true;
        this.lastOpen = t;
        return null;
      }
      if (!this.armed) return null;
      this.begin();
    }

    let event: EyeEvent | null = null;
    const timing = this.timing;
    if (shut.left && shut.right) {
      this.bothSince ??= t;
      this.winkValid = false;
      const held = t - this.bothSince;
      this.progress = Math.min(1, held / timing.pauseS);
      if (!this.longFired && held >= timing.pauseS) {
        this.longFired = true;
        event = 'long-blink';
      }
    } else {
      if (this.bothSince !== null) {
        this.bothLongest = Math.max(this.bothLongest, t - this.bothSince);
        this.bothSince = null;
      }
      this.progress = 0;
      if (any && this.bothLongest === 0) {
        const eye: EyeSide = shut.left ? 'left' : 'right';
        const otherClear = eye === 'left' ? right <= this.right.clear : left <= this.left.clear;
        if (this.winkEye === null) {
          this.winkEye = eye;
          this.winkSince = t;
          this.winkValid = otherClear;
        } else if (this.winkEye !== eye || !otherClear) {
          this.winkValid = false;
        }
      }
    }

    const bothHeld = this.bothSince !== null ? t - this.bothSince : 0;
    this.holding = !this.longFired && (bothHeld >= timing.blinkMinS || (this.winkValid && t - this.winkSince >= timing.winkMinS));

    if (!any) {
      if (!this.longFired) {
        if (this.bothLongest >= timing.blinkMinS) event = 'blink';
        else if (this.bothLongest === 0 && this.winkValid && this.winkEye && t - this.winkSince >= timing.winkMinS) event = this.winkEye === 'left' ? 'wink-left' : 'wink-right';
      }
      this.active = false;
      this.holding = false;
      this.lastOpen = t;
    }
    return event;
  }

  reset(): void {
    this.shut.left = false;
    this.shut.right = false;
    this.armed = false;
    this.active = false;
    this.holding = false;
    this.progress = 0;
    this.bothSince = null;
  }

  private begin(): void {
    this.active = true;
    this.from = Number.isFinite(this.lastOpen) ? this.lastOpen : 0;
    this.bothSince = null;
    this.bothLongest = 0;
    this.longFired = false;
    this.winkEye = null;
    this.winkValid = false;
  }
}

function closure(value: number, threshold: EyeThreshold): number {
  const span = threshold.on - threshold.open;
  return span > 0 ? Math.min(1, Math.max(0, (value - threshold.open) / span)) : 0;
}

/** The eye test, one step at a time: a few seconds of samples in, a verdict out. */
export type EyeTestStep = 'open' | 'closed' | 'wink-left' | 'wink-right';

export type EyeTestOutcome =
  | { ok: true; calibration: EyeCalibration }
  | { ok: false; reason: string };

export const EYE_TEST = {
  /** Settle, then sample the open eyes. */
  openSettleS: 0.4,
  openS: 1,
  /** How long to wait for the eyes to close before giving up. */
  waitS: 8,
  closedS: 1,
  winkS: 0.6,
  /** A wink passes when the shut eye is this far shut and the open eye at most this far (fractions of the calibrated span). */
  winkShut: 0.6,
  winkOpen: 0.35,
} as const;

export class EyeTest {
  step: EyeTestStep | null = null;
  /** 0..1 through the current step's sampling. */
  progress = 0;
  /** Waiting for the eyes to do what was asked (closing), before sampling starts. */
  waiting = false;
  private started = 0;
  private samplingFrom: number | null = null;
  private sum = { left: 0, right: 0, smile: 0 };
  private n = 0;
  private hits = 0;
  private wrongEye = 0;

  constructor(private calibration: EyeCalibration | null = null) {}

  get result(): EyeCalibration | null {
    return this.calibration;
  }

  /** 'closed' and the winks need a calibration from 'open' (and 'closed') first. */
  start(step: EyeTestStep, t: number): void {
    this.step = step;
    this.started = t;
    this.progress = 0;
    this.waiting = step !== 'open';
    this.samplingFrom = step === 'open' ? t + EYE_TEST.openSettleS : null;
    this.sum = { left: 0, right: 0, smile: 0 };
    this.n = 0;
    this.hits = 0;
    this.wrongEye = 0;
  }

  /** A verdict when the step has run far too long (the face went missing); call every frame. */
  expire(t: number): EyeTestOutcome | null {
    if (!this.step || t - this.started <= EYE_TEST.waitS + EYE_TEST.openS + 1) return null;
    return this.finish({ ok: false, reason: 'I lost sight of your face. Face the camera and try again.' });
  }

  cancel(): void {
    this.step = null;
    this.progress = 0;
    this.waiting = false;
  }

  /** One frame of eyeBlink levels (player's own sides) and smile; a verdict when the step is over. */
  feed(left: number, right: number, smile: number, t: number): EyeTestOutcome | null {
    const step = this.step;
    if (!step) return null;
    const cal = this.calibration;
    if (step !== 'open' && !cal) return this.finish({ ok: false, reason: 'Do the open-eyes step first.' });
    if (step.startsWith('wink') && !hasSpan(cal!)) return this.finish({ ok: false, reason: 'Do the closed-eyes step first.' });

    if (this.samplingFrom === null) {
      if (t - this.started > EYE_TEST.waitS) {
        return this.finish({ ok: false, reason: step === 'closed' ? "I couldn't see your eyes close. Try again, in good light." : "I couldn't see that eye close. You can try again any time." });
      }
      if (!this.closing(left, right, step, cal!)) return null;
      this.waiting = false;
      this.samplingFrom = t;
    }
    if (t < this.samplingFrom) return null;
    const length = step === 'open' ? EYE_TEST.openS : step === 'closed' ? EYE_TEST.closedS : EYE_TEST.winkS;
    this.sum.left += left;
    this.sum.right += right;
    this.sum.smile += smile;
    this.n += 1;
    if (step === 'wink-left' || step === 'wink-right') {
      const verdict = winkSample(left, right, step === 'wink-left' ? 'left' : 'right', cal!);
      if (verdict === 'pass') this.hits += 1;
      else if (verdict === 'other') this.wrongEye += 1;
    }
    this.progress = Math.min(1, (t - this.samplingFrom) / length);
    if (this.progress < 1) return null;
    return this.finish(this.verdict(step));
  }

  private closing(left: number, right: number, step: EyeTestStep, cal: EyeCalibration): boolean {
    if (step === 'closed') return left - cal.open.left >= MIN_EYE_SPAN && right - cal.open.right >= MIN_EYE_SPAN;
    return shutFraction(left, cal, 'left') >= EYE_TEST.winkShut || shutFraction(right, cal, 'right') >= EYE_TEST.winkShut;
  }

  private verdict(step: EyeTestStep): EyeTestOutcome {
    const n = Math.max(1, this.n);
    const left = this.sum.left / n;
    const right = this.sum.right / n;
    const cal = this.calibration;
    switch (step) {
      case 'open':
        this.calibration = { open: { left, right }, closed: { left: 0, right: 0 }, smile: this.sum.smile / n, winkLeft: false, winkRight: false };
        return { ok: true, calibration: this.calibration };
      case 'closed': {
        if (!cal) return { ok: false, reason: 'Do the open-eyes step first.' };
        if (left - cal.open.left < MIN_EYE_SPAN || right - cal.open.right < MIN_EYE_SPAN) {
          return { ok: false, reason: 'Your eyes looked almost the same open and closed. Try again with your face well lit.' };
        }
        this.calibration = { ...cal, closed: { left, right }, winkLeft: false, winkRight: false };
        return { ok: true, calibration: this.calibration };
      }
      case 'wink-left':
      case 'wink-right': {
        if (!cal) return { ok: false, reason: 'Do the open-eyes step first.' };
        const side = step === 'wink-left' ? 'left' : 'right';
        const other = side === 'left' ? 'right' : 'left';
        if (this.hits >= n * 0.6) {
          this.calibration = { ...cal, [side === 'left' ? 'winkLeft' : 'winkRight']: true };
          return { ok: true, calibration: this.calibration };
        }
        return {
          ok: false,
          reason: this.wrongEye > this.hits
            ? `That looked like your ${other} eye. Close your ${side} eye: the one on the ${side} in the picture.`
            : `Both eyes moved together, which is very common. The ${side} wink stays off; blinks still work.`,
        };
      }
    }
  }

  private finish(outcome: EyeTestOutcome): EyeTestOutcome {
    this.step = null;
    this.waiting = false;
    this.progress = outcome.ok ? 1 : 0;
    return outcome;
  }
}

/** One frame of a wink test: the asked eye shut and the other open, the other way round, or neither. */
function winkSample(left: number, right: number, side: EyeSide, cal: EyeCalibration): 'pass' | 'other' | 'none' {
  const l = shutFraction(left, cal, 'left');
  const r = shutFraction(right, cal, 'right');
  const [asked, other] = side === 'left' ? [l, r] : [r, l];
  if (asked >= EYE_TEST.winkShut && other <= EYE_TEST.winkOpen) return 'pass';
  if (other >= EYE_TEST.winkShut && asked <= EYE_TEST.winkOpen) return 'other';
  return 'none';
}

/** 0 at the calibrated open level, 1 at the shut one. */
function shutFraction(value: number, cal: EyeCalibration, side: EyeSide): number {
  return (value - cal.open[side]) / Math.max(1e-3, cal.closed[side] - cal.open[side]);
}

function hasSpan(cal: EyeCalibration): boolean {
  return cal.closed.left - cal.open.left >= MIN_EYE_SPAN && cal.closed.right - cal.open.right >= MIN_EYE_SPAN;
}

/** A calibration complete enough to set thresholds from (open and shut both measured). */
export function isCalibrated(cal: EyeCalibration | null): cal is EyeCalibration {
  return cal !== null && hasSpan(cal);
}
