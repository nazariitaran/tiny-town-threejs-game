/**
 * Instanced ring of distant trees, bushes and rocks around the plot, built once models are loaded.
 * One InstancedMesh per model part (the decor models are single-part colour-atlas meshes, so this is
 * 4 draw calls). Placement is deterministic (fixed seed + noise groves), never inside the plot or
 * its clear margin, and sits on the terrain height field.
 *
 * WP-04 (World & look).
 */
import * as THREE from 'three';
import type { ModelId } from '../catalog/models';
import type { QualityTier } from '../game/config';
import type { ModelLibrary } from '../render/ModelLibrary';
import { createSeededRandom } from '../utils/random';
import { PLOT_HALF_X, PLOT_HALF_Z, distanceToPlot, fbm, terrainHeight } from './terrainShape';

type DecorId = Extract<ModelId, 'tree-a' | 'tree-b' | 'decor-bush' | 'decor-rocks'>;

export interface DecorInstance {
  model: DecorId;
  x: number;
  z: number;
  y: number;
  scale: number;
  rotation: number;
}

const DECOR_SEED = 0x7a11e;
/**
 * Instance caps per model (triangle budget: tree-a 408, tree-b 204, bush 108, rocks 100 tris,
 * so the full ring is ≈ 70k triangles).
 */
const DECOR_BUDGET: Readonly<Record<DecorId, number>> = {
  'tree-a': 80,
  'tree-b': 150,
  'decor-bush': 70,
  'decor-rocks': 40,
};
/** Clear meadow margin between the plot edge and the first decor (world units). */
export const DECOR_CLEAR_MARGIN = 3.2;
/** Outer edge of the framing band that hugs the plot. */
const FRAME_BAND = 7.5;
/**
 * Inner radius of the forest belt. The title camera orbits at ~33 units from the centre, so the
 * band between the framing ring and the belt stays open meadow (no trees filling the lens).
 */
const BELT_INNER = 46;
const BELT_OUTER = 105;

