/**
 * Checks that the road models (rotationOffset + roadTiles rotation) connect exactly the neighbours
 * of every one of the 16 masks: a side is "open" when the road surface (y ≤ 0.012, below the 0.02
 * kerb) reaches that cell edge on both sides of its middle and nothing kerb-high stands in between.
 * Both sides, not the middle: the zebra crossroad is one surface quad per arm, with no vertex there.
 * Car-park joints must connect like their piece and keep its centre line except towards the lot.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { MODELS, ROAD_JOINT_MODELS, ROAD_PIECE_MODELS, ZEBRA_JOINT_MODELS, ZEBRA_PIECE_MODELS, type ModelId } from '../catalog/models';
import { createGlbLoader } from '../testing/gltfNode';
import { roadJointFor, roadTileFor, rotateMask } from '../town/roadTiles';

const points = new Map<ModelId, THREE.Vector3[]>();
/** Vertices of the atlas's lane-paint texel. */
const paint = new Map<ModelId, THREE.Vector3[]>();
/** colormap.png lane paint, glTF UV (v down). */
const PAINT_UV = [0.40625, 0.875] as const;

const JOINTS = [ROAD_JOINT_MODELS, ZEBRA_JOINT_MODELS].flatMap((table) => Object.values(table).flatMap((byLots) => Object.values(byLots)));

beforeAll(async () => {
  const load = await createGlbLoader();
  for (const id of new Set([...Object.values(ROAD_PIECE_MODELS), 'road-crossing' as const, ...JOINTS])) {
    const spec = MODELS[id];
    const gltf = await load(spec.url);
    // Same normalisation as ModelLibrary.normalise.
    const root = new THREE.Group();
    root.add(gltf.scene);
    gltf.scene.scale.setScalar(spec.scale);
    gltf.scene.rotation.y = (spec.rotationOffset * Math.PI) / 2;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const centre = box.getCenter(new THREE.Vector3());
    gltf.scene.position.set(-centre.x, -box.min.y, -centre.z);
    root.updateMatrixWorld(true);
    const list: THREE.Vector3[] = [];
    const painted: THREE.Vector3[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      const uv = mesh.geometry.getAttribute('uv');
      for (let i = 0; i < pos.count; i += 1) {
        const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        list.push(p);
        if (Math.abs(uv.getX(i) - PAINT_UV[0]) < 2e-3 && Math.abs(uv.getY(i) - PAINT_UV[1]) < 2e-3) painted.push(p);
      }
    });
    points.set(id, list);
    paint.set(id, painted);
  }
}, 60_000);

/** Open sides (N=1, E=2, S=4, W=8) of a model after `rotation` quarter turns CCW. */
function openMask(id: ModelId, rotation: number): number {
  const turn = new THREE.Matrix4().makeRotationY((rotation * Math.PI) / 2);
  const sides: Array<[number, number, number]> = [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]];
  // Per side: highest vertex across the middle (|along| < 0.35), and whether low surface vertices
  // reach the edge left and right of the middle.
  const maxY = new Map<number, number>();
  const lowLeft = new Set<number>();
  const lowRight = new Set<number>();
  const v = new THREE.Vector3();
  for (const p of points.get(id)!) {
    v.copy(p).applyMatrix4(turn);
    for (const [bit, dx, dz] of sides) {
      const across = dx ? v.x * dx : v.z * dz;
      const along = dx ? v.z : v.x;
      if (across <= 0.45 || Math.abs(along) >= 0.35) continue;
      maxY.set(bit, Math.max(maxY.get(bit) ?? -1, v.y));
      if (v.y <= 0.012 && along <= 0) lowLeft.add(bit);
      if (v.y <= 0.012 && along >= 0) lowRight.add(bit);
    }
  }
  let mask = 0;
  for (const [bit, y] of maxY) if (y <= 0.012 && lowLeft.has(bit) && lowRight.has(bit)) mask |= bit;
  return mask;
}

/** Sides (N=1, E=2, S=4, W=8) along which a 0.02-wide centre line runs out past the junction, after `rotation` quarter turns. */
function centreLineSides(id: ModelId, rotation: number): number {
  const turn = new THREE.Matrix4().makeRotationY((rotation * Math.PI) / 2);
  const sides: Array<[number, number, number]> = [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]];
  const v = new THREE.Vector3();
  let mask = 0;
  for (const p of paint.get(id)!) {
    v.copy(p).applyMatrix4(turn);
    for (const [bit, dx, dz] of sides) {
      const along = dx ? v.x * dx : v.z * dz;
      const across = dx ? v.z : v.x;
      if (Math.abs(across) <= 0.0105 && along > 0.05) mask |= bit;
    }
  }
  return mask;
}

describe('car-park joints', () => {
  it.each(Array.from({ length: 15 }, (_, i) => i + 1))('mask %i: every set of lot sides has a joint that connects like the piece and drops only those centre lines', (mask) => {
    const tile = roadTileFor(mask);
    const base = centreLineSides(ROAD_PIECE_MODELS[tile.piece], tile.rotation);
    expect(base, `${tile.piece} has its centre lines`).toBe(mask);
    for (let plain = mask; plain > 0; plain = (plain - 1) & mask) {
      const joint = roadJointFor(mask, plain);
      expect(joint.piece).toBe(tile.piece);
      expect(rotateMask(joint.plain, joint.rotation), `plain ${plain}`).toBe(plain);
      const id = ROAD_JOINT_MODELS[joint.piece]?.[joint.plain];
      expect(id, `${joint.piece} lots ${joint.plain}`).toBeDefined();
      expect(openMask(id!, joint.rotation), `${id} r${joint.rotation} connects`).toBe(mask);
      expect(centreLineSides(id!, joint.rotation), `${id} r${joint.rotation} lines`).toBe(mask & ~plain);
    }
  });

  it('the zebra straight beside a lot keeps its stripes and loses the centre line towards it', () => {
    for (const mask of [1 | 4, 2 | 8]) {
      const tile = roadTileFor(mask);
      for (let plain = mask; plain > 0; plain = (plain - 1) & mask) {
        const joint = roadJointFor(mask, plain);
        const id = ZEBRA_JOINT_MODELS.straight![joint.plain];
        expect(openMask(id, joint.rotation)).toBe(mask);
        expect(centreLineSides(id, joint.rotation)).toBe(centreLineSides(ZEBRA_PIECE_MODELS.straight!, tile.rotation) & ~plain);
        // Stripes and edge lines stay: only centre-line paint changes.
        const lost = paint.get(ZEBRA_PIECE_MODELS.straight!)!.length - paint.get(id)!.length;
        expect(lost).toBeLessThanOrEqual(8);
      }
    }
  });
});

describe('road models connect every mask', () => {
  it.each(Array.from({ length: 16 }, (_, mask) => mask))('mask %i', (mask) => {
    const { piece, rotation } = roadTileFor(mask);
    expect(openMask(ROAD_PIECE_MODELS[piece], rotation), `${piece} r${rotation}`).toBe(mask);
  });
});
