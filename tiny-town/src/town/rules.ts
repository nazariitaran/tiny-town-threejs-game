/**
 * Placement rules: BuildAction + current state → the exact TownChanges to apply, or why not.
 * PURE: never mutates `state`; must be fully unit-tested (rules.test.ts).
 *
 * SCAFFOLD STUB — WP-02 (Town logic) owns this file. The baseline below handles
 * bounds, basic occupancy and edges so the vertical slice works. TODO(WP-02): implement
 * the full rule table in docs/design/03-architecture.md §Placement rules
 * (ground-under-object rules, road blocking, bus-stop adjacency, fences across roads,
 * bulldoze priority object > edge > ground, human-readable messages for every reason).
 */
import { edgeInBounds, footprintCells } from './grid';
import { objectDef } from '../catalog/objects';
import type { BuildAction, PlanResult, Rotation, TownStateReader } from './types';

export interface PlanContext {
  /** Reserve an object id for an add (TownState.allocateObjectId). */
  nextId(): number;
  /** Seeded RNG for variant selection. */
  rng(): number;
}

const fail = (reason: Extract<PlanResult, { ok: false }>['reason'], message: string): PlanResult => ({
  ok: false,
  reason,
  message,
});

export function planAction(state: TownStateReader, action: BuildAction, ctx: PlanContext): PlanResult {
  switch (action.type) {
    case 'paint-ground': {
      if (!state.inBounds(action.cell)) return fail('out-of-bounds', 'Outside your plot');
      const before = state.getGround(action.cell);
      if (before === action.kind) return fail('no-change', 'Already there');
      if (action.kind === 'road' && state.getObjectAt(action.cell)) return fail('occupied', 'Something is in the way');
      return { ok: true, changes: [{ layer: 'ground', cell: { ...action.cell }, before, after: action.kind }] };
    }
    case 'place-object': {
      const def = objectDef(action.kind);
      const cells = footprintCells(action.cell, def.footprint, action.rotation as Rotation);
      for (const cell of cells) {
        if (!state.inBounds(cell)) return fail('out-of-bounds', 'Outside your plot');
        if (state.getObjectAt(cell)) return fail('occupied', 'Something is already here');
        if (!def.allowedGround.includes(state.getGround(cell))) return fail('blocked-by-road', `${def.label} can't go on ${state.getGround(cell)}`);
      }
      const variant = def.variants > 1 ? Math.floor(ctx.rng() * def.variants) : 0;
      return {
        ok: true,
        changes: [{ layer: 'object', op: 'add', object: { id: ctx.nextId(), kind: action.kind, anchor: { ...action.cell }, rotation: action.rotation, variant } }],
      };
    }
    case 'place-edge': {
      if (!edgeInBounds(action.edge, state.width, state.depth)) return fail('out-of-bounds', 'Outside your plot');
      const existing = state.getEdge(action.edge);
      if (existing?.kind === action.kind) return fail('no-change', 'Already fenced');
      const changes: Extract<PlanResult, { ok: true }>['changes'] = [];
      if (existing) changes.push({ layer: 'edge', op: 'remove', placed: existing });
      changes.push({ layer: 'edge', op: 'add', placed: { kind: action.kind, edge: { ...action.edge } } });
      return { ok: true, changes };
    }
    case 'bulldoze': {
      const object = state.getObjectAt(action.cell);
      if (object) return { ok: true, changes: [{ layer: 'object', op: 'remove', object }] };
      const edge = action.edge ? state.getEdge(action.edge) : undefined;
      if (edge) return { ok: true, changes: [{ layer: 'edge', op: 'remove', placed: edge }] };
      if (!state.inBounds(action.cell)) return fail('out-of-bounds', 'Outside your plot');
      const before = state.getGround(action.cell);
      if (before === 'field') return fail('nothing-here', 'Nothing to remove');
      return { ok: true, changes: [{ layer: 'ground', cell: { ...action.cell }, before, after: 'field' }] };
    }
  }
}
