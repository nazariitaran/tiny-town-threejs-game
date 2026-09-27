/**
 * The ONLY way the game mutates the town. Wraps TownState + rules + History and
 * publishes facts on the bus. Input/UI call this; the renderer listens to 'town:changed'.
 * WP-02 owns this file.
 *
 * Public API (used by Game.ts / ToolController / sampleTown):
 *  - preview(action)                  dry run for ghosts; never mutates, consumes no id/RNG.
 *  - beginStroke() → apply(action, toolId)* → endStroke()
 *                                     everything in one stroke is ONE undo entry. Inside a stroke,
 *                                     apply() emits town:changed/town:stats/build:* per cell but
 *                                     history:changed only once, at endStroke().
 *  - applyBatch(items, { silent })    many actions → one town:changed, one town:stats, one undo
 *                                     entry (or joins the open stroke). silent: no build:* events
 *                                     (no sound/FX spam for demo towns).
 *  - undo() / redo()                  cause 'undo' / 'redo'.
 *  - reset()                          empty plot, history cleared, cause 'reset'. Not undoable.
 *  - load(save)                       replace the town with a VALIDATED save (see parseSave), cause
 *                                     'load' with a full change list (remove old…, add new…),
 *                                     history cleared. Not undoable.
 *  - serialize(camera?)               current town as SavedTown (for SaveStore).
 *
 * Every change list keeps its primary change last; build events derive from it.
 */
import { cellToWorld, edgeToWorld, footprintCentreWorld, roadBlockCentreWorld } from '../game/config';
import { objectDef } from '../catalog/objects';
import type { GameBus } from '../game/events';
import type { ToolId } from '../catalog/tools';
import { History } from './History';
import { planAction } from './rules';
import { decodeGround, serializeTown, type CameraPose } from './serialize';
import type { TownState } from './TownState';
import type { BuildAction, InvalidReason, PlanResult, SavedTown, TownChange } from './types';

export interface BatchItem {
  action: BuildAction;
  toolId: ToolId;
}

export interface BatchOptions {
  /** Don't emit build:placed/removed per item (demo towns, scripted fills). Default false. */
  silent?: boolean;
}

export interface BatchResult {
  applied: number;
  rejected: Array<{ index: number; item: BatchItem; reason: InvalidReason; message: string }>;
  /** Every applied change, in order. */
  changes: TownChange[];
}

