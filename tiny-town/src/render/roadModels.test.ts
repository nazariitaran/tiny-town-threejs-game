/**
 * Geometric proof that the road MODELS (catalog/models.ts rotationOffset + roadTiles rotation)
 * connect exactly the neighbours of every one of the 16 masks: a side is "open" when the road
 * surface (y ≤ 0.012, below the 0.02 kerb) reaches that cell edge on both sides of its middle and
 * nothing kerb-high stands in between. (v0.3: the zebra-crossing crossroad is one surface quad
 * across each arm, so it has no vertex exactly at the edge middle.)
 * Loads the real GLBs through GLTFLoader in Node (src/testing/gltfNode.ts).
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { MODELS, ROAD_PIECE_MODELS, type ModelId } from '../catalog/models';
import { createGlbLoader } from '../testing/gltfNode';
import { roadTileFor } from './roadTiles';

const points = new Map<ModelId, THREE.Vector3[]>();

beforeAll(async () => {
  const load = await createGlbLoader();
  for (const id of new Set(Object.values(ROAD_PIECE_MODELS))) {
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
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 1) list.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    });
    points.set(id, list);
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

describe('road models connect every mask', () => {
  it.each(Array.from({ length: 16 }, (_, mask) => mask))('mask %i', (mask) => {
    const { piece, rotation } = roadTileFor(mask);
    expect(openMask(ROAD_PIECE_MODELS[piece], rotation), `${piece} r${rotation}`).toBe(mask);
  });
});
