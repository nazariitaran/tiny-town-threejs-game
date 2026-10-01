/**
 * Deterministic decor around the plot, one InstancedMesh per model part:
 *  1. a hedgerow frame just outside the kerb (squashed, sunk `oak` canopies as shrubs, hedgerow trees,
 *     corner clumps, rock pairs at run ends);
 *  2. open meadow, which the title camera orbits through;
 *  3. a forest belt, thinned where it would show behind the top bar at DEFAULT_POSE.
 */
import * as THREE from 'three';
import { MODELS, type ModelId } from '../catalog/models';
import { DEFAULT_POSE, type CameraPose } from '../interaction/CameraController';
import type { ModelLibrary } from '../render/ModelLibrary';
import { createSeededRandom } from '../utils/random';
import { KERB_WIDTH, PLOT_HALF_X, PLOT_HALF_Z, distanceToPlot, fbm, terrainHeight } from './terrainShape';

type DecorId = Extract<ModelId, 'oak' | 'pine' | 'decor-rocks'>;

export interface DecorInstance {
  model: DecorId;
  x: number;
  z: number;
  /** Ground height under the instance. */
  y: number;
  scale: number;
  /** Vertical squash (1 = none). */
  squash: number;
  /** Fraction of the model's height pushed below ground (shrubs bury the trunk). */
  sink: number;
  rotation: number;
  layer: 'hedge' | 'hedge-tree' | 'corner' | 'rock' | 'belt';
}

const DECOR_SEED = 0x7a11e;
/** Instance caps: ≈ 75k triangles (oak 408, pine 204, rocks 100 tris each). */
const DECOR_BUDGET: Readonly<Record<DecorId, number>> = {
  'oak': 150,
  'pine': 120,
  'decor-rocks': 36,
};
/** Hedgerow centre line, measured from the plot edge (outside the kerb). */
export const HEDGE_OFFSET = KERB_WIDTH + 1.9;
export const DECOR_CLEAR_MARGIN = 1.2;
/** Forest belt inner radius: beyond the title camera's orbit (~43 units), so the meadow it flies over stays open. */
const BELT_INNER = 60;
const BELT_OUTER = 120;
/** Must match the build camera's vertical FOV. */
const BUILD_FOV = 35;
/** Screen band (CSS px from the top) that the top bar covers at the default pose. */
export const TOP_BAR_BAND_PX = 64;
/** Viewports the top-band rule is checked against: desktop and phone portrait. */
const TOP_BAND_VIEWPORTS: ReadonlyArray<[number, number]> = [
  [1280, 720],
  [390, 844],
];

/** Camera for a pose (same spherical convention as CameraController/MapControls). */
export function cameraForPose(pose: CameraPose, aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(BUILD_FOV, aspect, 0.1, 900);
  const sinP = Math.sin(pose.polar);
  camera.position.set(
    pose.targetX + pose.distance * sinP * Math.sin(pose.azimuth),
    pose.distance * Math.cos(pose.polar),
    pose.targetZ + pose.distance * sinP * Math.cos(pose.azimuth),
  );
  camera.lookAt(pose.targetX, 0, pose.targetZ);
  camera.updateMatrixWorld(true);
  return camera;
}

/** True when any part of a vertical segment would show in the top-bar band at the default pose. */
function makeTopBandTest(): (x: number, y0: number, y1: number, z: number) => boolean {
  const cams = TOP_BAND_VIEWPORTS.map(([w, h]) => ({ cam: cameraForPose(DEFAULT_POSE, w / h), limit: 1 - (2 * TOP_BAR_BAND_PX) / h }));
  const p = new THREE.Vector3();
  return (x, y0, y1, z) => {
    for (const { cam, limit } of cams) {
      for (const y of [y0, (y0 + y1) / 2, y1]) {
        p.set(x, y, z).project(cam);
        if (p.z < 1 && Math.abs(p.x) <= 1.05 && p.y >= limit && p.y <= 1.05) return true;
      }
    }
    return false;
  };
}

/** Ring scales are planned for a 0.36 tree scale; this maps them onto the catalog's scale. */
const RING_SCALE_BASE = 0.36;
export const TEMPLATE_RESCALE: Readonly<Record<DecorId, number>> = {
  'oak': RING_SCALE_BASE / MODELS['oak'].scale,
  'pine': RING_SCALE_BASE / MODELS['pine'].scale,
  'decor-rocks': 1,
};

