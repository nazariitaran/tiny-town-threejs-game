import { describe, expect, it } from 'vitest';
import { OBJECTS } from '../catalog/objects';
import { rotatedFootprint } from './grid';
import { TownState } from './TownState';
import type { Rotation, TownChange } from './types';
import { ROAD_JOINT_MODELS, ROAD_PIECE_MODELS, ZEBRA_JOINT_MODELS, ZEBRA_PIECE_MODELS } from '../catalog/models';
import { E, isFeatureArm, isFeatureCentre, N, plainJoinMask, roadFeatureAt, roadJointFor, roadLook, roadMask, roadTileFor, rotateMask, S, underRoadFeature, W } from './roadTiles';

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

describe('road auto-tiling next to a car park (front arms)', () => {
  /** 20 × 20 plot with a car park of `variant` anchored at (6, 6), turned `rotation`, standing on road. */
  function parkingTown(variant: number, rotation: Rotation): TownState {
    const town = new TownState(20, 20);
    const [w, d] = rotatedFootprint(OBJECTS.parking.footprints![variant], rotation);
    const changes: TownChange[] = [];
    for (let z = 6; z < 6 + d; z += 1) for (let x = 6; x < 6 + w; x += 1) changes.push({ layer: 'ground', cell: { x, z }, before: 'field', after: 'road' });
    changes.push({ layer: 'object', op: 'add', object: { id: 1, kind: 'parking', anchor: { x: 6, z: 6 }, rotation, variant } });
    town.applyChanges(changes);
    return town;
  }

  it('every road block in front of it joins it, from every side only the front, for every style and rotation', () => {
    for (let variant = 0; variant < OBJECTS.parking.variants; variant += 1) {
      for (const rotation of [0, 1, 2, 3] as const) {
        const [w, d] = rotatedFootprint(OBJECTS.parking.footprints![variant], rotation);
        // Front side: S at rotation 0, then E, N, W (quarter turns CCW from above).
        const front = (['S', 'E', 'N', 'W'] as const)[rotation];
        const around: Array<{ x: number; z: number; side: 'N' | 'E' | 'S' | 'W'; bit: number }> = [];
        for (let x = 6; x < 6 + w; x += 2) around.push({ x, z: 4, side: 'N', bit: S }, { x, z: 6 + d, side: 'S', bit: N });
        for (let z = 6; z < 6 + d; z += 2) around.push({ x: 4, z, side: 'W', bit: E }, { x: 6 + w, z, side: 'E', bit: W });
        for (const block of around) {
          const town = parkingTown(variant, rotation);
          town.applyChanges([0, 1].flatMap((dz) => [0, 1].map((dx): TownChange => ({ layer: 'ground', cell: { x: block.x + dx, z: block.z + dz }, before: 'field', after: 'road' }))));
          const expected = block.side === front ? block.bit : 0;
          expect(roadMask(town, block), `style ${variant} r${rotation} ${block.side} of the lot at ${block.x},${block.z}`).toBe(expected);
        }
      }
    }
  });

  it('a street along its front tees into each front block; arms are entered only from straight in front', () => {
    const town = parkingTown(1, 0); // medium, 4 × 4 cells on 6..9 × 6..9, front to the south
    for (let x = 2; x < 16; x += 2) town.applyChanges([0, 1].flatMap((dz) => [0, 1].map((dx): TownChange => ({ layer: 'ground', cell: { x: x + dx, z: 10 + dz }, before: 'field', after: 'road' }))));
    expect(roadMask(town, { x: 4, z: 10 })).toBe(E | W);
    expect(roadMask(town, { x: 6, z: 10 })).toBe(N | E | W);
    expect(roadMask(town, { x: 8, z: 10 })).toBe(N | E | W);
    expect(roadMask(town, { x: 10, z: 10 })).toBe(E | W);
    const lot = roadFeatureAt(town, { x: 7, z: 9 })!;
    expect(lot.kind).toBe('parking');
    expect(isFeatureArm(lot, { x: 6, z: 8 }, 0)).toBe(true); // front-left block, entered northwards
    expect(isFeatureArm(lot, { x: 6, z: 8 }, 1)).toBe(false); // the same block from the west
    expect(isFeatureArm(lot, { x: 6, z: 6 }, 0)).toBe(false); // the back row
    expect(isFeatureCentre(lot, { x: 7, z: 7 })).toBe(false);
  });
});

