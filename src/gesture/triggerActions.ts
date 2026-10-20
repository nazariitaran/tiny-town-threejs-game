/**
 * What a one-shot trigger bound to an action does (pure), for the interpreters that bind triggers
 * (HeadInterpreter, PalmInterpreter): clicks, a toggled drag, pause and the commands.
 */
import type { TriggerAction } from './bindings';
import type { PointerSmoother } from './pointerSmoother';
import type { GestureFrame } from './protocol';

export class TriggerActions {
  paused = false;
  /** A drag toggled on (drag-toggle): the press stays down until the trigger fires again. */
  toggled = false;
  /** The press reported last frame: a new one pins the pointer. */
  wasPressed = false;

  constructor(
    private readonly frame: GestureFrame,
    private readonly pointer: PointerSmoother,
    private readonly recentre: () => void,
  ) {}

  /** Ends a pause or a toggled drag that no trigger is bound to end any more. */
  configure(bound: readonly TriggerAction[]): void {
    if (this.paused && !bound.includes('pause')) this.paused = false;
    if (this.toggled && !bound.includes('drag-toggle')) this.toggled = false;
  }

  /** A trigger bound to `action` fired at t; `from` is where a click from it lands (when the gesture began). */
  fire(action: TriggerAction, from: number, t: number): void {
    if (this.paused) {
      if (action === 'pause') {
        this.paused = false;
        this.frame.command = 'pause';
      }
      return;
    }
    switch (action) {
      case 'off':
      case 'hold':
        return;
      case 'click':
        if (!this.toggled) this.tap(from, t);
        return;
      case 'drag-toggle':
        this.toggled = !this.toggled;
        // Down and up both land where the gesture began.
        this.pointer.pressAt(t, Math.min(from, t));
        this.wasPressed = this.toggled;
        return;
      case 'cancel':
        this.toggled = false;
        this.frame.command = 'cancel';
        return;
      case 'rotate':
        this.frame.command = 'rotate';
        return;
      case 'pause':
        this.paused = true;
        this.toggled = false;
        this.frame.command = 'pause';
        return;
      case 'recentre':
        this.frame.command = 'recentre';
        this.recentre();
        return;
      default: {
        const never: never = action;
        return never;
      }
    }
  }

  tap(from: number, t: number): void {
    this.frame.tap = true;
    this.pointer.pressAt(t, Math.min(from, t));
  }
}
