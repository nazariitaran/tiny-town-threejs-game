/**
 * DOM UI (WP-06): loading, title, build HUD (top bar + dock with category tabs, item tray and
 * mode buttons), hint line, cursor tooltip, menu / confirm / controls help / credits overlays
 * and the error screen. Layout and states follow docs/design/02-interaction-and-ui.md §4–§7.
 *
 * Talks to the game ONLY via the bus: emits `intent:*` / `ui:sfx`, renders facts
 * (`phase:changed`, `tool:changed`, `history:changed`, `audio:changed`, ...).
 *
 * UI-owned state: the active dock category and the digit shortcuts (see uiKeys.ts).
 * Keep the element ids listed in UI_TEST_IDS stable — Playwright tests select by them.
 */
// Styles (ui.css + bundled Nunito) are imported from src/styles.css, NOT here: tests import
// UI_TEST_IDS through this module in Node, so it must stay free of CSS/asset side effects.
import { TOOL_CATEGORIES, toolDef, toolsInCategory, type ToolCategory, type ToolId } from '../catalog/tools';
import { assetUrl } from '../game/config';
import type { GameBus, GamePhase } from '../game/events';
import type { Rotation } from '../town/types';
import { GLYPHS } from './glyphs';
import { UI_TEST_IDS } from './testIds';
import { digitAction } from './uiKeys';

export { UI_TEST_IDS };

type ModalView = 'menu' | 'confirm' | 'help' | 'credits';
type UiSfx = 'ui-hover' | 'ui-click' | 'ui-open' | 'ui-close';

const HINT_MAX_USES = 3;
const HINT_MS = 3500;
const PICK_HINT_MOUSE = 'Pick something below, then click the map to build';
const PICK_HINT_TOUCH = 'Pick an item below · two fingers move the view';

/** Catalog hints are written for mouse + keys; reword them for touch (no key cues). */
export function touchHint(hint: string): string {
  return hint
    .replace(/ · R to rotate$/, ' · tap Rotate to turn it')
    .replace(/^Click or drag/, 'Tap or drag')
    .replace(/^Click/, 'Tap');
}
const INVALID_TOOLTIP_MS = 1500;
/** Music note for the menu's Music row (WP-13; same 24×24, 2 px stroke style as GLYPHS). */
const MUSIC_GLYPH =
  '<svg class="ui-glyph" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>';

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

export class UiRoot {
  private readonly root: HTMLElement;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly coarse = window.matchMedia('(pointer: coarse)');

  private phase: GamePhase = 'loading';
  private category: ToolCategory = 'streets';
  private activeTool: ToolId | null = null;
  private muted = false;
  private volume = 0.8;
  private modal: ModalView | null = null;
  /** View to show when the pending `intent:open-menu` lands (`?` opens help directly). */
  private pendingView: ModalView | null = null;
  private readonly toolUses = new Map<ToolId, number>();
  private hintTimer = 0;
  private tooltipTimer = 0;
  private hoverReason: string | null = null;
  private flashReason: string | null = null;
  private pointerX = -1;
  private pointerY = -1;
  private pointerTouch = false;
  private hoverKey: string | null = null;
  private quietHoverKey: string | null = null;

