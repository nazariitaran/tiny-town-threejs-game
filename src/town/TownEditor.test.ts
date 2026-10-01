import { describe, expect, it } from 'vitest';
import { edgeToWorld, footprintCentreWorld, PLOT_DEPTH, PLOT_WIDTH, roadBlockCentreWorld } from '../game/config';
import { createGameBus, type GameBus, type GameEvents } from '../game/events';
import { createSeededRandom } from '../utils/random';
import { buildSampleTown } from './sampleTown';
import { parseSave, serializeTown } from './serialize';
import { DEFAULT_TOWN_NAME } from './townName';
import { TownEditor } from './TownEditor';
import { TownState } from './TownState';
import type { BuildAction, Cell } from './types';

type Recorded = { [K in keyof GameEvents]: { type: K; payload: GameEvents[K] } }[keyof GameEvents];

function setup(seed = 1) {
  const bus = createGameBus();
  const editor = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), bus, createSeededRandom(seed));
  const events = record(bus);
  return { bus, editor, events };
}

function record(bus: GameBus) {
  const log: Recorded[] = [];
  const types = ['town:changed', 'build:placed', 'build:removed', 'history:changed', 'town:named'] as const;
  for (const type of types) bus.on(type, (payload: unknown) => void log.push({ type, payload } as Recorded));
  return {
    log,
    of: <K extends keyof GameEvents>(type: K) => log.filter((e) => e.type === type).map((e) => e.payload as GameEvents[K]),
    clear: () => (log.length = 0),
  };
}

const snapshot = (editor: TownEditor) => serializeTown(editor.state);
const road = (x: number, z: number): BuildAction => ({ type: 'paint-ground', kind: 'road', cell: { x, z } });

/** A 50-block snake-shaped road drag (one cell per 2 × 2 block) over three free rows south of the centred sample town. */
function fiftyCellStroke(editor: TownEditor): number {
  const cells: Cell[] = [];
  for (let x = 0; x < 48; x += 2) cells.push({ x, z: 58 });
  for (let x = 46; x >= 0; x -= 2) cells.push({ x, z: 60 });
  cells.push({ x: 0, z: 62 }, { x: 2, z: 62 });
  expect(cells).toHaveLength(50);
  editor.beginStroke();
  let applied = 0;
  for (const cell of cells) if (editor.apply(road(cell.x, cell.z), 'road').ok) applied += 1;
  editor.endStroke();
  return applied;
}

