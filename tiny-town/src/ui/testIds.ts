/**
 * Stable DOM ids for tests and bots (WP-06). Side-effect free so Playwright specs can import it
 * in Node (re-exported from UiRoot.ts for existing imports).
 */
import type { ToolCategory, ToolId } from '../catalog/tools';
import type { GraphicsPreset } from '../game/graphics';
import type { TimeMode } from '../world/dayCycle';

/** WP-25: menu tabs, in order. */
export const MENU_TABS = ['town', 'graphics', 'sound', 'help'] as const;
export type MenuTab = (typeof MENU_TABS)[number];

/**
 * Stable selectors for tests/bots. `tool-<id>` buttons also carry data-tool="<id>".
 * NOTE: a tool button only exists while its category is active — click `cat-<category>` first.
 * Everything below "added by WP-06" is additive; never rename the original eight.
 */
export const UI_TEST_IDS = {
  start: 'btn-start',
  undo: 'btn-undo',
  redo: 'btn-redo',
  mute: 'btn-mute',
  rotate: 'btn-rotate',
  bulldoze: 'tool-bulldoze',
  category: (id: ToolCategory) => `cat-${id}`,
  tool: (id: ToolId) => `tool-${id}`,
  // --- added by WP-06 ---
  titleNew: 'btn-title-new',
  titleCredits: 'btn-title-credits',
  menu: 'btn-menu',
  menuPanel: 'ui-menu',
  resume: 'btn-resume',
  newTown: 'btn-new-town',
  help: 'btn-help',
  resetView: 'btn-reset-view',
  credits: 'btn-credits',
  volume: 'range-volume',
  grid: 'chk-grid',
  // --- added by WP-13 (menu music settings) ---
  music: 'chk-music',
  musicVolume: 'range-music',
  // --- added by WP-16c (day/night controls) ---
  /** Top-bar time button: cycles Auto → Day → Night (data-mode = the current mode). */
  timeMode: 'time-mode',
  /** Menu "Time of day" radio group and its three radios. */
  timeModeGroup: 'ui-time-mode',
  timeModeOption: (mode: TimeMode) => `radio-time-${mode}`,
  // --- added by WP-19 (town photo) ---
  /** Top-bar camera button (key P): takes a photo and opens the preview. */
  photo: 'btn-photo',
  photoPanel: 'ui-photo',
  /** The framed photo in the preview (src set once the photo is ready; data-state on its figure). */
  photoImage: 'ui-photo-img',
  photoDownload: 'btn-photo-download',
  photoClose: 'btn-photo-close',
  // --- added by WP-20 (town name) ---
  /** Top-bar brand pill: shows the town's name; click/tap to rename. */
  townName: 'btn-town-name',
  /** Menu "Rename town" button. */
  renameTown: 'btn-rename-town',
  /** The name dialog (data-mode="new" | "rename"), its field, dice, cancel and submit buttons. */
  namePanel: 'ui-town-name',
  nameInput: 'input-town-name',
  nameShuffle: 'btn-town-name-shuffle',
  nameCancel: 'btn-town-name-cancel',
  nameSubmit: 'btn-town-name-ok',
  // --- added by WP-21 (town file) ---
  /** Top-bar Town file button (hidden ≤ 440 px) and its phone twin in the menu (shown only ≤ 440 px). */
  townFile: 'btn-town-file',
  townFileMenu: 'btn-town-file-menu',
  /** Title link "Open a town file" (straight to the file picker). */
  titleOpenFile: 'btn-title-open-file',
  /** The Town file panel: Download, Open a town file…, the status line (data-state), Back to town. */
  filePanel: 'ui-town-file',
  fileDownload: 'btn-town-file-download',
  fileOpen: 'btn-town-file-open',
  fileClose: 'btn-town-file-close',
  /** The hidden <input type="file"> behind every "open" (Playwright: waitForEvent('filechooser')). */
  fileInput: 'input-town-file',
  /** The confirm before an opened file replaces the town. */
  fileConfirmPanel: 'ui-town-file-confirm',
  fileConfirmCancel: 'btn-town-file-cancel',
  fileConfirmOpen: 'btn-town-file-replace',
  fileConfirmKeep: 'btn-town-file-keep',
  // --- added by WP-25 (menu tabs, graphics settings) ---
  /** Menu tab buttons (role=tab, aria-selected) and their panels (role=tabpanel; hidden unless selected). */
  menuTab: (tab: MenuTab) => `tab-menu-${tab}`,
  menuTabPanel: (tab: MenuTab) => `panel-menu-${tab}`,
  /** Graphics tab: the Low / Medium / High radio group, its radios, and "Reload to apply". */
  graphicsGroup: 'ui-graphics',
  graphicsOption: (preset: GraphicsPreset) => `radio-graphics-${preset}`,
  graphicsReload: 'btn-graphics-reload',
  confirmPanel: 'ui-confirm',
  confirmClear: 'btn-confirm-clear',
  confirmCancel: 'btn-confirm-cancel',
  helpPanel: 'ui-help',
  helpClose: 'btn-help-close',
  creditsPanel: 'ui-credits',
  creditsClose: 'btn-credits-close',
  retry: 'btn-retry',
  dock: 'ui-dock',
  tray: 'ui-tray',
  hint: 'ui-hint',
  tooltip: 'ui-tooltip',
} as const;
