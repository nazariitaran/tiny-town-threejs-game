/**
 * CONTRACT FILE — owned by the integrator. Workers may ADD events in their PR
 * description for the integrator to merge, but must not rename/remove events.
 *
 * Two families travel on one typed bus:
 *  - `intent:*`  UI / input → game. "Please do X." Handlers decide if X happens.
 *  - everything else: facts, game → UI / audio / fx / renderer. "X happened."
 *
 * UI code never mutates game state directly; it emits intents and renders facts.
 */
import type { SfxEvent } from '../audio/sfx';
import type { ToolId } from '../catalog/tools';
import type { Cell, Edge, Rotation, TownChange, TownStats } from '../town/types';

export type GamePhase = 'loading' | 'title' | 'building' | 'menu' | 'error';

export type GameEvents = {
  // ---- intents (UI / input → game) -------------------------------------
  'intent:start': { mode: 'continue' | 'new' };
  'intent:select-tool': { toolId: ToolId | null };
  /** direction 1 = clockwise seen from above (the R key), -1 = counter-clockwise (Shift+R). */
  'intent:rotate': { direction: 1 | -1 };
  'intent:undo': void;
  'intent:redo': void;
  'intent:new-town': void;
  'intent:open-menu': void;
  'intent:close-menu': void;
  'intent:set-muted': { muted: boolean };
  'intent:set-volume': { volume: number };
  'intent:toggle-grid': { visible: boolean };
  /** UI → audio: switch background music on/off (persisted). */
  'intent:set-music': { enabled: boolean };
  /** UI → audio: music volume 0..1 (persisted). */
  'intent:set-music-volume': { volume: number };
  'intent:reset-camera': void;

  // ---- facts (game → everyone) ----------------------------------------
  'phase:changed': { phase: GamePhase; previous: GamePhase };
  'load:progress': { loaded: number; total: number; label: string };
  'load:error': { message: string };

  'tool:changed': { toolId: ToolId | null; rotation: Rotation };
  'hover:changed': { cell: Cell | null; edge: Edge | null; valid: boolean; reason: string | null };

  /** Applied town mutations (after placement, bulldoze, undo, redo, load). Renderer consumes this. */
  'town:changed': { changes: readonly TownChange[]; cause: 'edit' | 'undo' | 'redo' | 'load' | 'reset' };
  'town:stats': TownStats;

  /**
   * Semantic build events for audio / fx / hud juice. One per placed/removed thing, only for
   * interactive edits (not for load/reset/silent batches). worldX/Z = centre of the object's footprint
   * (road: its 2×2 block; other ground: the cell), or the edge midpoint for fences. strokeIndex = 0-based count of placements so far in the current stroke
   * (drives pitch rise in audio and FX scaling).
   */
  'build:placed': { toolId: ToolId; layer: 'ground' | 'object' | 'edge'; cell: Cell; worldX: number; worldZ: number; strokeIndex: number };
  'build:removed': { layer: 'ground' | 'object' | 'edge'; kind: string; cell: Cell; worldX: number; worldZ: number; strokeIndex: number };
  'build:invalid': { toolId: ToolId | null; cell: Cell | null; reason: string };
  'build:rotated': { rotation: Rotation };

  'history:changed': { canUndo: boolean; canRedo: boolean };
  'save:written': { at: number };
  'audio:changed': { muted: boolean; volume: number };
  /** audio → UI: current music settings. */
  'music:changed': { enabled: boolean; volume: number };

  /** UI chrome feedback for audio (hover/click on DOM buttons). */
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