describe('TownEditor strokes and history', () => {
  it('undo of a 50-cell drag stroke restores a deep-equal snapshot; redo re-applies it', () => {
    const { editor } = setup();
    buildSampleTown(editor);
    const before = snapshot(editor);
    const applied = fiftyCellStroke(editor);
    expect(applied).toBe(50);
    const after = snapshot(editor);
    expect(after).not.toEqual(before);
    expect(editor.history.undoDepth).toBe(2); // sample town + the stroke

    editor.undo();
    expect(snapshot(editor)).toEqual(before);
    editor.redo();
    expect(snapshot(editor)).toEqual(after);
  });

  it('a pure 50-cell stroke on an empty plot undoes to empty and redoes all 50', () => {
    const { editor } = setup();
    const empty = snapshot(editor);
    editor.beginStroke();
    for (let i = 0; i < 50; i += 1) expect(editor.apply({ type: 'paint-ground', kind: 'grass', cell: { x: i % PLOT_WIDTH, z: Math.floor(i / PLOT_WIDTH) } }, 'grass').ok).toBe(true);
    editor.endStroke();
    const full = snapshot(editor);
    expect(editor.state.stats()).toMatchObject({ roadTiles: 0 });
    expect(editor.history.undoDepth).toBe(1);
    editor.undo();
    expect(snapshot(editor)).toEqual(empty);
    editor.redo();
    expect(snapshot(editor)).toEqual(full);
  });

  it('apply inside a stroke emits history:changed once (at endStroke), not per cell', () => {
    const { editor, events } = setup();
    editor.beginStroke();
    for (let x = 0; x < 10; x += 1) editor.apply(road(x * 2, 0), 'road');
    expect(events.of('history:changed')).toHaveLength(0);
    expect(events.of('town:changed')).toHaveLength(10);
    expect(events.of('build:placed').map((e) => e.strokeIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    editor.endStroke();
    expect(events.of('history:changed')).toEqual([{ canUndo: true, canRedo: false }]);
  });

  it('apply outside a stroke is its own undo entry and emits history:changed', () => {
    const { editor, events } = setup();
    editor.apply(road(1, 1), 'road');
    editor.apply(road(2, 1), 'road');
    expect(editor.history.undoDepth).toBe(2);
    expect(events.of('history:changed')).toHaveLength(2);
  });

  it('rejected actions change nothing and emit nothing', () => {
    const { editor, events } = setup();
    const r = editor.apply({ type: 'bulldoze', cell: { x: 1, z: 1 }, edge: null }, 'bulldoze');
    expect(r.ok).toBe(false);
    expect(events.log).toHaveLength(0);
    expect(editor.history.undoDepth).toBe(0);
  });

  it('beginStroke while a stroke is open commits the open one instead of dropping it', () => {
    const { editor } = setup();
    editor.beginStroke();
    editor.apply(road(1, 1), 'road');
    editor.beginStroke();
    editor.apply(road(2, 1), 'road');
    editor.endStroke();
    expect(editor.history.undoDepth).toBe(2);
    editor.undo();
    editor.undo();
    expect(editor.state.stats().roadTiles).toBe(0);
  });

  it('undo mid-stroke closes the stroke first', () => {
    const { editor } = setup();
    editor.beginStroke();
    editor.apply(road(1, 1), 'road');
    editor.apply(road(2, 1), 'road');
    editor.undo();
    expect(editor.inStroke).toBe(false);
    expect(editor.state.stats().roadTiles).toBe(0);
  });

  it('undo/redo reproduce placement variants exactly', () => {
    const { editor } = setup(42);
    editor.beginStroke();
    for (let x = 0; x < 12; x += 1) editor.apply({ type: 'place-object', kind: 'birch', cell: { x, z: 3 }, rotation: 0 }, 'birch');
    editor.endStroke();
    const variants = [...editor.state.objects()].map((o) => o.variant);
    expect(new Set(variants).size).toBe(2); // both birch variants appear with this seed
    editor.undo();
    editor.redo();
    expect([...editor.state.objects()].map((o) => o.variant)).toEqual(variants);
  });

  it('town:changed carries cause edit/undo/redo', () => {
    const { editor, events } = setup();
    editor.apply(road(1, 1), 'road');
    editor.undo();
    editor.redo();
    expect(events.of('town:changed').map((e) => e.cause)).toEqual(['edit', 'undo', 'redo']);
  });
});

describe('TownEditor road paint removes the in-between fence', () => {
  it('removes it in the same change list, emits a ground build event at the block centre, and undo restores it', () => {
    const { editor, events } = setup();
    editor.apply(road(2, 2), 'road'); // block 2..3 × 2..3
    editor.apply({ type: 'place-edge', kind: 'fence-tall', edge: { x: 4, z: 2, side: 'w' } }, 'fence-tall');
    const before = snapshot(editor);
    events.clear();

    const result = editor.apply(road(5, 3), 'road'); // block 4..5 × 2..3
    expect(result.ok && result.changes.map((c) => c.layer)).toEqual(['edge', 'ground', 'ground', 'ground', 'ground']);
    expect(editor.state.getEdge({ x: 4, z: 2, side: 'w' })).toBeUndefined();
    expect(editor.state.stats().roadTiles).toBe(2);
    const placed = events.of('build:placed');
    const world = roadBlockCentreWorld({ x: 5, z: 3 });
    expect(placed).toEqual([{ toolId: 'road', layer: 'ground', cell: { x: 5, z: 3 }, worldX: world.x, worldZ: world.z, strokeIndex: 0 }]);

    editor.undo();
    expect(editor.state.getEdge({ x: 4, z: 2, side: 'w' })).toEqual({ kind: 'fence-tall', edge: { x: 4, z: 2, side: 'w' } });
    expect(snapshot(editor)).toEqual(before);
    editor.redo();
    expect(editor.state.getEdge({ x: 4, z: 2, side: 'w' })).toBeUndefined();
  });

  it('multi-cell objects report their footprint centre in build:placed / build:removed', () => {
    const { editor, events } = setup();
    editor.apply({ type: 'place-object', kind: 'townhouse', cell: { x: 10, z: 10 }, rotation: 1 }, 'townhouse');
    // A 3 × 4 townhouse at rotation 1 covers 4 × 3 cells (x 10..13, z 10..12); bulldoze its far corner.
    editor.apply({ type: 'bulldoze', cell: { x: 13, z: 12 }, edge: null }, 'bulldoze');
    const centre = footprintCentreWorld({ x: 10, z: 10 }, [3, 4], 1);
    expect(centre.x).toBeCloseTo(footprintCentreWorld({ x: 10, z: 10 }, [1, 1], 0).x + 1.5 * 0.5, 6);
    expect(events.of('build:placed')[0]).toMatchObject({ cell: { x: 10, z: 10 }, worldX: centre.x, worldZ: centre.z });
    expect(events.of('build:removed')[0]).toMatchObject({ layer: 'object', kind: 'townhouse', cell: { x: 13, z: 12 }, worldX: centre.x, worldZ: centre.z });
  });
});

describe('TownEditor build events derive from the primary (last) change', () => {
  it('fence replace emits one build:placed on the edge midpoint', () => {
    const { editor, events } = setup();
    const edge = { x: 4, z: 4, side: 'n' as const };
    editor.apply({ type: 'place-edge', kind: 'fence-low', edge }, 'fence-low');
    events.clear();
    editor.apply({ type: 'place-edge', kind: 'fence-tall', edge }, 'fence-tall');
    const w = edgeToWorld(edge);
    expect(events.of('build:placed')).toEqual([{ toolId: 'fence-tall', layer: 'edge', cell: { x: 4, z: 4 }, worldX: w.x, worldZ: w.z, strokeIndex: 0 }]);
  });

  it('bulldoze emits build:removed with the removed kind for each layer', () => {
    const { editor, events } = setup();
    editor.apply({ type: 'paint-ground', kind: 'grass', cell: { x: 1, z: 1 } }, 'grass');
    editor.apply({ type: 'place-object', kind: 'cottage', cell: { x: 1, z: 1 }, rotation: 0 }, 'cottage');
    editor.apply({ type: 'place-edge', kind: 'fence-low', edge: { x: 1, z: 1, side: 'w' } }, 'fence-low');
    events.clear();
    editor.beginStroke();
    for (let i = 0; i < 3; i += 1) editor.apply({ type: 'bulldoze', cell: { x: 1, z: 1 }, edge: { x: 1, z: 1, side: 'w' } }, 'bulldoze');
    editor.endStroke();
    expect(events.of('build:removed').map((e) => [e.layer, e.kind, e.strokeIndex])).toEqual([
      ['object', 'cottage', 0],
      ['edge', 'fence-low', 1],
      ['ground', 'grass', 2],
    ]);
  });
});

describe('TownEditor.applyBatch', () => {
  const items = [
    { toolId: 'road' as const, action: road(1, 1) },
    { toolId: 'road' as const, action: road(1, 1) }, // no-change → rejected
    { toolId: 'postbox' as const, action: { type: 'place-object', kind: 'postbox', cell: { x: 2, z: 1 }, rotation: 0 } as BuildAction },
  ];

  it('silent: one town:changed, one history entry, no build:* events', () => {
    const { editor, events } = setup();
    const result = editor.applyBatch(items, { silent: true });
    expect(result.applied).toBe(2);
    expect(result.rejected).toEqual([{ index: 1, item: items[1], reason: 'no-change', message: '' }]);
    expect(result.changes).toHaveLength(5); // a 4-cell road block + the postbox
    expect(events.of('town:changed')).toHaveLength(1);
    expect(events.of('town:changed')[0]).toEqual({ changes: result.changes, cause: 'edit' });
    expect(events.of('history:changed')).toHaveLength(1);
    expect(events.of('build:placed')).toHaveLength(0);
    expect(editor.history.undoDepth).toBe(1);
    editor.undo();
    expect(editor.state.stats()).toMatchObject({ roadTiles: 0, props: 0 });
  });

  it('not silent: one build:placed per applied item with increasing strokeIndex', () => {
    const { editor, events } = setup();
    editor.applyBatch(items);
    expect(events.of('build:placed').map((e) => [e.toolId, e.strokeIndex])).toEqual([
      ['road', 0],
      ['postbox', 1],
    ]);
  });

  it('inside an open stroke it joins the stroke (single undo entry, history at endStroke)', () => {
    const { editor, events } = setup();
    editor.beginStroke();
    editor.apply(road(5, 5), 'road');
    editor.applyBatch([{ toolId: 'road', action: road(6, 5) }], { silent: true });
    expect(events.of('history:changed')).toHaveLength(0);
    editor.endStroke();
    expect(editor.history.undoDepth).toBe(1);
  });

  it('a batch where nothing applies emits nothing and adds no history', () => {
    const { editor, events } = setup();
    const result = editor.applyBatch([{ toolId: 'bulldoze', action: { type: 'bulldoze', cell: { x: 0, z: 0 }, edge: null } }], { silent: true });
    expect(result.applied).toBe(0);
    expect(events.log).toHaveLength(0);
    expect(editor.history.undoDepth).toBe(0);
  });
});

describe('TownEditor.preview', () => {
  it('never mutates state, consumes no object id and no RNG', () => {
    const rngCalls: number[] = [];
    const base = createSeededRandom(3);
    const editor = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), () => {
      const v = base();
      rngCalls.push(v);
      return v;
    });
    const nextId = editor.state.nextObjectId;
    const result = editor.preview({ type: 'place-object', kind: 'birch', cell: { x: 3, z: 3 }, rotation: 1 });
    expect(result.ok).toBe(true);
    expect(editor.state.nextObjectId).toBe(nextId);
    expect(rngCalls).toHaveLength(0);
    expect([...editor.state.objects()]).toHaveLength(0);
  });
});

