import { describe, expect, it } from 'vitest';
import { TownState } from '../town/TownState';
import type { TownChange } from '../town/types';
import { E, N, S, W, roadMask, roadTileFor, rotateMask } from './roadTiles';

describe('road auto-tiling', () => {
  it('rotates masks counter-clockwise (E→N, S→E)', () => {
    expect(rotateMask(E, 1)).toBe(N);
    expect(rotateMask(S, 1)).toBe(E);
    expect(rotateMask(N | S, 1)).toBe(E | W);
    expect(rotateMask(E | S, 4)).toBe(E | S);
  });

  it('maps every one of the 16 masks to a piece', () => {
    for (let mask = 0; mask < 16; mask += 1) {
      const { piece, rotation } = roadTileFor(mask);
      expect(piece).toBeTruthy();
      expect(rotation).toBeGreaterThanOrEqual(0);
    }
  });

  it('picks the expected pieces', () => {
    expect(roadTileFor(0).piece).toBe('single');
    expect(roadTileFor(N | S)).toEqual({ piece: 'straight', rotation: 0 });
    expect(roadTileFor(E | W)).toEqual({ piece: 'straight', rotation: 1 });
    expect(roadTileFor(E | S)).toEqual({ piece: 'corner', rotation: 0 });
    expect(roadTileFor(N | E)).toEqual({ piece: 'corner', rotation: 1 });
    expect(roadTileFor(N | E | S | W).piece).toBe('cross');
    expect(roadTileFor(N | E | W)).toEqual({ piece: 'tee', rotation: 2 });
    expect(roadTileFor(W)).toEqual({ piece: 'end', rotation: 3 });
  });

  it('computes masks on the 2 × 2 road-block grid (any cell of a block gives the block mask)', () => {
    const town = new TownState(12, 12);
    const block = (bx: number, bz: number): TownChange[] =>
      [0, 1].flatMap((dz) => [0, 1].map((dx): TownChange => ({ layer: 'ground', cell: { x: bx * 2 + dx, z: bz * 2 + dz }, before: 'field', after: 'road' })));
    // A T: centre block (2, 2) with blocks west, east and south.
    town.applyChanges([...block(2, 2), ...block(1, 2), ...block(3, 2), ...block(2, 3)]);
    for (const [x, z] of [[4, 4], [5, 4], [4, 5], [5, 5]]) expect(roadMask(town, { x, z })).toBe(E | S | W);
    expect(roadMask(town, { x: 2, z: 4 })).toBe(E);
    expect(roadMask(town, { x: 7, z: 5 })).toBe(W);
    expect(roadMask(town, { x: 5, z: 7 })).toBe(N);
    // A single road CELL next to a block does not count (only block anchors are read).
    town.applyChanges([{ layer: 'ground', cell: { x: 5, z: 3 }, before: 'field', after: 'road' }]);
    expect(roadMask(town, { x: 4, z: 4 })).toBe(E | S | W);
  });
});
