/** Stable DOM ids for tests and bots. Side-effect free so Playwright specs can import it in Node. */
import type { ToolCategory, ToolId } from '../catalog/tools';
import type { GraphicsPreset } from '../game/graphics';
import type { TimeMode } from '../world/dayCycle';

/** In display order. */
export const MENU_TABS = ['town', 'graphics', 'sound', 'help'] as const;
export type MenuTab = (typeof MENU_TABS)[number];

/**
 * `tool-<id>` buttons also carry data-tool="<id>".
 * A tool button only exists while its category is active: click `cat-<category>` first.
 */
export const UI_TEST_IDS = {
  start: 'btn-start',
  undo: 'btn-undo',
  redo: 'btn-redo',
  mute: 'btn-mute',
  rotate: 'btn-rotate',
  move: 'tool-move',
  bulldoze: 'tool-bulldoze',
  category: (id: ToolCategory) => `cat-${id}`,
  tool: (id: ToolId) => `tool-${id}`,
  titleNew: 'btn-title-new',
  titleCredits: 'btn-title-credits',
  menu: 'btn-menu',
  menuPanel: 'ui-menu',
  resume: 'btn-resume',
  newTown: 'btn-new-town',
  help: 'btn-help',
  credits: 'btn-credits',
  volume: 'range-volume',
  grid: 'chk-grid',
  fps: 'chk-fps',
  /** Shown only while the Show FPS switch is on; reads "60 FPS". */
  fpsCounter: 'ui-fps',
  music: 'chk-music',
  musicVolume: 'range-music',
  /** Cycles Auto → Day → Night; data-mode is the current mode. */
  timeMode: 'time-mode',
  timeModeGroup: 'ui-time-mode',
  timeModeOption: (mode: TimeMode) => `radio-time-${mode}`,
  photo: 'btn-photo',
  photoPanel: 'ui-photo',
  /** src is set once the photo is ready; data-state is on its figure. */
  photoImage: 'ui-photo-img',
  photoDownload: 'btn-photo-download',
  photoClose: 'btn-photo-close',
  townName: 'btn-town-name',
  renameTown: 'btn-rename-town',
  /** data-mode is "new" or "rename". */
  namePanel: 'ui-town-name',
  nameInput: 'input-town-name',
  nameShuffle: 'btn-town-name-shuffle',
  nameCancel: 'btn-town-name-cancel',
  nameSubmit: 'btn-town-name-ok',
  /** Top-bar button, hidden ≤ 440 px; townFileMenu is its menu twin, shown only ≤ 440 px. */
  townFile: 'btn-town-file',
  townFileMenu: 'btn-town-file-menu',
  titleOpenFile: 'btn-title-open-file',
  /** Its status line carries data-state. */
  filePanel: 'ui-town-file',
  fileDownload: 'btn-town-file-download',
  fileOpen: 'btn-town-file-open',
  fileClose: 'btn-town-file-close',
  /** Hidden <input type="file"> behind every "open"; Playwright: waitForEvent('filechooser'). */
  fileInput: 'input-town-file',
  fileConfirmPanel: 'ui-town-file-confirm',
  fileConfirmCancel: 'btn-town-file-cancel',
  fileConfirmOpen: 'btn-town-file-replace',
  fileConfirmKeep: 'btn-town-file-keep',
  /** role=tab with aria-selected; its panel is role=tabpanel, hidden unless selected. */
  menuTab: (tab: MenuTab) => `tab-menu-${tab}`,
  menuTabPanel: (tab: MenuTab) => `panel-menu-${tab}`,
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
  /** Variant picker strip; its chips are keyed by model index. */
  variants: 'ui-variants',
  variant: (choice: number) => `variant-${choice}`,
  hint: 'ui-hint',
  tooltip: 'ui-tooltip',
} as const;