describe('car-park joints (plainJoin)', () => {
  const road = (x: number, z: number): TownChange[] =>
    [0, 1].flatMap((dz) => [0, 1].map((dx): TownChange => ({ layer: 'ground', cell: { x: x + dx, z: z + dz }, before: 'field', after: 'road' })));

  function lotTown(variant: number, rotation: Rotation, anchor = { x: 6, z: 6 }, town = new TownState(24, 24), id = 1): TownState {
    const [w, d] = rotatedFootprint(OBJECTS.parking.footprints![variant], rotation);
    const changes: TownChange[] = [];
    for (let z = anchor.z; z < anchor.z + d; z += 1) for (let x = anchor.x; x < anchor.x + w; x += 1) changes.push({ layer: 'ground', cell: { x, z }, before: town.getGround({ x, z }), after: 'road' });
    changes.push({ layer: 'object', op: 'add', object: { id, kind: 'parking', anchor, rotation, variant } });
    town.applyChanges(changes);
    return town;
  }

  it('picks a joint model for every piece and set of lot sides (symmetric pieces share one)', () => {
    const used = new Set<string>();
    for (let mask = 1; mask < 16; mask += 1) {
      for (let plain = mask; plain > 0; plain = (plain - 1) & mask) {
        const joint = roadJointFor(mask, plain);
        expect(joint.piece).toBe(roadTileFor(mask).piece);
        expect(rotateMask(joint.plain, joint.rotation), `mask ${mask} lots ${plain}`).toBe(plain);
        const id = ROAD_JOINT_MODELS[joint.piece]?.[joint.plain];
        expect(id, `mask ${mask} lots ${plain}`).toBeDefined();
        used.add(id!);
      }
    }
    // Every joint model is reachable.
    expect(used).toEqual(new Set(Object.values(ROAD_JOINT_MODELS).flatMap((byLots) => Object.values(byLots))));
    expect(roadJointFor(E | W, 0)).toEqual({ ...roadTileFor(E | W), plain: 0 });
  });

  it('the road in front of each front block draws a joint facing the lot, for every size and rotation', () => {
    for (let variant = 0; variant < OBJECTS.parking.variants; variant += 1) {
      for (const rotation of [0, 1, 2, 3] as const) {
        const [w, d] = rotatedFootprint(OBJECTS.parking.footprints![variant], rotation);
        // In front: S of the lot at rotation 0, then E, N, W; the bit points from the road block back at the lot.
        const front = [
          { cells: Array.from({ length: w / 2 }, (_, i) => ({ x: 6 + i * 2, z: 6 + d })), bit: N },
          { cells: Array.from({ length: d / 2 }, (_, i) => ({ x: 6 + w, z: 6 + i * 2 })), bit: W },
          { cells: Array.from({ length: w / 2 }, (_, i) => ({ x: 6 + i * 2, z: 4 })), bit: S },
          { cells: Array.from({ length: d / 2 }, (_, i) => ({ x: 4, z: 6 + i * 2 })), bit: E },
        ][rotation];
        const town = lotTown(variant, rotation);
        town.applyChanges(front.cells.flatMap((c) => road(c.x, c.z)));
        for (const cell of front.cells) {
          const label = `style ${variant} r${rotation} block ${cell.x},${cell.z}`;
          expect(plainJoinMask(town, cell), label).toBe(front.bit);
          const look = roadLook(town, cell);
          const joint = roadJointFor(roadMask(town, cell), front.bit);
          expect(look, label).toEqual({ piece: joint.piece, model: ROAD_JOINT_MODELS[joint.piece]![joint.plain], rotation: joint.rotation });
        }
      }
    }
  });

  it('a street running past tees into the lot without a centre line; the blocks beside it stay plain straights', () => {
    const town = lotTown(1, 0); // medium on 6..9 × 6..9, front to the south
    for (let x = 2; x < 16; x += 2) town.applyChanges(road(x, 10));
    for (const x of [6, 8]) expect(roadLook(town, { x, z: 10 })).toEqual({ piece: 'tee', model: 'road-joint-tee-s', rotation: 2 });
    for (const x of [4, 10]) expect(roadLook(town, { x, z: 10 })).toEqual({ piece: 'straight', model: 'road-straight', rotation: 1 });
    // A road arriving head-on ends in the entrance, and a dead end facing it loses its line too.
    const headOn = lotTown(1, 0);
    headOn.applyChanges([...road(6, 10), ...road(6, 12)]);
    expect(roadLook(headOn, { x: 6, z: 10 })).toMatchObject({ piece: 'straight', model: 'road-joint-straight-n' });
    const stub = lotTown(1, 0);
    stub.applyChanges(road(8, 10));
    expect(roadLook(stub, { x: 8, z: 10 })).toMatchObject({ piece: 'end', model: 'road-joint-end-s' });
  });

  it('two lots facing each other across a street: the street loses both lines there', () => {
    const town = lotTown(0, 0, { x: 6, z: 6 }); // small, 4 × 2 on rows 6..7, front south
    lotTown(0, 2, { x: 6, z: 10 }, town, 2); // small turned to face north, rows 10..11
    town.applyChanges([2, 4, 6, 8, 10, 12].flatMap((x) => road(x, 8)));
    for (const x of [6, 8]) {
      expect(plainJoinMask(town, { x, z: 8 })).toBe(N | S);
      expect(roadLook(town, { x, z: 8 })).toMatchObject({ piece: 'cross', model: 'road-joint-cross-ns' });
    }
  });

  it('a zebra next to a lot: the straight drops its line, the tee keeps its zebra; the roundabout never makes joints', () => {
    const town = lotTown(1, 0);
    town.applyChanges([...road(6, 10), ...road(6, 12)]);
    town.applyChanges([{ layer: 'object', op: 'add', object: { id: 9, kind: 'zebra-crossing', anchor: { x: 6, z: 10 }, rotation: 0, variant: 0 } }]);
    expect(roadLook(town, { x: 6, z: 10 })).toMatchObject({ piece: 'straight', model: ZEBRA_JOINT_MODELS.straight![1] });
    const tee = lotTown(1, 0);
    for (let x = 2; x < 16; x += 2) tee.applyChanges(road(x, 10));
    expect(roadLook(tee, { x: 6, z: 10 }, true)).toEqual({ piece: 'tee', model: ZEBRA_PIECE_MODELS.tee, rotation: 2 });

    const roundabout = new TownState(16, 16);
    const changes: TownChange[] = [];
    for (let z = 4; z < 10; z += 1) for (let x = 4; x < 10; x += 1) changes.push({ layer: 'ground', cell: { x, z }, before: 'field', after: 'road' });
    changes.push({ layer: 'object', op: 'add', object: { id: 1, kind: 'roundabout', anchor: { x: 4, z: 4 }, rotation: 0, variant: 0 } });
    roundabout.applyChanges([...changes, ...road(6, 10)]);
    expect(roadMask(roundabout, { x: 6, z: 10 })).toBe(N);
    expect(plainJoinMask(roundabout, { x: 6, z: 10 })).toBe(0);
    expect(roadLook(roundabout, { x: 6, z: 10 }).model).toBe(ROAD_PIECE_MODELS.end);
  });

  it('removing the lot gives the street its usual piece back', () => {
    const town = lotTown(1, 0);
    for (let x = 2; x < 16; x += 2) town.applyChanges(road(x, 10));
    const lot = roadFeatureAt(town, { x: 6, z: 6 })!;
    town.applyChanges([{ layer: 'object', op: 'remove', object: lot }]);
    expect(roadLook(town, { x: 6, z: 10 }).model).not.toMatch(/joint/);
  });
});
