/**
 * The ONLY way the game mutates the town. Wraps TownState + rules + History and
 * publishes facts on the bus. Input/UI call this; the renderer listens to 'town:changed'.
 *
 * Stroke protocol (ToolController): beginStroke() → apply(action)* → endStroke().
 * Everything applied inside one stroke is a single undo entry.
 *
 * SCAFFOLD BASELINE — WP-02 owns this file.
 */
import { cellToWorld, edgeToWorld } from '../game/config';
import type { GameBus } from '../game/events';
import type { ToolId } from '../catalog/tools';
import { History } from './History';
import { planAction } from './rules';
import type { TownState } from './TownState';
import type { BuildAction, PlanResult, SavedTownV1, TownChange } from './types';

export class TownEditor {
  readonly history = new History();
  private stroke: TownChange[] | null = null;
  /** Placements/removals so far in the current stroke (build:* strokeIndex). */
  private strokeCount = 0;

  constructor(
    readonly state: TownState,
    private readonly bus: GameBus,
    private readonly rng: () => number,
  ) {}

  /** Dry run for ghost previews. Never mutates state, never consumes an object id. */
  preview(action: BuildAction): PlanResult {
    let provisionalId = this.state.nextObjectId;
    return planAction(this.state, action, { nextId: () => provisionalId++, rng: () => 0 });
  }

  beginStroke(): void {
    this.stroke = [];
    this.strokeCount = 0;
  }

  /** Validate and apply one action. Emits town:changed and build:placed/removed on success. */
  apply(action: BuildAction, toolId: ToolId): PlanResult {
    const result = planAction(this.state, action, { nextId: () => this.state.allocateObjectId(), rng: this.rng });
    if (!result.ok) return result;
    this.state.applyChanges(result.changes);
    if (this.stroke) this.stroke.push(...result.changes);
    else this.history.push(result.changes);
    this.publish(result.changes, 'edit');
    this.emitBuildEvent(action, toolId, result.changes);
    return result;
  }

  endStroke(): void {
    if (this.stroke && this.stroke.length > 0) this.history.push(this.stroke);
    this.stroke = null;
    this.emitHistory();
  }

  undo(): void {
    this.endStrokeIfOpen();
    const changes = this.history.undo();
    if (!changes) return;
    this.state.applyChanges(changes);
    this.publish(changes, 'undo');
  }

  redo(): void {
    this.endStrokeIfOpen();
    const changes = this.history.redo();
    if (!changes) return;
    this.state.applyChanges(changes);
    this.publish(changes, 'redo');
  }

  /** Clear the plot (New town). Not undoable. */
  reset(): void {
    this.stroke = null;
    const changes = this.state.clear();
    this.history.clear();
    this.publish(changes, 'reset');
  }

  /** Replace the town with a saved one. TODO(WP-02): implement via serialize.ts. */
  load(_save: SavedTownV1): void {
    throw new Error('TownEditor.load: not implemented (WP-02)');
  }

  private emitBuildEvent(action: BuildAction, toolId: ToolId, changes: readonly TownChange[]): void {
    const strokeIndex = this.strokeCount++;
    // The primary change is the last one (e.g. a fence replace is [remove old, add new]).
    const primary = changes[changes.length - 1];
    const cell = 'cell' in action ? action.cell : { x: action.edge.x, z: action.edge.z };
    const world = primary.layer === 'edge' ? edgeToWorld(primary.placed.edge) : cellToWorld(cell);
    if (action.type === 'bulldoze') {
      const kind = primary.layer === 'ground' ? primary.before : primary.layer === 'object' ? primary.object.kind : primary.placed.kind;
      this.bus.emit('build:removed', { layer: primary.layer, kind, cell, worldX: world.x, worldZ: world.z, strokeIndex });
    } else {
      this.bus.emit('build:placed', { toolId, layer: primary.layer, cell, worldX: world.x, worldZ: world.z, strokeIndex });
    }
  }

  private endStrokeIfOpen(): void {
    if (this.stroke) this.endStroke();
  }

  private publish(changes: readonly TownChange[], cause: 'edit' | 'undo' | 'redo' | 'load' | 'reset'): void {
    this.bus.emit('town:changed', { changes, cause });
    this.bus.emit('town:stats', this.state.stats());
    this.emitHistory();
  }

  private emitHistory(): void {
    this.bus.emit('history:changed', { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
  }
}
