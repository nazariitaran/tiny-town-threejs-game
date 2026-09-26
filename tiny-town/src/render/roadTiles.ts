/**
 * Road auto-tiling: which road piece + rotation to draw for a cell, given which of its
 * 4 neighbours are also road. PURE (tested in roadTiles.test.ts).
 *
 * Mask bits follow grid.NEIGHBOURS order: N=1, E=2, S=4, W=8.
 * Canonical connections at rotation 0 (after the per-model rotationOffset in catalog/models.ts
 * has been applied, i.e. "front" = +z = south):
 *   straight: N+S · corner: E+S · tee: E+S+W · cross: all · end: S · single: none
 * Rotation r = r quarter turns counter-clockwise from above, which maps E→N, N→W, W→S, S→E.
 */
import { NEIGHBOURS } from '../town/grid';
import type { Cell, Rotation, TownStateReader } from '../town/types';

export type RoadPiece = 'straight' | 'corner' | 'tee' | 'cross' | 'end' | 'single';

const N = 1;
const E = 2;
const S = 4;
const W = 8;

const CANONICAL: ReadonlyArray<[RoadPiece, number]> = [
  ['single', 0],
  ['end', S],
  ['straight', N | S],
  ['corner', E | S],
  ['tee', E | S | W],
  ['cross', N | E | S | W],
];

/** Rotate a mask r quarter turns CCW (bit i moves to bit (i + 3) % 4 per turn). */
export function rotateMask(mask: number, r: number): number {
  let out = mask;
  for (let t = 0; t < r; t += 1) {
    let next = 0;
    for (let i = 0; i < 4; i += 1) if (out & (1 << i)) next |= 1 << ((i + 3) % 4);
    out = next;
  }
  return out;
}

const TABLE: ReadonlyArray<{ piece: RoadPiece; rotation: Rotation }> = Array.from({ length: 16 }, (_, mask) => {
  for (const [piece, canonical] of CANONICAL) {
    for (let r = 0; r < 4; r += 1) {
      if (rotateMask(canonical, r) === mask) return { piece, rotation: r as Rotation };
    }
  }
  throw new Error(`No road piece for mask ${mask}`);
});

export function roadMask(state: TownStateReader, cell: Cell): number {
  let mask = 0;
  NEIGHBOURS.forEach((offset, i) => {
    if (state.getGround({ x: cell.x + offset.x, z: cell.z + offset.z }) === 'road') mask |= 1 << i;
  });
  return mask;
}

export function roadTileFor(mask: number): { piece: RoadPiece; rotation: Rotation } {
  return TABLE[mask & 15];
}

export { N, E, S, W };
