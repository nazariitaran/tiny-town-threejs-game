/** Pure parts of the on-screen camera controls (CameraPad), testable in Node. */
import type { GamePhase, HandsFreeMode } from '../game/events';

/** Press and hold: one step at once, the next after HOLD_DELAY_MS, then one every HOLD_INTERVAL_MS. */
export const HOLD_DELAY_MS = 450;
export const HOLD_INTERVAL_MS = 250;

/** Building only; shown by the setting or by head tracking (which leaves the setting alone). */
export function cameraPadVisible(phase: GamePhase, setting: boolean, handsFree: HandsFreeMode | null): boolean {
  return phase === 'building' && (setting || handsFree === 'head' || handsFree === 'head-hand');
}

type TimerHandle = unknown;

export interface RepeatTimers {
  setTimeout(callback: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

const browserTimers: RepeatTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/** Fires a step at once and keeps firing it until stop(); starting again replaces the running one. */
export class HoldRepeat {
  private timer: TimerHandle | null = null;
  private step: (() => void) | null = null;

  constructor(
    private readonly timers: RepeatTimers = browserTimers,
    private readonly delayMs = HOLD_DELAY_MS,
    private readonly intervalMs = HOLD_INTERVAL_MS,
  ) {}

  get active(): boolean {
    return this.step !== null;
  }

  start(step: () => void): void {
    this.stop();
    this.step = step;
    step();
    this.schedule(this.delayMs);
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.step = null;
  }

  private schedule(ms: number): void {
    this.timer = this.timers.setTimeout(() => {
      const step = this.step;
      if (!step) return;
      step();
      if (this.step === step) this.schedule(this.intervalMs);
    }, ms);
  }
}
