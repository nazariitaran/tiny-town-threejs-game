/** Debounced on/off signals for noisy per-frame detections. Times are in seconds. */

/** On after the condition has held for `onS`, off after it has been false for `offS`. */
export class Latch {
  on = false;
  private since: number | null = null;

  constructor(
    private readonly onS: number,
    private readonly offS: number,
  ) {}

  /** Returns true on the frame the latch changes state. */
  update(condition: boolean, t: number): boolean {
    if (condition === this.on) {
      this.since = null;
      return false;
    }
    if (this.since === null) this.since = t;
    if (t - this.since < (this.on ? this.offS : this.onS)) return false;
    this.on = condition;
    this.since = null;
    return true;
  }

  reset(): void {
    this.on = false;
    this.since = null;
  }
}

/** Fires once when the condition has held for `holdS`; re-arms when it stops. `progress` is 0..1 towards firing. */
export class HoldTrigger {
  progress = 0;
  /** When the current hold began (null: not holding). */
  since: number | null = null;
  private fired = false;

  constructor(private readonly holdS: number) {}

  update(condition: boolean, t: number): boolean {
    if (!condition) {
      this.since = null;
      this.fired = false;
      this.progress = 0;
      return false;
    }
    if (this.since === null) this.since = t;
    if (this.fired) return false;
    this.progress = this.holdS > 0 ? Math.min(1, (t - this.since) / this.holdS) : 1;
    if (this.progress < 1) return false;
    this.fired = true;
    return true;
  }

  reset(): void {
    this.since = null;
    this.fired = false;
    this.progress = 0;
  }
}

/**
 * Two thresholds on a scalar, so it doesn't chatter at the edge: switches on once the value has been
 * past `onAt` for `onFrames` frames in a row (below it, or above with `rising`), off once it is past `offAt`.
 */
export class ThresholdSwitch {
  on = false;
  private streak = 0;

  constructor(
    private readonly onAt: number,
    private readonly offAt: number,
    private readonly onFrames = 1,
    private readonly rising = false,
  ) {}

  /** `allowed` false holds it off (and resets the streak). Returns true on the frame it changes. */
  update(value: number, allowed = true): boolean {
    const was = this.on;
    if (!allowed) {
      this.on = false;
      this.streak = 0;
    } else if (this.on) {
      if (this.rising ? value < this.offAt : value > this.offAt) this.on = false;
    } else {
      this.streak = (this.rising ? value >= this.onAt : value <= this.onAt) ? this.streak + 1 : 0;
      if (this.streak >= this.onFrames) this.on = true;
    }
    if (this.on !== was) this.streak = 0;
    return this.on !== was;
  }

  reset(): void {
    this.on = false;
    this.streak = 0;
  }
}

/**
 * The tracking rate, measured from result timestamps (every result counts, with or without a face).
 * A slow machine delivers a result every 0.25 s or so, so "lost" must outlast a couple of those.
 */
export class FrameClock {
  /** Smoothed seconds between results; 0 until two have arrived. */
  interval = 0;
  private last = -Infinity;

  tick(t: number): void {
    const dt = t - this.last;
    this.last = t;
    if (!(dt > 0) || dt > 2) return;
    this.interval = this.interval === 0 ? dt : this.interval * 0.8 + dt * 0.2;
  }

  /** Results per second (0 until measured). */
  get rate(): number {
    return this.interval > 0 ? 1 / this.interval : 0;
  }

  /** How long without a detection counts as lost: `minS`, or 2.5 result intervals when those are longer. */
  lostAfter(minS: number): number {
    return Math.max(minS, 2.5 * this.interval);
  }

  reset(): void {
    this.interval = 0;
    this.last = -Infinity;
  }
}
