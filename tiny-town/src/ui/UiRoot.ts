/**
 * DOM UI (WP-06): loading, title, build HUD (top bar + dock with category tabs, item tray and
 * mode buttons), hint line, cursor tooltip, menu / confirm / controls help / credits / photo /
 * town name overlays and the error screen. Layout and states follow docs/design/02-interaction-and-ui.md §4–§7.
 *
 * Talks to the game ONLY via the bus: emits `intent:*` / `ui:sfx`, renders facts
 * (`phase:changed`, `tool:changed`, `history:changed`, `audio:changed`, ...).
 *
 * UI-owned state: the active dock category and the digit shortcuts (see uiKeys.ts).
 * Keep the element ids listed in UI_TEST_IDS stable — Playwright tests select by them.
 */
// Styles (ui.css + bundled Nunito) are imported from src/styles.css, NOT here. Tests import
// UI_TEST_IDS from ./testIds, which has no side effects.
import { TOOL_CATEGORIES, toolDef, toolsInCategory, type ToolCategory, type ToolId } from '../catalog/tools';
import { assetUrl } from '../game/config';
import type { GameBus, GamePhase } from '../game/events';
import { DEFAULT_GRAPHICS, GRAPHICS_PRESETS, GRAPHICS_UI, isGraphicsPreset, type GraphicsPreset } from '../game/graphics';
import { photoFrameLayout } from '../photo/photoLayout';
import { decodeTownFile, TOWN_FILE_ERRORS, TOWN_FILE_EXTENSION, TOWN_FILE_MAX_BYTES, TOWN_FILE_MIME, type DecodedTownFile } from '../persistence/townFile';
import { downloadBlob } from '../utils/download';
import { DEFAULT_TOWN_NAME, sanitizeTownName, TOWN_NAME_MAX_LENGTH, townNameLength } from '../town/townName';
import type { Rotation } from '../town/types';
import { TIME_MODES, type DayPhase, type TimeMode } from '../world/dayCycle';
import { GLYPHS } from './glyphs';
import { MENU_TABS, UI_TEST_IDS, type MenuTab } from './testIds';
import { digitAction, isPhotoKey } from './uiKeys';

type ModalView = 'menu' | 'confirm' | 'help' | 'credits' | 'photo' | 'name' | 'file' | 'file-confirm';
/** The name dialog (WP-20) names a new town or renames this one, and returns to where it opened. */
type NameDialog = { mode: 'new' | 'rename'; from: 'title' | 'menu' | 'building' };
type UiSfx = 'ui-hover' | 'ui-click' | 'ui-open' | 'ui-close';

const HINT_MAX_USES = 3;
const HINT_MS = 3500;
const PICK_HINT_MOUSE = 'Pick something below, then click the map to build';
const PICK_HINT_TOUCH = 'Pick an item below · two fingers move the view';

/** Catalog hints are written for mouse + keys; reword them for touch (no key cues). */
function touchHint(hint: string): string {
  return hint
    .replace(/ · R to rotate$/, ' · tap Rotate to turn it')
    .replace(/^Click or drag/, 'Tap or drag')
    .replace(/^Click/, 'Tap');
}
const INVALID_TOOLTIP_MS = 1500;
const PHOTO_DEVELOPING = 'Developing…';
/** Music note for the menu's Music row (WP-13; same 24×24, 2 px stroke style as GLYPHS). */
const MUSIC_GLYPH =
  '<svg class="ui-glyph" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>';

/** Day/night modes (WP-16c): label + glyph for the top-bar button and the menu row. */
const TIME_MODE_UI: Record<TimeMode, { label: string; glyph: string }> = {
  auto: { label: 'Auto', glyph: GLYPHS.timeAuto },
  day: { label: 'Day', glyph: GLYPHS.timeDay },
  night: { label: 'Night', glyph: GLYPHS.timeNight },
};

