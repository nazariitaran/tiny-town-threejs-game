/**
 * Placement rules: BuildAction + current state → the exact TownChanges to apply, or why not.
 * Never mutates `state`.
 *
 * Invariants every successful plan keeps:
 *  - The PRIMARY change is LAST in the list; TownEditor derives build:placed/removed from it.
 *  - Object ids and RNG draws are consumed only on success, after every check has passed.
 *  - `no-change` is silent: its message is '' and callers must never show it.
 *  - A 2 × 2 road block is all road or none: painting or bulldozing one cell converts the whole block.
 *  - Road features (roundabout) and road markings (zebra) are block-aligned and lock their road
 *    against repainting while they stand.
 *  - A move is [remove, add] with the SAME id and variant, so undo, saves and the per-id look follow it.
 */
import { cellKey, edgeCells, edgeInBounds, edgeKey, edgeOfCellSide, footprintCells, NEIGHBOURS, ROAD_BLOCK, roadBlockCells } from './grid';
import { ZEBRA_PIECE_MODELS } from '../catalog/models';
import { objectDef, type ObjectDef } from '../catalog/objects';
import { roadMask, roadTileFor } from './roadTiles';
import type { BuildAction, Cell, GroundKind, InvalidReason, PlanResult, Rotation, TownChange, TownStateReader } from './types';

export interface PlanContext {
  /** Reserves an object id; called only on success. */
  nextId(): number;
  /** Seeded RNG for variants; called only on success, for multi-variant kinds, when the action names no variant. */
  rng(): number;
}

/** Player-facing names of ground kinds, used in rejection messages. */
export const GROUND_LABELS: Readonly<Record<GroundKind, string>> = {
  field: 'open field',
  grass: 'grass',
  meadow: 'meadow',
  road: 'road',
  pavement: 'pavement',
  walkway: 'walkway',
};

/** Player-facing messages that don't depend on a label. */
export const RULE_MESSAGES = {
  outOfBounds: 'Outside your plot',
  occupied: 'Something is already here',
  fenceAcrossRoad: "Fences can't cross roads",
  busStopNeedsRoad: 'Bus stops need to be next to a road',
  trafficLightNeedsRoad: 'Traffic lights need to be next to a road',
  zebraNeedsStraight: 'Zebra crossings go on a straight road or a junction',
  nothingHere: 'Nothing to remove',
  nothingToMove: 'Nothing to move',
  noChange: '',
} as const;

type Rejection = Extract<PlanResult, { ok: false }>;

const fail = (reason: InvalidReason, message: string): Rejection => ({ ok: false, reason, message });

/** "a", "a or b", "a, b or c". */
function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** Human description of the ground an object may stand on ("grass, meadow or open field"). */
export function allowedGroundText(def: ObjectDef): string {
  // Friendlier order: soft ground first, then paved, then the bare field.
  const order: GroundKind[] = ['grass', 'meadow', 'pavement', 'walkway', 'field', 'road'];
  return orList(order.filter((kind) => def.allowedGround.includes(kind)).map((kind) => GROUND_LABELS[kind]));
}

const isRoad = (state: TownStateReader, cell: Cell): boolean => state.inBounds(cell) && state.getGround(cell) === 'road';

export function planAction(state: TownStateReader, action: BuildAction, ctx: PlanContext): PlanResult {
  switch (action.type) {
    case 'paint-ground':
      return planPaintGround(state, action);
    case 'place-object':
      return planPlaceObject(state, action, ctx);
    case 'place-edge':
      return planPlaceEdge(state, action);
    case 'bulldoze':
      return planBulldoze(state, action);
    case 'move-object':
      return planMoveObject(state, action);
  }
}

function planPaintGround(state: TownStateReader, action: Extract<BuildAction, { type: 'paint-ground' }>): PlanResult {
  const cell = action.cell;
  if (!state.inBounds(cell)) return fail('out-of-bounds', RULE_MESSAGES.outOfBounds);
  const before = state.getGround(cell);
  if (before === action.kind) return fail('no-change', RULE_MESSAGES.noChange);
  if (action.kind === 'road') return planPaintRoadBlock(state, cell);
  if (before === 'road') {
    // Repainting a road cell turns its whole block. Only road features stand on road.
    const feature = state.getObjectAt(cell);
    if (feature) return fail('occupied', `Move the ${objectDef(feature.kind).label} first`);
    return { ok: true, changes: blockGroundChanges(state, cell, action.kind) };
  }
  const object = state.getObjectAt(cell);
  if (object) {
    const def = objectDef(object.kind);
    if (!def.allowedGround.includes(action.kind)) return fail('occupied', `Move the ${def.label} first`);
  }
  return { ok: true, changes: [{ layer: 'ground', cell: { x: cell.x, z: cell.z }, before, after: action.kind }] };
}

/**
 * Road on any cell converts its whole 2 × 2 block. Fails `occupied` if any block cell holds an
 * object. Removes fences on the block's inside edges, and on its outside edges towards road.
 */
