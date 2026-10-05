/**
 * Sends a GestureFrame where a mouse would go. Over the 3D view it becomes `intent:virtual-pointer`
 * (ToolController builds with it). Over a DOM control a press then release on the same control clicks
 * it, so the dock, top bar, menus and this module's own panel work through their normal handlers. A
 * press keeps its target until release, like pointer capture: a road stroke can cross the dock.
 * Fists and two-hand zoom move the camera through their own intents; ✌ / smile rotate; 👎 / raised
 * eyebrows press Escape (same meaning as the key everywhere: put back, put away, close).
 */
import type { GameBus } from '../game/events';
import type { GestureFrame } from './protocol';
import { HoldTrigger } from './triggers';

const DWELL_REARM_PX = 40;

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
  /** The hovered control's accessible name, if any. */
  hoverLabel: string | null;
}

export class GestureRouter {
  readonly state: RouterState = { x: 0, y: 0, overCanvas: false, progress: 0, pressed: false, grab: false, present: false, hoverLabel: null };
  /** Clicks delivered to DOM controls, presses on the canvas (diagnostics for the panel and tests). */
  readonly counts = { domClicks: 0, canvasPresses: 0, commands: 0 };
  private wasPressed = false;
  private captured: 'canvas' | HTMLElement | 'none' | null = null;
  private hovered: HTMLElement | null = null;
  private onCanvas = false;
  private lastX = NaN;
  private lastY = NaN;
  /** Hovering a DOM control this long clicks it (head mode); null = off. */
  private dwell: HoldTrigger | null = null;
  private dwellTarget: HTMLElement | null = null;
  /** Where the last dwell click fired: no new one until the cursor moves DWELL_REARM_PX away (a click may re-render the control). */
  private dwellAt: { x: number; y: number } | null = null;

  constructor(
    private readonly bus: GameBus,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  apply(frame: GestureFrame, t: number): void {
    const state = this.state;
    state.present = frame.present;
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
    if (frame.command) {
      this.counts.commands += 1;
      if (frame.command === 'rotate') this.bus.emit('intent:rotate', { direction: 1 });
      else window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
    }

    const hit = document.elementFromPoint(x, y);
    const overCanvas = hit === this.canvas;
    const control = overCanvas ? null : this.clickable(hit);

    if (frame.pressed && !this.wasPressed) {
      if (overCanvas) {
        this.captured = 'canvas';
        this.counts.canvasPresses += 1;
        this.bus.emit('intent:virtual-pointer', { phase: 'down', clientX: x, clientY: y });
      } else {
        this.captured = control ?? 'none';
        control?.classList.add('hf-pressed');
      }
    } else if (!frame.pressed && this.wasPressed) {
      this.finishPress(control, x, y);
    }
    this.wasPressed = frame.pressed;
    state.pressed = frame.pressed;

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
    if (dwell) {
      if (this.dwellAt && Math.hypot(x - this.dwellAt.x, y - this.dwellAt.y) > DWELL_REARM_PX) this.dwellAt = null;
      if (this.hovered !== this.dwellTarget) {
        dwell.reset();
        this.dwellTarget = this.hovered;
      }
      const fire = dwell.update(this.hovered !== null && !frame.pressed && this.captured === null && !this.dwellAt, t);
      dwellProgress = dwell.progress;
      if (fire && this.hovered) {
        this.click(this.hovered);
        this.dwellAt = { x, y };
      }
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

  private finishPress(control: HTMLElement | null, x: number, y: number): void {
    const captured = this.captured;
    this.captured = null;
    if (captured === 'canvas') {
      this.bus.emit('intent:virtual-pointer', { phase: 'up', clientX: Number.isFinite(x) ? x : 0, clientY: Number.isFinite(y) ? y : 0 });
    } else if (captured instanceof HTMLElement) {
      captured.classList.remove('hf-pressed');
      if (control === captured) this.click(captured);
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
