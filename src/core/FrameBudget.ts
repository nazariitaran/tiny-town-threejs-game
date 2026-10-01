/** Caps the frame rate: activeFps while the player interacts, idleFps after idleAfterS without activity. */
export interface FrameBudgetTuning {
  /** 0 = the display's rate. */
  activeFps: number;
  idleFps: number;
  idleAfterS: number;
}

export const DEFAULT_FRAME_BUDGET: Readonly<FrameBudgetTuning> = { activeFps: 60, idleFps: 30, idleAfterS: 4 };

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'touchstart', 'touchmove'] as const;

export class FrameBudget {
  readonly tuning: FrameBudgetTuning = { ...DEFAULT_FRAME_BUDGET };
  private lastActive = -Infinity;
  private target: EventTarget | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

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

  /** Call while something moves because of the player (camera glide, pop-in, photo). */
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
