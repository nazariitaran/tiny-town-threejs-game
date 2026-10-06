import { describe, expect, it } from 'vitest';
import { findPonds, pondQuarter, pondQuarters, POND_QUARTERS } from './pondTiles';
import { TownState } from './TownState';
import type { Cell, Rotation } from './types';

/** A town with pond on every `#` of the picture (rows are z, columns x). */
function townFrom(picture: string[]): TownState {
  const town = new TownState(12, 12);
  picture.forEach((row, z) =>
    [...row].forEach((c, x) => {
      if (c === '#') town.applyChanges([{ layer: 'ground', cell: { x, z }, before: 'field', after: 'pond' }]);
    }),
  );
  return town;
}

/** Turn a point (x, z) by r quarter turns counter-clockwise from above, as three's makeRotationY does. */
function turn([x, z]: readonly [number, number], r: Rotation): [number, number] {
  let p: [number, number] = [x, z];
  for (let i = 0; i < r; i += 1) p = [p[1], -p[0]];
  return [Math.round(p[0]) + 0, Math.round(p[1]) + 0];
}

describe('pond auto-tiling', () => {
  it('a lone pond cell is four rounded corners, each turned onto its own quarter', () => {
    const town = townFrom(['', '.#']);
    const quarters = pondQuarters(town, { x: 1, z: 1 });
    expect(quarters.map((q) => q.piece)).toEqual(['outer', 'outer', 'outer', 'outer']);
    // The piece is made for the north-west quarter: its turn must carry NW (−1, −1) onto the quarter's corner.
    quarters.forEach((q, i) => expect(turn([-1, -1], q.rotation)).toEqual([...POND_QUARTERS[i]]));
  });

  it('edges face the land: the turn carries north onto the dry side', () => {
    // A 3 × 3 pond: the middle of each side is an edge on its outer quarters.
    const town = townFrom(['', '.###', '.###', '.###']);
    const north = pondQuarters(town, { x: 2, z: 1 });
    expect(north.map((q) => q.piece)).toEqual(['edge', 'edge', 'open', 'open']);
    for (const q of north.slice(0, 2)) expect(turn([0, -1], q.rotation)).toEqual([0, -1]);
    const west = pondQuarters(town, { x: 1, z: 2 });
    expect(west.map((q) => q.piece)).toEqual(['edge', 'open', 'open', 'edge']);
    for (const q of [west[0], west[3]]) expect(turn([0, -1], q.rotation)).toEqual([-1, 0]);
    const south = pondQuarters(town, { x: 2, z: 3 });
    for (const q of south.slice(2)) expect(turn([0, -1], q.rotation)).toEqual([0, 1]);
    const east = pondQuarters(town, { x: 3, z: 2 });
    for (const q of [east[1], east[2]]) expect(turn([0, -1], q.rotation)).toEqual([1, 0]);
    // The centre is open water all round.
    expect(pondQuarters(town, { x: 2, z: 2 }).map((q) => q.piece)).toEqual(['open', 'open', 'open', 'open']);
  });

  it('a dry diagonal makes an inner corner pointing at it', () => {
    // An L: the cell at (2, 2) has pond north and west but not north-west.
    const town = townFrom(['', '..#', '.##']);
    const cell: Cell = { x: 2, z: 2 };
    const q = pondQuarter(town, cell, 0);
    expect(q.piece).toBe('inner');
    expect(turn([-1, -1], q.rotation)).toEqual([-1, -1]);
  });

  it('the plot edge counts as land', () => {
    const town = townFrom(['##', '##']);
    expect(pondQuarters(town, { x: 0, z: 0 })[0].piece).toBe('outer');
  });

  it('finds ponds as 4-connected groups (a diagonal touch is two ponds)', () => {
    const town = townFrom(['##..#', '##...', '..#..']);
    const ponds = findPonds(town);
    expect(ponds.map((pond) => pond.length)).toEqual([4, 1, 1]);
    expect(ponds[0]).toEqual([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }]);
  });
});