function planPaintRoadBlock(state: TownStateReader, cell: Cell): PlanResult {
  const block = roadBlockCells(cell).filter((c) => state.inBounds(c));
  for (const c of block) {
    const object = state.getObjectAt(c);
    if (object) return fail('occupied', `Move the ${objectDef(object.kind).label} first`);
  }
  const changes = fenceRemovalsForRoad(state, block);
  changes.push(...blockGroundChanges(state, cell, 'road'));
  return { ok: true, changes };
}

/**
 * Fence removals for turning `cells` into road: every fence on an edge between two of them, or
 * between one of them and a cell that already is road.
 */
function fenceRemovalsForRoad(state: TownStateReader, cells: readonly Cell[]): TownChange[] {
  const keys = new Set(cells.map(cellKey));
  const changes: TownChange[] = [];
  const removed = new Set<string>();
  for (const c of cells) {
    for (let side = 0; side < 4; side += 1) {
      const offset = NEIGHBOURS[side];
      const neighbour = { x: c.x + offset.x, z: c.z + offset.z };
      if (!keys.has(cellKey(neighbour)) && !isRoad(state, neighbour)) continue;
      const placed = state.getEdge(edgeOfCellSide(c, side as 0 | 1 | 2 | 3));
      if (!placed) continue;
      const key = edgeKey(placed.edge);
      if (removed.has(key)) continue;
      removed.add(key);
      changes.push({ layer: 'edge', op: 'remove', placed: { kind: placed.kind, edge: { ...placed.edge } } });
    }
  }
  return changes;
}

/** Ground changes turning the block around `cell` into `after`, the clicked cell's change last. */
function blockGroundChanges(state: TownStateReader, cell: Cell, after: GroundKind): TownChange[] {
  const changes: TownChange[] = [];
  let primary: TownChange | null = null;
  for (const c of roadBlockCells(cell)) {
    if (!state.inBounds(c)) continue;
    const before = state.getGround(c);
    if (before === after) continue;
    const change: TownChange = { layer: 'ground', cell: c, before, after };
    if (c.x === cell.x && c.z === cell.z) primary = change;
    else changes.push(change);
  }
  if (primary) changes.push(primary);
  return changes;
}

/**
 * Can an object of `def` stand anchored at `cell`, turned `rotation`? The placing checks, in severity
 * order across the whole footprint (so the message names the real blocker); `ignoreId` is an object
 * that doesn't count as occupying (the one being moved). Null when the spot is fine.
 */
function checkObjectSpot(
  state: TownStateReader,
  def: ObjectDef,
  cell: Cell,
  rotation: Rotation,
  ignoreId: number | null,
): Rejection | null {
  const cells = footprintCells(cell, def.footprint, rotation);
  if (cells.some((c) => !state.inBounds(c))) return fail('out-of-bounds', RULE_MESSAGES.outOfBounds);
  if ((def.roadFeature || def.roadMarking) && (cell.x % ROAD_BLOCK !== 0 || cell.z % ROAD_BLOCK !== 0)) {
    // ToolController snaps the anchor to the block grid; this only guards scripted actions.
    return fail('out-of-bounds', `${def.label} must line up with the road grid`);
  }
  const occupied = (c: Cell): boolean => {
    const other = state.getObjectAt(c);
    return other !== undefined && other.id !== ignoreId;
  };
  if (cells.some(occupied)) return fail('occupied', RULE_MESSAGES.occupied);
  for (const c of cells) {
    const ground = state.getGround(c);
    if (def.allowedGround.includes(ground)) continue;
    if (ground === 'road') return fail('blocked-by-road', `${def.label} can't go on a road`);
    return fail('needs-ground', `${def.label} needs ${allowedGroundText(def)}`);
  }
  if (def.roadMarking && !ZEBRA_PIECE_MODELS[roadTileFor(roadMask(state, cell)).piece]) {
    return fail('needs-ground', RULE_MESSAGES.zebraNeedsStraight);
  }
  if (def.requiresAdjacent) {
    const needed = def.requiresAdjacent;
    const adjacent = cells.some((c) =>
      NEIGHBOURS.some((o) => {
        const n = { x: c.x + o.x, z: c.z + o.z };
        return state.inBounds(n) && state.getGround(n) === needed;
      }),
    );
    if (!adjacent) {
      const message =
        def.kind === 'bus-stop'
          ? RULE_MESSAGES.busStopNeedsRoad
          : def.kind === 'traffic-light'
          ? RULE_MESSAGES.trafficLightNeedsRoad
          : `${def.label} needs to be next to ${GROUND_LABELS[needed]}`;
      return fail('needs-ground', message);
    }
  }
  return null;
}

export function isMovable(def: ObjectDef): boolean {
  return !def.roadFeature && !def.roadMarking;
}

/** Can a moved object of this kind be turned? Trees and plants take their look from their id. */
export function isTurnable(def: ObjectDef): boolean {
  return def.group !== 'tree' && def.group !== 'plant';
}