  constructor(
    host: HTMLElement,
    private readonly bus: GameBus,
    private readonly hasSave: () => boolean,
  ) {
    this.root = host;
    this.root.innerHTML = this.template();

    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('change', this.onInput);
    this.root.addEventListener('pointerover', this.onPointerOver);
    this.el(UI_TEST_IDS.tray).addEventListener('scroll', this.updateTrayCue, { passive: true });
    window.addEventListener('resize', this.updateTrayCue);
    // Capture phase on window: runs before ToolController's keydown, so Esc inside an overlay
    // closes that overlay and is not also seen as "Esc with no tool → open menu".
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });

    this.unsubscribers.push(
      bus.on('phase:changed', ({ phase }) => this.showPhase(phase)),
      bus.on('load:progress', ({ loaded, total, label }) => this.renderProgress(loaded, total, label)),
      bus.on('load:error', ({ message }) => {
        this.el('ui-error-message').textContent = message;
      }),
      bus.on('tool:changed', ({ toolId, rotation }) => this.onToolChanged(toolId, rotation)),
      bus.on('build:rotated', ({ rotation }) => this.renderRotation(rotation)),
      bus.on('hover:changed', ({ cell, edge, valid, reason }) => {
        const key = cell ? `${cell.x},${cell.z}` + (edge ? `,${edge.x},${edge.z},${edge.side}` : '') : null;
        // Right after a placement the hovered spot is "occupied"; stay quiet until the pointer moves on.
        if (key !== this.quietHoverKey) this.quietHoverKey = null;
        this.hoverKey = key;
        this.hoverReason = !valid && reason && !this.quietHoverKey ? reason : null;
        this.renderTooltip();
      }),
      bus.on('build:invalid', ({ reason }) => this.flashInvalid(reason)),
      bus.on('build:placed', () => this.clearTooltip(true)),
      bus.on('history:changed', ({ canUndo, canRedo }) => {
        this.button(UI_TEST_IDS.undo).disabled = !canUndo;
        this.button(UI_TEST_IDS.redo).disabled = !canRedo;
      }),
      bus.on('audio:changed', ({ muted, volume }) => {
        this.muted = muted;
        this.volume = volume;
        this.renderAudio();
      }),
      // WP-13: music settings rows.
      bus.on('music:changed', ({ enabled, volume }) => {
        this.el<HTMLInputElement>(UI_TEST_IDS.music).checked = enabled;
        const range = this.el<HTMLInputElement>(UI_TEST_IDS.musicVolume);
        if (document.activeElement !== range) range.value = String(volume);
        range.disabled = !enabled;
      }),
      bus.on('intent:toggle-grid', ({ visible }) => {
        this.el<HTMLInputElement>(UI_TEST_IDS.grid).checked = visible;
      }),
    );
    this.renderTray();
    this.renderAudio();
    this.renderRotation(0);
    this.showPhase('loading');
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('input', this.onInput);
    this.root.removeEventListener('change', this.onInput);
    this.root.removeEventListener('pointerover', this.onPointerOver);
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('resize', this.updateTrayCue);
    window.clearTimeout(this.hintTimer);
    window.clearTimeout(this.tooltipTimer);
    for (const off of this.unsubscribers) off();
    this.root.innerHTML = '';
    delete this.root.dataset.phase;
  }

  // ---------------------------------------------------------------- markup

  private template(): string {
    const id = UI_TEST_IDS;
    const mark = `<span class="ui-mark-house">${GLYPHS.homes}</span><span class="ui-mark-text">Tiny Town</span>`;
    return `
      <section class="ui-screen ui-loading" data-phase="loading" aria-label="Loading">
        <h1 class="ui-mark ui-mark-big">${mark}</h1>
        <div class="ui-progress" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="load-progress">
          <div class="ui-progress-fill"></div>
        </div>
        <p class="ui-progress-label" id="ui-load-label">Unpacking the toy box…</p>
      </section>

      <section class="ui-screen ui-title" data-phase="title" aria-label="Title">
        <div class="ui-title-card">
          <h1 class="ui-mark ui-mark-big">${mark}</h1>
          <p class="ui-tagline">Paint roads, plant trees, grow a cosy town.</p>
        </div>
        <div class="ui-title-bottom">
          <div class="ui-title-actions">
            <button id="${id.start}" type="button" class="ui-btn ui-btn-primary ui-btn-big">${GLYPHS.play}<span class="ui-start-label">Start building</span></button>
            <button id="${id.titleNew}" type="button" class="ui-btn ui-btn-big" hidden>${GLYPHS.plus}<span>New town</span></button>
          </div>
          <button id="${id.titleCredits}" type="button" class="ui-link ui-title-credits">Credits</button>
        </div>
      </section>

      <header class="ui-topbar ui-hud" data-phase="building menu">
        <div class="ui-brand ui-pill"><span class="ui-mark">${mark}</span></div>
        <div class="ui-actions ui-pill" role="group" aria-label="Game controls">
          <button id="${id.undo}" type="button" class="ui-icon-btn" disabled aria-label="Undo" title="Undo (Ctrl+Z)">${GLYPHS.undo}</button>
          <button id="${id.redo}" type="button" class="ui-icon-btn" disabled aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${GLYPHS.redo}</button>
          <span class="ui-sep" aria-hidden="true"></span>
          <button id="${id.mute}" type="button" class="ui-icon-btn" aria-label="Mute sound" aria-pressed="false"></button>
          <button id="${id.menu}" type="button" class="ui-icon-btn" aria-label="Menu" title="Menu (Esc)">${GLYPHS.menu}</button>
        </div>
      </header>

      <p class="ui-hint ui-hud" id="${id.hint}" data-phase="building" aria-live="polite"></p>
      <div class="ui-dock-wrap ui-hud" data-phase="building menu">
        <nav class="ui-dock" id="${id.dock}" aria-label="Build tools">
          <div class="ui-tray-frame"><div class="ui-tray" id="${id.tray}" role="group" aria-label="Items"></div></div>
          <div class="ui-tabbar">
            <div class="ui-tabs" role="group" aria-label="Categories">
              ${TOOL_CATEGORIES.map(
                (c, i) =>
                  `<button type="button" class="ui-tab" id="${id.category(c.id)}" data-category="${c.id}" aria-pressed="false" title="${c.label} (Shift+${i + 1})">${GLYPHS[c.id]}<span>${c.label}</span></button>`,
              ).join('')}
            </div>
            <span class="ui-sep" aria-hidden="true"></span>
            <div class="ui-modes" role="group" aria-label="Modes">
              <button type="button" class="ui-mode" id="${id.rotate}" aria-label="Rotate" title="Rotate (R)"><span class="ui-rot">${GLYPHS.rotate}</span><span class="ui-mode-label">Rotate</span></button>
              <button type="button" class="ui-mode ui-mode-danger" id="${id.bulldoze}" data-tool="bulldoze" aria-label="Bulldoze" aria-pressed="false" title="Bulldoze (B)">${GLYPHS.bulldoze}<span class="ui-mode-label">Bulldoze</span></button>
            </div>
          </div>
        </nav>
      </div>

      <div class="ui-tooltip" id="${id.tooltip}" role="alert" hidden><span class="ui-tooltip-x">${GLYPHS.close}</span><span class="ui-tooltip-text"></span></div>

      <div class="ui-modal" hidden>
        <section class="ui-panel" id="${id.menuPanel}" data-view="menu" role="dialog" aria-modal="true" aria-labelledby="ui-menu-h">
          <h2 id="ui-menu-h">Menu</h2>
          <button type="button" class="ui-btn ui-btn-primary" id="${id.resume}">${GLYPHS.play}<span>Resume</span></button>
          <div class="ui-row">
            <button type="button" class="ui-btn" id="${id.help}">${GLYPHS.help}<span>Controls</span></button>
            <button type="button" class="ui-btn" id="${id.resetView}">${GLYPHS.camera}<span>Reset view</span></button>
          </div>
          <div class="ui-field">
            <label for="${id.volume}">${GLYPHS.soundOn}<span>Volume</span></label>
            <input type="range" id="${id.volume}" min="0" max="1" step="0.05" value="0.8" />
          </div>
          <label class="ui-field ui-check" for="${id.music}">
            ${MUSIC_GLYPH}<span>Music</span>
            <input type="checkbox" id="${id.music}" role="switch" checked />
          </label>
          <div class="ui-field ui-field-sub">
            <label for="${id.musicVolume}"><span>Music volume</span></label>
            <input type="range" id="${id.musicVolume}" min="0" max="1" step="0.05" value="0.5" />
          </div>
          <label class="ui-field ui-check" for="${id.grid}">
            ${GLYPHS.grid}<span>Show grid</span>
            <input type="checkbox" id="${id.grid}" role="switch" checked />
          </label>
          <button type="button" class="ui-btn ui-btn-danger-soft" id="${id.newTown}">${GLYPHS.plus}<span>New town</span></button>
          <button type="button" class="ui-link" id="${id.credits}">Credits</button>
        </section>

        <section class="ui-panel" id="${id.confirmPanel}" data-view="confirm" role="alertdialog" aria-modal="true" aria-labelledby="ui-confirm-h" aria-describedby="ui-confirm-d">
          <h2 id="ui-confirm-h">Start a new town?</h2>
          <p id="ui-confirm-d">Your current town will be cleared.</p>
          <div class="ui-row">
            <button type="button" class="ui-btn" id="${id.confirmCancel}" data-back>Cancel</button>
            <button type="button" class="ui-btn ui-btn-danger" id="${id.confirmClear}">Clear</button>
          </div>
        </section>

        <section class="ui-panel ui-panel-wide" id="${id.helpPanel}" data-view="help" role="dialog" aria-modal="true" aria-labelledby="ui-help-h">
          <h2 id="ui-help-h">Controls</h2>
          <div class="ui-help-cols">
            <div>
              <h3>Mouse &amp; keys</h3>
              <dl>
                <dt>Click · drag</dt><dd>Build with the selected tool</dd>
                <dt>Right-drag · WASD</dt><dd>Move the camera</dd>
                <dt>Middle-drag · Q / E</dt><dd>Turn the camera</dd>
                <dt>Wheel · + / −</dt><dd>Zoom</dd>
                <dt>1–9</dt><dd>Pick an item in the open tray</dd>
                <dt>Shift + 1–5</dt><dd>Switch category</dd>
                <dt>R · Shift+R</dt><dd>Rotate</dd>
                <dt>B</dt><dd>Bulldoze</dd>
                <dt>Ctrl+Z · Ctrl+Shift+Z</dt><dd>Undo · redo</dd>
                <dt>F · Home</dt><dd>Reset view</dd>
                <dt>Esc</dt><dd>Put the tool away · menu</dd>
                <dt>?</dt><dd>This help</dd>
              </dl>
            </div>
            <div>
              <h3>Touch</h3>
              <dl>
                <dt>Tap · drag</dt><dd>Build with the selected tool</dd>
                <dt>Two fingers</dt><dd>Move the camera</dd>
                <dt>Twist</dt><dd>Turn the camera</dd>
                <dt>Pinch</dt><dd>Zoom</dd>
                <dt>No tool + drag</dt><dd>Move the camera</dd>
              </dl>
            </div>
          </div>
          <button type="button" class="ui-btn ui-btn-primary" id="${id.helpClose}" data-back>Got it</button>
        </section>

        <section class="ui-panel" id="${id.creditsPanel}" data-view="credits" role="dialog" aria-modal="true" aria-labelledby="ui-credits-h">
          <h2 id="ui-credits-h">Credits</h2>
          <p>Most 3D models, item icons and all sounds by <strong>Kenney</strong> (kenney.nl), CC0.</p>
          <p class="ui-credits-small">Also via Poly Pizza (poly.pizza): “Church” and “Swing set” by Poly by Google, CC-BY 3.0; “Grill” by Zsky, CC-BY 3.0; corner shop “Building” by Kay Lousberg, CC0. Scaled and recoloured for Tiny Town.</p>
          <p>Music: <strong>Foundation of Gold</strong>, created for Tiny Town by its author.</p>
          <p>Font: <strong>Nunito</strong> by Vernon Adams, Cyreal and Jacques Le Bailly, SIL Open Font License.</p>
          <p>Made with three.js.</p>
          <button type="button" class="ui-btn" id="${id.creditsClose}" data-back>Back</button>
        </section>
      </div>

      <section class="ui-screen ui-error" data-phase="error" aria-label="Error">
        <div class="ui-panel" role="alertdialog" aria-labelledby="ui-error-h">
          <h2 id="ui-error-h">Oh no, the town didn't load</h2>
          <p>Something went wrong while setting up. Check your connection and try again.</p>
          <p class="ui-error-detail" id="ui-error-message"></p>
          <button type="button" class="ui-btn ui-btn-primary" id="${id.retry}">${GLYPHS.retry}<span>Try again</span></button>
        </div>
      </section>`;
  }

  // ---------------------------------------------------------------- input

  private readonly onClick = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement).closest('button');
    if (!target || target.disabled) return;
    const id = UI_TEST_IDS;
    const quiet = target.id === id.undo || target.id === id.redo; // AudioManager plays undo/redo
    if (!quiet) this.sfx('ui-click');

    if (target.id === id.start) this.bus.emit('intent:start', { mode: this.hasSave() ? 'continue' : 'new' });
    else if (target.id === id.titleNew) this.openModal('confirm');
    else if (target.id === id.titleCredits || target.id === id.credits) this.openModal('credits');
    else if (target.id === id.undo) this.bus.emit('intent:undo');
    else if (target.id === id.redo) this.bus.emit('intent:redo');
    else if (target.id === id.mute) this.bus.emit('intent:set-muted', { muted: !this.muted });
    else if (target.id === id.menu) this.bus.emit('intent:open-menu');
    else if (target.id === id.rotate) this.bus.emit('intent:rotate', { direction: 1 });
    else if (target.id === id.resume) this.bus.emit('intent:close-menu');
    else if (target.id === id.help) this.openModal('help');
    else if (target.id === id.newTown) this.openModal('confirm');
    else if (target.id === id.resetView) {
      this.bus.emit('intent:reset-camera');
      this.bus.emit('intent:close-menu');
    } else if (target.id === id.confirmClear) this.confirmNewTown();
    else if (target.hasAttribute('data-back')) this.back();
    else if (target.id === id.retry) window.location.reload();
    else if (target.dataset.category) this.setCategory(target.dataset.category as ToolCategory);
    else if (target.dataset.tool) this.selectTool(target.dataset.tool as ToolId);
  };

  private readonly onInput = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    if (target.id === UI_TEST_IDS.volume && event.type === 'input') {
      this.bus.emit('intent:set-volume', { volume: Number(target.value) });
    } else if (target.id === UI_TEST_IDS.musicVolume && event.type === 'input') {
      this.bus.emit('intent:set-music-volume', { volume: Number(target.value) });
    } else if (target.id === UI_TEST_IDS.music && event.type === 'change') {
      this.sfx('ui-click');
      this.bus.emit('intent:set-music', { enabled: target.checked });
    } else if (target.id === UI_TEST_IDS.grid && event.type === 'change') {
      this.sfx('ui-click');
      this.bus.emit('intent:toggle-grid', { visible: target.checked });
    }
  };

  private readonly onPointerOver = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.ui-dock button');
    if (!button || button.disabled) return;
    const from = event.relatedTarget as Node | null;
    if (from && button.contains(from)) return; // moving between the button's own children
    this.sfx('ui-hover');
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.pointerTouch = event.pointerType === 'touch';
    if (!this.el(UI_TEST_IDS.tooltip).hidden) this.positionTooltip();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const typing = target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox';
    if (typing || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;

    if (event.code === 'Escape' && this.modal) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.back();
      return;
    }
    if (event.key === '?' && (this.phase === 'building' || this.phase === 'menu')) {
      event.preventDefault();
      if (this.phase === 'menu') this.openModal('help');
      else {
        this.pendingView = 'help';
        this.bus.emit('intent:open-menu');
        this.pendingView = null;
      }
      return;
    }
    if (this.phase !== 'building' || event.repeat) return;
    const action = digitAction(event, this.category, this.activeTool);
    if (!action) return;
    event.preventDefault();
    if (action.type === 'category') this.setCategory(action.category);
    else this.bus.emit('intent:select-tool', { toolId: action.toolId });
  };

  // ---------------------------------------------------------------- actions

  private setCategory(category: ToolCategory): void {
    if (category === this.category) return;
    this.category = category;
    this.sfx('ui-open');
    this.renderTray(true);
  }

  private selectTool(toolId: ToolId): void {
    // Clicking the active item (or active Bulldoze) again puts the tool away.
    this.bus.emit('intent:select-tool', { toolId: toolId === this.activeTool ? null : toolId });
  }

  private confirmNewTown(): void {
    if (this.phase === 'title') {
      this.closeModal();
      this.bus.emit('intent:start', { mode: 'new' });
    } else {
      this.bus.emit('intent:new-town');
      this.bus.emit('intent:close-menu');
    }
  }

  /** Esc / Back / Cancel: sub-view → menu (while paused), menu → resume, title overlay → close. */
  private back(): void {
    if (!this.modal) return;
    if (this.phase === 'menu') {
      if (this.modal === 'menu') this.bus.emit('intent:close-menu');
      else this.openModal('menu');
    } else this.closeModal();
  }

  private openModal(view: ModalView): void {
    const wasOpen = this.modal !== null;
    this.modal = view;
    const modal = this.root.querySelector<HTMLElement>('.ui-modal')!;
    modal.hidden = false;
    for (const panel of modal.querySelectorAll<HTMLElement>('[data-view]')) panel.hidden = panel.dataset.view !== view;
    this.setHudInert(true);
    if (!wasOpen) this.sfx('ui-open');
    const panel = modal.querySelector<HTMLElement>(`[data-view="${view}"]`)!;
    panel.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  private closeModal(): void {
    if (!this.modal) return;
    this.modal = null;
    this.root.querySelector<HTMLElement>('.ui-modal')!.hidden = true;
    this.setHudInert(false);
    this.sfx('ui-close');
    const active = document.activeElement;
    if (!active || active === document.body || this.root.contains(active)) {
      const fallback = this.phase === 'title' ? UI_TEST_IDS.start : UI_TEST_IDS.menu;
      this.root.querySelector<HTMLElement>(`#${fallback}`)?.focus({ preventScroll: true });
    }
  }

  private setHudInert(inert: boolean): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('.ui-hud, .ui-title')) el.inert = inert;
  }

  // ---------------------------------------------------------------- facts → DOM

  private showPhase(phase: GamePhase): void {
    const previous = this.phase;
    this.phase = phase;
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-phase]')) {
      el.hidden = !(el.dataset.phase ?? '').split(' ').includes(phase);
    }
    this.root.dataset.phase = phase;
    if (phase === 'title') this.renderTitle();
    if (phase === 'menu') this.openModal(this.pendingView ?? 'menu');
    else if (this.modal && (previous === 'menu' || phase !== 'title')) this.closeModal();
    if (phase === 'building' && previous === 'title') {
      this.showHint(this.coarse.matches ? PICK_HINT_TOUCH : PICK_HINT_MOUSE);
    }
    if (phase !== 'building') this.hideTransient();
    else this.clearTooltip();
  }

  private renderTitle(): void {
    const save = this.hasSave();
    this.root.querySelector('.ui-start-label')!.textContent = save ? 'Continue' : 'Start building';
    this.el(UI_TEST_IDS.titleNew).hidden = !save;
  }

  private renderProgress(loaded: number, total: number, label: string): void {
    const pct = total ? Math.round((loaded / total) * 100) : 0;
    const bar = this.el('load-progress');
    bar.setAttribute('aria-valuenow', String(pct));
    bar.querySelector<HTMLElement>('.ui-progress-fill')!.style.width = `${pct}%`;
    this.el('ui-load-label').textContent = label ? `Loading ${label}…` : `Loading… ${pct}%`;
  }

  private onToolChanged(toolId: ToolId | null, rotation: Rotation): void {
    const previous = this.activeTool;
    this.activeTool = toolId;
    if (toolId) {
      // Keep the tray showing the active tool (e.g. picked by a shortcut from another category).
      const category = toolDef(toolId).category;
      if (category !== 'mode') this.category = category;
    }
    this.renderTray(false);
    this.renderRotation(rotation);
    if (toolId !== previous) this.clearTooltip();
    if (toolId && toolId !== previous) {
      const uses = (this.toolUses.get(toolId) ?? 0) + 1;
      this.toolUses.set(toolId, uses);
      if (uses <= HINT_MAX_USES) {
        this.showHint(this.coarse.matches ? touchHint(toolDef(toolId).hint) : toolDef(toolId).hint);
      } else this.hideHint();
    } else if (!toolId) {
      if (previous && this.coarse.matches && this.phase === 'building') this.showHint(PICK_HINT_TOUCH);
      else this.hideHint();
    }
  }

  private renderTray(animate = false): void {
    const tray = this.el(UI_TEST_IDS.tray);
    const wanted = toolsInCategory(this.category);
    const current = tray.querySelectorAll<HTMLElement>('[data-tool]');
    const same = current.length === wanted.length && wanted.every((t, i) => current[i].dataset.tool === t.id);
    if (!same) {
      tray.innerHTML = wanted
        .map(
          (tool, i) => `<button type="button" class="ui-card" id="${UI_TEST_IDS.tool(tool.id)}" data-tool="${tool.id}" aria-pressed="false" aria-label="${tool.label}" title="${tool.label} (${i + 1})">
          <img src="${assetUrl(tool.icon)}" alt="" width="64" height="64" draggable="false" onerror="this.style.visibility='hidden'" /><span class="ui-card-label">${tool.label}</span><kbd>${i + 1}</kbd></button>`,
        )
        .join('');
      tray.scrollLeft = 0;
    }
    for (const card of tray.querySelectorAll<HTMLElement>('[data-tool]')) {
      const pressed = card.dataset.tool === this.activeTool;
      card.setAttribute('aria-pressed', String(pressed));
      if (pressed && !same) card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    this.updateTrayCue();
    if (animate) {
      tray.classList.remove('is-entering');
      void tray.offsetWidth;
      tray.classList.add('is-entering');
    }
    for (const tab of this.root.querySelectorAll<HTMLElement>('[data-category]')) {
      tab.setAttribute('aria-pressed', String(tab.dataset.category === this.category));
    }
    this.button(UI_TEST_IDS.bulldoze).setAttribute('aria-pressed', String(this.activeTool === 'bulldoze'));
    const rotatable = this.activeTool !== null && toolDef(this.activeTool).layer === 'object';
    this.button(UI_TEST_IDS.rotate).classList.toggle('is-idle', !rotatable);
  }

  /** Edge fades on the tray frame when more items are scrolled off either side. */
  private readonly updateTrayCue = (): void => {
    const tray = this.root.querySelector<HTMLElement>(`#${UI_TEST_IDS.tray}`);
    const frame = tray?.parentElement;
    if (!tray || !frame) return;
    const max = tray.scrollWidth - tray.clientWidth;
    frame.classList.toggle('has-more-left', tray.scrollLeft > 2);
    frame.classList.toggle('has-more-right', tray.scrollLeft < max - 2);
  };

  private renderRotation(rotation: Rotation): void {
    const rot = this.root.querySelector<HTMLElement>('.ui-rot');
    if (rot) rot.style.transform = `rotate(${rotation * 90}deg)`;
  }

  private renderAudio(): void {
    const mute = this.button(UI_TEST_IDS.mute);
    mute.innerHTML = this.muted ? GLYPHS.soundOff : GLYPHS.soundOn;
    mute.setAttribute('aria-pressed', String(this.muted));
    mute.setAttribute('aria-label', this.muted ? 'Unmute sound' : 'Mute sound');
    mute.title = this.muted ? 'Sound off' : 'Sound on';
    const volume = this.el<HTMLInputElement>(UI_TEST_IDS.volume);
    if (document.activeElement !== volume) volume.value = String(this.volume);
  }

  private showHint(text: string): void {
    const hint = this.el(UI_TEST_IDS.hint);
    hint.textContent = text;
    hint.classList.add('is-visible');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hideHint(), HINT_MS);
  }

  private hideHint(): void {
    window.clearTimeout(this.hintTimer);
    this.el(UI_TEST_IDS.hint).classList.remove('is-visible');
  }

  /** Drop any refusal tooltip. `afterPlacement` also mutes the hover reason for the current spot. */
  private clearTooltip(afterPlacement = false): void {
    window.clearTimeout(this.tooltipTimer);
    this.flashReason = null;
    this.hoverReason = null;
    this.quietHoverKey = afterPlacement ? this.hoverKey : null;
    this.renderTooltip();
  }

  private flashInvalid(reason: string): void {
    this.flashReason = reason;
    window.clearTimeout(this.tooltipTimer);
    this.tooltipTimer = window.setTimeout(() => {
      this.flashReason = null;
      this.renderTooltip();
    }, INVALID_TOOLTIP_MS);
    this.renderTooltip(true);
  }

  private renderTooltip(shake = false): void {
    const tip = this.el(UI_TEST_IDS.tooltip);
    const text = this.phase === 'building' ? (this.flashReason ?? this.hoverReason) : null;
    tip.hidden = !text || (this.pointerX < 0 && !this.coarse.matches);
    if (tip.hidden) return;
    tip.querySelector('.ui-tooltip-text')!.innerHTML = escapeHtml(text!);
    this.positionTooltip();
    if (shake) {
      tip.classList.remove('is-shaking');
      void tip.offsetWidth;
      tip.classList.add('is-shaking');
    }
  }

  /**
   * Mouse: anchored near the pointer but never under it (above-right).
   * Touch / coarse pointer: a finger hides the spot anyway, so the tooltip sits top-centre in the
   * free scene area below the top bar and the hint pill. In both cases it never overlaps the top
   * bar, the hint pill or the dock.
   */
  private positionTooltip(): void {
    const tip = this.el(UI_TEST_IDS.tooltip);
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const margin = 8;
    const topbar = this.root.querySelector<HTMLElement>('.ui-topbar')!.getBoundingClientRect();
    const hint = this.el(UI_TEST_IDS.hint);
    const hintRect = hint.classList.contains('is-visible') && hint.textContent ? hint.getBoundingClientRect() : null;
    const dockTop = this.el(UI_TEST_IDS.dock).getBoundingClientRect().top;
    const minY = Math.max(topbar.bottom, hintRect?.bottom ?? 0) + margin;
    const maxY = dockTop - h - margin;
    let x: number;
    let y: number;
    if (this.pointerTouch || this.coarse.matches) {
      x = (window.innerWidth - w) / 2;
      y = minY;
    } else {
      x = this.pointerX + 18;
      y = this.pointerY - h - 14;
      if (y < minY) y = this.pointerY + 28;
    }
    x = Math.max(margin, Math.min(window.innerWidth - w - margin, x));
    y = Math.max(minY, Math.min(maxY, y));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  private hideTransient(): void {
    this.hideHint();
    this.clearTooltip();
  }

  // ---------------------------------------------------------------- helpers

  private sfx(event: UiSfx): void {
    this.bus.emit('ui:sfx', { event });
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = this.root.querySelector<T>(`#${id}`);
    if (!el) throw new Error(`Missing UI element #${id}`);
    return el;
  }

  private button(id: string): HTMLButtonElement {
    return this.el<HTMLButtonElement>(id);
  }
}
