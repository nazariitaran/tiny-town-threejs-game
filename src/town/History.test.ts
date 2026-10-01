import { describe, expect, it } from 'vitest';
import { History, HISTORY_LIMIT, invertChanges } from './History';
import type { TownChange } from './types';

const g = (x: number, before: 'field' | 'grass' = 'field', after: 'field' | 'grass' = 'grass'): TownChange => ({
  layer: 'ground',
  cell: { x, z: 0 },
  before,
  after,
});

describe('invertChanges', () => {
  it('inverts every layer and reverses the order', () => {
    const changes: TownChange[] = [
      { layer: 'edge', op: 'remove', placed: { kind: 'fence-low', edge: { x: 1, z: 1, side: 'n' } } },
      { layer: 'object', op: 'add', object: { id: 7, kind: 'postbox', anchor: { x: 1, z: 1 }, rotation: 2, variant: 0 } },
      { layer: 'ground', cell: { x: 1, z: 1 }, before: 'field', after: 'road' },
    ];
    expect(invertChanges(changes)).toEqual([
      { layer: 'ground', cell: { x: 1, z: 1 }, before: 'road', after: 'field' },
      { layer: 'object', op: 'remove', object: { id: 7, kind: 'postbox', anchor: { x: 1, z: 1 }, rotation: 2, variant: 0 } },
      { layer: 'edge', op: 'add', placed: { kind: 'fence-low', edge: { x: 1, z: 1, side: 'n' } } },
    ]);
  });

  it('is an involution', () => {
    const changes = [g(1), g(2, 'grass', 'field')];
    expect(invertChanges(invertChanges(changes))).toEqual(changes);
  });
});

describe('History', () => {
  it('starts empty', () => {
    const h = new History();
    expect([h.canUndo, h.canRedo, h.undoDepth, h.redoDepth]).toEqual([false, false, 0, 0]);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it('ignores empty entries', () => {
    const h = new History();
    h.push([]);
    expect(h.undoDepth).toBe(0);
  });

  it('undo returns the inverse, redo the original, moving the entry between stacks', () => {
    const h = new History();
    h.push([g(1), g(2)]);
    expect(h.undo()).toEqual([g(2, 'grass', 'field'), g(1, 'grass', 'field')]);
    expect([h.undoDepth, h.redoDepth]).toEqual([0, 1]);
    expect(h.redo()).toEqual([g(1), g(2)]);
    expect([h.undoDepth, h.redoDepth]).toEqual([1, 0]);
  });

  it('a new push clears the redo stack', () => {
    const h = new History();
    h.push([g(1)]);
    h.undo();
    h.push([g(2)]);
    expect(h.canRedo).toBe(false);
    expect(h.undoDepth).toBe(1);
  });

  it('stores a copy of the pushed list', () => {
    const h = new History();
    const list = [g(1)];
    h.push(list);
    list.push(g(2));
    expect(h.undo()).toHaveLength(1);
  });

  it(`caps at ${HISTORY_LIMIT} entries, dropping the oldest`, () => {
    expect(HISTORY_LIMIT).toBe(200);
    const h = new History();
    for (let i = 0; i < 250; i += 1) h.push([g(i)]);
    expect(h.undoDepth).toBe(200);
    let last: TownChange[] | null = null;
    let count = 0;
    for (let entry = h.undo(); entry; entry = h.undo()) {
      last = entry;
      count += 1;
    }
    expect(count).toBe(200);
    // The oldest surviving entry is push #50.
    expect(last).toEqual([g(50, 'grass', 'field')]);
  });

  it('clear() empties both stacks', () => {
    const h = new History();
    h.push([g(1)]);
    h.push([g(2)]);
    h.undo();
    h.clear();
    expect([h.canUndo, h.canRedo]).toEqual([false, false]);
  });
});
