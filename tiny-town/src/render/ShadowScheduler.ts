/**
 * When to redraw the sun's shadow map (WP-24). Pure: no three.js.
 *
 * The renderer runs with `shadowMap.autoUpdate = false`; Game asks `step()` once per rendered frame.
 * Redrawing every caster every frame was the largest per-frame cost that grows with the town.
 *  - Redraw at once when the town changed (`invalidate()` on town:changed), the key light was
 *    re-aimed or the map resized (Environment.shadowVersion), and on every frame while pop-in /
 *    shrink-out tweens run (`settling`).
 *  - Moving casters that aren't the town — cars and birds — refresh at a lower rate of their own
 *    (birds faster: they cross the plot quickly and their wings flap).
 *  - Otherwise the map is reused: static towns cost no shadow pass at all.
 */
export interface ShadowSchedulerTuning {
  /** Redraws per second while cars are on the roads. */
  carHz: number;
  /** Redraws per second while a flock is in the air. */
  birdHz: number;
}

export const DEFAULT_SHADOW_TUNING: Readonly<ShadowSchedulerTuning> = { carHz: 15, birdHz: 30 };

export interface ShadowFrame {
  /** Town tweens are running (every frame). */
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

  /** The next frame must redraw the map. */
  invalidate(): void {
    this.dirty = true;
  }

  /** Advance by `delta` seconds; true when this frame must redraw the shadow map. */
  step(delta: number, frame: Readonly<ShadowFrame>): boolean {
    this.sinceRedraw += Math.max(delta, 0);
    let redraw = this.dirty || frame.settling;
    if (!redraw) {
      const hz = frame.birds ? this.tuning.birdHz : frame.cars ? this.tuning.carHz : 0;
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