describe('TownEditor.reset and load', () => {
  it('reset empties the plot, clears history, restarts ids and emits cause reset', () => {
    const { editor, events } = setup();
    buildSampleTown(editor);
    events.clear();
    editor.reset();
    expect(snapshot(editor)).toEqual(serializeTown(new TownState(PLOT_WIDTH, PLOT_DEPTH)));
    expect(editor.history.undoDepth).toBe(0);
    expect(editor.state.nextObjectId).toBe(1);
    expect(events.of('town:changed').map((e) => e.cause)).toEqual(['reset']);
    expect(events.of('history:changed')).toEqual([{ canUndo: false, canRedo: false }]);
  });

  it('demo towns rebuild id-for-id after reset (deterministic states)', () => {
    const a = setup(9).editor;
    buildSampleTown(a);
    const first = snapshot(a);
    a.reset();
    // Same seed → same variants; ids restart at 1.
    const b = setup(9).editor;
    buildSampleTown(b);
    expect(snapshot(b)).toEqual(first);
  });

  it('load replaces the town: cause load, full change list (remove old, add new), history cleared', () => {
    const source = setup(5).editor;
    buildSampleTown(source);
    const save = snapshot(source);

    const { editor, events } = setup(6);
    editor.apply(road(0, 0), 'road');
    editor.apply({ type: 'place-object', kind: 'lamppost', cell: { x: 23, z: 23 }, rotation: 0 }, 'lamppost');
    events.clear();
    editor.load(save);

    expect(snapshot(editor)).toEqual(save);
    expect(editor.history.undoDepth).toBe(0);
    expect(editor.history.redoDepth).toBe(0);
    const changed = events.of('town:changed');
    expect(changed).toHaveLength(1);
    expect(changed[0].cause).toBe('load');
    const { changes } = changed[0];
    expect(changes[0]).toMatchObject({ layer: 'object', op: 'remove' });
    const addedObjects = changes.filter((c) => c.layer === 'object' && c.op === 'add').length;
    const addedEdges = changes.filter((c) => c.layer === 'edge' && c.op === 'add').length;
    expect(addedObjects).toBe(save.objects.length);
    expect(addedEdges).toBe(save.edges.length);
    expect(events.of('build:placed')).toHaveLength(0);
    expect(events.of('history:changed')).toEqual([{ canUndo: false, canRedo: false }]);
  });

  it('after load, new objects continue from the saved nextObjectId', () => {
    const source = setup().editor;
    buildSampleTown(source);
    const save = snapshot(source);
    const { editor } = setup();
    editor.load(save);
    const r = editor.apply({ type: 'place-object', kind: 'oak', cell: { x: 0, z: 23 }, rotation: 0 }, 'oak');
    expect(r.ok && r.changes[0].layer === 'object' && r.changes[0].object.id).toBe(save.nextObjectId);
  });

  it('load rejects a save for another plot size (must go through parseSave)', () => {
    const { editor } = setup();
    const save = serializeTown(new TownState(10, 10));
    expect(() => editor.load(save)).toThrow(/parseSave/);
  });
});

