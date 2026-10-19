/**
 * Head offset → pointer target (pure). The offset is the head's pose minus its neutral pose, in the
 * source's own units: fractions of the face for the nose, radians for the head angle.
 *
 *  fit       per half-axis (left / right / up / down) comfortable extremes, from the Fit wizard; without
 *            one, fixed gains apply. `unit` is the offset as a fraction of that half-axis's extreme.
 *  direct    the pointer sits where the head points: neutral is the screen centre, `reach` of each
 *            extreme is that edge (so the edge comes without straining).
 *  joystick  past a dead zone the pointer moves at a speed rising with the offset; it stays put when the
 *            head comes back to neutral. Time-based, so the same at 4 or 30 results a second.
 */
import { OneEuroFilter, type OneEuroTuning } from './oneEuro';

export const POINTER_SOURCES = ['nose', 'angle'] as const;
export type PointerSource = (typeof POINTER_SOURCES)[number];

export const POINTER_STYLES = ['direct', 'joystick'] as const;
export type PointerStyle = (typeof POINTER_STYLES)[number];

/** Comfortable extremes away from neutral, each > 0, in the source's units. */
export interface HeadRange {
  left: number;
  right: number;
  up: number;
  down: number;
}

export type HeadRanges = Record<PointerSource, HeadRange | null>;

export const HALF_AXES = ['left', 'right', 'up', 'down'] as const;
export type HalfAxis = (typeof HALF_AXES)[number];

/** Per source: fixed gains (viewport fractions per unit) without a fit, and the wizard's thresholds (source units). */
export interface SourceTuning {
  gainX: number;
  gainY: number;
  /** A fit step needs at least this far from neutral. */
  minMove: number;
  /** Holding steady: within max(steady, steadyShare × the distance from neutral) of where the hold began. */
  steady: number;
  /** Largest believable extreme (parsing stored fits). */
  maxRange: number;
}

export const SOURCE_TUNING: Record<PointerSource, SourceTuning> = {
  // The edge at 10 % of the face width across, 7 % of its height down.
  nose: { gainX: 5, gainY: 7, minMove: 0.015, steady: 0.006, maxRange: 1 },
  // The edge at ~11.5° of turn and ~9.5° of tilt.
  angle: { gainX: 2.5, gainY: 3, minMove: 0.05, steady: 0.02, maxRange: 1.4 },
};

export interface HeadPointerTuning {
  /** The share of each extreme that reaches the screen edge (direct) or full speed (joystick). */
  reach: number;
  /** Joystick: no movement within this share of each extreme. */
  deadZone: number;
  /** Joystick: viewport fractions a second at `reach` (1: a screen width, or height, a second). */
  joystickSpeed: number;
  /** Joystick: speed rises as (share past the dead zone) ^ curve, for fine moves near it. */
  joystickCurve: number;
  /** Joystick: longest step integrated at once (a stall or a lost face doesn't fling the pointer). */
  maxStepS: number;
  /** Joystick: smoothing of the offset before it becomes a speed. */
  filter: OneEuroTuning;
}

export const DEFAULT_HEAD_POINTER: HeadPointerTuning = {
  reach: 0.9,
  deadZone: 0.15,
  joystickSpeed: 1,
  joystickCurve: 1.5,
  maxStepS: 0.5,
  filter: { minCutoff: 1, beta: 2, dCutoff: 1 },
};

/** The extreme a half-axis maps from: the fit's, or the one that reproduces the fixed gain. */
export function extremeOf(half: HalfAxis, source: PointerSource, fit: HeadRange | null, reach: number): number {
  if (fit) return fit[half];
  const gain = half === 'left' || half === 'right' ? SOURCE_TUNING[source].gainX : SOURCE_TUNING[source].gainY;
  return 1 / (2 * gain * reach);
}

/** The offset as a share of its half-axis's extreme (1 at the comfortable extreme, signed). */
export function unitOffset(dx: number, dy: number, source: PointerSource, fit: HeadRange | null, reach: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = dx / extremeOf(dx < 0 ? 'left' : 'right', source, fit, reach);
  out.y = dy / extremeOf(dy < 0 ? 'up' : 'down', source, fit, reach);
  return out;
}

/** Direct style: viewport fraction of a unit offset; `reach` hits the edge, before the sensitivity. */
export function directTarget(unit: number, reach: number, sensitivity: number): number {
  return clamp01(0.5 + (0.5 * unit * sensitivity) / reach);
}

/** Joystick style: signed speed (viewport fractions a second) for a unit offset. */
export function joystickSpeed(unit: number, tuning: HeadPointerTuning, sensitivity: number): number {
  const past = (Math.abs(unit) - tuning.deadZone) / (tuning.reach - tuning.deadZone);
  if (past <= 0) return 0;
  return Math.sign(unit) * tuning.joystickSpeed * sensitivity * Math.min(1, past) ** tuning.joystickCurve;
}

export class HeadPointer {
  source: PointerSource = 'nose';
  style: PointerStyle = 'direct';
  fit: HeadRange | null = null;
  /** This frame's offset as a share of the extremes (for the panel's indicator). */
  readonly unit = { x: 0, y: 0 };
  /** Where the pointer should go, in viewport fractions (before the pointer's own smoothing). */
  readonly target = { x: 0.5, y: 0.5 };
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;
  private lastT: number | null = null;

  constructor(readonly tuning: HeadPointerTuning = { ...DEFAULT_HEAD_POINTER }) {
    this.fx = new OneEuroFilter(tuning.filter);
    this.fy = new OneEuroFilter(tuning.filter);
  }

  /**
   * One frame: `dx`, `dy` is the offset from neutral. `held`: the pointer is pinned (a press, closed
   * eyes) at that point; the joystick resumes from there instead of drifting underneath.
   */
  update(dx: number, dy: number, t: number, sensitivity: number, held: { x: number; y: number } | null = null): { x: number; y: number } {
    const tuning = this.tuning;
    const unit = this.measure(dx, dy);
    const target = this.target;
    if (this.style === 'direct') {
      target.x = directTarget(unit.x, tuning.reach, sensitivity);
      target.y = directTarget(unit.y, tuning.reach, sensitivity);
      return target;
    }
    const ux = this.fx.filter(unit.x, t);
    const uy = this.fy.filter(unit.y, t);
    const dt = this.lastT === null ? 0 : Math.min(tuning.maxStepS, Math.max(0, t - this.lastT));
    this.lastT = t;
    if (held) {
      target.x = held.x;
      target.y = held.y;
      return target;
    }
    target.x = clamp01(target.x + joystickSpeed(ux, tuning, sensitivity) * dt);
    target.y = clamp01(target.y + joystickSpeed(uy, tuning, sensitivity) * dt);
    return target;
  }

  /** Updates `unit` only (the pointer isn't moving: the fit wizard). */
  measure(dx: number, dy: number): { x: number; y: number } {
    return unitOffset(dx, dy, this.source, this.fit, this.tuning.reach, this.unit);
  }

  /** The joystick starts again from (x, y), with no step to the first frame after (a lost face, a re-centre). */
  reset(x = 0.5, y = 0.5): void {
    this.target.x = x;
    this.target.y = y;
    this.unit.x = 0;
    this.unit.y = 0;
    this.lastT = null;
    this.fx.reset();
    this.fy.reset();
  }

  /** A gap in tracking: the next frame integrates nothing. */
  pause(): void {
    this.lastT = null;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