function planPlaceObject(state: TownStateReader, action: Extract<BuildAction, { type: 'place-object' }>, ctx: PlanContext): PlanResult {
  const def = objectDef(action.kind);
  const cells = footprintCells(action.cell, def.footprint, action.rotation);
  const blocked = checkObjectSpot(state, def, action.cell, action.rotation, null);
  if (blocked) return blocked;
  // A road feature paints its footprint to road first (fences across it go), so the add is last.
  const changes: TownChange[] = [];
  if (def.roadFeature) {
    changes.push(...fenceRemovalsForRoad(state, cells));
    for (const cell of cells) {
      const before = state.getGround(cell);
      if (before !== 'road') changes.push({ layer: 'ground', cell: { x: cell.x, z: cell.z }, before, after: 'road' });
    }
  }
  // The variant picker sends the model the ghost showed; without one (demo towns, tests) roll one.
  const chosen = action.variant;
  const variant =
    chosen !== undefined && Number.isInteger(chosen) && chosen >= 0 && chosen < def.variants
      ? chosen
      : def.variants > 1
        ? Math.min(def.variants - 1, Math.floor(ctx.rng() * def.variants))
        : 0;
  changes.push({
    layer: 'object',
    op: 'add',
    object: { id: ctx.nextId(), kind: action.kind, anchor: { x: action.cell.x, z: action.cell.z }, rotation: action.rotation, variant },
  });
  return { ok: true, changes };
}

function planPlaceEdge(state: TownStateReader, action: Extract<BuildAction, { type: 'place-edge' }>): PlanResult {
  const edge = action.edge;
  if (!edgeInBounds(edge, state.width, state.depth)) return fail('out-of-bounds', RULE_MESSAGES.outOfBounds);
  const [a, b] = edgeCells(edge);
  if (isRoad(state, a) && isRoad(state, b)) return fail('blocked-by-road', RULE_MESSAGES.fenceAcrossRoad);
  const existing = state.getEdge(edge);
  if (existing?.kind === action.kind) return fail('no-change', RULE_MESSAGES.noChange);
  const changes: TownChange[] = [];
  if (existing) changes.push({ layer: 'edge', op: 'remove', placed: { kind: existing.kind, edge: { ...existing.edge } } });
  // Primary change last.
  changes.push({ layer: 'edge', op: 'add', placed: { kind: action.kind, edge: { x: edge.x, z: edge.z, side: edge.side } } });
  return { ok: true, changes };
}

function planMoveObject(state: TownStateReader, action: Extract<BuildAction, { type: 'move-object' }>): PlanResult {
  const object = state.getObject(action.id);
  if (!object) return fail('nothing-here', RULE_MESSAGES.nothingToMove);
  const def = objectDef(object.kind);
  if (!isMovable(def)) return fail('cannot-move', `${def.label} can't be moved`);
  const rotation = isTurnable(def) ? action.rotation : object.rotation;
  if (object.anchor.x === action.cell.x && object.anchor.z === action.cell.z && object.rotation === rotation) {
    return fail('no-change', RULE_MESSAGES.noChange);
  }
  const blocked = checkObjectSpot(state, def, action.cell, rotation, object.id);
  if (blocked) return blocked;
  // Same id and variant: the move is the same object, so undo / saves / its per-id look follow it.
  return {
    ok: true,
    changes: [
      { layer: 'object', op: 'remove', object: { ...object, anchor: { ...object.anchor } } },
      { layer: 'object', op: 'add', object: { ...object, anchor: { x: action.cell.x, z: action.cell.z }, rotation } },
    ],
  };
}

function planBulldoze(state: TownStateReader, action: Extract<BuildAction, { type: 'bulldoze' }>): PlanResult {
  // Priority: object > fence edge (as picked) > non-field ground.
  const object = state.getObjectAt(action.cell);
  if (object) {
    const changes: TownChange[] = [];
    const def = objectDef(object.kind);
    if (def.roadFeature) {
      // The feature takes its road with it (the object removal stays last = primary).
      for (const cell of footprintCells(object.anchor, def.footprint, object.rotation)) {
        if (state.getGround(cell) === 'road') changes.push({ layer: 'ground', cell, before: 'road', after: 'field' });
      }
    }
    changes.push({ layer: 'object', op: 'remove', object: { ...object, anchor: { ...object.anchor } } });
    return { ok: true, changes };
  }
  const placed = action.edge ? state.getEdge(action.edge) : undefined;
  if (placed) return { ok: true, changes: [{ layer: 'edge', op: 'remove', placed: { kind: placed.kind, edge: { ...placed.edge } } }] };
  if (state.inBounds(action.cell)) {
    const before = state.getGround(action.cell);
    if (before === 'road') return { ok: true, changes: blockGroundChanges(state, action.cell, 'field') };
    if (before !== 'field') return { ok: true, changes: [{ layer: 'ground', cell: { x: action.cell.x, z: action.cell.z }, before, after: 'field' }] };
  }
  // Silent on drag, shown on click — the caller (ToolController) decides.
  return fail('nothing-here', RULE_MESSAGES.nothingHere);
}
