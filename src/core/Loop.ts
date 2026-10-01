/** Frames closer than this to the pacing interval still count as due (rAF timestamps jitter). */
export const FRAME_SLACK_MS = 1.5;

/**
 * Frame pacing (WP-24): whether a rAF tick at `time` should update + render, given the pacing
 * anchor of the last rendered tick and a target rate (0 = every display frame). Returns the new
 * anchor, or null to skip the tick. The anchor advances on a fixed grid (last + interval), so on
 * displays whose rate is not a multiple of the target (e.g. 144 Hz → 60) frames alternate between
 * 2 and 3 display frames and average the target exactly, instead of dropping to the next divisor.
 */
export function paceFrame(time: number, lastRender: number, targetFps: number): number | null {
  if (!(targetFps > 0)) return time;
  const interval = 1000 / targetFps;
  const elapsed = time - lastRender;
  if (elapsed < interval - FRAME_SLACK_MS) return null;
  // A frame or more behind (hidden tab, long task, a display slower than the cap): restart the grid.
  if (elapsed >= interval * 2) return time;
  return lastRender + interval;
}

export class Loop {
  private frameId = 0;
  private lastTime = 0;
  private lastRender = -Infinity;
  private running = false;

  /**
   * `targetFps` is read every tick (0 = the display's rate). Skipped ticks run neither update nor
   * render; `deltaSeconds` is the time since the last rendered tick.
   */
  constructor(
    private readonly update: (deltaSeconds: number, elapsedSeconds: number) => void,
    private readonly render: () => void,
    private readonly targetFps: () => number = () => 0,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.lastRender = -Infinity;
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  private readonly tick = (time: number) => {
    if (!this.running) return;
    const anchor = paceFrame(time, this.lastRender, this.targetFps());
    if (anchor === null) {
      this.frameId = requestAnimationFrame(this.tick);
      return;
    }
    this.lastRender = anchor;
    const deltaSeconds = Math.min(Math.max(time - this.lastTime, 0) / 1000, 0.05);
    this.lastTime = time;
    this.update(deltaSeconds, time / 1000);
    this.render();
    this.frameId = requestAnimationFrame(this.tick);
  };
}
