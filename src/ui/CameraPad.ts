/**
 * On-screen camera controls at the right edge, for players who can only point and click (a head
 * pointer, an eye tracker): rotate, zoom, pan and reset, plus an Aim group while a tool is active.
 * Shown in the building phase when the setting is on or head tracking runs.
 *
 * Step buttons carry `data-repeat`: a mouse, pen or finger held on one repeats it here; the hands-free
 * router repeats them with clicks of its own. Keyboard Enter / Space click once.
 */
import type { CameraStep, GameBus, GamePhase, HandsFreeMode } from '../game/events';
import { cameraPadVisible, HoldRepeat } from './cameraPadLogic';
import { GLYPHS } from './glyphs';
import { UI_TEST_IDS, type AimDirection } from './testIds';

interface PadButton {
  id: string;
  label: string;
  glyph: string;
  row: number;
  col: number;
  /** data-* attributes (all but data-repeat) the click handler reads. */
  data: string;
  repeat: boolean;
  text?: string;
  className?: string;
}

const step = (s: CameraStep, label: string, glyph: string, row: number, col: number): PadButton => ({
  id: UI_TEST_IDS.cameraStep(s),
  label,
  glyph,
  row,
  col,
  data: `data-step="${s}"`,
  repeat: true,
});

const VIEW_BUTTONS: readonly PadButton[] = [
  step('orbit-left', 'Rotate left (Q)', GLYPHS.orbitLeft, 1, 1),
  step('pan-up', 'Move view up (W)', GLYPHS.arrowUp, 1, 2),
  step('orbit-right', 'Rotate right (E)', GLYPHS.orbitRight, 1, 3),
  step('pan-left', 'Move view left (A)', GLYPHS.arrowLeft, 2, 1),
  { id: UI_TEST_IDS.cameraReset, label: 'Reset view (F)', glyph: GLYPHS.recentre, row: 2, col: 2, data: 'data-reset', repeat: false, className: 'ui-pad-reset' },
  step('pan-right', 'Move view right (D)', GLYPHS.arrowRight, 2, 3),
  step('zoom-out', 'Zoom out (−)', GLYPHS.zoomOut, 3, 1),
  step('pan-down', 'Move view down (S)', GLYPHS.arrowDown, 3, 2),
  step('zoom-in', 'Zoom in (+)', GLYPHS.zoomIn, 3, 3),
];

const AIM_DIRECTIONS: Readonly<Record<AimDirection, { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }>> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const nudge = (direction: AimDirection, glyph: string, row: number, col: number): PadButton => ({
  id: UI_TEST_IDS.aimNudge(direction),
  label: `Aim ${direction}`,
  glyph,
  row,
  col,
  data: `data-aim="${direction}"`,
  repeat: true,
});

const AIM_BUTTONS: readonly PadButton[] = [
  nudge('up', GLYPHS.chevronUp, 1, 2),
  nudge('left', GLYPHS.chevronLeft, 2, 1),
  {
    id: UI_TEST_IDS.aimPlace,
    label: 'Place here',
    glyph: GLYPHS.place,
    row: 2,
    col: 2,
    data: 'data-place',
    repeat: false,
    text: 'Place',
    className: 'ui-pad-place',
  },
  nudge('right', GLYPHS.chevronRight, 2, 3),
  nudge('down', GLYPHS.chevronDown, 3, 2),
];

function buttonHtml(b: PadButton): string {
  const repeat = b.repeat ? ' data-repeat' : '';
  const text = b.text ? `<span class="ui-pad-text">${b.text}</span>` : '';
  return `<button type="button" class="ui-pad-btn${b.className ? ` ${b.className}` : ''}" id="${b.id}" ${b.data}${repeat} aria-label="${b.label}" title="${b.label}" style="grid-area: ${b.row} / ${b.col}">${b.glyph}${text}</button>`;
}

export class CameraPad {
  private readonly el: HTMLElement;
  private readonly aim: HTMLElement;
  private readonly hold = new HoldRepeat();
  /** The button whose pointer press already stepped; its click (on release) is swallowed. */
  private pressed: HTMLButtonElement | null = null;

