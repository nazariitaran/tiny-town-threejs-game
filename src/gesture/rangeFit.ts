/**
 * The "Fit to my movement" wizard (pure): centre, then each comfortable extreme (left, right, up,
 * down). A step completes once the head has moved far enough from neutral the asked way and then held
 * steady for `holdS`; it records the mean of that hold. Signals are the pointer source's raw ones
 * (see headPointer.ts): x > 0 towards screen right, y > 0 down.
 */
import { SOURCE_TUNING, type HeadRange, type PointerSource } from './headPointer';

export const FIT_STEPS = ['centre', 'left', 'right', 'up', 'down'] as const;
export type FitStep = (typeof FIT_STEPS)[number];

export interface FitTuning {
  holdS: number;
  /** Steadiness grows with the distance from neutral: a held extreme trembles more than a rest. */
  steadyShare: number;
  /** A step that hasn't completed in this long ends the wizard (nothing changes). */
  timeoutS: number;
}

export const DEFAULT_FIT_TUNING: FitTuning = { holdS: 0.6, steadyShare: 0.2, timeoutS: 30 };

/** move: not there yet · further: the right way, not far enough · hold: holding · lost: no face. */
export type FitStatus = 'move' | 'further' | 'hold' | 'lost';

export type FitEvent = { kind: 'step'; completed: FitStep } | { kind: 'done'; range: HeadRange; neutral: { x: number; y: number } } | { kind: 'failed'; step: FitStep };

export class RangeFit {
  step: FitStep | null = null;
  status: FitStatus = 'move';
  /** 0..1 of the current hold. */
  progress = 0;
  readonly neutral = { x: 0, y: 0 };
  readonly range: HeadRange = { left: 0, right: 0, up: 0, down: 0 };
  private source: PointerSource = 'nose';
  private stepStart = 0;
  private anchorT: number | null = null;
  private readonly anchor = { x: 0, y: 0 };
  private readonly sum = { x: 0, y: 0, along: 0 };
  private samples = 0;

  constructor(readonly tuning: FitTuning = { ...DEFAULT_FIT_TUNING }) {}

  get running(): boolean {
    return this.step !== null;
  }

  /** 0..1 through the whole wizard. */
  get overall(): number {
    return this.step === null ? 0 : (FIT_STEPS.indexOf(this.step) + this.progress) / FIT_STEPS.length;
  }

  start(source: PointerSource, t: number): void {
    this.source = source;
    this.begin('centre', t);
  }

  /** Redo the step before this one (the centre redoes itself). */
  back(t: number): void {
    if (this.step === null) return;
    this.begin(FIT_STEPS[Math.max(0, FIT_STEPS.indexOf(this.step) - 1)], t);
  }

  cancel(): void {
    this.step = null;
    this.progress = 0;
    this.anchorT = null;
  }

  /** One frame's signal (null: no face). */
  feed(x: number | null, y: number | null, t: number): FitEvent | null {
    const step = this.step;
    if (step === null) return null;
    if (t - this.stepStart > this.tuning.timeoutS) {
      this.cancel();
      return { kind: 'failed', step };
    }
    if (x === null || y === null) {
      this.status = 'lost';
      this.dropHold();
      return null;
    }
    const along = this.along(step, x, y);
    const units = SOURCE_TUNING[this.source];
    const far = step === 'centre' || along >= units.minMove;
    if (!far) {
      this.status = along > units.steady ? 'further' : 'move';
      this.dropHold();
      return null;
    }
    const tolerance = Math.max(units.steady, this.tuning.steadyShare * Math.max(0, along));
    if (this.anchorT === null || Math.hypot(x - this.anchor.x, y - this.anchor.y) > tolerance) {
      this.anchorT = t;
      this.anchor.x = x;
      this.anchor.y = y;
      this.sum.x = 0;
      this.sum.y = 0;
      this.sum.along = 0;
      this.samples = 0;
    }
    this.status = 'hold';
    this.sum.x += x;
    this.sum.y += y;
    this.sum.along += along;
    this.samples += 1;
    this.progress = Math.min(1, (t - this.anchorT) / this.tuning.holdS);
    if (this.progress < 1) return null;

    if (step === 'centre') {
      this.neutral.x = this.sum.x / this.samples;
      this.neutral.y = this.sum.y / this.samples;
    } else {
      this.range[step] = Math.max(units.minMove, this.sum.along / this.samples);
    }
    const next = FIT_STEPS[FIT_STEPS.indexOf(step) + 1];
    if (next === undefined) {
      this.cancel();
      return { kind: 'done', range: { ...this.range }, neutral: { ...this.neutral } };
    }
    this.begin(next, t);
    return { kind: 'step', completed: step };
  }

  /** How far the signal is from neutral the way the step asks (negative: the other way). */
  private along(step: FitStep, x: number, y: number): number {
    const dx = x - this.neutral.x;
    const dy = y - this.neutral.y;
    switch (step) {
      case 'centre':
        return 0;
      case 'left':
        return -dx;
      case 'right':
        return dx;
      case 'up':
        return -dy;
      case 'down':
        return dy;
      default: {
        const never: never = step;
        return never;
      }
    }
  }

  private begin(step: FitStep, t: number): void {
    this.step = step;
    this.stepStart = t;
    this.status = step === 'centre' ? 'hold' : 'move';
    this.dropHold();
  }

  private dropHold(): void {
    this.anchorT = null;
    this.progress = 0;
  }
}