/** Approximate model height at ring scale 1, for the top-band test. */
const MODEL_HEIGHT: Readonly<Record<DecorId, number>> = { 'oak': 0.72, 'pine': 0.72, 'decor-rocks': 0.2 };

/** Deterministic placement, sorted nearest first. */
export function planDecor(): DecorInstance[] {
  const rng = createSeededRandom(DECOR_SEED);
  const out: DecorInstance[] = [];
  const remaining: Record<DecorId, number> = { ...DECOR_BUDGET };
  const inTopBand = makeTopBandTest();
  const trees: Array<[number, number, number]> = [];
  const treeFits = (x: number, z: number, radius: number): boolean => {
    for (const [px, pz, pr] of trees) {
      const min = radius + pr;
      if ((px - x) ** 2 + (pz - z) ** 2 < min * min) return false;
    }
    return true;
  };
  const place = (
    model: DecorId,
    x: number,
    z: number,
    scale: number,
    layer: DecorInstance['layer'],
    opts: { squash?: number; sink?: number; spacing?: boolean } = {},
  ): boolean => {
    if (remaining[model] <= 0) return false;
    if (distanceToPlot(x, z) < DECOR_CLEAR_MARGIN) return false;
    const squash = opts.squash ?? 1;
    const sink = opts.sink ?? 0;
    const y = terrainHeight(x, z) - 0.04;
    const height = MODEL_HEIGHT[model] * scale * squash;
    if (inTopBand(x, y, y + height * (1 - sink), z)) return false;
    if (opts.spacing !== false) {
      const footprint = 0.28 * scale;
      if (!treeFits(x, z, footprint)) return false;
      trees.push([x, z, footprint]);
    }
    remaining[model] -= 1;
    out.push({ model, x, z, y, scale, squash, sink, rotation: rng() * Math.PI * 2, layer });
    return true;
  };

  // 1. Hedgerow frame. Walk each side's centre line (u = along, v = outward normal).
  const sides = [
    { half: PLOT_HALF_X, depth: PLOT_HALF_Z, map: (u: number, v: number) => [u, PLOT_HALF_Z + v] as const },
    { half: PLOT_HALF_X, depth: PLOT_HALF_Z, map: (u: number, v: number) => [u, -PLOT_HALF_Z - v] as const },
    { half: PLOT_HALF_Z, depth: PLOT_HALF_X, map: (u: number, v: number) => [PLOT_HALF_X + v, u] as const },
    { half: PLOT_HALF_Z, depth: PLOT_HALF_X, map: (u: number, v: number) => [-PLOT_HALF_X - v, u] as const },
  ];
  sides.forEach((side, s) => {
    const step = 0.66;
    let inRun = false;
    let lastEnd: number | null = null;
    for (let u = -side.half + 0.8; u <= side.half - 0.8; u += step) {
      // Runs and gaps from 1D noise along the side; the wobble keeps the line hand-made.
      const run = fbm(u * 0.16 + s * 13.7, s * 5.1, 2, 61);
      const wobble = (fbm(u * 0.35 + s * 3.3, 1.9, 2, 67) - 0.5) * 0.7;
      const present = run > 0.4;
      if (present) {
        const [x, z] = side.map(u, HEDGE_OFFSET + wobble);
        place('oak', x, z, 1.95 + rng() * 0.55, 'hedge', { squash: 0.58, sink: 0.45, spacing: false });
        if (rng() < 0.13) {
          const [tx, tz] = side.map(u + (rng() - 0.5) * 0.6, HEDGE_OFFSET + 1.3 + rng() * 0.8);
          place(rng() < 0.55 ? 'oak' : 'pine', tx, tz, 1.6 + rng() * 0.6, 'hedge-tree');
        }
      }
      if (present !== inRun) {
        // Rock pair at the end of a run: anchors the gap so it reads as a gateway, not a hole.
        if (!present && (lastEnd === null || u - lastEnd > 3)) {
          for (let k = 0; k < 2; k += 1) {
            const [rx, rz] = side.map(u + k * 0.45 - 0.2, HEDGE_OFFSET + (rng() - 0.5) * 0.5);
            place('decor-rocks', rx, rz, 2.0 + rng() * 0.8, 'rock', { spacing: false });
          }
          lastEnd = u;
        }
        inRun = present;
      }
    }
  });

  // Corner clumps: 3–4 trees on each diagonal just past the hedge corner.
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const cx = sx * (PLOT_HALF_X + HEDGE_OFFSET + 0.2);
    const cz = sz * (PLOT_HALF_Z + HEDGE_OFFSET + 0.2);
    for (let k = 0; k < 4; k += 1) {
      const a = rng() * Math.PI * 2;
      const r = k === 0 ? 0 : 0.9 + rng() * 0.9;
      place(k % 2 === 0 ? 'pine' : 'oak', cx + Math.cos(a) * r, cz + Math.sin(a) * r, 1.5 + rng() * 0.5, 'corner');
    }
    place('oak', cx - sx * 1.3, cz - sz * 0.2, 2.4, 'hedge', { squash: 0.62, sink: 0.42, spacing: false });
    place('oak', cx - sx * 0.2, cz - sz * 1.3, 2.4, 'hedge', { squash: 0.62, sink: 0.42, spacing: false });
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
    const model: DecorId = grove > 0.56 ? (rng() < 0.6 ? 'pine' : 'oak') : rng() < 0.75 ? 'oak' : 'pine';
    place(model, x, z, (1.9 + rng() * 0.9) * (1 + far * 0.7), 'belt');
  }

  out.sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
  return out;
}

