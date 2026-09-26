/**
 * Stable DOM ids for tests and bots (WP-06). Side-effect free so Playwright specs can import it
 * in Node (re-exported from UiRoot.ts for existing imports).
 */
import type { ToolCategory, ToolId } from '../catalog/tools';

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
  stats: 'ui-stats',
  hint: 'ui-hint',
  tooltip: 'ui-tooltip',
} as const;