describe('TownEditor name', () => {
  it('starts as the default name and reset(name) names the new town', () => {
    const { editor, events } = setup();
    expect(editor.name).toBe(DEFAULT_TOWN_NAME);
    editor.reset('  Puddleton ');
    expect(editor.name).toBe('Puddleton');
    expect(events.of('town:named')).toEqual([{ name: 'Puddleton', cause: 'reset' }]);
    // A blank name (or none) gives the default.
    editor.reset('   ');
    expect(editor.name).toBe(DEFAULT_TOWN_NAME);
    editor.reset('Bumbleford');
    editor.reset();
    expect(editor.name).toBe(DEFAULT_TOWN_NAME);
  });

  it('rename sanitises, ignores blank or unchanged names, and is not undoable', () => {
    const { editor, events } = setup();
    buildSampleTown(editor);
    const depth = editor.history.undoDepth;
    events.clear();
    expect(editor.rename(' Muffin   Heath ')).toBe(true);
    expect(editor.name).toBe('Muffin Heath');
    expect(editor.rename('Muffin Heath')).toBe(false);
    expect(editor.rename(' \t ')).toBe(false);
    expect(editor.rename('y'.repeat(35))).toBe(true);
    expect(editor.name).toBe('y'.repeat(30));
    expect(events.of('town:named')).toEqual([
      { name: 'Muffin Heath', cause: 'rename' },
      { name: 'y'.repeat(30), cause: 'rename' },
    ]);
    expect(events.of('town:changed')).toEqual([]);
    expect(editor.history.undoDepth).toBe(depth);
  });

  it('the name is saved and loaded; a save without one loads as the default', () => {
    const { editor } = setup();
    buildSampleTown(editor);
    editor.rename('Teacup Green');
    const saved = ok(parseSave(JSON.stringify(editor.serialize())));
    expect(saved.name).toBe('Teacup Green');

    const other = setup(3);
    other.editor.load(saved);
    expect(other.editor.name).toBe('Teacup Green');
    expect(other.events.of('town:named')).toEqual([{ name: 'Teacup Green', cause: 'load' }]);

    const { name: _dropped, ...unnamed } = saved;
    other.editor.load(unnamed);
    expect(other.editor.name).toBe(DEFAULT_TOWN_NAME);
  });
});

