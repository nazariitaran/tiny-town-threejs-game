/**
 * A tracked 2D pointer: One Euro smoothing plus a back-dated press. Making a click (pinching, opening
 * the mouth) moves the hand or head a little, so a press lands where the pointer was `backdateS`
 * earlier and holds there for `holdS`, then follows again (a drag). An eye click is back-dated to when
 * the eyes began to close, up to ~3 s at 30 results a second.
 */
import { OneEuroFilter, type OneEuroTuning } from './oneEuro';

export interface PressTuning {
  backdateS: number;
  holdS: number;
}

const HISTORY = 96;

export class PointerSmoother {
  readonly point = { x: 0.5, y: 0.5 };
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;
  /** Ring of (t, x, y) samples of the filtered pointer. */
  private readonly history = new Float64Array(HISTORY * 3);
  private head = 0;
  private count = 0;
  private holdUntil = -Infinity;
  private readonly held = { x: 0.5, y: 0.5 };

  constructor(
    filter: OneEuroTuning,
    readonly press: PressTuning = { backdateS: 0.1, holdS: 0.15 },
  ) {
    this.fx = new OneEuroFilter(filter);
    this.fy = new OneEuroFilter(filter);
  }

  /** Feeds a raw sample (any units) at time t (s) and returns the pointer to show. */
  update(x: number, y: number, t: number): { x: number; y: number } {
    const sx = this.fx.filter(x, t);
    const sy = this.fy.filter(y, t);
    const i = this.head * 3;
    this.history[i] = t;
    this.history[i + 1] = sx;
    this.history[i + 2] = sy;
    this.head = (this.head + 1) % HISTORY;
    this.count = Math.min(this.count + 1, HISTORY);
    if (t < this.holdUntil) {
      this.point.x = this.held.x;
      this.point.y = this.held.y;
    } else {
      this.point.x = sx;
      this.point.y = sy;
    }
    return this.point;
  }

  /** A press at time t: pins the pointer to where it was at `at` (default `backdateS` ago), for `holdS`. */
  pressAt(t: number, at = t - this.press.backdateS): { x: number; y: number } {
    this.holdAt(at, t + this.press.holdS);
    return this.point;
  }

  /** Holds the pointer where it was at `at` until unpin() or the next press (eyes shut: nothing to aim with). */
  pin(at: number): void {
    if (this.holdUntil === Infinity) return;
    this.holdAt(at, Infinity);
  }

  unpin(): void {
    if (this.holdUntil === Infinity) this.holdUntil = -Infinity;
  }

  private holdAt(at: number, until: number): void {
    // Newest to oldest: the first sample at or before `at` (or the oldest we have).
    let best = -1;
    for (let k = 1; k <= this.count; k += 1) {
      const i = ((this.head - k + HISTORY) % HISTORY) * 3;
      best = i;
      if (this.history[i] <= at) break;
    }
    if (best >= 0) {
      this.held.x = this.history[best + 1];
      this.held.y = this.history[best + 2];
    } else {
      this.held.x = this.point.x;
      this.held.y = this.point.y;
    }
    this.holdUntil = until;
    this.point.x = this.held.x;
    this.point.y = this.held.y;
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.count = 0;
    this.head = 0;
    this.holdUntil = -Infinity;
  }
}