type TownCause = 'edit' | 'undo' | 'redo' | 'load' | 'reset';

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

  /** Is a stroke open (between beginStroke and endStroke)? */
  get inStroke(): boolean {
    return this.stroke !== null;
  }

  /** Dry run for ghost previews. Never mutates state, never consumes an object id or RNG draw. */
  preview(action: BuildAction): PlanResult {
    let provisionalId = this.state.nextObjectId;
    return planAction(this.state, action, { nextId: () => provisionalId++, rng: () => 0 });
  }

  beginStroke(): void {
    // A stroke left open (e.g. pointer lost) is committed rather than silently merged.
    if (this.stroke) this.endStroke();
    this.stroke = [];
    this.strokeCount = 0;
  }

  /** Validate and apply one action. Emits town:changed and build:placed/removed on success. */
  apply(action: BuildAction, toolId: ToolId): PlanResult {
    const result = this.plan(action);
    if (!result.ok) return result;
    // Outside a stroke every apply is its own one-item stroke (strokeIndex 0).
    if (!this.stroke) this.strokeCount = 0;
    this.state.applyChanges(result.changes);
    this.record(result.changes);
    this.publish(result.changes, 'edit');
    this.emitBuildEvent(action, toolId, result.changes);
    return result;
  }

  /**
   * Apply many actions as one edit: one town:changed (cause 'edit') with all changes, one
   * town:stats, one undo entry (or appended to the open stroke). Rejected items are skipped and
   * reported; later items see the effects of earlier ones.
   */
  applyBatch(items: readonly BatchItem[], options: BatchOptions = {}): BatchResult {
    const result: BatchResult = { applied: 0, rejected: [], changes: [] };
    // Outside a stroke the batch is its own stroke (strokeIndex from 0); inside, it continues it.
    if (!this.stroke) this.strokeCount = 0;
    items.forEach((item, index) => {
      const plan = this.plan(item.action);
      if (!plan.ok) {
        result.rejected.push({ index, item, reason: plan.reason, message: plan.message });
        return;
      }
      this.state.applyChanges(plan.changes);
      result.changes.push(...plan.changes);
      result.applied += 1;
      if (!options.silent) this.emitBuildEvent(item.action, item.toolId, plan.changes);
    });
    if (result.changes.length > 0) {
      this.record(result.changes);
      this.publish(result.changes, 'edit');
    }
    return result;
  }

  endStroke(): void {
    if (this.stroke && this.stroke.length > 0) this.history.push(this.stroke);
    this.stroke = null;
    this.strokeCount = 0;
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
    this.strokeCount = 0;
    const changes = this.state.clear();
    this.history.clear();
    this.publish(changes, 'reset');
  }

  /**
   * Replace the town with a saved one. `save` must come from parseSave (validated and clamped to
   * this plot); a save for a different plot size throws. Emits one town:changed with cause 'load'
   * whose changes remove the old town and then add the new one; clears history. Not undoable.
   */
  load(save: SavedTown): void {
    if (save.width !== this.state.width || save.depth !== this.state.depth) {
      throw new Error(`TownEditor.load: save is ${save.width}×${save.depth}, plot is ${this.state.width}×${this.state.depth} (run parseSave first)`);
    }
    this.stroke = null;
    this.strokeCount = 0;
    const changes = this.state.clear();
    const added: TownChange[] = [];
    const ground = decodeGround(save);
    for (let z = 0; z < save.depth; z += 1) {
      for (let x = 0; x < save.width; x += 1) {
        const after = ground[z * save.width + x];
        if (after !== 'field') added.push({ layer: 'ground', cell: { x, z }, before: 'field', after });
      }
    }
    for (const object of save.objects) added.push({ layer: 'object', op: 'add', object: { ...object, anchor: { ...object.anchor } } });
    for (const placed of save.edges) added.push({ layer: 'edge', op: 'add', placed: { kind: placed.kind, edge: { ...placed.edge } } });
    this.state.applyChanges(added);
    this.state.restoreNextObjectId(save.nextObjectId);
    changes.push(...added);
    this.history.clear();
    this.publish(changes, 'load');
  }

  /** The current town as a save (deterministic). SaveStore / Game use this for autosave. */
  serialize(camera?: CameraPose): SavedTown {
    return serializeTown(this.state, camera);
  }

  private plan(action: BuildAction): PlanResult {
    return planAction(this.state, action, { nextId: () => this.state.allocateObjectId(), rng: this.rng });
  }

  private record(changes: readonly TownChange[]): void {
    if (this.stroke) this.stroke.push(...changes);
    else this.history.push(changes);
  }

  private emitBuildEvent(action: BuildAction, toolId: ToolId, changes: readonly TownChange[]): void {
    const strokeIndex = this.strokeCount++;
    // The primary change is the last one (e.g. a fence replace is [remove old, add new]).
    const primary = changes[changes.length - 1];
    const cell = 'cell' in action ? { x: action.cell.x, z: action.cell.z } : { x: action.edge.x, z: action.edge.z };
    // FX/audio position: the centre of what changed (a multi-cell object, a whole road block).
    const world =
      primary.layer === 'edge'
        ? edgeToWorld(primary.placed.edge)
        : primary.layer === 'object'
        ? footprintCentreWorld(primary.object.anchor, objectDef(primary.object.kind).footprint, primary.object.rotation)
        : primary.before === 'road' || primary.after === 'road'
        ? roadBlockCentreWorld(primary.cell)
        : cellToWorld(primary.cell);
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

  private publish(changes: readonly TownChange[], cause: TownCause): void {
    this.bus.emit('town:changed', { changes, cause });
    this.bus.emit('town:stats', this.state.stats());
    // Inside a stroke history only changes at endStroke(), so don't spam per cell.
    if (!this.stroke) this.emitHistory();
  }

  private emitHistory(): void {
    this.bus.emit('history:changed', { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
  }
}
