/**
 * Sends a GestureFrame where a mouse would go. Over the 3D view it becomes `intent:virtual-pointer`
 * (ToolController builds with it). Over a DOM control a press then release on the same control clicks
 * it, so the dock, top bar, menus and this module's own panel work through their normal handlers. A
 * press keeps its target until release, like pointer capture: a road stroke can cross the dock. A tap
 * (a blink, a wink) is a press and release at once.
 * Fists and two-hand zoom move the camera through their own intents; rotate is `intent:rotate`; cancel
 * presses Escape (same meaning as the key everywhere: put back, put away, close).
 * Controls marked `data-repeat` (step buttons) repeat while held, and while dwelt on.
 */
import type { GameBus } from '../game/events';
import type { GestureCommand, GestureFrame } from './protocol';
import { HoldTrigger } from './triggers';

const DWELL_REARM_PX = 40;

/** A held press on a `data-repeat` control clicks at once, again after REPEAT_DELAY_S, then every REPEAT_EVERY_S. */
export const REPEAT_DELAY_S = 0.45;
export const REPEAT_EVERY_S = 0.25;

/** What a click can land on. */
const CLICKABLE = 'button, a[href], input, select, label, summary, [role="button"], [role="tab"]';

export interface RouterState {
  x: number;
  y: number;
  overCanvas: boolean;
  /** 0..1: dwell or command progress, for the cursor ring. */
  progress: number;
  pressed: boolean;
  grab: boolean;
  present: boolean;
  paused: boolean;
  /** The hovered control's accessible name, if any. */
  hoverLabel: string | null;
}

/** Where a command goes: the game's rotate, an Escape key, or nowhere (the interpreter already acted on it). */
export function commandRoute(command: GestureCommand): 'rotate' | 'escape' | 'none' {
  switch (command) {
    case 'rotate':
      return 'rotate';
    case 'cancel':
      return 'escape';
    case 'pause':
    case 'recentre':
      return 'none';
    default: {
      const never: never = command;
      return never;
    }
  }
}

export class GestureRouter {
  readonly state: RouterState = { x: 0, y: 0, overCanvas: false, progress: 0, pressed: false, grab: false, present: false, paused: false, hoverLabel: null };
  /** Clicks delivered to DOM controls, presses on the canvas, taps (diagnostics for the panel and tests). */
  readonly counts = { domClicks: 0, canvasPresses: 0, commands: 0, taps: 0 };
  private wasPressed = false;
  private captured: 'canvas' | HTMLElement | 'none' | null = null;
  private hovered: HTMLElement | null = null;
  private onCanvas = false;
  private lastX = NaN;
  private lastY = NaN;
  /** Hovering a DOM control this long clicks it; null = off. */
  private dwell: HoldTrigger | null = null;
  private dwellTarget: HTMLElement | null = null;
  /** Where the last dwell click fired: no new one until the cursor moves DWELL_REARM_PX away (a click may re-render the control). */
  private dwellAt: { x: number; y: number } | null = null;
  /** Next repeat time of a held `data-repeat` control (NaN: none). */
  private repeatAt = NaN;