/** Deterministic placement (pure: no three.js objects created). Sorted by distance: nearest first. */
export function planDecor(): DecorInstance[] {
  const rng = createSeededRandom(DECOR_SEED);
  const out: DecorInstance[] = [];
  const spacing: Array<[number, number, number]> = [];
  const remaining: Record<DecorId, number> = { ...DECOR_BUDGET };
  const fits = (x: number, z: number, radius: number): boolean => {
    for (const [px, pz, pr] of spacing) {
      const min = radius + pr;
      if ((px - x) ** 2 + (pz - z) ** 2 < min * min) return false;
    }
    return true;
  };
  const place = (model: DecorId, x: number, z: number, scale: number): void => {
    if (remaining[model] <= 0) return;
    const isTree = model === 'tree-a' || model === 'tree-b';
    const footprint = (isTree ? 0.3 : 0.22) * scale;
    if (!fits(x, z, footprint)) return;
    spacing.push([x, z, footprint]);
    remaining[model] -= 1;
    out.push({ model, x, z, y: terrainHeight(x, z) - 0.04, scale, rotation: rng() * Math.PI * 2 });
  };
  const pick = (weights: Array<[DecorId, number]>): DecorId => {
    let k = rng() * weights.reduce((sum, [, w]) => sum + w, 0);
    for (const [id, w] of weights) {
      k -= w;
      if (k <= 0) return id;
    }
    return weights[weights.length - 1][0];
  };
  const bushOrRockScale = (model: DecorId): number => (model === 'decor-rocks' ? 1.2 + rng() * 1.3 : 1.9 + rng() * 0.9);

  // 1. Framing band: small clumps of bushes, rocks and house-sized trees hugging the plot.
  for (let i = 0; i < 700; i += 1) {
    const side = rng() * 4;
    const along = rng() * 2 - 1;
    const out_ = DECOR_CLEAR_MARGIN + rng() * (FRAME_BAND - DECOR_CLEAR_MARGIN);
    const edgeX = PLOT_HALF_X + out_;
    const edgeZ = PLOT_HALF_Z + out_;
    const [x, z] =
      side < 1 ? [along * edgeX, edgeZ] : side < 2 ? [along * edgeX, -edgeZ] : side < 3 ? [edgeX, along * edgeZ] : [-edgeX, along * edgeZ];
    if (distanceToPlot(x, z) < DECOR_CLEAR_MARGIN) continue;
    if (fbm(x * 0.13 + 4.1, z * 0.13 - 2.6, 2, 3) < 0.5) continue;
    const model = pick([['decor-bush', 5], ['tree-a', 2.5], ['tree-b', 1.5], ['decor-rocks', 1]]);
    const isTree = model === 'tree-a' || model === 'tree-b';
    place(model, x, z, isTree ? 1.25 + rng() * 0.6 : bushOrRockScale(model));
  }

  // 2. Open meadow between the frame and the belt: the odd rock or bush.
  for (let i = 0; i < 260; i += 1) {
    const a = rng() * Math.PI * 2;
    const r = 18 + rng() * (BELT_INNER - 18);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (distanceToPlot(x, z) < FRAME_BAND + 1) continue;
    if (rng() > 0.25) continue;
    const model = pick([['decor-rocks', 1], ['decor-bush', 1]]);
    place(model, x, z, bushOrRockScale(model));
  }

  // 3. Forest belt: noise groves of round trees and pines, larger with distance for silhouette.
  for (let i = 0; i < 9000; i += 1) {
    const a = rng() * Math.PI * 2;
    const r = BELT_INNER + rng() * (BELT_OUTER - BELT_INNER);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const grove = fbm(x * 0.03 + 1.7, z * 0.03 - 6.2, 3, 7);
    if (grove < 0.5) continue;
    const far = (r - BELT_INNER) / (BELT_OUTER - BELT_INNER);
    const model: DecorId =
      grove > 0.56 ? pick([['tree-b', 3], ['tree-a', 2]]) : pick([['tree-a', 3], ['tree-b', 1], ['decor-bush', 1.5], ['decor-rocks', 0.5]]);
    const isTree = model === 'tree-a' || model === 'tree-b';
    place(model, x, z, isTree ? (1.9 + rng() * 0.9) * (1 + far * 0.7) : bushOrRockScale(model) * 1.5);
  }

  out.sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
  return out;
}

const DECOR_MODELS: readonly DecorId[] = ['tree-a', 'tree-b', 'decor-bush', 'decor-rocks'];

export class DecorRing {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** Instance count per mesh at full quality (low tier draws a nearest-first prefix). */
  private readonly fullCounts: number[] = [];
  private tier: QualityTier = 'high';

  constructor() {
    this.group.name = 'decor-ring';
  }

  get instanceCount(): number {
    return this.meshes.reduce((sum, mesh) => sum + mesh.count, 0);
  }

  populate(library: ModelLibrary): void {
    this.clear();
    const plan = planDecor();
    const instance = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const matrix = new THREE.Matrix4();

    for (const id of DECOR_MODELS) {
      if (!library.has(id)) continue;
      const items = plan.filter((p) => p.model === id);
      if (items.length === 0) continue;
      for (const part of library.get(id).parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.name = `decor:${id}`;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        items.forEach((item, index) => {
          position.set(item.x, item.y, item.z);
          rotation.setFromAxisAngle(up, item.rotation);
          scale.setScalar(item.scale);
          instance.compose(position, rotation, scale);
          matrix.multiplyMatrices(instance, part.matrix);
          mesh.setMatrixAt(index, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.meshes.push(mesh);
        this.fullCounts.push(items.length);
        this.group.add(mesh);
      }
    }
    this.applyTier();
  }

  setQuality(tier: QualityTier): void {
    this.tier = tier;
    this.applyTier();
  }

  /** Meshes don't own geometry/material (shared with ModelLibrary); only release instance buffers. */
  dispose(): void {
    this.clear();
  }

  private applyTier(): void {
    this.meshes.forEach((mesh, i) => {
      mesh.count = this.tier === 'low' ? Math.ceil(this.fullCounts[i] * 0.6) : this.fullCounts[i];
    });
  }

  private clear(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.meshes.length = 0;
    this.fullCounts.length = 0;
  }
}