/** Menu tabs (WP-25): label + glyph, in MENU_TABS order. */
const MENU_TAB_UI: Record<MenuTab, { label: string; glyph: string }> = {
  town: { label: 'Town', glyph: GLYPHS.homes },
  graphics: { label: 'Graphics', glyph: GLYPHS.graphics },
  sound: { label: 'Sound', glyph: GLYPHS.soundOn },
  help: { label: 'Help', glyph: GLYPHS.help },
};

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
  /** Last `daytime:changed` fact (Game emits it at boot with the stored mode). */
  private timeMode: TimeMode = 'auto';
  private dayPhase: DayPhase = 'day';
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
  /** The latest framed photo (WP-19) and the object URL the preview shows it through. */
  private photo: { blob: Blob; fileName: string; url: string } | null = null;
  /** The town's name (WP-20; from `town:named`) and the name dialog's purpose while it is open. */
  private townName = DEFAULT_TOWN_NAME;
  private nameDialog: NameDialog = { mode: 'new', from: 'title' };
  /** Town file (WP-21): where the panel opened from, and the decoded file waiting for its confirm. */
  private fileFrom: 'title' | 'menu' | 'building' = 'building';
  private pendingFile: DecodedTownFile | null = null;
  /** Menu tabs (WP-25): the open tab (kept for this page session) and the menu control a sub-view opened from. */
  private menuTab: MenuTab = 'town';
  private menuReturnFocus: HTMLElement | null = null;
  /**
   * Last `graphics:changed` fact (WP-25). Game emits it at boot; until it does (or if it never
   * does), the Graphics tab shows the default preset.
   */
  private graphics: { preset: GraphicsPreset; reloadRequired: boolean } = { preset: DEFAULT_GRAPHICS, reloadRequired: false };

  /**
   * `suggestTownName(avoid)` draws a random name from the suggestion list (Game owns the list and its
   * seeded stream), never `avoid` when there is another choice.
   */
  constructor(
    host: HTMLElement,
    private readonly bus: GameBus,
    private readonly hasSave: () => boolean,
    private readonly suggestTownName: (avoid?: string) => string,
  ) {
    this.root = host;
    this.root.innerHTML = this.template();

    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('submit', this.onSubmit);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('change', this.onInput);
    this.root.addEventListener('pointerover', this.onPointerOver);
    this.el('ui-menu-tabs').addEventListener('keydown', this.onMenuTabKeyDown);
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
      // WP-16c: day/night mode (button + menu row) render from the fact, never from the intent.
      bus.on('daytime:changed', ({ mode, phase }) => {
        this.timeMode = mode;
        this.dayPhase = phase;
        this.renderTimeMode();
      }),
      // WP-19: the photo preview fills in when the framed photo is ready.
      bus.on('photo:ready', (photo) => this.showPhoto(photo)),
      bus.on('photo:error', () => this.renderPhotoState('error', "The photo didn't come out. Close this and try again.")),
      // WP-21: the live town as a file, answered in the same click as intent:export-town.
      bus.on('town-file:ready', ({ blob, fileName }) => {
        downloadBlob(blob, fileName);
        this.renderFileStatus('ok', `Saved as ${fileName}`);
        const keep = this.button(UI_TEST_IDS.fileConfirmKeep);
        keep.textContent = `Saved as ${fileName}`;
        keep.disabled = true;
      }),
      // WP-20: the top bar shows the town's name.
      bus.on('town:named', ({ name }) => {
        this.townName = name;
        this.renderTownName();
      }),
      // WP-25: the Graphics tab renders from the fact, never from the intent.
      bus.on('graphics:changed', ({ preset, reloadRequired }) => {
        this.graphics = { preset, reloadRequired };
        this.renderGraphics();
      }),
    );
    this.renderTownName();
    this.renderTray();
    this.renderAudio();
    this.renderTimeMode();
    this.renderGraphics();
    this.renderMenuTab();
    this.renderRotation(0);
    this.showPhase('loading');
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('submit', this.onSubmit);
    this.root.removeEventListener('input', this.onInput);
    this.root.removeEventListener('change', this.onInput);
    this.root.removeEventListener('pointerover', this.onPointerOver);
    this.el('ui-menu-tabs').removeEventListener('keydown', this.onMenuTabKeyDown);
    window.removeEventListener('keydown', this.onKeyDown, { capture: true });
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('resize', this.updateTrayCue);
    window.clearTimeout(this.hintTimer);
    window.clearTimeout(this.tooltipTimer);
    if (this.photo) URL.revokeObjectURL(this.photo.url);
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
          <div class="ui-title-links">
            <button id="${id.titleOpenFile}" type="button" class="ui-link ui-title-credits">Open a town file</button>
            <button id="${id.titleCredits}" type="button" class="ui-link ui-title-credits">Credits</button>
          </div>
        </div>
      </section>

      <header class="ui-topbar ui-hud" data-phase="building menu">
        <button id="${id.townName}" type="button" class="ui-brand ui-pill"><span class="ui-mark"><span class="ui-mark-house">${GLYPHS.homes}</span><span class="ui-mark-text ui-town-name"></span></span></button>
        <div class="ui-actions ui-pill" role="group" aria-label="Game controls">
          <button id="${id.undo}" type="button" class="ui-icon-btn" disabled aria-label="Undo" title="Undo (Ctrl+Z)">${GLYPHS.undo}</button>
          <button id="${id.redo}" type="button" class="ui-icon-btn" disabled aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${GLYPHS.redo}</button>
          <span class="ui-sep" aria-hidden="true"></span>
          <button id="${id.townFile}" type="button" class="ui-icon-btn ui-town-file-btn" aria-label="Town file: download or open a town" title="Town file: download or open a town">${GLYPHS.folder}</button>
          <button id="${id.photo}" type="button" class="ui-icon-btn" aria-label="Take a photo" aria-keyshortcuts="P" title="Take a photo (P)">${GLYPHS.photo}</button>
          <button id="${id.timeMode}" type="button" class="ui-icon-btn ui-time-btn" aria-keyshortcuts="T"></button>
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
        <section class="ui-panel ui-menu-panel" id="${id.menuPanel}" data-view="menu" role="dialog" aria-modal="true" aria-labelledby="ui-menu-h">
          <h2 id="ui-menu-h">Menu</h2>
          <button type="button" class="ui-btn ui-btn-primary" id="${id.resume}">${GLYPHS.play}<span>Resume</span></button>
          <div class="ui-menu-tabs" id="ui-menu-tabs" role="tablist" aria-label="Menu sections">
            ${MENU_TABS.map(
              (tab) =>
                `<button type="button" role="tab" class="ui-menu-tab" id="${id.menuTab(tab)}" data-menu-tab="${tab}" aria-controls="${id.menuTabPanel(tab)}" aria-selected="false" tabindex="-1">${MENU_TAB_UI[tab].glyph}<span>${MENU_TAB_UI[tab].label}</span></button>`,
            ).join('')}
          </div>
          <div class="ui-menu-pages">
            <div class="ui-menu-page" role="tabpanel" id="${id.menuTabPanel('town')}" aria-labelledby="${id.menuTab('town')}" hidden>
              <div class="ui-field ui-seg-field">
                <span class="ui-seg-label" id="ui-time-mode-label">${GLYPHS.timeAuto}<span>Time of day</span></span>
                <div class="ui-seg" id="${id.timeModeGroup}" role="radiogroup" aria-labelledby="ui-time-mode-label">
                  ${TIME_MODES.map(
                    (mode) =>
                      `<label class="ui-seg-opt"><input type="radio" name="time-mode" id="${id.timeModeOption(mode)}" value="${mode}"${mode === 'auto' ? ' checked' : ''} /><span>${TIME_MODE_UI[mode].label}</span></label>`,
                  ).join('')}
                </div>
              </div>
              <button type="button" class="ui-btn ui-town-file-row" id="${id.townFileMenu}">${GLYPHS.folder}<span>Town file</span></button>
              <div class="ui-row">
                <button type="button" class="ui-btn" id="${id.renameTown}">${GLYPHS.pencil}<span>Rename town</span></button>
                <button type="button" class="ui-btn ui-btn-danger-soft" id="${id.newTown}">${GLYPHS.plus}<span>New town</span></button>
              </div>
            </div>
            <div class="ui-menu-page" role="tabpanel" id="${id.menuTabPanel('graphics')}" aria-labelledby="${id.menuTab('graphics')}" hidden>
              <div class="ui-field ui-seg-field">
                <span class="ui-seg-label" id="ui-graphics-label">${GLYPHS.graphics}<span>Quality</span></span>
                <div class="ui-seg" id="${id.graphicsGroup}" role="radiogroup" aria-labelledby="ui-graphics-label" aria-describedby="ui-graphics-desc">
                  ${GRAPHICS_PRESETS.map(
                    (preset) =>
                      `<label class="ui-seg-opt"><input type="radio" name="graphics" id="${id.graphicsOption(preset)}" value="${preset}"${preset === DEFAULT_GRAPHICS ? ' checked' : ''} /><span>${GRAPHICS_UI[preset].label}</span></label>`,
                  ).join('')}
                </div>
              </div>
              <p class="ui-graphics-desc" id="ui-graphics-desc"></p>
              <div class="ui-graphics-live" aria-live="polite">
                <div class="ui-graphics-reload" hidden>
                  <p>Some changes apply after a reload</p>
                  <button type="button" class="ui-btn" id="${id.graphicsReload}">${GLYPHS.retry}<span>Reload now</span></button>
                </div>
              </div>
              <label class="ui-field ui-check" for="${id.grid}">
                ${GLYPHS.grid}<span>Show grid</span>
                <input type="checkbox" id="${id.grid}" role="switch" checked />
              </label>
            </div>
            <div class="ui-menu-page" role="tabpanel" id="${id.menuTabPanel('sound')}" aria-labelledby="${id.menuTab('sound')}" hidden>
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
            </div>
            <div class="ui-menu-page" role="tabpanel" id="${id.menuTabPanel('help')}" aria-labelledby="${id.menuTab('help')}" hidden>
              <button type="button" class="ui-btn" id="${id.help}">${GLYPHS.keys}<span>Controls</span></button>
              <button type="button" class="ui-btn" id="${id.resetView}">${GLYPHS.camera}<span>Reset view</span></button>
              <button type="button" class="ui-btn" id="${id.credits}">${GLYPHS.info}<span>Credits</span></button>
            </div>
          </div>
        </section>

        <section class="ui-panel ui-name-panel" id="${id.namePanel}" data-view="name" data-mode="new" role="dialog" aria-modal="true" aria-labelledby="ui-name-h">
          <h2 id="ui-name-h">Name your town</h2>
          <form class="ui-name-form" novalidate>
            <div class="ui-name-field">
              <input type="text" id="${id.nameInput}" maxlength="${TOWN_NAME_MAX_LENGTH}" aria-label="Town name" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done" />
              <button type="button" class="ui-icon-btn" id="${id.nameShuffle}" aria-label="Another name" title="Another name">${GLYPHS.dice}</button>
            </div>
            <p class="ui-name-count" id="ui-name-count" aria-hidden="true"></p>
            <div class="ui-row">
              <button type="button" class="ui-btn" id="${id.nameCancel}" data-back>Cancel</button>
              <button type="submit" class="ui-btn ui-btn-primary" id="${id.nameSubmit}"><span class="ui-name-submit">Start building</span></button>
            </div>
          </form>
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
                <dt>T</dt><dd>Time of day (auto · day · night)</dd>
                <dt>P</dt><dd>Take a photo</dd>
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
                <dt>Sun · moon</dt><dd>Time of day</dd>
                <dt>Camera</dt><dd>Take a photo</dd>
              </dl>
            </div>
          </div>
          <button type="button" class="ui-btn ui-btn-primary" id="${id.helpClose}" data-back>Got it</button>
        </section>

        <section class="ui-panel ui-photo-panel" id="${id.photoPanel}" data-view="photo" role="dialog" aria-modal="true" aria-labelledby="ui-photo-h">
          <h2 id="ui-photo-h">Town photo</h2>
          <figure class="ui-print" data-state="developing">
            <span class="ui-print-tape" aria-hidden="true"></span>
            <img id="${id.photoImage}" alt="A photo of your town in a Polaroid frame" hidden />
          </figure>
          <p class="ui-photo-status" aria-live="polite">${PHOTO_DEVELOPING}</p>
          <div class="ui-photo-actions">
            <button type="button" class="ui-btn ui-btn-primary" id="${id.photoDownload}" disabled>${GLYPHS.download}<span>Download</span></button>
          </div>
          <button type="button" class="ui-link" id="${id.photoClose}" data-back>Back to town</button>
        </section>

        <section class="ui-panel ui-file-panel" id="${id.filePanel}" data-view="file" role="dialog" aria-modal="true" aria-labelledby="ui-file-h">
          <h2 id="ui-file-h">Town file</h2>
          <p>Keep a copy of your town on your device, or open one you saved before.</p>
          <button type="button" class="ui-btn ui-btn-primary" id="${id.fileDownload}">${GLYPHS.download}<span>Download this town</span></button>
          <button type="button" class="ui-btn" id="${id.fileOpen}">${GLYPHS.upload}<span>Open a town file…</span></button>
          <p class="ui-file-status" aria-live="polite"></p>
          <button type="button" class="ui-link" id="${id.fileClose}" data-back>Back to town</button>
        </section>

        <section class="ui-panel" id="${id.fileConfirmPanel}" data-view="file-confirm" role="alertdialog" aria-modal="true" aria-labelledby="ui-file-confirm-h" aria-describedby="ui-file-confirm-d">
          <h2 id="ui-file-confirm-h"></h2>
          <p class="ui-file-when"></p>
          <p id="ui-file-confirm-d"></p>
          <div class="ui-row">
            <button type="button" class="ui-btn" id="${id.fileConfirmCancel}" data-back>Cancel</button>
            <button type="button" class="ui-btn" id="${id.fileConfirmOpen}"></button>
          </div>
          <button type="button" class="ui-link" id="${id.fileConfirmKeep}"></button>
        </section>

        <section class="ui-panel" id="${id.creditsPanel}" data-view="credits" role="dialog" aria-modal="true" aria-labelledby="ui-credits-h">
          <h2 id="ui-credits-h">Credits</h2>
          <p>Most 3D models, item icons and all sounds by <strong>Kenney</strong> (kenney.nl), CC0.</p>
          <p class="ui-credits-small">Also via Poly Pizza (poly.pizza): “Church”, “Swing set” and “Fountain” by Poly by Google, CC-BY 3.0; “Grill” by Zsky, CC-BY 3.0; “Donut Store” by J-Toastie, CC-BY 3.0; “Slide” by sirkitree, CC-BY 3.0; corner shop “Building” by Kay Lousberg, CC0; “Mailbox” by CreativeTrio, CC0. Scaled and recoloured for Tiny Town.</p>
          <p>Music: <strong>Foundation of Gold</strong>, created for Tiny Town by its author.</p>
          <p>Font: <strong>Nunito</strong> by Vernon Adams, Cyreal and Jacques Le Bailly, SIL Open Font License.</p>
          <p>Made with three.js.</p>
          <button type="button" class="ui-btn" id="${id.creditsClose}" data-back>Back</button>
        </section>
      </div>

      <input type="file" id="${id.fileInput}" accept="${TOWN_FILE_EXTENSION},.json,${TOWN_FILE_MIME}" hidden />

      <div class="ui-flash" aria-hidden="true"></div>

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

    if (target.id === id.start) {
      // Continue goes straight in; a new town is named first (WP-20).
      if (this.hasSave()) this.bus.emit('intent:start', { mode: 'continue' });
      else this.openNameDialog({ mode: 'new', from: 'title' });
    } else if (target.id === id.townName) this.openNameDialog({ mode: 'rename', from: 'building' });
    else if (target.id === id.renameTown) this.openNameDialog({ mode: 'rename', from: 'menu' });
    else if (target.id === id.nameShuffle) this.shuffleTownName();
    else if (target.id === id.townFile) this.openFilePanel('building');
    else if (target.id === id.townFileMenu) this.openFilePanel('menu');
    else if (target.id === id.titleOpenFile) {
      this.fileFrom = 'title';
      this.chooseTownFile();
    } else if (target.id === id.fileOpen) this.chooseTownFile();
    else if (target.id === id.fileDownload || target.id === id.fileConfirmKeep) this.bus.emit('intent:export-town');
    else if (target.id === id.fileConfirmOpen) this.openPendingFile();
    else if (target.id === id.titleNew) this.openModal('confirm');
    else if (target.id === id.titleCredits || target.id === id.credits) this.openModal('credits');
    else if (target.id === id.undo) this.bus.emit('intent:undo');
    else if (target.id === id.redo) this.bus.emit('intent:redo');
    else if (target.id === id.timeMode) this.bus.emit('intent:cycle-time-mode');
    else if (target.id === id.photo) this.takePhoto();
    else if (target.id === id.photoDownload) this.downloadPhoto();
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
    else if (target.id === id.graphicsReload) this.bus.emit('intent:reload-graphics');
    else if (target.dataset.menuTab) this.selectMenuTab(target.dataset.menuTab as MenuTab);
    else if (target.hasAttribute('data-back')) this.back();
    else if (target.id === id.retry) window.location.reload();
    else if (target.dataset.category) this.setCategory(target.dataset.category as ToolCategory);
    else if (target.dataset.tool) this.selectTool(target.dataset.tool as ToolId);
  };

  /** The name dialog's form (Enter in the field or its submit button). */
  private readonly onSubmit = (event: SubmitEvent): void => {
    if (!(event.target as HTMLElement).closest(`#${UI_TEST_IDS.namePanel}`)) return;
    event.preventDefault();
    this.submitTownName();
  };

  private readonly onInput = (event: Event): void => {
    const target = event.target as HTMLInputElement;
    if (target.id === UI_TEST_IDS.nameInput) {
      if (event.type === 'input') this.renderNameCount();
    } else if (target.id === UI_TEST_IDS.fileInput) {
      if (event.type === 'change') void this.readTownFile(target);
    } else if (target.id === UI_TEST_IDS.volume && event.type === 'input') {
      this.bus.emit('intent:set-volume', { volume: Number(target.value) });
    } else if (target.id === UI_TEST_IDS.musicVolume && event.type === 'input') {
      this.bus.emit('intent:set-music-volume', { volume: Number(target.value) });
    } else if (target.id === UI_TEST_IDS.music && event.type === 'change') {
      this.sfx('ui-click');
      this.bus.emit('intent:set-music', { enabled: target.checked });
    } else if (target.id === UI_TEST_IDS.grid && event.type === 'change') {
      this.sfx('ui-click');
      this.bus.emit('intent:toggle-grid', { visible: target.checked });
    } else if (target.name === 'time-mode' && event.type === 'change' && target.checked) {
      this.sfx('ui-click');
      this.bus.emit('intent:set-time-mode', { mode: target.value as TimeMode });
    } else if (target.name === 'graphics' && event.type === 'change' && target.checked && isGraphicsPreset(target.value)) {
      this.sfx('ui-click');
      this.bus.emit('intent:set-graphics', { preset: target.value });
      // The radios show the last fact: Game answers the intent with graphics:changed (synchronously),
      // so this keeps the new choice; without an answer the old one comes back.
      this.renderGraphics();
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
    // Esc closes an overlay even from the town name field (WP-20); every other key there is typing.
    if (event.code === 'Escape' && this.modal && !event.isComposing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.back();
      return;
    }
    const target = event.target as HTMLElement | null;
    const typing = target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'checkbox' && target.type !== 'radio';
    if (typing || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;

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
    if (isPhotoKey(event)) {
      event.preventDefault();
      this.takePhoto();
      return;
    }
    const action = digitAction(event, this.category, this.activeTool);
    if (!action) return;
    event.preventDefault();
    if (action.type === 'category') this.setCategory(action.category);
    else this.bus.emit('intent:select-tool', { toolId: action.toolId });
  };

  /** WAI-ARIA tabs (automatic activation): Left/Right move and wrap, Home/End jump to the ends. */
  private readonly onMenuTabKeyDown = (event: KeyboardEvent): void => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-menu-tab]')?.dataset.menuTab as MenuTab | undefined;
    if (!tab || event.altKey || event.ctrlKey || event.metaKey) return;
    const i = MENU_TABS.indexOf(tab);
    const n = MENU_TABS.length;
    const next =
      event.key === 'ArrowRight' ? MENU_TABS[(i + 1) % n]
      : event.key === 'ArrowLeft' ? MENU_TABS[(i - 1 + n) % n]
      : event.key === 'Home' ? MENU_TABS[0]
      : event.key === 'End' ? MENU_TABS[n - 1]
      : null;
    if (!next) return;
    event.preventDefault();
    if (next !== this.menuTab) this.sfx('ui-click');
    this.selectMenuTab(next);
  };

  // ---------------------------------------------------------------- actions

  /** Show `tab`'s panel and focus its tab button (the menu remembers it until the page reloads). */
  private selectMenuTab(tab: MenuTab): void {
    this.menuTab = tab;
    this.renderMenuTab();
    this.button(UI_TEST_IDS.menuTab(tab)).focus({ preventScroll: true });
  }

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

  /** Camera button / P: the game captures and enters the menu phase, which opens the photo view. */
  private takePhoto(): void {
    if (this.phase !== 'building') return;
    this.pendingView = 'photo';
    this.bus.emit('intent:take-photo');
    this.pendingView = null;
  }

  private downloadPhoto(): void {
    if (!this.photo) return;
    downloadBlob(this.photo.blob, this.photo.fileName);
    this.renderPhotoState('ready', `Saved as ${this.photo.fileName}`);
  }

  /** "Clear" in the new-town confirm: name the new town first; nothing is cleared until it is named. */
  private confirmNewTown(): void {
    this.openNameDialog({ mode: 'new', from: this.phase === 'title' ? 'title' : 'menu' });
  }

  /**
   * The name dialog (WP-20). From the title it opens over the title; from the top bar it enters the
   * menu phase (like the photo view); from the menu or the confirm it replaces that panel.
   */
  private openNameDialog(dialog: NameDialog): void {
    this.nameDialog = dialog;
    if (dialog.from === 'building') {
      if (this.phase !== 'building') return;
      this.pendingView = 'name';
      this.bus.emit('intent:open-menu');
      this.pendingView = null;
    } else this.openModal('name');
  }

  /** Fill the dialog: a random suggestion for a new town, the current name for a rename. */
  private startNameView(): void {
    const { mode } = this.nameDialog;
    const panel = this.el(UI_TEST_IDS.namePanel);
    panel.dataset.mode = mode;
    this.el('ui-name-h').textContent = mode === 'new' ? 'Name your town' : 'Rename your town';
    panel.querySelector('.ui-name-submit')!.textContent = mode === 'new' ? 'Start building' : 'Save';
    this.el<HTMLInputElement>(UI_TEST_IDS.nameInput).value = mode === 'new' ? this.suggestTownName() : this.townName;
    this.renderNameCount();
  }

  /** Desktop: the field, text selected, so typing replaces the suggestion. Touch: the button, so the keyboard stays shut. */
  private focusNameDialog(): void {
    const input = this.el<HTMLInputElement>(UI_TEST_IDS.nameInput);
    if (this.coarse.matches) this.button(UI_TEST_IDS.nameSubmit).focus({ preventScroll: true });
    else {
      input.focus({ preventScroll: true });
      input.select();
    }
  }

  private shuffleTownName(): void {
    const input = this.el<HTMLInputElement>(UI_TEST_IDS.nameInput);
    input.value = this.suggestTownName(sanitizeTownName(input.value));
    this.renderNameCount();
  }

  private submitTownName(): void {
    const name = sanitizeTownName(this.el<HTMLInputElement>(UI_TEST_IDS.nameInput).value);
    if (!name || this.modal !== 'name') return;
    const { mode, from } = this.nameDialog;
    if (mode === 'rename') {
      this.bus.emit('intent:rename-town', { name });
      this.back();
    } else if (from === 'title') {
      this.closeModal();
      this.bus.emit('intent:start', { mode: 'new', name });
    } else {
      this.bus.emit('intent:new-town', { name });
      this.bus.emit('intent:close-menu');
    }
  }

  // ---------------------------------------------------------------- town file (WP-21)

  /** Top bar (from building, like the photo view) or the phone menu row (from the menu). */
  private openFilePanel(from: 'menu' | 'building'): void {
    this.fileFrom = from;
    if (from === 'building') {
      if (this.phase !== 'building') return;
      this.pendingView = 'file';
      this.bus.emit('intent:open-menu');
      this.pendingView = null;
    } else this.openModal('file');
  }

  /** The system file picker (inside the click that asked for it). */
  private chooseTownFile(): void {
    this.el<HTMLInputElement>(UI_TEST_IDS.fileInput).click();
  }

  /** Read and check the picked file; a good one goes to the confirm, a bad one to the panel's status line. */
  private async readTownFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = ''; // picking the same file again still fires 'change'
    if (!file) return;
    let decoded: DecodedTownFile | Error;
    try {
      decoded = file.size > TOWN_FILE_MAX_BYTES ? new Error(TOWN_FILE_ERRORS.tooBig) : decodeTownFile(await file.text());
    } catch {
      decoded = new Error(TOWN_FILE_ERRORS.notTown);
    }
    // The player may have left the title or the panel while the file was read.
    if (this.fileFrom === 'title' ? this.phase !== 'title' : this.phase !== 'menu') return;
    if (decoded instanceof Error) {
      if (this.modal !== 'file') this.openModal('file');
      this.renderFileStatus('error', decoded.message);
      return;
    }
    this.pendingFile = decoded;
    this.openModal('file-confirm');
  }

  /** The panel: no Download on the title (there is no town yet). */
  private startFileView(): void {
    this.button(UI_TEST_IDS.fileDownload).hidden = this.fileFrom === 'title';
    this.el(UI_TEST_IDS.fileClose).textContent = this.fileFrom === 'building' ? 'Back to town' : 'Back';
    this.renderFileStatus('idle', '');
  }

  /** "Open Bumbleford?", when it was saved, and what it replaces (nothing on a fresh title). */
  private startFileConfirmView(): void {
    const file = this.pendingFile;
    if (!file) return;
    const name = file.town.name ?? DEFAULT_TOWN_NAME;
    const replaces = this.fileFrom !== 'title' || this.hasSave();
    this.el('ui-file-confirm-h').textContent = `Open ${name}?`;
    const when = this.root.querySelector<HTMLElement>('.ui-file-when')!;
    when.textContent = file.exportedAt
      ? `Saved on ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(file.exportedAt)}.`
      : '';
    when.hidden = !file.exportedAt;
    const warning = this.el('ui-file-confirm-d');
    warning.textContent =
      this.fileFrom === 'title'
        ? 'Your saved town will be replaced.'
        : `${this.townName} will be replaced. Download it first if you want to keep it.`;
    warning.hidden = !replaces;
    const open = this.button(UI_TEST_IDS.fileConfirmOpen);
    open.textContent = replaces ? 'Replace town' : 'Open town';
    open.classList.toggle('ui-btn-danger', replaces);
    open.classList.toggle('ui-btn-primary', !replaces);
    const keep = this.button(UI_TEST_IDS.fileConfirmKeep);
    keep.hidden = this.fileFrom === 'title';
    keep.disabled = false;
    keep.textContent = `Download ${this.townName} first`;
  }

  private openPendingFile(): void {
    const file = this.pendingFile;
    if (!file || this.modal !== 'file-confirm') return;
    this.pendingFile = null;
    if (this.phase === 'title') this.closeModal();
    // Game loads it and enters building; from the menu, the phase change closes the overlay.
    this.bus.emit('intent:open-town', { save: file.town });
  }

  private renderFileStatus(state: 'idle' | 'ok' | 'error', text: string): void {
    const status = this.root.querySelector<HTMLElement>('.ui-file-status')!;
    status.dataset.state = state;
    status.textContent = text;
  }

  /** "n / 30" under the field; a blank name can't be submitted. */
  private renderNameCount(): void {
    const value = this.el<HTMLInputElement>(UI_TEST_IDS.nameInput).value;
    this.el('ui-name-count').textContent = `${townNameLength(value)} / ${TOWN_NAME_MAX_LENGTH}`;
    this.button(UI_TEST_IDS.nameSubmit).disabled = sanitizeTownName(value) === '';
  }

  /** Esc / Back / Cancel: sub-view → menu (while paused), menu → resume, title overlay → close. */
  private back(): void {
    if (!this.modal) return;
    if (this.phase === 'menu') {
      // The photo view and the top-bar rename open straight from the build view, so they close straight back to it.
      const toBuilding =
        this.modal === 'menu' ||
        this.modal === 'photo' ||
        (this.modal === 'name' && this.nameDialog.from === 'building') ||
        (this.modal === 'file' && this.fileFrom === 'building');
      if (toBuilding) this.bus.emit('intent:close-menu');
      else if (this.modal === 'file-confirm') this.openModal('file');
      else this.openModal('menu');
    } else this.closeModal();
  }

  private openModal(view: ModalView): void {
    const wasOpen = this.modal !== null;
    const from = this.modal;
    // A sub-view opened from the menu gives focus back to the control that opened it (WP-25).
    if (from === 'menu' && view !== 'menu') {
      const active = document.activeElement;
      this.menuReturnFocus = active instanceof HTMLElement && this.el(UI_TEST_IDS.menuPanel).contains(active) ? active : null;
    } else if (!wasOpen) this.menuReturnFocus = null;
    this.modal = view;
    const modal = this.root.querySelector<HTMLElement>('.ui-modal')!;
    modal.hidden = false;
    for (const panel of modal.querySelectorAll<HTMLElement>('[data-view]')) panel.hidden = panel.dataset.view !== view;
    this.setHudInert(true);
    if (!wasOpen) this.sfx('ui-open');
    if (view === 'photo') this.startPhotoView();
    if (view === 'file') this.startFileView();
    if (view === 'file-confirm') this.startFileConfirmView();
    if (view === 'name') {
      this.startNameView();
      this.focusNameDialog();
      return;
    }
    const panel = modal.querySelector<HTMLElement>(`[data-view="${view}"]`)!;
    if (view === 'menu') {
      this.renderMenuTab();
      const back = this.menuReturnFocus;
      this.menuReturnFocus = null;
      if (from && from !== 'menu' && back?.isConnected && back.checkVisibility({ visibilityProperty: true })) {
        back.focus({ preventScroll: true });
        return;
      }
    }
    panel.querySelector<HTMLElement>('button:not(:disabled):not([hidden])')?.focus({ preventScroll: true });
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

  // ---------------------------------------------------------------- photo (WP-19)

  /** Flash, then an empty print in the shape the photo will have while it develops. */
  private startPhotoView(): void {
    const flash = this.root.querySelector<HTMLElement>('.ui-flash')!;
    flash.classList.remove('is-on');
    void flash.offsetWidth; // restart the animation
    flash.classList.add('is-on');
    const layout = photoFrameLayout(window.innerWidth, window.innerHeight);
    this.printFigure().style.setProperty('--print-ar', String(layout.width / layout.height));
    const image = this.el<HTMLImageElement>(UI_TEST_IDS.photoImage);
    image.hidden = true;
    image.removeAttribute('src');
    this.renderPhotoState('developing', PHOTO_DEVELOPING);
  }

  private showPhoto({ blob, width, height, fileName }: { blob: Blob; width: number; height: number; fileName: string }): void {
    if (this.photo) URL.revokeObjectURL(this.photo.url);
    this.photo = { blob, fileName, url: URL.createObjectURL(blob) };
    const image = this.el<HTMLImageElement>(UI_TEST_IDS.photoImage);
    image.width = width;
    image.height = height;
    image.src = this.photo.url;
    image.hidden = false;
    this.printFigure().style.setProperty('--print-ar', String(width / height));
    this.renderPhotoState('ready', '');
    if (this.modal === 'photo') this.button(UI_TEST_IDS.photoDownload).focus({ preventScroll: true });
  }

  private renderPhotoState(state: 'developing' | 'ready' | 'error', status: string): void {
    this.printFigure().dataset.state = state;
    this.root.querySelector('.ui-photo-status')!.textContent = status;
    this.button(UI_TEST_IDS.photoDownload).disabled = state !== 'ready';
  }

  private printFigure(): HTMLElement {
    return this.root.querySelector<HTMLElement>('.ui-print')!;
  }

  /** WP-20: the top-bar pill and the photo's alt text follow the town's name. */
  private renderTownName(): void {
    const brand = this.button(UI_TEST_IDS.townName);
    brand.querySelector('.ui-town-name')!.textContent = this.townName;
    brand.setAttribute('aria-label', `${this.townName}, rename town`);
    brand.title = `${this.townName} · Rename town`;
    // The menu is headed by the town's name: on narrow phones the top bar has no room for it.
    this.el('ui-menu-h').textContent = this.townName;
    this.el(UI_TEST_IDS.photoImage).setAttribute('alt', `A photo of ${this.townName} in a Polaroid frame`);
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
          // Digits 1–9 reach the first nine tools; later ones (WP-23) have no badge and no shortcut.
          (tool, i) => `<button type="button" class="ui-card" id="${UI_TEST_IDS.tool(tool.id)}" data-tool="${tool.id}" aria-pressed="false" aria-label="${tool.label}" title="${i < 9 ? `${tool.label} (${i + 1})` : tool.label}">
          <img src="${assetUrl(tool.icon)}" alt="" width="64" height="64" draggable="false" onerror="this.style.visibility='hidden'" /><span class="ui-card-label">${tool.label}</span>${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}</button>`,
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

  /** Top-bar time button + menu radios from the last `daytime:changed` fact. */
  private renderTimeMode(): void {
    const { label, glyph } = TIME_MODE_UI[this.timeMode];
    const next = TIME_MODE_UI[TIME_MODES[(TIME_MODES.indexOf(this.timeMode) + 1) % TIME_MODES.length]].label;
    const button = this.button(UI_TEST_IDS.timeMode);
    button.innerHTML = glyph;
    button.dataset.mode = this.timeMode;
    button.dataset.dayPhase = this.dayPhase;
    // A 3-state cycle button: the name carries the current state, the description the action.
    button.setAttribute('aria-label', `Time of day: ${label}`);
    button.setAttribute('aria-description', `Switch to ${next}`);
    button.title = `Time: ${label} (T)`;
    for (const mode of TIME_MODES) this.el<HTMLInputElement>(UI_TEST_IDS.timeModeOption(mode)).checked = mode === this.timeMode;
  }

  /** Menu tabs (WP-25): one selected tab (roving tabindex) and its panel; the others are hidden. */
  private renderMenuTab(): void {
    for (const tab of MENU_TABS) {
      const selected = tab === this.menuTab;
      const button = this.button(UI_TEST_IDS.menuTab(tab));
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      this.el(UI_TEST_IDS.menuTabPanel(tab)).hidden = !selected;
    }
  }

  /** Graphics tab (WP-25) from the last `graphics:changed` fact: the checked preset, its description, the reload notice. */
  private renderGraphics(): void {
    const { preset, reloadRequired } = this.graphics;
    for (const p of GRAPHICS_PRESETS) this.el<HTMLInputElement>(UI_TEST_IDS.graphicsOption(p)).checked = p === preset;
    this.el('ui-graphics-desc').textContent = GRAPHICS_UI[preset].description;
    this.root.querySelector<HTMLElement>('.ui-graphics-reload')!.hidden = !reloadRequired;
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
