/** Seconds of frames averaged into one reading. */
export const FPS_WINDOW_S = 0.5;
/** A gap this long (hidden tab, long task) restarts the window instead of reporting a false low. */
const FPS_STALL_S = 2;

/** Averages the rendered frame rate over fixed windows. */
export class FpsMeter {
  private frames = 0;
  private windowStart = -1;

  /** Call once per rendered frame with its time in seconds; returns the rounded rate when a window closes, else null. */
  frame(time: number): number | null {
    const span = time - this.windowStart;
    if (this.windowStart < 0 || span >= FPS_STALL_S || span < 0) {
      this.reset();
      this.windowStart = time;
      return null;
    }
    this.frames += 1;
    if (span < FPS_WINDOW_S) return null;
    const fps = Math.round(this.frames / span);
    this.frames = 0;
    this.windowStart = time;
    return fps;
  }

  reset(): void {
    this.frames = 0;
    this.windowStart = -1;
  }
}
