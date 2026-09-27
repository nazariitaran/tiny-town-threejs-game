import { describe, expect, it } from 'vitest';
import { TownState } from '../town/TownState';
import type { TownChange } from '../town/types';
import { E, isFeatureArm, isFeatureCentre, N, roadFeatureAt, roadMask, roadTileFor, rotateMask, S, underRoadFeature, W } from './roadTiles';

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

describe('road auto-tiling next to a roundabout (road feature)', () => {
  /** 16 × 16 plot with a roundabout on cells 4..9 × 4..9 (road blocks 2..4 × 2..4), standing on road. */
  function roundaboutTown(): TownState {
    const town = new TownState(16, 16);
    const changes: TownChange[] = [];
    for (let z = 4; z < 10; z += 1) for (let x = 4; x < 10; x += 1) changes.push({ layer: 'ground', cell: { x, z }, before: 'field', after: 'road' });
    changes.push({ layer: 'object', op: 'add', object: { id: 1, kind: 'roundabout', anchor: { x: 4, z: 4 }, rotation: 0, variant: 0 } });
    town.applyChanges(changes);
    return town;
  }
  const roadBlock = (town: TownState, bx: number, bz: number) =>
    town.applyChanges([0, 1].flatMap((dz) => [0, 1].map((dx): TownChange => ({ layer: 'ground', cell: { x: bx * 2 + dx, z: bz * 2 + dz }, before: 'field', after: 'road' }))));

  it('a road block facing the middle ("arm") block of any side joins the roundabout', () => {
    // [block beside the arm, the bit pointing into the roundabout]
    for (const [bx, bz, bit] of [[3, 1, S], [5, 3, W], [3, 5, N], [1, 3, E]] as const) {
      const town = roundaboutTown();
      roadBlock(town, bx, bz);
      expect(roadMask(town, { x: bx * 2, z: bz * 2 }), `block ${bx},${bz}`).toBe(bit);
    }
  });

  it('a road block beside a roundabout corner block does not join it', () => {
    // Beside the corner blocks (2, 2), (4, 2), (2, 4) and (4, 4), from each outer side.
    for (const [bx, bz] of [[2, 1], [1, 2], [4, 1], [5, 2], [1, 4], [2, 5], [5, 4], [4, 5]] as const) {
      const town = roundaboutTown();
      roadBlock(town, bx, bz);
      expect(roadMask(town, { x: bx * 2, z: bz * 2 }), `block ${bx},${bz}`).toBe(0);
    }
  });

  it('a street running past the roundabout stays straight and only tees at the arm', () => {
    const town = roundaboutTown();
    for (let bz = 1; bz <= 5; bz += 1) roadBlock(town, 1, bz); // the column of blocks just west of it
    expect(roadMask(town, { x: 2, z: 4 })).toBe(N | S); // beside the north-west corner
    expect(roadMask(town, { x: 2, z: 6 })).toBe(N | E | S); // beside the west arm
    expect(roadMask(town, { x: 2, z: 8 })).toBe(N | S); // beside the south-west corner
  });

  it('finds the feature on every footprint cell and classifies centre and arm blocks', () => {
    const town = roundaboutTown();
    const feature = roadFeatureAt(town, { x: 9, z: 9 })!;
    expect(feature.kind).toBe('roundabout');
    expect(underRoadFeature(town, { x: 4, z: 4 })).toBe(true);
    expect(underRoadFeature(town, { x: 10, z: 4 })).toBe(false);
    expect(isFeatureCentre(feature, { x: 6, z: 6 })).toBe(true);
    expect(isFeatureCentre(feature, { x: 7, z: 7 })).toBe(true);
    expect(isFeatureCentre(feature, { x: 4, z: 6 })).toBe(false);
    expect(isFeatureArm(feature, { x: 6, z: 4 }, 2)).toBe(true); // north arm, entered southwards
    expect(isFeatureArm(feature, { x: 4, z: 4 }, 2)).toBe(false); // north-west corner
    expect(isFeatureArm(feature, { x: 4, z: 6 }, 1)).toBe(true); // west arm, entered eastwards
  });
});
