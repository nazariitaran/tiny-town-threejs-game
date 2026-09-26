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
 */
import { edgeCells, edgeInBounds, edgeOfCellSide, footprintCells, NEIGHBOURS } from './grid';
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
  const object = state.getObjectAt(cell);
  if (object) {
    const def = objectDef(object.kind);
    if (!def.allowedGround.includes(action.kind)) return fail('occupied', `Move the ${def.label} first`);
  }
  const changes: TownChange[] = [];
  if (action.kind === 'road') {
    // A new road cell joins every adjacent road cell: fences on those shared edges must go.
    for (let side = 0; side < 4; side += 1) {
      const offset = NEIGHBOURS[side];
      if (!isRoad(state, { x: cell.x + offset.x, z: cell.z + offset.z })) continue;
      const placed = state.getEdge(edgeOfCellSide(cell, side as 0 | 1 | 2 | 3));
      if (placed) changes.push({ layer: 'edge', op: 'remove', placed: { kind: placed.kind, edge: { ...placed.edge } } });
    }
  }
  // Primary change last.
  changes.push({ layer: 'ground', cell: { x: cell.x, z: cell.z }, before, after: action.kind });
  return { ok: true, changes };
}

function planPlaceObject(state: TownStateReader, action: Extract<BuildAction, { type: 'place-object' }>, ctx: PlanContext): PlanResult {
  const def = objectDef(action.kind);
  const cells = footprintCells(action.cell, def.footprint, action.rotation);
  // Check in severity order across the whole footprint, so the message names the real blocker.
  if (cells.some((cell) => !state.inBounds(cell))) return fail('out-of-bounds', RULE_MESSAGES.outOfBounds);
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
      const message = action.kind === 'bus-stop' ? RULE_MESSAGES.busStopNeedsRoad : `${def.label} needs to be next to ${GROUND_LABELS[needed]}`;
      return fail('needs-ground', message);
    }
  }
  const variant = def.variants > 1 ? Math.min(def.variants - 1, Math.floor(ctx.rng() * def.variants)) : 0;
  return {
    ok: true,
    changes: [
      {
        layer: 'object',
        op: 'add',
        object: { id: ctx.nextId(), kind: action.kind, anchor: { x: action.cell.x, z: action.cell.z }, rotation: action.rotation, variant },
      },
    ],
  };
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
  if (object) return { ok: true, changes: [{ layer: 'object', op: 'remove', object: { ...object, anchor: { ...object.anchor } } }] };
  const placed = action.edge ? state.getEdge(action.edge) : undefined;
  if (placed) return { ok: true, changes: [{ layer: 'edge', op: 'remove', placed: { kind: placed.kind, edge: { ...placed.edge } } }] };
  if (state.inBounds(action.cell)) {
    const before = state.getGround(action.cell);
    if (before !== 'field') return { ok: true, changes: [{ layer: 'ground', cell: { x: action.cell.x, z: action.cell.z }, before, after: 'field' }] };
  }
  // Silent on drag, shown on click — the caller (ToolController) decides.
  return fail('nothing-here', RULE_MESSAGES.nothingHere);
}
