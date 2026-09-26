/**
 * One describe per row of the placement rule table (docs/design/03-architecture.md §Placement rules),
 * each with valid and invalid cases, plus the cross-cutting invariants (purity, primary-last,
 * ids/RNG only consumed on success).
 */
import { describe, expect, it } from 'vitest';
import { OBJECTS } from '../catalog/objects';
import { planAction, RULE_MESSAGES, type PlanContext } from './rules';
import { serializeTown } from './serialize';
import { TownState } from './TownState';
import type { BuildAction, Cell, Edge, EdgeKind, GroundKind, ObjectKind, PlanResult, Rotation, TownChange } from './types';

const W = 8;
const D = 8;

function makeState(): TownState {
  return new TownState(W, D);
}

function ground(state: TownState, kind: GroundKind, ...cells: Array<[number, number]>): void {
  state.applyChanges(cells.map(([x, z]) => ({ layer: 'ground', cell: { x, z }, before: state.getGround({ x, z }), after: kind }) as TownChange));
}

let nextTestId = 100;
function object(state: TownState, kind: ObjectKind, x: number, z: number, rotation: Rotation = 0): number {
  const id = nextTestId++;
  state.applyChanges([{ layer: 'object', op: 'add', object: { id, kind, anchor: { x, z }, rotation, variant: 0 } }]);
  return id;
}

function fence(state: TownState, kind: EdgeKind, edge: Edge): void {
  state.applyChanges([{ layer: 'edge', op: 'add', placed: { kind, edge } }]);
}

/** Counting context: records how many ids / RNG draws the plan consumed. */
function ctx(rngValue = 0.5): PlanContext & { ids: number; draws: number } {
  const c = {
    ids: 0,
    draws: 0,
    nextId: () => {
      c.ids += 1;
      return 1000 + c.ids;
    },
    rng: () => {
      c.draws += 1;
      return rngValue;
    },
  };
  return c;
}

function plan(state: TownState, action: BuildAction, context: PlanContext = ctx()): PlanResult {
  const before = JSON.stringify(serializeTown(state));
  const result = planAction(state, action, context);
  // Purity: planning never mutates the state.
  expect(JSON.stringify(serializeTown(state))).toBe(before);
  return result;
}

