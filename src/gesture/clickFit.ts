/**
 * The "Fit my click" wizard (pure): rest the click hand, then move it the way that is easiest (up, sideways,
 * towards the body…) and hold it there. A step completes once the hand has held steady for `holdS`; the move
 * must reach CLICK_LENGTH.min from the rest. Fed the click hand as PalmInterpreter sees it (image coordinates,
 * palm size in frame heights); the move comes out in palm sizes, x > 0 towards screen right, y > 0 down.
 */
import { CLICK_LENGTH, type ClickVector } from './bindings';
import { SteadyHold } from './palmInterpreter';

export const CLICK_FIT_STEPS = ['rest', 'move'] as const;
export type ClickFitStep = (typeof CLICK_FIT_STEPS)[number];

export interface ClickFitTuning {
  holdS: number;
  /** Holding steady: within max(steady, steadyShare × the distance from the rest), in palm sizes. */
  steady: number;
  steadyShare: number;
  /** A step that hasn't completed in this long ends the wizard (nothing changes). */
  timeoutS: number;
}

export const DEFAULT_CLICK_FIT_TUNING: ClickFitTuning = { holdS: 0.6, steady: 0.15, steadyShare: 0.2, timeoutS: 30 };

/** move: not moved yet · further: moved, not far enough · hold: holding · lost: no click hand. */
export type ClickFitStatus = 'move' | 'further' | 'hold' | 'lost';

export type ClickFitEvent = { kind: 'step'; completed: 'rest' } | { kind: 'done'; click: ClickVector } | { kind: 'failed'; step: ClickFitStep };

/** The click hand this frame (PalmInterpreter's `clickHand` fits). */
export interface ClickFitHand {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

export class ClickFit {
  step: ClickFitStep | null = null;
  status: ClickFitStatus = 'move';
  /** 0..1 of the current hold. */
  progress = 0;
  /** The rest, in image coordinates, once the first step is done. */
  readonly rest = { x: 0, y: 0 };
  /** This frame's move from the rest in palm sizes (for the panel). */
  readonly offset = { x: 0, y: 0 };
  private stepStart = 0;
  private readonly hold = new SteadyHold();

  constructor(readonly tuning: ClickFitTuning = { ...DEFAULT_CLICK_FIT_TUNING }) {}

  get running(): boolean {
    return this.step !== null;
  }

  /** 0..1 through the whole wizard. */
  get overall(): number {
    return this.step === null ? 0 : (CLICK_FIT_STEPS.indexOf(this.step) + this.progress) / CLICK_FIT_STEPS.length;
  }

  start(t: number): void {
    this.begin('rest', t);
  }

  /** Redo the rest (from either step). */
  back(t: number): void {
    if (this.step !== null) this.begin('rest', t);
  }

  cancel(): void {
    this.step = null;
    this.progress = 0;
    this.hold.reset();
  }

  /** One frame's click hand (null: none), with the camera frame's width / height. */
  feed(hand: ClickFitHand | null, aspect: number, t: number): ClickFitEvent | null {
    const step = this.step;
    if (step === null) return null;
    const tuning = this.tuning;
    if (t - this.stepStart > tuning.timeoutS) {
      this.cancel();
      return { kind: 'failed', step };
    }
    if (!hand || !(hand.size > 0)) {
      this.status = 'lost';
      this.dropHold();
      return null;
    }

    if (step === 'rest') {
      this.status = 'hold';
      this.progress = Math.min(1, this.hold.update(hand.x, hand.y, t, aspect, hand.size, tuning.steady) / tuning.holdS);
      if (this.progress < 1) return null;
      this.rest.x = this.hold.mean.x;
      this.rest.y = this.hold.mean.y;
      this.begin('move', t);
      return { kind: 'step', completed: 'rest' };
    }

    const offset = this.offsetOf(hand.x, hand.y, aspect, hand.size, this.offset);
    const distance = Math.hypot(offset.x, offset.y);
    if (distance < CLICK_LENGTH.min) {
      this.status = distance > tuning.steady ? 'further' : 'move';
      this.dropHold();
      return null;
    }
    this.status = 'hold';
    const tolerance = Math.max(tuning.steady, tuning.steadyShare * distance);
    this.progress = Math.min(1, this.hold.update(hand.x, hand.y, t, aspect, hand.size, tolerance) / tuning.holdS);
    if (this.progress < 1) return null;
    const click = this.offsetOf(this.hold.mean.x, this.hold.mean.y, aspect, hand.size, { x: 0, y: 0 });
    const length = Math.hypot(click.x, click.y);
    if (length > CLICK_LENGTH.max) {
      click.x *= CLICK_LENGTH.max / length;
      click.y *= CLICK_LENGTH.max / length;
    }
    this.cancel();
    return { kind: 'done', click };
  }

  /** From the rest to (x, y) in image coords, mirrored, in palm sizes. */
  private offsetOf(x: number, y: number, aspect: number, size: number, out: { x: number; y: number }): { x: number; y: number } {
    out.x = ((this.rest.x - x) * aspect) / size;
    out.y = (y - this.rest.y) / size;
    return out;
  }

  private begin(step: ClickFitStep, t: number): void {
    this.step = step;
    this.stepStart = t;
    this.status = step === 'rest' ? 'hold' : 'move';
    this.dropHold();
  }

  private dropHold(): void {
    this.hold.reset();
    this.progress = 0;
  }
}
