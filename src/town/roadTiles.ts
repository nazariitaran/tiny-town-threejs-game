/**
 * Road auto-tiling: which road piece + rotation to draw for a road BLOCK, given which of its
 * 4 neighbouring blocks are also road. Each block is one tile drawn at the block centre; tiling
 * runs on the block grid (neighbours ±ROAD_BLOCK cells from the block anchor).
 *
 * Mask bits follow grid.NEIGHBOURS order: N=1, E=2, S=4, W=8.
 * Canonical connections at rotation 0 (after the per-model rotationOffset in catalog/models.ts
 * has been applied, i.e. "front" = +z = south):
 *   straight: N+S · corner: E+S · tee: E+S+W · cross: all · end: S · single: none
 * Rotation r = r quarter turns counter-clockwise from above, which maps E→N, N→W, W→S, S→E.
 *
 * Road features (the roundabout, catalog ObjectDef.roadFeature) stand on road blocks and draw them
 * instead of the tiles. A neighbouring road block joins a feature only at the middle block of the
 * feature's facing side (its "arm"), so a road running past a roundabout doesn't tee into its kerb.
 */
import { objectDef } from '../catalog/objects';
import { NEIGHBOURS, ROAD_BLOCK, roadBlockAnchor, rotatedFootprint } from './grid';
import type { Cell, PlacedObject, Rotation, TownStateReader } from './types';

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

const scratchAnchor: Cell = { x: 0, z: 0 };
const scratchNeighbour: Cell = { x: 0, z: 0 };

/** The road feature (e.g. roundabout) standing on `cell`, if any. */
export function roadFeatureAt(state: TownStateReader, cell: Cell): PlacedObject | undefined {
  const object = state.getObjectAt(cell);
  return object && objectDef(object.kind).roadFeature ? object : undefined;
}

export const underRoadFeature = (state: TownStateReader, cell: Cell): boolean => roadFeatureAt(state, cell) !== undefined;

/**
 * Is the feature block containing `cell` the arm a road reaches when it arrives travelling in
 * direction `side` (NEIGHBOURS index of the step from the road block into the feature)? Arms are
 * the middle blocks of each side (odd block counts; a 3 × 3-block roundabout has its arms at 1).
 */
export function isFeatureArm(feature: PlacedObject, cell: Cell, side: number): boolean {
  const [w, d] = rotatedFootprint(objectDef(feature.kind).footprint, feature.rotation);
  const bx = Math.floor((cell.x - feature.anchor.x) / ROAD_BLOCK);
  const bz = Math.floor((cell.z - feature.anchor.z) / ROAD_BLOCK);
  const northSouth = side === 0 || side === 2;
  return northSouth ? bx * 2 + 1 === w / ROAD_BLOCK : bz * 2 + 1 === d / ROAD_BLOCK;
}

/** Is `cell` in the centre block of the feature (the roundabout's island: no traffic)? */
export function isFeatureCentre(feature: PlacedObject, cell: Cell): boolean {
  const [w, d] = rotatedFootprint(objectDef(feature.kind).footprint, feature.rotation);
  const bx = Math.floor((cell.x - feature.anchor.x) / ROAD_BLOCK);
  const bz = Math.floor((cell.z - feature.anchor.z) / ROAD_BLOCK);
  return bx * 2 + 1 === w / ROAD_BLOCK && bz * 2 + 1 === d / ROAD_BLOCK;
}

/** Connection mask of the road block containing `cell` (N=1, E=2, S=4, W=8 neighbouring blocks). */
export function roadMask(state: TownStateReader, cell: Cell): number {
  const anchor = roadBlockAnchor(cell, scratchAnchor);
  let mask = 0;
  for (let i = 0; i < 4; i += 1) {
    scratchNeighbour.x = anchor.x + NEIGHBOURS[i].x * ROAD_BLOCK;
    scratchNeighbour.z = anchor.z + NEIGHBOURS[i].z * ROAD_BLOCK;
    if (state.getGround(scratchNeighbour) !== 'road') continue;
    const feature = roadFeatureAt(state, scratchNeighbour);
    if (feature && !isFeatureArm(feature, scratchNeighbour, i)) continue;
    mask |= 1 << i;
  }
  return mask;
}

export function roadTileFor(mask: number): { piece: RoadPiece; rotation: Rotation } {
  return TABLE[mask & 15];
}

export { N, E, S, W };