const DECOR_MODELS: readonly DecorId[] = ['oak', 'pine', 'decor-rocks'];

/**
 * Ascending indices of the instances kept for a share `fraction` of the ring: ranked by angle about the
 * plot centre with an error-diffusion stride, so any arc keeps about `fraction` of what it had.
 */
export function evenDecorSubset(angles: readonly number[], fraction: number): number[] {
  const n = angles.length;
  if (!(fraction > 0)) return [];
  if (fraction >= 1) return angles.map((_, i) => i);
  const byAngle = angles.map((_, i) => i).sort((a, b) => angles[a] - angles[b] || a - b);
  const kept: number[] = [];
  for (let rank = 0; rank < n; rank += 1) {
    // Keep rank r when floor((r + 1) f) steps up: exactly round-down(n f) kept, evenly strided.
    if (Math.floor((rank + 1) * fraction + 1e-9) > Math.floor(rank * fraction + 1e-9)) kept.push(byAngle[rank]);
  }
  return kept.sort((a, b) => a - b);
}

export class DecorRing {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  /** Per mesh: every instance matrix (plan order) and each instance's angle about the plot centre. */
  private readonly fullMatrices: Float32Array[] = [];
  private readonly angles: number[][] = [];
  private fraction = 1;

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
      const template = library.get(id);
      for (const part of template.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.name = `decor:${id}`;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        const rescale = TEMPLATE_RESCALE[id];
        this.angles.push(items.map((item) => Math.atan2(item.z, item.x)));
        items.forEach((item, index) => {
          const s = item.scale * rescale;
          const height = (template.bounds.max.y - template.bounds.min.y) * s * item.squash;
          position.set(item.x, item.y - height * item.sink, item.z);
          rotation.setFromAxisAngle(up, item.rotation);
          scale.set(s, s * item.squash, s);
          instance.compose(position, rotation, scale);
          matrix.multiplyMatrices(instance, part.matrix);
          mesh.setMatrixAt(index, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.meshes.push(mesh);
        this.fullMatrices.push((mesh.instanceMatrix.array as Float32Array).slice());
        this.group.add(mesh);
      }
    }
    this.applyFraction();
  }

  /** Draws this share (0..1] of every decor mesh, spread evenly; a change rewrites the instance buffers once. */
  setFraction(fraction: number): void {
    const next = Math.min(1, Math.max(0, fraction));
    if (next === this.fraction) return;
    this.fraction = next;
    this.applyFraction();
  }

  get decorFraction(): number {
    return this.fraction;
  }

  /** Meshes don't own geometry/material (shared with ModelLibrary); only release instance buffers. */
  dispose(): void {
    this.clear();
  }

  /** Pack the kept instances at the front of each buffer (an InstancedMesh draws the first `count`). */
  private applyFraction(): void {
    this.meshes.forEach((mesh, i) => {
      const full = this.fullMatrices[i];
      const target = mesh.instanceMatrix.array as Float32Array;
      if (this.fraction >= 1) {
        target.set(full);
        mesh.count = full.length / 16;
      } else {
        const kept = evenDecorSubset(this.angles[i], this.fraction);
        kept.forEach((index, slot) => target.set(full.subarray(index * 16, index * 16 + 16), slot * 16));
        mesh.count = kept.length;
      }
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private clear(): void {
    for (const mesh of this.meshes) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.meshes.length = 0;
    this.fullMatrices.length = 0;
    this.angles.length = 0;
  }
}
