/**
 * One Euro filter (Casiez, Roussel, Vogel, CHI 2012): a low-pass filter whose cutoff rises with speed,
 * so a still hand stays still and a fast one lags little. Times are in seconds.
 */
export interface OneEuroTuning {
  /** Cutoff (Hz) at rest: lower = steadier, laggier. */
  minCutoff: number;
  /** How fast the cutoff rises with speed: higher = less lag on quick moves. */
  beta: number;
  /** Cutoff (Hz) for the speed estimate. */
  dCutoff: number;
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(readonly tuning: OneEuroTuning) {}

  filter(value: number, t: number): number {
    if (this.x === null) {
      this.x = value;
      this.dx = 0;
      this.t = t;
      return value;
    }
    const dt = t - this.t;
    // A repeated or out-of-order timestamp: keep the last estimate rather than divide by zero.
    if (dt <= 0) return this.x;
    this.t = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.tuning.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.tuning.minCutoff + this.tuning.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}
