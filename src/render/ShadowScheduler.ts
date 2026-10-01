/**
 * When to redraw the sun's shadow map (the renderer runs with `shadowMap.autoUpdate = false`).
 * Redraws at once after `invalidate()` and on every frame while tweens settle; cars and birds
 * refresh at their own rate (at 15 Hz a car's shadow visibly lags the car); otherwise the map is reused.
 */
export interface ShadowSchedulerTuning {
  /** Redraws per second while cars are on the roads. */
  carHz: number;
  /** Redraws per second while a flock is in the air. */
  birdHz: number;
}

export const DEFAULT_SHADOW_TUNING: Readonly<ShadowSchedulerTuning> = { carHz: 30, birdHz: 30 };

export interface ShadowFrame {
  /** Town tweens are running. */
  settling: boolean;
  /** Cars are drawn and moving. */
  cars: boolean;
  /** Birds are drawn and flying. */
  birds: boolean;
}

/** Frame-time jitter tolerance when comparing against a refresh period (seconds). */
const PERIOD_SLACK_S = 0.002;

export class ShadowScheduler {
  readonly tuning: ShadowSchedulerTuning = { ...DEFAULT_SHADOW_TUNING };
  /** Shadow-map redraws so far (diagnostics). */
  renders = 0;
  private dirty = true;
  private sinceRedraw = Infinity;

  invalidate(): void {
    this.dirty = true;
  }

  /** Advance by `delta` seconds; true when this frame must redraw the shadow map. */
  step(delta: number, frame: Readonly<ShadowFrame>): boolean {
    this.sinceRedraw += Math.max(delta, 0);
    let redraw = this.dirty || frame.settling;
    if (!redraw) {
      // The faster of the two rates, so neither caster's shadow lags.
      const hz = Math.max(frame.birds ? this.tuning.birdHz : 0, frame.cars ? this.tuning.carHz : 0);
      redraw = hz > 0 && this.sinceRedraw >= 1 / hz - PERIOD_SLACK_S;
    }
    if (redraw) {
      this.dirty = false;
      this.sinceRedraw = 0;
      this.renders += 1;
    }
    return redraw;
  }
}
