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
 * Road features (the roundabout, parking lots; catalog ObjectDef.roadFeature) stand on road blocks and
 * draw them instead of the tiles. A neighbouring road block joins a feature only at one of its "arms":
 * the middle block of the feature's facing side (the roundabout), or any block of its front side when
 * arriving from straight in front (a parking lot), so a road running past doesn't tee into its kerb.
 * A road block that joins a car park (ObjectDef.plainJoin) draws a joint: its usual piece with no
 * centre line on the sides facing a lot (roadLook, catalog ROAD_JOINT_MODELS).
 */
import { ROAD_JOINT_MODELS, ROAD_PIECE_MODELS, ZEBRA_JOINT_MODELS, ZEBRA_PIECE_MODELS, type ModelId } from '../catalog/models';
import { objectDef, placedFootprint } from '../catalog/objects';
import { NEIGHBOURS, ROAD_BLOCK, roadBlockAnchor } from './grid';
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

/** NEIGHBOURS index of a feature's front side per rotation (front = +z = S at rotation 0, turning CCW). */
const FRONT_SIDE: readonly number[] = [2, 1, 0, 3];

const scratchBlock = { bx: 0, bz: 0, bw: 0, bd: 0 };

/** Feature block coordinates of `cell` and the feature's rotated size in blocks (a shared scratch). */
function featureBlock(feature: PlacedObject, cell: Cell): typeof scratchBlock {
  const [w, d] = placedFootprint(feature);
  const turned = feature.rotation % 2 === 1;
  scratchBlock.bx = Math.floor((cell.x - feature.anchor.x) / ROAD_BLOCK);
  scratchBlock.bz = Math.floor((cell.z - feature.anchor.z) / ROAD_BLOCK);
  scratchBlock.bw = (turned ? d : w) / ROAD_BLOCK;
  scratchBlock.bd = (turned ? w : d) / ROAD_BLOCK;
  return scratchBlock;
}

/**
 * Is the feature block containing `cell` the arm a road reaches when it arrives travelling in
 * direction `side` (NEIGHBOURS index of the step from the road block into the feature)? Side arms are
 * the middle blocks of each side (odd block counts; a 3 × 3-block roundabout has its arms at 1); front
 * arms are the blocks along the front side, entered from straight in front.
 */
export function isFeatureArm(feature: PlacedObject, cell: Cell, side: number): boolean {
  const { bx, bz, bw, bd } = featureBlock(feature, cell);
  if (objectDef(feature.kind).roadArms === 'front') {
    const front = FRONT_SIDE[feature.rotation];
    if (side !== (front + 2) % 4) return false;
    if (front === 0) return bz === 0;
    if (front === 1) return bx === bw - 1;
    if (front === 2) return bz === bd - 1;
    return bx === 0;
  }
  const northSouth = side === 0 || side === 2;
  return northSouth ? bx * 2 + 1 === bw : bz * 2 + 1 === bd;
}

/** Is `cell` in the centre block of the feature (the roundabout's island: no traffic)? */
export function isFeatureCentre(feature: PlacedObject, cell: Cell): boolean {
  const { bx, bz, bw, bd } = featureBlock(feature, cell);
  return bx * 2 + 1 === bw && bz * 2 + 1 === bd;
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

/** The bits of roadMask(state, cell) that join a car park's entrance (a plainJoin road feature). */
export function plainJoinMask(state: TownStateReader, cell: Cell): number {
  const anchor = roadBlockAnchor(cell, scratchAnchor);
  let mask = 0;
  for (let i = 0; i < 4; i += 1) {
    scratchNeighbour.x = anchor.x + NEIGHBOURS[i].x * ROAD_BLOCK;
    scratchNeighbour.z = anchor.z + NEIGHBOURS[i].z * ROAD_BLOCK;
    if (state.getGround(scratchNeighbour) !== 'road') continue;
    const feature = roadFeatureAt(state, scratchNeighbour);
    if (feature && objectDef(feature.kind).plainJoin && isFeatureArm(feature, scratchNeighbour, i)) mask |= 1 << i;
  }
  return mask;
}

/** Quarter turns that leave a piece's shape unchanged. */
const PIECE_SYMMETRY: Readonly<Record<RoadPiece, readonly number[]>> = {
  single: [0],
  end: [0],
  straight: [0, 2],
  corner: [0],
  tee: [0],
  cross: [0, 1, 2, 3],
};

/**
 * roadTileFor(mask) plus `plain`: the piece's sides at rotation 0 that face a lot (`plainMask`, a subset of
 * `mask`, in world sides). A symmetric piece takes the turn whose `plain` is smallest, so equivalent lot
 * sides share one joint model.
 */
export function roadJointFor(mask: number, plainMask: number): { piece: RoadPiece; rotation: Rotation; plain: number } {
  const tile = roadTileFor(mask);
  const plain = rotateMask(plainMask & mask & 15, (4 - tile.rotation) % 4);
  let best = { piece: tile.piece, rotation: tile.rotation, plain };
  for (const turn of PIECE_SYMMETRY[tile.piece]) {
    const turned = rotateMask(plain, turn);
    if (turned < best.plain) best = { piece: tile.piece, rotation: ((tile.rotation - turn + 4) % 4) as Rotation, plain: turned };
  }
  return best;
}

/** What a road block draws: its piece, the model (zebra and car-park joint variants included) and its turn. */
export interface RoadLook {
  piece: RoadPiece;
  model: ModelId;
  rotation: Rotation;
}

/** The road look of the block containing `cell`; `zebra` defaults to whether a zebra crossing stands on it. */
export function roadLook(state: TownStateReader, cell: Cell, zebra?: boolean): RoadLook {
  const mask = roadMask(state, cell);
  const tile = roadTileFor(mask);
  // Corners, ends and singles have no zebra variant and draw plain.
  const marked = (zebra ?? isMarked(state, cell)) && ZEBRA_PIECE_MODELS[tile.piece] !== undefined;
  const plain = plainJoinMask(state, cell);
  if (plain) {
    const joint = roadJointFor(mask, plain);
    const model = (marked ? ZEBRA_JOINT_MODELS : ROAD_JOINT_MODELS)[joint.piece]?.[joint.plain];
    if (model) return { piece: joint.piece, model, rotation: joint.rotation };
  }
  return { piece: tile.piece, model: (marked ? ZEBRA_PIECE_MODELS[tile.piece] : undefined) ?? ROAD_PIECE_MODELS[tile.piece], rotation: tile.rotation };
}

function isMarked(state: TownStateReader, cell: Cell): boolean {
  const object = state.getObjectAt(cell);
  return object !== undefined && objectDef(object.kind).roadMarking === true;
}

export { N, E, S, W };
