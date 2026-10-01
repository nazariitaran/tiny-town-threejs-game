/**
 * Frame budget (WP-24). The world always animates (cars, birds, wind, clouds), so without a cap the
 * game renders a full frame on every display refresh: 120 per second on a ProMotion Mac. The loop
 * is capped at `activeFps` while the player interacts and drops to `idleFps` once nothing has
 * happened for `idleAfterS` (no input, camera at rest, no tweens); any input restores it at once.
 */
export interface FrameBudgetTuning {
  /** Cap while the player interacts (0 = the display's rate). */
  activeFps: number;
  /** Cap while idle (ambient life only). */
  idleFps: number;
  /** Seconds without activity before the idle cap applies. */
  idleAfterS: number;
}

export const DEFAULT_FRAME_BUDGET: Readonly<FrameBudgetTuning> = { activeFps: 60, idleFps: 30, idleAfterS: 4 };

/** DOM events that count as player activity (window, capture phase, passive). */
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'touchstart', 'touchmove'] as const;

export class FrameBudget {
  readonly tuning: FrameBudgetTuning = { ...DEFAULT_FRAME_BUDGET };
  private lastActive = -Infinity;
  private target: EventTarget | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Listen for player input on `target` (the window). */
  attach(target: EventTarget): void {
    this.detach();
    this.target = target;
    for (const type of ACTIVITY_EVENTS) target.addEventListener(type, this.onActivity, { capture: true, passive: true });
    this.markActive();
  }

  detach(): void {
    if (!this.target) return;
    for (const type of ACTIVITY_EVENTS) this.target.removeEventListener(type, this.onActivity, { capture: true });
    this.target = null;
  }

  /** Something the player can see is moving because of them (camera glide, pop-in, photo). */
  markActive(): void {
    this.lastActive = this.now();
  }

  get idle(): boolean {
    return this.now() - this.lastActive >= this.tuning.idleAfterS * 1000;
  }

  /** The cap for this frame (0 = uncapped). */
  get targetFps(): number {
    return this.idle ? this.tuning.idleFps : this.tuning.activeFps;
  }

  private readonly onActivity = (): void => {
    this.markActive();
  };
}
