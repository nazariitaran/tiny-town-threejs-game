/**
 * The only way the game mutates the town: wraps TownState, rules and History and publishes facts on the bus.
 * Everything between beginStroke() and endStroke() is one undo entry; inside a stroke apply() emits
 * town:changed and build:* per cell but history:changed only at endStroke().
 * Every change list keeps its primary change last; build events derive from it.
 */
import { cellToWorld, edgeToWorld, footprintCentreWorld, roadBlockCentreWorld, setPlotSize, TOWN_PLOTS, townSizeFor } from '../game/config';
import { placedFootprint } from '../catalog/objects';
import type { GameBus } from '../game/events';
import type { ToolId } from '../catalog/tools';
import { History } from './History';
import { planAction } from './rules';
import { decodeGround, serializeTown, type CameraPose } from './serialize';
import { DEFAULT_TOWN_NAME, sanitizeTownName } from './townName';
import type { TownState } from './TownState';
import type { BuildAction, InvalidReason, PlanResult, SavedTown, TownChange, TownSize } from './types';

export interface BatchItem {
  action: BuildAction;
  toolId: ToolId;
}

export interface BatchOptions {
  /** Skip build:placed/removed events (no sound/FX spam for demo towns). */
  silent?: boolean;
}

export interface BatchResult {
  applied: number;
  rejected: Array<{ index: number; item: BatchItem; reason: InvalidReason; message: string }>;
  changes: TownChange[];
}

type TownCause = 'edit' | 'undo' | 'redo' | 'load' | 'reset';

export class TownEditor {
  readonly history = new History();
  private stroke: TownChange[] | null = null;
  /** build:* strokeIndex within the current stroke. */
  private strokeCount = 0;
  private townName = DEFAULT_TOWN_NAME;

  constructor(
    readonly state: TownState,
    private readonly bus: GameBus,
    private readonly rng: () => number,
  ) {}

  /** Always a valid name; DEFAULT_TOWN_NAME until named. */
  get name(): string {
    return this.townName;
  }

  /** Fixed for the town's life: only reset() and load() change it. */
  get size(): TownSize {
    return townSizeFor(this.state.width, this.state.depth);
  }

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
   * Applies many actions as one town:changed and one undo entry (or joins the open stroke).
   * Rejected items are skipped and reported; later items see the effects of earlier ones.
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

  /**
   * Clears the plot and names the new town `name` (blank → the default). With a `size`, the plot takes
   * that size (town:resized after the removals when it changes); without one it keeps its own. Not undoable.
   */
  reset(name: string = DEFAULT_TOWN_NAME, size?: TownSize): void {
    this.stroke = null;
    this.strokeCount = 0;
    const changes = this.state.clear();
    this.history.clear();
    this.publish(changes, 'reset');
    if (size) this.resizeEmpty(TOWN_PLOTS[size].width, TOWN_PLOTS[size].depth);
    this.setName(name, 'reset');
  }

  /** Sanitises `name`; a blank or unchanged name is ignored. Not undoable. Returns whether the name changed. */
  rename(name: string): boolean {
    const clean = sanitizeTownName(name);
    if (!clean || clean === this.townName) return false;
    this.setName(clean, 'rename');
    return true;
  }

  /**
   * `save` must come from parseSave (validated and fitted to its plot); the plot takes the save's size.
   * Emits one town:changed (cause 'load') that removes the old town, then adds the new one; on a size
   * change, the removals, town:resized and the additions instead. Not undoable.
   */
  load(save: SavedTown): void {
    const sized = TOWN_PLOTS[save.size];
    const fits = (w: number, d: number) => save.width === w && save.depth === d;
    if (!fits(this.state.width, this.state.depth) && !(sized && fits(sized.width, sized.depth))) {
      throw new Error(`TownEditor.load: save is ${save.width}×${save.depth}, not a ${save.size} plot (run parseSave first)`);
    }
    this.stroke = null;
    this.strokeCount = 0;
    let changes = this.state.clear();
    this.history.clear();
    if (save.width !== this.state.width || save.depth !== this.state.depth) {
      this.publish(changes, 'load');
      changes = [];
      this.resizeEmpty(save.width, save.depth);
    }
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
    this.publish(changes, 'load');
    this.setName(save.name ?? DEFAULT_TOWN_NAME, 'load');
  }

  /** The current town as a save (deterministic). */
  serialize(camera?: CameraPose): SavedTown {
    return serializeTown(this.state, camera, this.townName);
  }

  /** The town must be empty; a no-op when the plot already has these dimensions. Moves the cell↔world mapping with it. */
  private resizeEmpty(width: number, depth: number): void {
    if (width === this.state.width && depth === this.state.depth) return;
    this.state.resize(width, depth);
    setPlotSize(width, depth);
    this.bus.emit('town:resized', { size: this.size, width, depth });
  }

  private setName(name: string, cause: 'load' | 'reset' | 'rename'): void {
    this.townName = sanitizeTownName(name) || DEFAULT_TOWN_NAME;
    this.bus.emit('town:named', { name: this.townName, cause });
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
        ? footprintCentreWorld(primary.object.anchor, placedFootprint(primary.object), primary.object.rotation)
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
    // Inside a stroke history only changes at endStroke(), so don't spam per cell.
    if (!this.stroke) this.emitHistory();
  }

  private emitHistory(): void {
    this.bus.emit('history:changed', { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
  }
}
