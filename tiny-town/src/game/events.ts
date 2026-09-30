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
import type { Cell, Edge, Rotation, SavedTown, TownChange } from '../town/types';
import type { DayPhase, TimeMode } from '../world/dayCycle';

export type GamePhase = 'loading' | 'title' | 'building' | 'menu' | 'error';

export type GameEvents = {
  // ---- intents (UI / input → game) -------------------------------------
  /** `name`: what the player called a 'new' town (WP-20); ignored for 'continue' (the save has it). */
  'intent:start': { mode: 'continue' | 'new'; name?: string };
  'intent:select-tool': { toolId: ToolId | null };
  /** direction 1 = clockwise seen from above (the R key), -1 = counter-clockwise (Shift+R). */
  'intent:rotate': { direction: 1 | -1 };
  'intent:undo': void;
  'intent:redo': void;
  /** Menu → New town → confirm → name dialog: clear the plot and call the new town `name` (WP-20). */
  'intent:new-town': { name: string };
  /** Top-bar town name / menu → game: rename the current town (WP-20; saved, not undoable). */
  'intent:rename-town': { name: string };
  /** Town file panel → game: serialise the live town for a download (WP-21); answered by `town-file:ready` in the same task. */
  'intent:export-town': void;
  /**
   * Town file confirm / title → game: replace the town with an opened file (WP-21). `save` has been
   * through parseSave (persistence/townFile.ts decodeTownFile). From the title it also starts the game.
   */
  'intent:open-town': { save: SavedTown };
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
  /** UI / T key → game: day/night mode (WP-16; persisted as settings.timeMode). */
  'intent:set-time-mode': { mode: TimeMode };
  /** HUD time button / T key → game: next mode in TIME_MODES order (auto → day → night → auto). */
  'intent:cycle-time-mode': void;
  /** HUD camera button / P key → game: photograph the town (WP-19; building phase only, opens the photo preview). */
  'intent:take-photo': void;

  // ---- facts (game → everyone) ----------------------------------------
  'phase:changed': { phase: GamePhase; previous: GamePhase };
  'load:progress': { loaded: number; total: number; label: string };
  'load:error': { message: string };

  'tool:changed': { toolId: ToolId | null; rotation: Rotation };
  'hover:changed': { cell: Cell | null; edge: Edge | null; valid: boolean; reason: string | null };

  /** Applied town mutations (after placement, bulldoze, undo, redo, load). Renderer consumes this. */
  'town:changed': { changes: readonly TownChange[]; cause: 'edit' | 'undo' | 'redo' | 'load' | 'reset' };
  /**
   * The town's name (WP-20): after a load (the save's name, or the default), a reset (New town,
   * test states) or a rename. The top bar renders it; SaveStore autosaves on 'rename'.
   */
  'town:named': { name: string; cause: 'load' | 'reset' | 'rename' };

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
  /** Day/night (WP-16): emitted when the mode or the phase changes (and once at boot), never per frame. */
  'daytime:changed': { mode: TimeMode; phase: DayPhase };

  /**
   * Photo (WP-19): the framed JPEG is ready (the preview shows it; Download / Share save it).
   * `blob` stays valid until the next photo; the UI owns any object URL it makes from it.
   */
  'photo:ready': { blob: Blob; width: number; height: number; fileName: string };
  /** Photo (WP-19): capture or encoding failed; the preview says so. */
  'photo:error': { message: string };
  /** Town file (WP-21): the live town as a file, emitted synchronously from `intent:export-town` (the UI downloads it in the same click). */
  'town-file:ready': { blob: Blob; fileName: string };

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
