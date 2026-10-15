/**
 * One typed bus carries two families:
 *  - `intent:*`: UI / input → game, "please do X"; handlers decide whether X happens.
 *  - everything else: facts, game → UI / audio / fx / renderer, "X happened".
 * UI never mutates game state; it emits intents and renders facts.
 */
import type { GraphicsPreset } from './graphics';
import type { SfxEvent } from '../audio/sfx';
import type { ToolId } from '../catalog/tools';
import type { Cell, Edge, ObjectKind, Rotation, SavedTown, TownChange } from '../town/types';
import type { DayPhase, TimeMode } from '../world/dayCycle';
import type { RainMode } from '../weather/weatherSchedule';

export type GamePhase = 'loading' | 'title' | 'building' | 'menu' | 'error';

export type GameEvents = {
  /** `name` names a 'new' town; 'continue' takes the name from the save. */
  'intent:start': { mode: 'continue' | 'new'; name?: string };
  'intent:select-tool': { toolId: ToolId | null };
  /** direction 1 = clockwise seen from above (the R key), -1 = counter-clockwise (Shift+R). */
  'intent:rotate': { direction: 1 | -1 };
  /** Which model (index) the active object tool builds; ignored for one-model tools. */
  'intent:select-variant': { choice: number };
  'intent:undo': void;
  'intent:redo': void;
  /** Clears the plot and starts a town called `name`. */
  'intent:new-town': { name: string };
  /** Saved, not undoable. */
  'intent:rename-town': { name: string };
  /** Answered synchronously by `town-file:ready`. */
  'intent:export-town': void;
  /** Replaces the town with an opened file (`save` has been through parseSave); from the title it also starts the game. */
  'intent:open-town': { save: SavedTown };
  'intent:open-menu': void;
  'intent:close-menu': void;
  'intent:set-muted': { muted: boolean };
  'intent:set-volume': { volume: number };
  'intent:toggle-grid': { visible: boolean };
  /** Persisted. */
  'intent:toggle-fps': { visible: boolean };
  /** Persisted. */
  'intent:set-music': { enabled: boolean };
  /** 0..1, persisted. */
  'intent:set-music-volume': { volume: number };
  'intent:reset-camera': void;
  /** Persisted as settings.timeMode. */
  'intent:set-time-mode': { mode: TimeMode };
  /** Next mode in TIME_MODES order (auto → day → night → auto). */
  'intent:cycle-time-mode': void;
  /** Persisted as settings.rainMode. */
  'intent:set-rain-mode': { mode: RainMode };
  /** Next mode in RAIN_MODES order (auto → on → off → auto). */
  'intent:cycle-rain-mode': void;
  /** Building phase only; opens the photo preview. */
  'intent:take-photo': void;
  /** Saved; the live parts apply at once. */
  'intent:set-graphics': { preset: GraphicsPreset };
  /** Flushes the save and reloads so antialias / material take effect. */
  'intent:reload-graphics': void;

  'phase:changed': { phase: GamePhase; previous: GamePhase };
  /** `label`: the loading screen's line for the current stage (`LOAD_STAGES`), shown as is. */
  'load:progress': { loaded: number; total: number; label: string };
  'load:error': { message: string };

  /**
   * `variant`: the active object tool's chosen model and model count; null for one-model tools,
   * other layers or no tool. Also emitted when only the choice changes.
   */
  'tool:changed': { toolId: ToolId | null; rotation: Rotation; variant: { choice: number; count: number } | null };
  'hover:changed': { cell: Cell | null; edge: Edge | null; valid: boolean; reason: string | null };

  'town:changed': { changes: readonly TownChange[]; cause: 'edit' | 'undo' | 'redo' | 'load' | 'reset' };
  /** On 'load': the save's name or the default. SaveStore autosaves on 'rename'. */
  'town:named': { name: string; cause: 'load' | 'reset' | 'rename' };

  /**
   * One per placed/removed thing, for interactive edits only (not load/reset/silent batches).
   * worldX/Z: the footprint centre (a road's 2×2 block), or the edge midpoint for fences.
   * strokeIndex: 0-based placements so far in the current stroke (drives audio pitch and FX scale).
   */
  'build:placed': { toolId: ToolId; layer: 'ground' | 'object' | 'edge'; cell: Cell; worldX: number; worldZ: number; strokeIndex: number };
  'build:removed': { layer: 'ground' | 'object' | 'edge'; kind: string; cell: Cell; worldX: number; worldZ: number; strokeIndex: number };
  'build:invalid': { toolId: ToolId | null; cell: Cell | null; reason: string };
  /**
   * Move tool: the carried object (id null = nothing), on pick-up, turn, drop and put-back.
   * rotatable: R turns it (not trees and plants, whose look comes from their id).
   */
  'selection:changed': { id: number | null; kind: ObjectKind | null; rotation: Rotation; rotatable: boolean };
  'build:rotated': { rotation: Rotation };

  'history:changed': { canUndo: boolean; canRedo: boolean };
  'save:written': { at: number };
  'audio:changed': { muted: boolean; volume: number };
  'music:changed': { enabled: boolean; volume: number };
  /** At boot and on every change. reloadRequired: the page runs with a different antialias / material than `preset` wants. */
  'graphics:changed': { preset: GraphicsPreset; reloadRequired: boolean };
  /** Rendered frames per second, about twice a second while the counter is shown. */
  'fps:measured': { fps: number };
  /** On a rain mode change and once at boot. */
  'rain:changed': { mode: RainMode };
  /** On a mode or phase change and once at boot; never per frame. */
  'daytime:changed': { mode: TimeMode; phase: DayPhase };

  /** `blob` stays valid until the next photo; the UI owns any object URL it makes from it. */
  'photo:ready': { blob: Blob; width: number; height: number; fileName: string };
  'photo:error': { message: string };
  /** Emitted synchronously from `intent:export-town`, so the UI downloads it within the same click. */
  'town-file:ready': { blob: Blob; fileName: string };

  /** Hover/click sounds for DOM buttons. */
  'ui:sfx': { event: SfxEvent };
};

type Handler<T> = (payload: T) => void;

export class EventBus<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(type, handler);
  }

  off<K extends keyof Events>(type: K, handler: Handler<Events[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof Events>(type: K, ...payload: Events[K] extends void ? [] : [Events[K]]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) (handler as Handler<Events[K]>)(payload[0] as Events[K]);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export type GameBus = EventBus<GameEvents>;
export const createGameBus = (): GameBus => new EventBus<GameEvents>();
