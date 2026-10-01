/**
 * One describe per row of the placement rule table (docs/design/03-architecture.md §Placement rules),
 * each with valid and invalid cases, plus the cross-cutting invariants (purity, primary-last,
 * ids/RNG only consumed on success).
 */
import { describe, expect, it } from 'vitest';
import { OBJECTS } from '../catalog/objects';
import { createGameBus } from '../game/events';
import { createSeededRandom } from '../utils/random';
import { rotatedFootprint } from './grid';
import { planAction, RULE_MESSAGES, type PlanContext } from './rules';
import { serializeTown } from './serialize';
import { TownEditor } from './TownEditor';
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
  it('valid: paints every paintable non-road kind on field with one ground change', () => {
    for (const kind of ['grass', 'meadow', 'pavement', 'walkway'] as const) {
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
  it('valid: grass/meadow/pavement under a house, grass/meadow under a tree/bush, pavement/walkway under a prop', () => {
    const state = makeState();
    object(state, 'cottage', 1, 1);
    object(state, 'oak', 1, 5);
    object(state, 'bush', 3, 5);
    object(state, 'lamppost', 4, 5);
    expectOk(plan(state, paint('grass', 1, 1)));
    expectOk(plan(state, paint('meadow', 1, 1)));
    expectOk(plan(state, paint('pavement', 1, 1)));
    expectOk(plan(state, paint('grass', 1, 5)));
    expectOk(plan(state, paint('meadow', 3, 5)));
    expectOk(plan(state, paint('pavement', 4, 5)));
    expectOk(plan(state, paint('walkway', 4, 5)));
  });

  it('invalid: road under any object → occupied "Move the {label} first"', () => {
    for (const kind of Object.keys(OBJECTS) as ObjectKind[]) {
      const state = makeState();
      ground(state, 'road', [2, 1]); // keeps the bus stop legal where it stands
      object(state, kind, 2, 2);
      expectFail(plan(state, paint('road', 2, 2)), 'occupied', `Move the ${OBJECTS[kind].label} first`);
    }
  });

  it('invalid: walkway under a house → "Move the Cottage first"', () => {
    const state = makeState();
    object(state, 'cottage', 1, 1);
    expectFail(plan(state, paint('walkway', 1, 1)), 'occupied', 'Move the Cottage first');
  });

  it('invalid: pavement/walkway under a tree or bush → "Move the {label} first"', () => {
    const state = makeState();
    object(state, 'pine', 1, 1);
    object(state, 'bush', 2, 1);
    expectFail(plan(state, paint('pavement', 1, 1)), 'occupied', 'Move the Pine first');
    expectFail(plan(state, paint('walkway', 1, 1)), 'occupied', 'Move the Pine first');
    expectFail(plan(state, paint('pavement', 2, 1)), 'occupied', 'Move the Bush first');
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 3 — road blocks: paint/repaint/bulldoze whole aligned 2×2 blocks; fences inside and towards road go', () => {
  /** The 4 cells of the block anchored at (x, z) (x, z even). */
  const block = (x: number, z: number): Cell[] => [
    { x, z },
    { x: x + 1, z },
    { x, z: z + 1 },
    { x: x + 1, z: z + 1 },
  ];
  const groundChanges = (changes: TownChange[]) => changes.filter((c) => c.layer === 'ground');

  it('valid: road on any cell converts its whole block, the clicked cell last', () => {
    for (const clicked of block(2, 4)) {
      const state = makeState();
      const changes = expectOk(plan(state, paint('road', clicked.x, clicked.z)));
      expect(changes).toHaveLength(4);
      expect(changes.every((c) => c.layer === 'ground' && c.before === 'field' && c.after === 'road')).toBe(true);
      expect(changes.map((c) => (c.layer === 'ground' ? `${c.cell.x},${c.cell.z}` : '')).sort()).toEqual(['2,4', '2,5', '3,4', '3,5']);
      expect(changes[3]).toEqual({ layer: 'ground', cell: clicked, before: 'field', after: 'road' });
    }
  });

  it('invalid: road on a block already road → silent no-change', () => {
    const state = makeState();
    ground(state, 'road', [2, 4], [3, 4], [2, 5], [3, 5]);
    expectFail(plan(state, paint('road', 3, 5)), 'no-change', '');
  });

  it('valid: road over a mixed block converts every cell (row-major, clicked cell last)', () => {
    const state = makeState();
    ground(state, 'grass', [2, 4]);
    ground(state, 'pavement', [3, 5]);
    const changes = groundChanges(expectOk(plan(state, paint('road', 3, 4))));
    expect(changes.map((c) => c.layer === 'ground' && `${c.cell.x},${c.cell.z}:${c.before}`)).toEqual(['2,4:grass', '2,5:field', '3,5:pavement', '3,4:field']);
  });

  it('invalid: road fails occupied if ANY cell of the block has an object', () => {
    for (const [x, z] of [[2, 4], [3, 4], [2, 5], [3, 5]]) {
      const state = makeState();
      object(state, 'lamppost', x, z);
      expectFail(plan(state, paint('road', 2, 4)), 'occupied', 'Move the Lamppost first');
    }
    const state = makeState();
    object(state, 'cottage', 3, 5); // a 3×3 whose corner reaches into the block (2..3, 4..5)
    expectFail(plan(state, paint('road', 2, 4)), 'occupied', 'Move the Cottage first');
  });

  it('valid: another kind on a road cell converts the whole block, clicked cell last', () => {
    const state = makeState();
    ground(state, 'road', [2, 4], [3, 4], [2, 5], [3, 5]);
    const changes = expectOk(plan(state, paint('pavement', 2, 5)));
    expect(changes).toHaveLength(4);
    expect(changes.every((c) => c.layer === 'ground' && c.before === 'road' && c.after === 'pavement')).toBe(true);
    expect(changes[3]).toEqual({ layer: 'ground', cell: { x: 2, z: 5 }, before: 'road', after: 'pavement' });
  });

  it('valid: bulldozing a road cell turns its whole block back to field', () => {
    const state = makeState();
    ground(state, 'road', [2, 4], [3, 4], [2, 5], [3, 5]);
    const changes = expectOk(plan(state, bulldoze(3, 4)));
    expect(changes).toHaveLength(4);
    expect(changes.every((c) => c.layer === 'ground' && c.before === 'road' && c.after === 'field')).toBe(true);
    expect(changes[3]).toEqual({ layer: 'ground', cell: { x: 3, z: 4 }, before: 'road', after: 'field' });
  });

  it("valid: removes fences on the block's 4 inside edges, edge removals first and ground last", () => {
    const state = makeState();
    const inside: Edge[] = [
      { x: 3, z: 4, side: 'w' },
      { x: 3, z: 5, side: 'w' },
      { x: 2, z: 5, side: 'n' },
      { x: 3, z: 5, side: 'n' },
    ];
    for (const edge of inside) fence(state, 'fence-low', edge);
    const changes = expectOk(plan(state, paint('road', 2, 4)));
    expect(changes).toHaveLength(8);
    expect(changes.slice(0, 4).every((c) => c.layer === 'edge' && c.op === 'remove')).toBe(true);
    expect(changes.slice(4).every((c) => c.layer === 'ground')).toBe(true);
    expect(changes.slice(0, 4).map((c) => (c.layer === 'edge' ? c.placed.edge : null))).toEqual(expect.arrayContaining(inside));
  });

  const sides: Array<{ name: string; neighbour: [number, number]; edges: Edge[] }> = [
    { name: 'north', neighbour: [2, 2], edges: [{ x: 2, z: 4, side: 'n' }, { x: 3, z: 4, side: 'n' }] },
    { name: 'east', neighbour: [4, 4], edges: [{ x: 4, z: 4, side: 'w' }, { x: 4, z: 5, side: 'w' }] },
    { name: 'south', neighbour: [2, 6], edges: [{ x: 2, z: 6, side: 'n' }, { x: 3, z: 6, side: 'n' }] },
    { name: 'west', neighbour: [0, 4], edges: [{ x: 2, z: 4, side: 'w' }, { x: 2, z: 5, side: 'w' }] },
  ];
  for (const { name, neighbour, edges } of sides) {
    it(`valid: removes the outside fences towards a ${name} road block`, () => {
      const state = makeState();
      const [nx, nz] = neighbour;
      ground(state, 'road', [nx, nz], [nx + 1, nz], [nx, nz + 1], [nx + 1, nz + 1]);
      for (const edge of edges) fence(state, 'fence-tall', edge);
      const changes = expectOk(plan(state, paint('road', 3, 5)));
      expect(changes).toHaveLength(6);
      expect(changes.slice(0, 2)).toEqual(edges.map((edge) => ({ layer: 'edge', op: 'remove', placed: { kind: 'fence-tall', edge } })));
    });
  }

  it('keeps outside fences towards non-road neighbours and on the plot border', () => {
    const state = makeState();
    ground(state, 'pavement', [2, 3], [3, 3]);
    fence(state, 'fence-low', { x: 2, z: 4, side: 'n' }); // towards pavement
    fence(state, 'fence-low', { x: 0, z: 0, side: 'n' }); // plot border of block (0, 0)
    fence(state, 'fence-low', { x: 0, z: 1, side: 'w' });
    expect(expectOk(plan(state, paint('road', 2, 4)))).toHaveLength(4);
    expect(expectOk(plan(state, paint('road', 1, 1)))).toHaveLength(4);
  });

  it('does not remove fences when painting a non-road kind next to a road', () => {
    const state = makeState();
    ground(state, 'road', [2, 2], [3, 2], [2, 3], [3, 3]);
    fence(state, 'fence-low', { x: 3, z: 4, side: 'n' });
    expect(expectOk(plan(state, paint('pavement', 3, 4)))).toHaveLength(1);
  });

  it("invalid: a fence on a road block's inside edge → blocked-by-road", () => {
    const state = makeState();
    ground(state, 'road', [2, 4], [3, 4], [2, 5], [3, 5]);
    expectFail(plan(state, placeEdge('fence-low', 3, 4, 'w')), 'blocked-by-road', "Fences can't cross roads");
    expectFail(plan(state, placeEdge('fence-low', 2, 5, 'n')), 'blocked-by-road', "Fences can't cross roads");
    expectOk(plan(state, placeEdge('fence-low', 2, 4, 'n'))); // outside edge towards field
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 4 — place-object: footprint in bounds, unoccupied, ground ∈ allowedGround', () => {
  it('valid: every kind on its allowed ground, at every rotation', () => {
    for (const kind of Object.keys(OBJECTS) as ObjectKind[]) {
      const def = OBJECTS[kind];
      if (def.roadFeature || def.roadMarking) continue; // road features paint their footprint too: see 'road features'; markings: 'road markings'
      for (const g of def.allowedGround) {
        for (const rotation of [0, 1, 2, 3] as const) {
          const state = makeState();
          ground(state, 'road', [2, 1]); // bus stops and traffic lights need a road neighbour
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
    const low = expectOk(plan(state, placeObj('birch', 1, 1), ctx(0)))[0];
    const high = expectOk(plan(state, placeObj('birch', 1, 1), ctx(0.7)))[0];
    expect(low.layer === 'object' && low.object.variant).toBe(0);
    expect(high.layer === 'object' && high.object.variant).toBe(1);
  });

  it('invalid: out-of-bounds → "Outside your plot", no id or RNG consumed', () => {
    const state = makeState();
    for (const [x, z] of [[-1, 0], [0, -1], [W, 0], [0, D]]) {
      const context = ctx();
      expectFail(plan(state, placeObj('townhouse', x, z), context), 'out-of-bounds', 'Outside your plot');
      expect(context.ids + context.draws).toBe(0);
    }
  });

  it('invalid: occupied → "Something is already here", no id or RNG consumed', () => {
    const state = makeState();
    object(state, 'postbox', 4, 4);
    const context = ctx();
    expectFail(plan(state, placeObj('family-home', 4, 4), context), 'occupied', 'Something is already here');
    expect(context.ids + context.draws).toBe(0);
  });

  it('invalid: road ground → blocked-by-road "{label} can\'t go on a road" for every kind but road features', () => {
    for (const kind of Object.keys(OBJECTS) as ObjectKind[]) {
      if (OBJECTS[kind].roadFeature || OBJECTS[kind].roadMarking) continue;
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
    expectFail(plan(state, placeObj('cottage', 1, 1)), 'needs-ground', 'Cottage needs grass, meadow, pavement or open field');
    expectFail(plan(state, placeObj('family-home', 2, 1)), 'needs-ground', 'Family home needs grass, meadow, pavement or open field');
    expectFail(plan(state, placeObj('oak', 1, 1)), 'needs-ground', 'Oak needs grass, meadow or open field');
    expectFail(plan(state, placeObj('bush', 1, 1)), 'needs-ground', 'Bush needs grass, meadow or open field');
    expectFail(plan(state, placeObj('birch', 1, 1)), 'needs-ground', 'Birch needs grass, meadow or open field');
  });

  it('checks severity in order: out-of-bounds before occupied before ground', () => {
    const state = makeState();
    ground(state, 'road', [1, 1]);
    object(state, 'lamppost', 2, 2);
    expectFail(plan(state, placeObj('oak', 2, 2)), 'occupied');
    expectFail(plan(state, placeObj('oak', 0, 0)), 'blocked-by-road'); // the 2 × 2 oak covers (1, 1)
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 5 — place-object bus-stop (2×1): ≥ 1 footprint cell 4-adjacent to a road', () => {
  // Bus stop at (3, 3), rotation 0, covers (3, 3) and (4, 3).
  for (const [name, x, z] of [['north of the first cell', 3, 2], ['north of the second cell', 4, 2], ['east', 5, 3], ['south of the second cell', 4, 4], ['west', 2, 3]] as const) {
    it(`valid: road ${name}`, () => {
      const state = makeState();
      ground(state, 'road', [x, z]);
      expectOk(plan(state, placeObj('bus-stop', 3, 3)));
    });
  }

  it('valid: rotated (1×2) it is adjacent through either footprint cell', () => {
    const state = makeState();
    ground(state, 'road', [4, 4]); // east of (3, 4), the second cell at rotation 1
    expectOk(plan(state, placeObj('bus-stop', 3, 3, 1)));
    expectFail(plan(state, placeObj('bus-stop', 3, 2, 1)), 'needs-ground', 'Bus stops need to be next to a road');
  });

  it('valid: on pavement or walkway next to a road', () => {
    const state = makeState();
    ground(state, 'road', [3, 2]);
    ground(state, 'pavement', [3, 3], [4, 3]);
    expectOk(plan(state, placeObj('bus-stop', 3, 3)));
    ground(state, 'walkway', [3, 3], [4, 3]);
    expectOk(plan(state, placeObj('bus-stop', 3, 3)));
  });

  it('invalid: no road anywhere → needs-ground "Bus stops need to be next to a road"', () => {
    const state = makeState();
    expectFail(plan(state, placeObj('bus-stop', 3, 3)), 'needs-ground', 'Bus stops need to be next to a road');
  });

  it('invalid: diagonal road does not count', () => {
    const state = makeState();
    ground(state, 'road', [5, 4], [2, 2], [5, 2], [2, 4]);
    expectFail(plan(state, placeObj('bus-stop', 3, 3)), 'needs-ground', 'Bus stops need to be next to a road');
  });

  it('invalid: adjacent non-road paths (pavement/walkway) do not count', () => {
    const state = makeState();
    ground(state, 'pavement', [3, 2]);
    ground(state, 'walkway', [4, 4]);
    expectFail(plan(state, placeObj('bus-stop', 3, 3)), 'needs-ground', 'Bus stops need to be next to a road');
  });

  it('other kinds do not need a road', () => {
    const state = makeState();
    expectOk(plan(state, placeObj('postbox', 3, 3)));
    expectOk(plan(state, placeObj('lamppost', 3, 3)));
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 5b — place-object traffic-light: 4-adjacent to a road', () => {
  it('valid: next to a road (on field, pavement or walkway)', () => {
    for (const g of ['field', 'pavement', 'walkway'] as const) {
      const state = makeState();
      ground(state, 'road', [3, 2]);
      if (g !== 'field') ground(state, g, [3, 3]);
      expectOk(plan(state, placeObj('traffic-light', 3, 3)));
    }
  });

  it('invalid: no adjacent road → needs-ground with the traffic-light message', () => {
    const state = makeState();
    ground(state, 'road', [4, 4]); // diagonal only
    const context = ctx();
    expectFail(plan(state, placeObj('traffic-light', 3, 3), context), 'needs-ground', RULE_MESSAGES.trafficLightNeedsRoad);
    expect(RULE_MESSAGES.trafficLightNeedsRoad).toBe('Traffic lights need to be next to a road');
    expect(context.ids + context.draws).toBe(0);
  });

  it('invalid: on the road itself → blocked-by-road', () => {
    const state = makeState();
    ground(state, 'road', [3, 3], [3, 2]);
    expectFail(plan(state, placeObj('traffic-light', 3, 3)), 'blocked-by-road', "Traffic light can't go on a road");
  });
});

// ---------------------------------------------------------------------------------------------
describe('road markings — the zebra crossing (one 2 × 2 road block, block aligned, on existing road)', () => {
  /** Road on whole blocks, given by their anchor cells. */
  const roadBlocks = (state: TownState, ...anchors: Array<[number, number]>) => {
    for (const [x, z] of anchors) ground(state, 'road', [x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]);
  };

  it('valid on a straight, a tee and a cross: just the object add (the road stays)', () => {
    const layouts: Array<Array<[number, number]>> = [
      [[0, 2], [2, 2], [4, 2]], // straight east–west
      [[0, 2], [2, 2], [4, 2], [2, 4]], // tee
      [[0, 2], [2, 2], [4, 2], [2, 0], [2, 4]], // cross
    ];
    for (const blocks of layouts) {
      const state = makeState();
      roadBlocks(state, ...blocks);
      const context = ctx();
      const changes = expectOk(plan(state, placeObj('zebra-crossing', 2, 2), context));
      expect(changes).toEqual([{ layer: 'object', op: 'add', object: { id: 1001, kind: 'zebra-crossing', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 } }]);
      expect([context.ids, context.draws]).toEqual([1, 0]);
    }
  });

  it('invalid on a corner, a dead end or a lone block', () => {
    const layouts: Array<Array<[number, number]>> = [[[2, 2], [4, 2], [2, 4]], [[2, 2], [4, 2]], [[2, 2]]];
    for (const blocks of layouts) {
      const state = makeState();
      roadBlocks(state, ...blocks);
      const context = ctx();
      expectFail(plan(state, placeObj('zebra-crossing', 2, 2), context), 'needs-ground', RULE_MESSAGES.zebraNeedsStraight);
      expect(context.ids + context.draws).toBe(0);
    }
  });

  it('invalid off road ("needs road") and off the block grid', () => {
    const state = makeState();
    expectFail(plan(state, placeObj('zebra-crossing', 2, 2)), 'needs-ground', 'Zebra crossing needs road');
    roadBlocks(state, [0, 2], [2, 2], [4, 2]);
    expectFail(plan(state, placeObj('zebra-crossing', 3, 2)), 'out-of-bounds', 'Zebra crossing must line up with the road grid');
  });

  it('bulldozing it removes only the marking; its road cannot be repainted while it stands', () => {
    const state = makeState();
    roadBlocks(state, [0, 2], [2, 2], [4, 2]);
    object(state, 'zebra-crossing', 2, 2);
    const changes = expectOk(plan(state, bulldoze(3, 3)));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ layer: 'object', op: 'remove', object: { kind: 'zebra-crossing' } });
    expectFail(plan(state, paint('pavement', 2, 2)), 'occupied', 'Move the Zebra crossing first');
  });
});

describe('road features — the roundabout (6×6 cells = 3×3 road blocks, block aligned)', () => {
  const footprint = (x0: number, z0: number): string[] => {
    const keys: string[] = [];
    for (let z = z0; z < z0 + 6; z += 1) for (let x = x0; x < x0 + 6; x += 1) keys.push(`${x},${z}`);
    return keys;
  };
  const cellOf = (c: TownChange) => (c.layer === 'ground' ? `${c.cell.x},${c.cell.z}` : '');

  it('valid: on field it paints all 36 cells to road, and the object add is the last change', () => {
    const state = makeState();
    const context = ctx(0.99);
    const changes = expectOk(plan(state, placeObj('roundabout', 2, 2), context));
    expect(changes).toHaveLength(37);
    const groundChanges = changes.slice(0, 36);
    expect(groundChanges.every((c) => c.layer === 'ground' && c.before === 'field' && c.after === 'road')).toBe(true);
    expect(groundChanges.map(cellOf).sort()).toEqual(footprint(2, 2).sort());
    expect(changes[36]).toEqual({ layer: 'object', op: 'add', object: { id: 1001, kind: 'roundabout', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 } });
    expect([context.ids, context.draws]).toEqual([1, 0]);
  });

  it('valid: on mixed ground, `before` records each old kind', () => {
    const state = makeState();
    ground(state, 'grass', [2, 2]);
    ground(state, 'pavement', [7, 7]);
    const changes = expectOk(plan(state, placeObj('roundabout', 2, 2)));
    expect(changes.find((c) => cellOf(c) === '2,2')).toMatchObject({ before: 'grass', after: 'road' });
    expect(changes.find((c) => cellOf(c) === '7,7')).toMatchObject({ before: 'pavement', after: 'road' });
  });

  it('valid: on existing road only the non-road cells change; the add is still last', () => {
    const state = makeState();
    // Road blocks at (2..3, 2..3) and the whole middle row of blocks (2..7, 4..5): 4 + 12 = 16 cells.
    ground(state, 'road', [2, 2], [3, 2], [2, 3], [3, 3]);
    for (let x = 2; x < 8; x += 1) ground(state, 'road', [x, 4], [x, 5]);
    const changes = expectOk(plan(state, placeObj('roundabout', 2, 2)));
    expect(changes).toHaveLength(36 - 16 + 1);
    expect(changes.slice(0, -1).every((c) => c.layer === 'ground' && c.before !== 'road' && c.after === 'road')).toBe(true);
    expect(changes[changes.length - 1]).toMatchObject({ layer: 'object', op: 'add', object: { kind: 'roundabout' } });
  });

  it('valid: entirely on road → just the object add', () => {
    const state = makeState();
    for (const key of footprint(0, 0)) {
      const [x, z] = key.split(',').map(Number);
      ground(state, 'road', [x, z]);
    }
    expect(expectOk(plan(state, placeObj('roundabout', 0, 0)))).toEqual([
      { layer: 'object', op: 'add', object: { id: 1001, kind: 'roundabout', anchor: { x: 0, z: 0 }, rotation: 0, variant: 0 } },
    ]);
  });

  it('invalid: an anchor off the block grid (odd x or z) fails, no id or RNG consumed', () => {
    for (const [x, z] of [[1, 0], [0, 1], [1, 1]]) {
      const state = makeState();
      const context = ctx();
      expectFail(plan(state, placeObj('roundabout', x, z), context), 'out-of-bounds', 'Roundabout must line up with the road grid');
      expect(context.ids + context.draws).toBe(0);
    }
  });

  it('invalid: partly outside the plot → "Outside your plot"', () => {
    expectFail(plan(makeState(), placeObj('roundabout', 4, 0)), 'out-of-bounds', 'Outside your plot');
  });

  it('invalid: an object anywhere in the footprint → occupied', () => {
    const state = makeState();
    object(state, 'postbox', 7, 7);
    expectFail(plan(state, placeObj('roundabout', 2, 2)), 'occupied', 'Something is already here');
  });

  it('valid: removes fences inside the footprint and across its rim towards road, before the ground changes', () => {
    const state = makeState();
    ground(state, 'road', [0, 2], [1, 2], [0, 3], [1, 3]); // a road block west of the footprint
    const inside: Edge[] = [
      { x: 3, z: 2, side: 'w' }, // between two footprint cells
      { x: 5, z: 7, side: 'n' },
      { x: 2, z: 3, side: 'w' }, // rim towards the road block
    ];
    const kept: Edge[] = [
      { x: 2, z: 2, side: 'n' }, // rim towards field
      { x: 8, z: 4, side: 'w' }, // east plot border
    ];
    for (const edge of inside) fence(state, 'fence-low', edge);
    for (const edge of kept) fence(state, 'hedge', edge);
    const changes = expectOk(plan(state, placeObj('roundabout', 2, 2)));
    const removals = changes.filter((c) => c.layer === 'edge');
    expect(removals).toHaveLength(inside.length);
    expect(removals.map((c) => (c.layer === 'edge' ? c.placed.edge : null))).toEqual(expect.arrayContaining(inside));
    expect(removals.every((c) => c.layer === 'edge' && c.op === 'remove' && c.placed.kind === 'fence-low')).toBe(true);
    expect(changes.slice(0, inside.length).every((c) => c.layer === 'edge')).toBe(true);
    expect(changes[changes.length - 1].layer).toBe('object');
  });

  it('bulldozing any footprint cell turns the whole footprint to field, the object removal last', () => {
    for (const [x, z] of [[2, 2], [4, 4], [7, 7], [7, 2]]) {
      const state = makeState();
      state.applyChanges(expectOk(plan(state, placeObj('roundabout', 2, 2))));
      const changes = expectOk(plan(state, bulldoze(x, z)));
      expect(changes).toHaveLength(37);
      expect(changes.slice(0, 36).every((c) => c.layer === 'ground' && c.before === 'road' && c.after === 'field')).toBe(true);
      expect(changes.slice(0, 36).map(cellOf).sort()).toEqual(footprint(2, 2).sort());
      expect(changes[36]).toMatchObject({ layer: 'object', op: 'remove', object: { kind: 'roundabout', anchor: { x: 2, z: 2 } } });
    }
  });

  it('invalid: repainting a road cell under it → occupied "Move the Roundabout first"', () => {
    const state = makeState();
    state.applyChanges(expectOk(plan(state, placeObj('roundabout', 2, 2))));
    for (const kind of ['grass', 'meadow', 'pavement', 'walkway'] as const) {
      expectFail(plan(state, paint(kind, 4, 4)), 'occupied', 'Move the Roundabout first');
    }
    expectFail(plan(state, paint('road', 4, 4)), 'no-change', '');
  });

  it('invalid: fences across its (road) cells → blocked-by-road', () => {
    const state = makeState();
    state.applyChanges(expectOk(plan(state, placeObj('roundabout', 2, 2))));
    expectFail(plan(state, placeEdge('hedge', 4, 4, 'n')), 'blocked-by-road', "Fences can't cross roads");
  });

  it('TownEditor: place → bulldoze → undo → undo → redo → redo round-trips exact snapshots', () => {
    const editor = new TownEditor(new TownState(W, D), createGameBus(), createSeededRandom(1));
    ground(editor.state, 'grass', [0, 0]);
    fence(editor.state, 'fence-low', { x: 4, z: 4, side: 'n' });
    const empty = serializeTown(editor.state);
    expect(editor.apply(placeObj('roundabout', 2, 2), 'roundabout').ok).toBe(true);
    const placed = serializeTown(editor.state);
    expect(placed.objects.map((o) => o.kind)).toEqual(['roundabout']);
    expect(placed.edges).toEqual([]);
    expect(editor.state.stats().roadTiles).toBe(9);
    expect(editor.apply(bulldoze(5, 5), 'bulldoze').ok).toBe(true);
    const bulldozed = serializeTown(editor.state);
    expect(bulldozed.objects).toEqual([]);
    expect(bulldozed.ground).toEqual([['grass', 1], ['field', W * D - 1]]);
    editor.undo();
    expect(serializeTown(editor.state)).toEqual(placed);
    editor.undo();
    // Ids are never reused, so only the id counter differs from the starting town.
    expect(serializeTown(editor.state)).toEqual({ ...empty, nextObjectId: 2 });
    editor.redo();
    expect(serializeTown(editor.state)).toEqual(placed);
    editor.redo();
    expect(serializeTown(editor.state)).toEqual(bulldozed);
  });
});

// ---------------------------------------------------------------------------------------------
describe('multi-cell footprints (WP-12; WP-17 sizes: homes 4 × 4, townhouse 3 × 4, big house 5 × 4)', () => {
  it('invalid: a footprint partly out of bounds → out-of-bounds, on every side', () => {
    const state = makeState();
    expectFail(plan(state, placeObj('cottage', W - 3, 2)), 'out-of-bounds', 'Outside your plot');
    expectFail(plan(state, placeObj('cottage', 2, D - 3)), 'out-of-bounds', 'Outside your plot');
    expectFail(plan(state, placeObj('cottage', -1, 2)), 'out-of-bounds', 'Outside your plot');
    expectFail(plan(state, placeObj('cottage', 2, -1)), 'out-of-bounds', 'Outside your plot');
    expectFail(plan(state, placeObj('swing', 3, D - 1, 1)), 'out-of-bounds', 'Outside your plot');
    expectOk(plan(state, placeObj('cottage', W - 4, D - 4)));
  });

  it('plot-edge bounds of every WP-17 building, flush in each corner, at rotation 0 and 1', () => {
    const kinds = ['cottage', 'bungalow', 'family-home', 'garage-house', 'townhouse', 'big-house', 'corner-shop', 'supermarket', 'church'] as const;
    for (const kind of kinds) {
      for (const rotation of [0, 1] as const) {
        const [w, d] = rotatedFootprint(OBJECTS[kind].footprint, rotation);
        for (const [x, z] of [[0, 0], [W - w, 0], [0, D - d], [W - w, D - d]]) expectOk(plan(makeState(), placeObj(kind, x, z, rotation)));
        // One cell further out on either axis leaves the plot.
        expectFail(plan(makeState(), placeObj(kind, W - w + 1, 0, rotation)), 'out-of-bounds');
        expectFail(plan(makeState(), placeObj(kind, 0, D - d + 1, rotation)), 'out-of-bounds');
      }
    }
  });

  it('invalid: any footprint cell occupied → occupied', () => {
    const state = makeState();
    object(state, 'oak', 5, 5); // bottom-right cell of a 4×4 anchored at (2, 2)
    expectFail(plan(state, placeObj('family-home', 2, 2)), 'occupied', 'Something is already here');
    expectOk(plan(state, placeObj('family-home', 1, 1)));
    // Two houses may not overlap either.
    object(state, 'townhouse', 0, 0); // covers 0..2 × 0..3
    expectFail(plan(state, placeObj('cottage', 2, 3)), 'occupied');
    expectOk(plan(state, placeObj('corner-shop', 3, 0))); // 3 × 3 next to it: 3..5 × 0..2
  });

  it('invalid: any footprint cell on bad ground → blocked-by-road / needs-ground', () => {
    const state = makeState();
    ground(state, 'road', [4, 4]);
    expectFail(plan(state, placeObj('cottage', 2, 2)), 'blocked-by-road', "Cottage can't go on a road");
    const other = makeState();
    ground(other, 'walkway', [3, 4]);
    expectFail(plan(other, placeObj('townhouse', 2, 2)), 'needs-ground', 'Townhouse needs grass, meadow, pavement or open field');
  });

  it('rotation swaps the footprint: a 3×4 townhouse at rotation 1 occupies 4×3', () => {
    const state = makeState();
    const changes = expectOk(plan(state, placeObj('townhouse', 4, 5, 1)));
    state.applyChanges(changes);
    const id = changes[0].layer === 'object' ? changes[0].object.id : -1;
    for (let z = 5; z <= 7; z += 1) for (let x = 4; x <= 7; x += 1) expect(state.getObjectAt({ x, z })?.id, `${x},${z}`).toBe(id);
    expect(state.getObjectAt({ x: 4, z: 4 })).toBeUndefined();
    expect(state.getObjectAt({ x: 3, z: 5 })).toBeUndefined();
    // Rotation 0 would reach row 8 = out of bounds; rotation 1 fits.
    expectFail(plan(makeState(), placeObj('townhouse', 4, 5, 0)), 'out-of-bounds');
    expectOk(plan(makeState(), placeObj('townhouse', 4, 5, 3)));
  });

  it('rotation swaps the footprint: a 5×4 big house at rotation 1 occupies 4×5', () => {
    const state = makeState();
    const changes = expectOk(plan(state, placeObj('big-house', 4, 3, 1)));
    state.applyChanges(changes);
    const cells = [...Array(D).keys()].flatMap((z) => [...Array(W).keys()].map((x) => ({ x, z }))).filter((c) => state.getObjectAt(c));
    expect(cells).toHaveLength(20);
    expect(cells.every((c) => c.x >= 4 && c.x <= 7 && c.z >= 3 && c.z <= 7)).toBe(true);
    // At rotation 0 it is 5 wide: x 4..8 leaves the 8-wide plot.
    expectFail(plan(makeState(), placeObj('big-house', 4, 3, 0)), 'out-of-bounds');
    expectOk(plan(makeState(), placeObj('big-house', 3, 3, 2)));
    // The supermarket (also 5 × 4) behaves the same.
    expectOk(plan(makeState(), placeObj('supermarket', 4, 3, 1)));
    expectFail(plan(makeState(), placeObj('supermarket', 4, 3, 0)), 'out-of-bounds');
  });

  it('bulldozing any footprint cell removes the whole object', () => {
    for (const [x, z] of [[2, 2], [3, 3], [5, 5], [5, 2], [2, 5]]) {
      const state = makeState();
      const id = object(state, 'cottage', 2, 2);
      const changes = expectOk(plan(state, bulldoze(x, z)));
      expect(changes).toEqual([{ layer: 'object', op: 'remove', object: { id, kind: 'cottage', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 } }]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 6 — place-edge: in bounds, not between two roads; same ⇒ no-change; other ⇒ replace', () => {
  it('valid: interior edges of both sides add one fence', () => {
    const state = makeState();
    expect(expectOk(plan(state, placeEdge('fence-low', 3, 3, 'n')))).toEqual([
      { layer: 'edge', op: 'add', placed: { kind: 'fence-low', edge: { x: 3, z: 3, side: 'n' } } },
    ]);
    expectOk(plan(state, placeEdge('fence-tall', 3, 3, 'w')));
  });

  it('valid: plot border edges are allowed (all four borders)', () => {
    const state = makeState();
    expectOk(plan(state, placeEdge('fence-low', 0, 0, 'n'))); // north border
    expectOk(plan(state, placeEdge('fence-low', 2, D, 'n'))); // south border
    expectOk(plan(state, placeEdge('fence-low', 0, 2, 'w'))); // west border
    expectOk(plan(state, placeEdge('fence-low', W, 2, 'w'))); // east border
  });

  it('valid: between a road and a non-road cell, and on the border next to a road', () => {
    const state = makeState();
    ground(state, 'road', [3, 3], [0, 0]);
    expectOk(plan(state, placeEdge('fence-low', 3, 3, 'n')));
    expectOk(plan(state, placeEdge('fence-low', 0, 0, 'n')));
    expectOk(plan(state, placeEdge('fence-low', 0, 0, 'w')));
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
    expectFail(plan(state, placeEdge('fence-low', 3, 3, 'n')), 'blocked-by-road', "Fences can't cross roads");
    expectFail(plan(state, placeEdge('fence-tall', 4, 3, 'w')), 'blocked-by-road', "Fences can't cross roads");
  });

  it('invalid: same kind already there → silent no-change', () => {
    const state = makeState();
    fence(state, 'fence-low', { x: 3, z: 3, side: 'n' });
    expectFail(plan(state, placeEdge('fence-low', 3, 3, 'n')), 'no-change', '');
  });

  it('valid: other kind already there → [remove old, add new] (primary add last)', () => {
    const state = makeState();
    fence(state, 'fence-low', { x: 3, z: 3, side: 'n' });
    expect(expectOk(plan(state, placeEdge('fence-tall', 3, 3, 'n')))).toEqual([
      { layer: 'edge', op: 'remove', placed: { kind: 'fence-low', edge: { x: 3, z: 3, side: 'n' } } },
      { layer: 'edge', op: 'add', placed: { kind: 'fence-tall', edge: { x: 3, z: 3, side: 'n' } } },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('row 7 — bulldoze: object > picked fence edge > non-field ground', () => {
  it('valid: removes the object even if a fence and ground are also there', () => {
    const state = makeState();
    ground(state, 'grass', [2, 2]);
    const id = object(state, 'pine', 2, 2);
    fence(state, 'fence-low', { x: 2, z: 2, side: 'n' });
    const changes = expectOk(plan(state, bulldoze(2, 2, { x: 2, z: 2, side: 'n' })));
    expect(changes).toEqual([{ layer: 'object', op: 'remove', object: { id, kind: 'pine', anchor: { x: 2, z: 2 }, rotation: 0, variant: 0 } }]);
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
    fence(state, 'fence-low', { x: 0, z: 0, side: 'n' });
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
    fence(state, 'fence-low', { x: 5, z: 5, side: 'n' }); // a fence elsewhere doesn't count
    expectFail(plan(state, bulldoze(2, 2, { x: 2, z: 2, side: 'w' })), 'nothing-here', 'Nothing to remove');
  });

  it('invalid: out-of-plot cell with nothing picked → nothing-here', () => {
    const state = makeState();
    expectFail(plan(state, bulldoze(-1, 3)), 'nothing-here');
    expectFail(plan(state, bulldoze(W, D)), 'nothing-here');
  });
});

describe('move-object — the Move tool: the placing checks, ignoring the object itself; same id and variant', () => {
  const move = (id: number, x: number, z: number, rotation: Rotation = 0): BuildAction => ({ type: 'move-object', id, cell: { x, z }, rotation });

  it('valid: [remove old, add moved] with the same id and variant, the add last; no id or RNG consumed', () => {
    const state = makeState();
    const id = object(state, 'cottage', 0, 0);
    const context = ctx();
    const changes = expectOk(plan(state, move(id, 4, 4, 1), context));
    expect(changes).toEqual([
      { layer: 'object', op: 'remove', object: { id, kind: 'cottage', anchor: { x: 0, z: 0 }, rotation: 0, variant: 0 } },
      { layer: 'object', op: 'add', object: { id, kind: 'cottage', anchor: { x: 4, z: 4 }, rotation: 1, variant: 0 } },
    ]);
    expect(context.ids).toBe(0);
    expect(context.draws).toBe(0);
  });

  it('keeps a multi-variant object’s variant', () => {
    const state = makeState();
    const id = nextTestId++;
    state.applyChanges([{ layer: 'object', op: 'add', object: { id, kind: 'garage-house', anchor: { x: 0, z: 0 }, rotation: 0, variant: 3 } }]);
    const changes = expectOk(plan(state, move(id, 4, 0)));
    expect(changes[1]).toMatchObject({ op: 'add', object: { id, variant: 3, anchor: { x: 4, z: 0 } } });
  });

  it('valid: a one-cell shuffle onto its own old footprint, and a turn in place', () => {
    const state = makeState();
    const id = object(state, 'townhouse', 1, 1); // 3 × 4
    expectOk(plan(state, move(id, 2, 1)));
    expectOk(plan(state, move(id, 1, 1, 1))); // 4 × 3 now, still overlapping itself
  });

  it('invalid: onto another object → occupied; out of the plot → out-of-bounds (in that order)', () => {
    const state = makeState();
    const id = object(state, 'bench', 0, 0);
    object(state, 'cottage', 4, 4);
    expectFail(plan(state, move(id, 5, 5)), 'occupied', RULE_MESSAGES.occupied);
    expectFail(plan(state, move(id, W, 0)), 'out-of-bounds', RULE_MESSAGES.outOfBounds);
    const house = object(state, 'cottage', 0, 4);
    expectFail(plan(state, move(house, 6, 4)), 'out-of-bounds'); // 4 wide from x = 6 leaves the 8-wide plot
  });

  it('invalid: the ground rules of the kind still hold (a tree onto pavement, anything onto road)', () => {
    const state = makeState();
    const tree = object(state, 'oak', 0, 0);
    ground(state, 'pavement', [4, 4], [5, 4], [4, 5], [5, 5]);
    expectFail(plan(state, move(tree, 4, 4)), 'needs-ground', 'Oak needs grass, meadow or open field');
    const bench = object(state, 'bench', 2, 0);
    ground(state, 'road', [6, 6], [7, 6], [6, 7], [7, 7]);
    expectFail(plan(state, move(bench, 6, 6)), 'blocked-by-road', "Bench can't go on a road");
  });

  it('invalid: a bus stop moved away from the road → needs-ground with its message', () => {
    const state = makeState();
    ground(state, 'road', [0, 0], [1, 0], [0, 1], [1, 1]);
    const stop = object(state, 'bus-stop', 0, 2);
    expectOk(plan(state, move(stop, 2, 1)));
    expectFail(plan(state, move(stop, 4, 6)), 'needs-ground', RULE_MESSAGES.busStopNeedsRoad);
  });

  it('trees and plants keep their rotation (their look comes from their id); a tree turn alone is no change', () => {
    const state = makeState();
    const pine = object(state, 'pine', 0, 0, 2);
    expect(expectOk(plan(state, move(pine, 3, 3, 1)))[1]).toMatchObject({ object: { rotation: 2, anchor: { x: 3, z: 3 } } });
    expectFail(plan(state, move(pine, 0, 0, 1)), 'no-change', '');
  });

  it('invalid: roundabout and zebra crossing → cannot-move; unknown id → nothing-here; same spot → silent no-change', () => {
    const state = new TownState(12, 12);
    const roundabout = nextTestId++;
    state.applyChanges([{ layer: 'object', op: 'add', object: { id: roundabout, kind: 'roundabout', anchor: { x: 0, z: 0 }, rotation: 0, variant: 0 } }]);
    expectFail(plan(state, move(roundabout, 6, 6)), 'cannot-move', "Roundabout can't be moved");
    const zebra = nextTestId++;
    state.applyChanges([{ layer: 'object', op: 'add', object: { id: zebra, kind: 'zebra-crossing', anchor: { x: 8, z: 0 }, rotation: 0, variant: 0 } }]);
    expectFail(plan(state, move(zebra, 8, 2)), 'cannot-move', "Zebra crossing can't be moved");
    expectFail(plan(state, move(99_999, 1, 1)), 'nothing-here', RULE_MESSAGES.nothingToMove);
    const bench = object(state, 'bench', 8, 8, 1);
    expectFail(plan(state, move(bench, 8, 8, 1)), 'no-change', '');
  });
});
