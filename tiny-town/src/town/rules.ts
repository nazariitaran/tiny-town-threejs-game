/**
 * Placement rules: BuildAction + current state → the exact TownChanges to apply, or why not.
 * PURE: never mutates `state`; fully unit-tested in rules.test.ts (one test per rule-table row).
 *
 * Implements docs/design/03-architecture.md §Placement rules. WP-02 owns this file.
 *
 * Invariants every successful plan keeps:
 *  - The PRIMARY change is LAST in the list (TownEditor derives build:placed/removed from it),
 *    e.g. road paint = [fence removals…, ground change]; fence replace = [remove old, add new].
 *  - Object ids and RNG draws are only consumed on success, after every check passed.
 *  - `no-change` is silent: its message is '' and callers must never show it.
 *  - Road blocks (WP-12): roads come in aligned 2 × 2 blocks and a block is all road or has no road.
 *    Painting road on any cell converts its whole block; painting another kind on a road cell, or
 *    bulldozing it, converts the whole block. The CLICKED cell's ground change is last (primary).
 *  - Road features (ObjectDef.roadFeature: the roundabout) are block-aligned objects that stand on
 *    road. Placing one = [fence removals…, ground → road…, object add]; bulldozing it =
 *    [ground → field…, object remove]. Its road can't be repainted while it stands.
 */
import { cellKey, edgeCells, edgeInBounds, edgeKey, edgeOfCellSide, footprintCells, NEIGHBOURS, ROAD_BLOCK, roadBlockCells } from './grid';
import { objectDef, type ObjectDef } from '../catalog/objects';
import type { BuildAction, Cell, GroundKind, InvalidReason, PlanResult, TownChange, TownStateReader } from './types';

export interface PlanContext {
  /** Reserve an object id for an add (TownState.allocateObjectId). Called only on success. */
  nextId(): number;
  /** Seeded RNG for variant selection. Called only on success (and only for multi-variant kinds). */
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

/** Fixed player-facing messages (the ones that don't depend on a label). */
export const RULE_MESSAGES = {
  outOfBounds: 'Outside your plot',
  occupied: 'Something is already here',
  fenceAcrossRoad: "Fences can't cross roads",
  busStopNeedsRoad: 'Bus stops need to be next to a road',
  trafficLightNeedsRoad: 'Traffic lights need to be next to a road',
  nothingHere: 'Nothing to remove',
  noChange: '',
} as const;

const fail = (reason: InvalidReason, message: string): PlanResult => ({ ok: false, reason, message });

/** "a", "a or b", "a, b or c". */
function orList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** Human description of the ground an object may stand on ("grass, meadow or open field"). */
export function allowedGroundText(def: ObjectDef): string {
  // Friendlier order: soft ground first, then paved, then the bare field.
  const order: GroundKind[] = ['grass', 'meadow', 'pavement', 'walkway', 'field'];
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

function planPlaceObject(state: TownStateReader, action: Extract<BuildAction, { type: 'place-object' }>, ctx: PlanContext): PlanResult {
  const def = objectDef(action.kind);
  const cells = footprintCells(action.cell, def.footprint, action.rotation);
  // Check in severity order across the whole footprint, so the message names the real blocker.
  if (cells.some((cell) => !state.inBounds(cell))) return fail('out-of-bounds', RULE_MESSAGES.outOfBounds);
  if (def.roadFeature && (action.cell.x % ROAD_BLOCK !== 0 || action.cell.z % ROAD_BLOCK !== 0)) {
    // ToolController snaps the anchor to the block grid; this only guards scripted actions.
    return fail('out-of-bounds', `${def.label} must line up with the road grid`);
  }
  if (cells.some((cell) => state.getObjectAt(cell))) return fail('occupied', RULE_MESSAGES.occupied);
  for (const cell of cells) {
    const ground = state.getGround(cell);
    if (def.allowedGround.includes(ground)) continue;
    if (ground === 'road') return fail('blocked-by-road', `${def.label} can't go on a road`);
    return fail('needs-ground', `${def.label} needs ${allowedGroundText(def)}`);
  }
  if (def.requiresAdjacent) {
    const needed = def.requiresAdjacent;
    const adjacent = cells.some((cell) =>
      NEIGHBOURS.some((o) => {
        const n = { x: cell.x + o.x, z: cell.z + o.z };
        return state.inBounds(n) && state.getGround(n) === needed;
      }),
    );
    if (!adjacent) {
      const message =
        action.kind === 'bus-stop'
          ? RULE_MESSAGES.busStopNeedsRoad
          : action.kind === 'traffic-light'
          ? RULE_MESSAGES.trafficLightNeedsRoad
          : `${def.label} needs to be next to ${GROUND_LABELS[needed]}`;
      return fail('needs-ground', message);
    }
  }
  // A road feature paints its footprint to road first (fences across it go), so the add is last.
  const changes: TownChange[] = [];
  if (def.roadFeature) {
    changes.push(...fenceRemovalsForRoad(state, cells));
    for (const cell of cells) {
      const before = state.getGround(cell);
      if (before !== 'road') changes.push({ layer: 'ground', cell: { x: cell.x, z: cell.z }, before, after: 'road' });
    }
  }
  const variant = def.variants > 1 ? Math.min(def.variants - 1, Math.floor(ctx.rng() * def.variants)) : 0;
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