function ok<T>(result: T | Error): T {
  if (result instanceof Error) throw result;
  return result;
}

describe('stats after the sample town', () => {
  it('match hand-computed values', () => {
    const { editor } = setup();
    buildSampleTown(editor);
    // Homes: cottage ×2 (2 residents), townhouse ×2 (3), bungalow (2), family home (4), suburban home (4),
    // big house (5) → 8 homes, 25 residents. Amenities: corner shop, donut shop, supermarket, church,
    // fountain, tiered fountain, pool = 7.
    // Trees: oak ×2, pine ×2, birch = 5 (bushes are plants, counted as props).
    // Road blocks: main street x 4..43 (20) + side street z 8..23 (8) + z 26..41 (8) = 36, plus the
    // roundabout's 3 × 3 blocks (x 20..25, z 22..27) that were not road yet: 2 north + 2 south = 40.
    // Props: street (2 traffic lights, 4 lampposts, postbox, mailbox, bus stop = 9) + garden (2 benches,
    // 2 long benches, table, barbecue, swing, slide, planter = 9) + plants (2 bushes, 3 tulips) = 23.
    // Fences (edge layer): 14 low (x 6..19) + 6 hedge (z 13..18) + 8 tall (z 27..34) = 28.
    expect(editor.state.stats()).toEqual({ homes: 8, residents: 25, amenities: 7, trees: 5, roadTiles: 40, props: 23, fences: 28 });
  });
});

describe('TownEditor — moving an object (Move tool)', () => {
  it('is one undo entry; undo puts it back and redo moves it again; the id never changes', () => {
    const { editor, events } = setup();
    expect(editor.apply({ type: 'place-object', kind: 'cottage', cell: { x: 10, z: 10 }, rotation: 0 }, 'cottage').ok).toBe(true);
    const placed = [...editor.state.objects()][0];
    const before = snapshot(editor);
    const depth = editor.history.undoDepth;
    events.clear();

    expect(editor.preview({ type: 'move-object', id: placed.id, cell: { x: 20, z: 12 }, rotation: 1 }).ok).toBe(true);
    expect(snapshot(editor)).toEqual(before); // preview never mutates

    expect(editor.apply({ type: 'move-object', id: placed.id, cell: { x: 20, z: 12 }, rotation: 1 }, 'cottage').ok).toBe(true);
    expect(editor.history.undoDepth).toBe(depth + 1);
    expect(editor.state.getObject(placed.id)).toEqual({ ...placed, anchor: { x: 20, z: 12 }, rotation: 1 });
    expect(editor.state.getObjectAt({ x: 10, z: 10 })).toBeUndefined();
    expect([...editor.state.objects()]).toHaveLength(1);
    const moved = snapshot(editor);

    // The drop plays the item's own place sound and dust, at the new footprint's centre.
    const centre = footprintCentreWorld({ x: 20, z: 12 }, [4, 4], 1);
    expect(events.of('build:placed')).toEqual([{ toolId: 'cottage', layer: 'object', cell: { x: 20, z: 12 }, worldX: centre.x, worldZ: centre.z, strokeIndex: 0 }]);
    expect(events.of('build:removed')).toEqual([]);

    editor.undo();
    expect(snapshot(editor)).toEqual(before);
    expect(editor.state.getObject(placed.id)).toEqual(placed);
    editor.redo();
    expect(snapshot(editor)).toEqual(moved);
  });
});