  constructor(
    private readonly bus: GameBus,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  apply(frame: GestureFrame, t: number): void {
    const state = this.state;
    state.present = frame.present;
    state.paused = frame.paused;
    if (!frame.present) {
      this.release();
      return;
    }
    const x = frame.x * window.innerWidth;
    const y = frame.y * window.innerHeight;
    state.x = x;
    state.y = y;
    state.grab = frame.grab;

    if (frame.grab && (frame.grabDx !== 0 || frame.grabDy !== 0)) {
      this.bus.emit('intent:pan-camera', { dx: frame.grabDx * window.innerWidth, dy: frame.grabDy * window.innerHeight });
    }
    if (frame.zoom !== 1) this.bus.emit('intent:zoom-camera', { factor: frame.zoom });
    if (frame.command) this.command(frame.command);

    const hit = document.elementFromPoint(x, y);
    const overCanvas = hit === this.canvas;
    const control = overCanvas ? null : this.clickable(hit);
    // Paused: nothing presses; the cursor still shows where the head points.
    const pressed = frame.pressed && !frame.paused;

    if (pressed && !this.wasPressed) {
      if (overCanvas) {
        this.captured = 'canvas';
        this.counts.canvasPresses += 1;
        this.bus.emit('intent:virtual-pointer', { phase: 'down', clientX: x, clientY: y });
      } else {
        this.captured = control ?? 'none';
        control?.classList.add('hf-pressed');
        if (control && isRepeating(control)) {
          this.click(control);
          this.repeatAt = t + REPEAT_DELAY_S;
        }
      }
    } else if (!pressed && this.wasPressed) {
      this.finishPress(control, x, y);
    } else if (pressed && this.captured instanceof HTMLElement && this.repeatAt <= t) {
      if (control === this.captured) this.click(control);
      this.repeatAt = t + REPEAT_EVERY_S;
    }
    this.wasPressed = pressed;
    state.pressed = pressed;

    if (frame.tap && !pressed && !frame.paused) {
      this.counts.taps += 1;
      if (overCanvas) {
        this.counts.canvasPresses += 1;
        this.bus.emit('intent:virtual-pointer', { phase: 'down', clientX: x, clientY: y });
        this.bus.emit('intent:virtual-pointer', { phase: 'up', clientX: x, clientY: y });
      } else if (control) {
        this.click(control);
      }
    }

    // Moves: to the canvas while it holds the press or the cursor is over it; a 'leave' when it goes.
    const toCanvas = this.captured === 'canvas' || (this.captured === null && overCanvas);
    if (toCanvas) {
      if (x !== this.lastX || y !== this.lastY) this.bus.emit('intent:virtual-pointer', { phase: 'move', clientX: x, clientY: y });
      this.lastX = x;
      this.lastY = y;
    } else if (this.onCanvas) {
      this.leaveCanvas();
    }
    this.onCanvas = toCanvas;
    state.overCanvas = overCanvas;

    this.setHovered(this.captured === null ? control : this.captured instanceof HTMLElement ? this.captured : null);

    // Dwell clicks only DOM controls: dwelling on the map would build wherever the head rests.
    let dwellProgress = 0;
    const dwell = this.dwell;
    if (dwell && !frame.paused) {
      if (this.dwellAt && Math.hypot(x - this.dwellAt.x, y - this.dwellAt.y) > DWELL_REARM_PX) this.dwellAt = null;
      if (this.hovered !== this.dwellTarget) {
        dwell.reset();
        this.dwellTarget = this.hovered;
      }
      const fire = dwell.update(this.hovered !== null && !pressed && this.captured === null && !this.dwellAt, t);
      dwellProgress = dwell.progress;
      if (fire && this.hovered) {
        const target = this.hovered;
        this.click(target);
        // A step button keeps stepping while the cursor stays on it: the ring refills each time.
        if (isRepeating(target)) dwell.reset();
        else this.dwellAt = { x, y };
      }
    } else if (dwell) {
      dwell.reset();
    }
    state.progress = Math.max(dwellProgress, frame.commandProgress);
  }

  /** Dwell-to-click on DOM controls after `seconds` (0 = off). */
  setDwell(seconds: number): void {
    this.dwell = seconds > 0 ? new HoldTrigger(seconds) : null;
    this.dwellTarget = null;
    this.dwellAt = null;
  }

  /** Ends any press and takes the pointer off the canvas (tracking lost or stopped). */
  release(): void {
    if (this.wasPressed) this.finishPress(null, this.lastX, this.lastY);
    this.wasPressed = false;
    if (this.onCanvas) this.leaveCanvas();
    this.onCanvas = false;
    this.setHovered(null);
    this.dwell?.reset();
    this.dwellTarget = null;
    const state = this.state;
    state.pressed = false;
    state.grab = false;
    state.progress = 0;
    state.present = false;
  }

  private command(command: GestureCommand): void {
    this.counts.commands += 1;
    const route = commandRoute(command);
    if (route === 'rotate') this.bus.emit('intent:rotate', { direction: 1 });
    else if (route === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
  }

  private finishPress(control: HTMLElement | null, x: number, y: number): void {
    const captured = this.captured;
    this.captured = null;
    const repeated = !Number.isNaN(this.repeatAt);
    this.repeatAt = NaN;
    if (captured === 'canvas') {
      this.bus.emit('intent:virtual-pointer', { phase: 'up', clientX: Number.isFinite(x) ? x : 0, clientY: Number.isFinite(y) ? y : 0 });
    } else if (captured instanceof HTMLElement) {
      captured.classList.remove('hf-pressed');
      // A repeating control clicked on press already.
      if (control === captured && !repeated) this.click(captured);
    }
  }

  private click(control: HTMLElement): void {
    this.counts.domClicks += 1;
    if (control instanceof HTMLInputElement && control.type === 'range') {
      control.focus();
      return;
    }
    control.click();
    if (control instanceof HTMLInputElement && control.type !== 'checkbox' && control.type !== 'radio') control.focus();
  }

  private leaveCanvas(): void {
    this.bus.emit('intent:virtual-pointer', { phase: 'leave', clientX: this.lastX, clientY: this.lastY });
    this.lastX = NaN;
    this.lastY = NaN;
  }

  private clickable(element: Element | null): HTMLElement | null {
    const control = element?.closest<HTMLElement>(CLICKABLE) ?? null;
    if (!control || (control as HTMLButtonElement).disabled) return null;
    return control;
  }

  private setHovered(control: HTMLElement | null): void {
    if (control === this.hovered) return;
    this.hovered?.classList.remove('hf-hover');
    control?.classList.add('hf-hover');
    this.hovered = control;
    this.state.hoverLabel = control ? control.getAttribute('aria-label') ?? control.textContent?.trim() ?? null : null;
  }
}

function isRepeating(control: HTMLElement): boolean {
  return control.hasAttribute('data-repeat');
}