  private phase: GamePhase = 'loading';
  private setting = false;
  private handsFree: HandsFreeMode | null = null;
  private toolActive = false;
  private carrying = false;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    host: HTMLElement,
    private readonly bus: GameBus,
  ) {
    this.el = document.createElement('div');
    this.el.id = UI_TEST_IDS.cameraPad;
    this.el.className = 'ui-pad ui-hud';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="ui-pad-group" role="group" aria-labelledby="ui-pad-view-h">
        <span class="ui-pad-title" id="ui-pad-view-h">View</span>
        <div class="ui-pad-grid">${VIEW_BUTTONS.map(buttonHtml).join('')}</div>
      </div>
      <div class="ui-pad-group ui-pad-aim" id="${UI_TEST_IDS.aimGroup}" role="group" aria-labelledby="ui-pad-aim-h" data-aimed="false" hidden>
        <span class="ui-pad-title" id="ui-pad-aim-h">Aim</span>
        <div class="ui-pad-grid">${AIM_BUTTONS.map(buttonHtml).join('')}</div>
      </div>`;
    host.appendChild(this.el);
    this.aim = this.el.querySelector<HTMLElement>(`#${UI_TEST_IDS.aimGroup}`)!;

    this.el.addEventListener('pointerdown', this.onPointerDown);
    this.el.addEventListener('pointerup', this.onPointerEnd);
    this.el.addEventListener('pointercancel', this.onPointerEnd);
    this.el.addEventListener('pointerout', this.onPointerOut);
    this.el.addEventListener('click', this.onClick);
    this.el.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.stopHold);

    this.unsubscribers.push(
      bus.on('phase:changed', ({ phase }) => {
        this.phase = phase;
        this.render();
      }),
      bus.on('camera-pad:changed', ({ visible }) => {
        this.setting = visible;
        this.render();
      }),
      bus.on('hands-free:changed', ({ mode }) => {
        this.handsFree = mode;
        this.render();
      }),
      bus.on('tool:changed', ({ toolId }) => {
        this.toolActive = toolId !== null;
        this.render();
      }),
      bus.on('selection:changed', ({ id }) => {
        this.carrying = id !== null;
        this.render();
      }),
      bus.on('aim:changed', ({ cell }) => {
        this.aim.dataset.aimed = String(cell !== null);
      }),
    );
  }

  dispose(): void {
    this.stopHold();
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    this.el.removeEventListener('pointerup', this.onPointerEnd);
    this.el.removeEventListener('pointercancel', this.onPointerEnd);
    this.el.removeEventListener('pointerout', this.onPointerOut);
    this.el.removeEventListener('click', this.onClick);
    this.el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.stopHold);
    for (const off of this.unsubscribers) off();
    this.el.remove();
  }

  private render(): void {
    const visible = cameraPadVisible(this.phase, this.setting, this.handsFree);
    const aim = visible && (this.toolActive || this.carrying);
    if (!visible || (!aim && this.pressed && this.aim.contains(this.pressed))) this.stopHold();
    this.el.hidden = !visible;
    this.aim.hidden = !aim;
  }

  /** One step of a repeating button. */
  private fire(button: HTMLButtonElement): void {
    const { step, aim } = button.dataset;
    if (step) this.bus.emit('intent:camera-step', { step: step as CameraStep });
    else if (aim) this.bus.emit('intent:aim-nudge', AIM_DIRECTIONS[aim as AimDirection]);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pressed = null;
    // Only a real pointer holds; anything else repeats with clicks of its own.
    if (!event.isTrusted || event.button !== 0) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-repeat]');
    if (!button || button.disabled) return;
    this.pressed = button;
    this.sfx();
    this.hold.start(() => this.fire(button));
  };

  private readonly onPointerEnd = (): void => {
    this.hold.stop();
  };

  private readonly onPointerOut = (event: PointerEvent): void => {
    const button = this.pressed;
    if (button && !button.contains(event.relatedTarget as Node | null)) this.hold.stop();
  };

  private readonly stopHold = (): void => {
    this.hold.stop();
  };

  private readonly onClick = (event: MouseEvent): void => {
    // UiRoot's own click handler (and its click sound) is for the rest of the HUD.
    event.stopPropagation();
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-repeat')) {
      // detail 0: a keyboard or scripted click, which never had a pointer press.
      const handled = button === this.pressed && event.detail > 0;
      this.pressed = null;
      if (handled) return;
      this.sfx();
      this.fire(button);
      return;
    }
    this.sfx();
    if (button.hasAttribute('data-reset')) this.bus.emit('intent:reset-camera');
    else if (button.hasAttribute('data-place')) this.bus.emit('intent:aim-place');
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault(); // a long press on a touch screen
  };

  private sfx(): void {
    this.bus.emit('ui:sfx', { event: 'ui-click' });
  }
}