function expectOk(result: PlanResult): TownChange[] {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.message}`);
  return result.changes;
}

function expectFail(result: PlanResult, reason: string, message?: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.reason).toBe(reason);
  if (message !== undefined) expect(result.message).toBe(message);
}

const paint = (kind: Exclude<GroundKind, 'field'>, x: number, z: number): BuildAction => ({ type: 'paint-ground', kind, cell: { x, z } });
const placeObj = (kind: ObjectKind, x: number, z: number, rotation: Rotation = 0): BuildAction => ({ type: 'place-object', kind, cell: { x, z }, rotation });
const placeEdge = (kind: EdgeKind, x: number, z: number, side: 'n' | 'w'): BuildAction => ({ type: 'place-edge', kind, edge: { x, z, side } });
const bulldoze = (x: number, z: number, edge: Edge | null = null): BuildAction => ({ type: 'bulldoze', cell: { x, z }, edge });

// ---------------------------------------------------------------------------------------------
describe('row 1 — paint-ground: in bounds and kind differs', () => {
  it('valid: paints every paintable kind on field with one ground change', () => {
    for (const kind of ['grass', 'meadow', 'road', 'pavement', 'walkway'] as const) {
      const state = makeState();
      const changes = expectOk(plan(state, paint(kind, 3, 4)));
      expect(changes).toEqual([{ layer: 'ground', cell: { x: 3, z: 4 }, before: 'field', after: kind }]);
    }
  });

  it('valid: repaints one non-field kind over another (before = old kind)', () => {
    const state = makeState();
    ground(state, 'grass', [1, 1]);
    expect(expectOk(plan(state, paint('pavement', 1, 1)))).toEqual([{ layer: 'ground', cell: { x: 1, z: 1 }, before: 'grass', after: 'pavement' }]);
  });

  it('valid: plot corners are in bounds', () => {
    const state = makeState();
    for (const [x, z] of [[0, 0], [W - 1, 0], [0, D - 1], [W - 1, D - 1]]) expectOk(plan(state, paint('grass', x, z)));
  });

  it('invalid: out-of-bounds on every side → "Outside your plot"', () => {
    const state = makeState();
    for (const [x, z] of [[-1, 0], [0, -1], [W, 0], [0, D], [W, D], [-5, -5]]) {
      expectFail(plan(state, paint('grass', x, z)), 'out-of-bounds', 'Outside your plot');
    }
  });

  it('invalid: same kind → silent no-change (empty message)', () => {
    const state = makeState();
    ground(state, 'meadow', [2, 2]);
    expectFail(plan(state, paint('meadow', 2, 2)), 'no-change', '');
    expect(RULE_MESSAGES.noChange).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 2 — paint-ground under an object: new kind ∈ allowedGround', () => {
  it('valid: grass/meadow under a house, pavement under a tree/garage/prop, walkway under a prop', () => {
    const state = makeState();
    object(state, 'townhouse-a', 1, 1);
    object(state, 'tree-a', 2, 1);
    object(state, 'garage', 3, 1);
    object(state, 'lamppost', 4, 1);
    expectOk(plan(state, paint('grass', 1, 1)));
    expectOk(plan(state, paint('meadow', 1, 1)));
    expectOk(plan(state, paint('pavement', 2, 1)));
    expectOk(plan(state, paint('pavement', 3, 1)));
    expectOk(plan(state, paint('walkway', 4, 1)));
  });

  it('invalid: road under any object → occupied "Move the {label} first"', () => {
    for (const kind of Object.keys(OBJECTS) as ObjectKind[]) {
      const state = makeState();
      ground(state, 'road', [2, 1]); // keeps the bus stop legal where it stands
      object(state, kind, 2, 2);
      expectFail(plan(state, paint('road', 2, 2)), 'occupied', `Move the ${OBJECTS[kind].label} first`);
    }
  });

  it('invalid: pavement/walkway under a house → "Move the Cottage first"', () => {
    const state = makeState();
    object(state, 'townhouse-a', 1, 1);
    expectFail(plan(state, paint('pavement', 1, 1)), 'occupied', 'Move the Cottage first');
    expectFail(plan(state, paint('walkway', 1, 1)), 'occupied', 'Move the Cottage first');
  });

  it('invalid: walkway under a tree → "Move the Pine first"', () => {
    const state = makeState();
    object(state, 'tree-b', 1, 1);
    expectFail(plan(state, paint('walkway', 1, 1)), 'occupied', 'Move the Pine first');
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 3 — paint-ground road removes fences on edges shared with adjacent road cells', () => {
  const centre: Cell = { x: 3, z: 3 };
  const sides: Array<{ name: string; neighbour: [number, number]; edge: Edge }> = [
    { name: 'north', neighbour: [3, 2], edge: { x: 3, z: 3, side: 'n' } },
    { name: 'east', neighbour: [4, 3], edge: { x: 4, z: 3, side: 'w' } },
    { name: 'south', neighbour: [3, 4], edge: { x: 3, z: 4, side: 'n' } },
    { name: 'west', neighbour: [2, 3], edge: { x: 3, z: 3, side: 'w' } },
  ];

  for (const { name, neighbour, edge } of sides) {
    it(`valid: removes the fence towards a ${name} road neighbour, ground change last`, () => {
      const state = makeState();
      ground(state, 'road', neighbour);
      fence(state, 'fence-small', edge);
      const changes = expectOk(plan(state, paint('road', centre.x, centre.z)));
      expect(changes).toEqual([
        { layer: 'edge', op: 'remove', placed: { kind: 'fence-small', edge } },
        { layer: 'ground', cell: centre, before: 'field', after: 'road' },
      ]);
    });
  }

  it('valid: removes all four fences at a crossroads, primary (ground) change last', () => {
    const state = makeState();
    for (const { neighbour, edge } of sides) {
      ground(state, 'road', neighbour);
      fence(state, 'fence-tall', edge);
    }
    const changes = expectOk(plan(state, paint('road', 3, 3)));
    expect(changes).toHaveLength(5);
    expect(changes.slice(0, 4).every((c) => c.layer === 'edge' && c.op === 'remove')).toBe(true);
    expect(changes[4]).toEqual({ layer: 'ground', cell: centre, before: 'field', after: 'road' });
  });

  it('keeps fences towards non-road neighbours and fences on the plot border', () => {
    const state = makeState();
    ground(state, 'pavement', [3, 2]);
    fence(state, 'fence-small', { x: 3, z: 3, side: 'n' }); // towards pavement
    fence(state, 'fence-small', { x: 0, z: 0, side: 'n' }); // plot border of (0,0)
    fence(state, 'fence-small', { x: 0, z: 0, side: 'w' });
    expect(expectOk(plan(state, paint('road', 3, 3)))).toHaveLength(1);
    expect(expectOk(plan(state, paint('road', 0, 0)))).toHaveLength(1);
  });

  it('does not remove fences when painting a non-road kind next to a road', () => {
    const state = makeState();
    ground(state, 'road', [3, 2]);
    fence(state, 'fence-small', { x: 3, z: 3, side: 'n' });
    expect(expectOk(plan(state, paint('pavement', 3, 3)))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 4 — place-object: footprint in bounds, unoccupied, ground ∈ allowedGround', () => {
  it('valid: every kind on its allowed ground, at every rotation', () => {
    for (const kind of Object.keys(OBJECTS) as ObjectKind[]) {
      const def = OBJECTS[kind];
      for (const g of def.allowedGround) {
        for (const rotation of [0, 1, 2, 3] as const) {
          const state = makeState();
          ground(state, 'road', [2, 1]); // bus stops need a road neighbour
          if (g !== 'field') ground(state, g, [2, 2]);
          const context = ctx(0.99);
          const changes = expectOk(plan(state, placeObj(kind, 2, 2, rotation), context));
          expect(changes).toEqual([
            { layer: 'object', op: 'add', object: { id: 1001, kind, anchor: { x: 2, z: 2 }, rotation, variant: def.variants - 1 } },
          ]);
          expect(context.ids).toBe(1);
          expect(context.draws).toBe(def.variants > 1 ? 1 : 0);
        }
      }
    }
  });

  it('valid: variant is floor(rng * variants), so undo/redo/save can reproduce it', () => {
    const state = makeState();
    const low = expectOk(plan(state, placeObj('tree-c', 1, 1), ctx(0)))[0];
    const high = expectOk(plan(state, placeObj('tree-c', 1, 1), ctx(0.7)))[0];
    expect(low.layer === 'object' && low.object.variant).toBe(0);
    expect(high.layer === 'object' && high.object.variant).toBe(1);
  });

  it('invalid: out-of-bounds → "Outside your plot", no id or RNG consumed', () => {
    const state = makeState();
    for (const [x, z] of [[-1, 0], [0, -1], [W, 0], [0, D]]) {
      const context = ctx();
      expectFail(plan(state, placeObj('townhouse-b', x, z), context), 'out-of-bounds', 'Outside your plot');
      expect(context.ids + context.draws).toBe(0);
    }
  });

  it('invalid: occupied → "Something is already here", no id or RNG consumed', () => {
    const state = makeState();
    object(state, 'postbox', 4, 4);
    const context = ctx();
    expectFail(plan(state, placeObj('townhouse-c', 4, 4), context), 'occupied', 'Something is already here');
    expect(context.ids + context.draws).toBe(0);
  });

  it('invalid: road ground → blocked-by-road "{label} can\'t go on a road" for every kind', () => {
    for (const kind of Object.keys(OBJECTS) as ObjectKind[]) {
      const state = makeState();
      ground(state, 'road', [2, 2], [2, 1]);
      const context = ctx();
      expectFail(plan(state, placeObj(kind, 2, 2), context), 'blocked-by-road', `${OBJECTS[kind].label} can't go on a road`);
      expect(context.ids + context.draws).toBe(0);
    }
  });

  it('invalid: other disallowed ground → needs-ground "{label} needs {ground}"', () => {
    const state = makeState();
    ground(state, 'pavement', [1, 1]);
    ground(state, 'walkway', [2, 1]);
    expectFail(plan(state, placeObj('townhouse-a', 1, 1)), 'needs-ground', 'Cottage needs grass, meadow or open field');
    expectFail(plan(state, placeObj('townhouse-c', 2, 1)), 'needs-ground', 'Family home needs grass, meadow or open field');
    expectFail(plan(state, placeObj('tree-a', 2, 1)), 'needs-ground', 'Oak needs grass, meadow, pavement or open field');
    expectFail(plan(state, placeObj('garage', 2, 1)), 'needs-ground', 'Garage needs grass, meadow, pavement or open field');
  });

  it('checks severity in order: out-of-bounds before occupied before ground', () => {
    const state = makeState();
    ground(state, 'road', [1, 1]);
    object(state, 'lamppost', 2, 2);
    expectFail(plan(state, placeObj('tree-a', 2, 2)), 'occupied');
    expectFail(plan(state, placeObj('tree-a', 1, 1)), 'blocked-by-road');
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 5 — place-object bus-stop: ≥ 1 footprint cell 4-adjacent to a road', () => {
  for (const [name, x, z] of [['north', 3, 2], ['east', 4, 3], ['south', 3, 4], ['west', 2, 3]] as const) {
    it(`valid: road to the ${name}`, () => {
      const state = makeState();
      ground(state, 'road', [x, z]);
      expectOk(plan(state, placeObj('bus-stop', 3, 3)));
    });
  }

  it('valid: on pavement or walkway next to a road', () => {
    const state = makeState();
    ground(state, 'road', [3, 2]);
    ground(state, 'pavement', [3, 3]);
    expectOk(plan(state, placeObj('bus-stop', 3, 3)));
    ground(state, 'walkway', [3, 3]);
    expectOk(plan(state, placeObj('bus-stop', 3, 3)));
  });

  it('invalid: no road anywhere → needs-ground "Bus stops need to be next to a road"', () => {
    const state = makeState();
    expectFail(plan(state, placeObj('bus-stop', 3, 3)), 'needs-ground', 'Bus stops need to be next to a road');
  });

  it('invalid: diagonal road does not count', () => {
    const state = makeState();
    ground(state, 'road', [4, 4], [2, 2]);
    expectFail(plan(state, placeObj('bus-stop', 3, 3)), 'needs-ground', 'Bus stops need to be next to a road');
  });

  it('invalid: adjacent non-road paths (pavement/walkway) do not count', () => {
    const state = makeState();
    ground(state, 'pavement', [3, 2]);
    ground(state, 'walkway', [3, 4]);
    expectFail(plan(state, placeObj('bus-stop', 3, 3)), 'needs-ground', 'Bus stops need to be next to a road');
  });

  it('other kinds do not need a road', () => {
    const state = makeState();
    expectOk(plan(state, placeObj('postbox', 3, 3)));
    expectOk(plan(state, placeObj('lamppost', 3, 3)));
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 6 — place-edge: in bounds, not between two roads; same ⇒ no-change; other ⇒ replace', () => {
  it('valid: interior edges of both sides add one fence', () => {
    const state = makeState();
    expect(expectOk(plan(state, placeEdge('fence-small', 3, 3, 'n')))).toEqual([
      { layer: 'edge', op: 'add', placed: { kind: 'fence-small', edge: { x: 3, z: 3, side: 'n' } } },
    ]);
    expectOk(plan(state, placeEdge('fence-tall', 3, 3, 'w')));
  });

  it('valid: plot border edges are allowed (all four borders)', () => {
    const state = makeState();
    expectOk(plan(state, placeEdge('fence-small', 0, 0, 'n'))); // north border
    expectOk(plan(state, placeEdge('fence-small', 2, D, 'n'))); // south border
    expectOk(plan(state, placeEdge('fence-small', 0, 2, 'w'))); // west border
    expectOk(plan(state, placeEdge('fence-small', W, 2, 'w'))); // east border
  });

  it('valid: between a road and a non-road cell, and on the border next to a road', () => {
    const state = makeState();
    ground(state, 'road', [3, 3], [0, 0]);
    expectOk(plan(state, placeEdge('fence-small', 3, 3, 'n')));
    expectOk(plan(state, placeEdge('fence-small', 0, 0, 'n')));
    expectOk(plan(state, placeEdge('fence-small', 0, 0, 'w')));
  });

  it('invalid: out-of-bounds edges → "Outside your plot"', () => {
    const state = makeState();
    for (const [x, z, side] of [[W, 0, 'n'], [0, D, 'w'], [-1, 0, 'w'], [0, -1, 'n'], [W + 1, 0, 'w'], [0, D + 1, 'n']] as const) {
      expectFail(plan(state, placeEdge('fence-tall', x, z, side)), 'out-of-bounds', 'Outside your plot');
    }
  });

  it('invalid: between two road cells → blocked-by-road "Fences can\'t cross roads"', () => {
    const state = makeState();
    ground(state, 'road', [3, 2], [3, 3], [4, 3]);
    expectFail(plan(state, placeEdge('fence-small', 3, 3, 'n')), 'blocked-by-road', "Fences can't cross roads");
    expectFail(plan(state, placeEdge('fence-tall', 4, 3, 'w')), 'blocked-by-road', "Fences can't cross roads");
  });

  it('invalid: same kind already there → silent no-change', () => {
    const state = makeState();
    fence(state, 'fence-small', { x: 3, z: 3, side: 'n' });
    expectFail(plan(state, placeEdge('fence-small', 3, 3, 'n')), 'no-change', '');
  });

  it('valid: other kind already there → [remove old, add new] (primary add last)', () => {
    const state = makeState();
    fence(state, 'fence-small', { x: 3, z: 3, side: 'n' });
    expect(expectOk(plan(state, placeEdge('fence-tall', 3, 3, 'n')))).toEqual([
      { layer: 'edge', op: 'remove', placed: { kind: 'fence-small', edge: { x: 3, z: 3, side: 'n' } } },
      { layer: 'edge', op: 'add', placed: { kind: 'fence-tall', edge: { x: 3, z: 3, side: 'n' } } },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 7 — bulldoze: object > picked fence edge > non-field ground', () => {
  it('valid: removes the object even if a fence and ground are also there', () => {
    const state = makeState();
    ground(state, 'grass', [2, 2]);
    const id = object(state, 'tree-b', 2, 2);
    fence(state, 'fence-small', { x: 2, z: 2, side: 'n' });
    const changes = expectOk(plan(state, bulldoze(2, 2, { x: 2, z: 2, side: 'n' })));
    expect(changes).toEqual([{ layer: 'object', op: 'remove', object: { id, kind: 'tree-b', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 } }]);
  });

  it('valid: with no object, removes the fence on the picked edge before the ground', () => {
    const state = makeState();
    ground(state, 'pavement', [2, 2]);
    fence(state, 'fence-tall', { x: 3, z: 2, side: 'w' });
    expect(expectOk(plan(state, bulldoze(2, 2, { x: 3, z: 2, side: 'w' })))).toEqual([
      { layer: 'edge', op: 'remove', placed: { kind: 'fence-tall', edge: { x: 3, z: 2, side: 'w' } } },
    ]);
  });

  it('valid: removes a fence on the plot border (picked from an edge cell)', () => {
    const state = makeState();
    fence(state, 'fence-small', { x: 0, z: 0, side: 'n' });
    expectOk(plan(state, bulldoze(0, 0, { x: 0, z: 0, side: 'n' })));
  });

  it('valid: with no object and no fence, non-field ground goes back to field', () => {
    for (const kind of ['grass', 'meadow', 'road', 'pavement', 'walkway'] as const) {
      const state = makeState();
      ground(state, kind, [2, 2]);
      expect(expectOk(plan(state, bulldoze(2, 2, { x: 2, z: 2, side: 'n' })))).toEqual([
        { layer: 'ground', cell: { x: 2, z: 2 }, before: kind, after: 'field' },
      ]);
    }
  });

  it('invalid: bare field, no edge → nothing-here "Nothing to remove"', () => {
    const state = makeState();
    expectFail(plan(state, bulldoze(2, 2)), 'nothing-here', 'Nothing to remove');
  });

  it('invalid: picked edge without a fence on bare field → nothing-here', () => {
    const state = makeState();
    fence(state, 'fence-small', { x: 5, z: 5, side: 'n' }); // a fence elsewhere doesn't count
    expectFail(plan(state, bulldoze(2, 2, { x: 2, z: 2, side: 'w' })), 'nothing-here', 'Nothing to remove');
  });

  it('invalid: out-of-plot cell with nothing picked → nothing-here', () => {
    const state = makeState();
    expectFail(plan(state, bulldoze(-1, 3)), 'nothing-here');
    expectFail(plan(state, bulldoze(W, D)), 'nothing-here');
  });
});
