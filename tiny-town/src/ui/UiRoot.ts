/**
 * DOM UI: loading, title, build dock, top bar, menu. Talks to the game ONLY via the bus:
 * emits `intent:*`, renders facts (`tool:changed`, `town:stats`, `history:changed`, ...).
 *
 * SCAFFOLD BASELINE — WP-06 (UI) owns src/ui/**. This baseline is intentionally plain and
 * functional; replace it with the design in docs/design/02-interaction-and-ui.md (dock with
 * category tabs + item tray, stats, menu/confirm/help overlays, hint line, cursor tooltip,
 * mobile layout, focus/hover/pressed/disabled states, ui:sfx on hover/click).
 * Keep the element ids listed in UI_TEST_IDS stable — Playwright tests select by them.
 */
import { TOOL_CATEGORIES, toolsInCategory, type ToolCategory, type ToolId } from '../catalog/tools';
import { assetUrl } from '../game/config';
import type { GameBus, GamePhase } from '../game/events';
import type { TownStats } from '../town/types';

/**
 * Stable selectors for tests/bots. `tool-<id>` buttons also carry data-tool="<id>".
 * NOTE: a tool button only exists while its category is active — click `cat-<category>` first.
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
} as const;

export class UiRoot {
  private readonly root: HTMLElement;
  private readonly unsubscribers: Array<() => void> = [];
  private category: ToolCategory = 'paths';
  private activeTool: ToolId | null = null;
  private muted = false;

  constructor(
    host: HTMLElement,
    private readonly bus: GameBus,
    private readonly hasSave: () => boolean,
  ) {
    this.root = host;
    this.root.innerHTML = `
      <div class="ui-loading" data-phase="loading"><h1>Tiny Town</h1><progress id="load-progress" max="1" value="0"></progress></div>
      <div class="ui-title" data-phase="title">
        <h1>Tiny Town</h1>
        <button id="${UI_TEST_IDS.start}" type="button">Start building</button>
      </div>
      <header class="ui-topbar" data-phase="building">
        <div class="ui-stats" id="ui-stats"></div>
        <div class="ui-actions">
          <button id="${UI_TEST_IDS.undo}" type="button" disabled aria-label="Undo">↶</button>
          <button id="${UI_TEST_IDS.redo}" type="button" disabled aria-label="Redo">↷</button>
          <button id="${UI_TEST_IDS.mute}" type="button" aria-label="Mute">🔊</button>
        </div>
      </header>
      <nav class="ui-dock" data-phase="building">
        <div class="ui-tray" id="ui-tray"></div>
        <div class="ui-tabs">
          ${TOOL_CATEGORIES.map((c) => `<button type="button" id="${UI_TEST_IDS.category(c.id)}" data-category="${c.id}">${c.label}</button>`).join('')}
          <button type="button" id="${UI_TEST_IDS.rotate}" aria-label="Rotate">⟳</button>
          <button type="button" id="${UI_TEST_IDS.bulldoze}" data-tool="bulldoze" aria-label="Bulldoze">✕</button>
        </div>
      </nav>`;

    this.root.addEventListener('click', this.onClick);
    this.unsubscribers.push(
      bus.on('phase:changed', ({ phase }) => this.showPhase(phase)),
      bus.on('load:progress', ({ loaded, total }) => {
        const bar = this.root.querySelector<HTMLProgressElement>('#load-progress');
        if (bar) bar.value = total ? loaded / total : 0;
      }),
      bus.on('tool:changed', ({ toolId }) => {
        this.activeTool = toolId;
        this.renderTray();
      }),
      bus.on('town:stats', (stats) => this.renderStats(stats)),
      bus.on('history:changed', ({ canUndo, canRedo }) => {
        this.button(UI_TEST_IDS.undo).disabled = !canUndo;
        this.button(UI_TEST_IDS.redo).disabled = !canRedo;
      }),
      bus.on('audio:changed', ({ muted }) => {
        this.muted = muted;
        this.button(UI_TEST_IDS.mute).textContent = muted ? '🔇' : '🔊';
      }),
    );
    this.renderTray();
    this.renderStats({ homes: 0, residents: 0, trees: 0, roadTiles: 0, props: 0, fences: 0 });
    this.showPhase('loading');
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    for (const off of this.unsubscribers) off();
    this.root.innerHTML = '';
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement).closest('button');
    if (!target) return;
    this.bus.emit('ui:sfx', { event: 'ui-click' });
    if (target.id === UI_TEST_IDS.start) this.bus.emit('intent:start', { mode: this.hasSave() ? 'continue' : 'new' });
    else if (target.id === UI_TEST_IDS.undo) this.bus.emit('intent:undo');
    else if (target.id === UI_TEST_IDS.redo) this.bus.emit('intent:redo');
    else if (target.id === UI_TEST_IDS.mute) this.bus.emit('intent:set-muted', { muted: !this.muted });
    else if (target.id === UI_TEST_IDS.rotate) this.bus.emit('intent:rotate', { direction: 1 });
    else if (target.dataset.category) {
      this.category = target.dataset.category as ToolCategory;
      this.renderTray();
    } else if (target.dataset.tool) this.bus.emit('intent:select-tool', { toolId: target.dataset.tool as ToolId });
  };

  private renderTray(): void {
    const tray = this.root.querySelector<HTMLElement>('#ui-tray');
    if (!tray) return;
    tray.innerHTML = toolsInCategory(this.category)
      .map(
        (tool) => `<button type="button" id="${UI_TEST_IDS.tool(tool.id)}" data-tool="${tool.id}" aria-pressed="${tool.id === this.activeTool}">
          <img src="${assetUrl(tool.icon)}" alt="" width="48" height="48" onerror="this.style.visibility='hidden'" /><span>${tool.label}</span></button>`,
      )
      .join('');
    for (const tab of this.root.querySelectorAll<HTMLElement>('[data-category]')) {
      tab.setAttribute('aria-pressed', String(tab.dataset.category === this.category));
    }
    this.button(UI_TEST_IDS.bulldoze).setAttribute('aria-pressed', String(this.activeTool === 'bulldoze'));
  }

  private renderStats(stats: TownStats): void {
    const el = this.root.querySelector<HTMLElement>('#ui-stats');
    if (el) el.textContent = `Homes ${stats.homes} · Residents ${stats.residents} · Trees ${stats.trees}`;
  }

  private showPhase(phase: GamePhase): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-phase]')) {
      el.hidden = el.dataset.phase !== phase;
    }
  }

  private button(id: string): HTMLButtonElement {
    const el = this.root.querySelector<HTMLButtonElement>(`#${id}`);
    if (!el) throw new Error(`Missing UI button #${id}`);
    return el;
  }
}
