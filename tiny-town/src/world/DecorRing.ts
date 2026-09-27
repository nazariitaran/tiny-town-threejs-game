/**
 * Decor around the plot, built once models are loaded. One InstancedMesh per model part (the decor
 * models are single-part colour-atlas meshes), so ≤ 4 draw calls.
 *
 * Layout (deterministic, fixed seed):
 *  1. Hedgerow frame just outside the kerb: runs of low round shrubs (the `tree-a` canopy, sunk so
 *     its trunk is buried, and squashed) with gaps, hedgerow trees behind it, tree clumps on the
 *     corners and rock pairs at the ends of runs. Reads as an authored field boundary at the default
 *     build camera instead of scattered specks.
 *  2. Open meadow (the title camera orbits through it at r ≈ 33).
 *  3. Forest belt of groves, thinned where it would project behind the top bar at DEFAULT_POSE.
 *
 * `decor-bush` (the platformer grass-leaf plant) is no longer used: from above it read as birds.
 *
 * WP-04 (World & look).
 */
import * as THREE from 'three';
import { MODELS, type ModelId } from '../catalog/models';
import type { QualityTier } from '../game/config';
import { DEFAULT_POSE, type CameraPose } from '../interaction/CameraController';
import type { ModelLibrary } from '../render/ModelLibrary';
import { createSeededRandom } from '../utils/random';
import { KERB_WIDTH, PLOT_HALF_X, PLOT_HALF_Z, distanceToPlot, fbm, terrainHeight } from './terrainShape';

type DecorId = Extract<ModelId, 'tree-a' | 'tree-b' | 'decor-rocks'>;

export interface DecorInstance {
  model: DecorId;
  x: number;
  z: number;
  /** Ground height under the instance. */
  y: number;
  scale: number;
  /** Vertical squash (1 = none). Shrubs are squashed canopies. */
  squash: number;
  /** Fraction of the model's height pushed below ground (shrubs bury the trunk). */
  sink: number;
  rotation: number;
  /** Which layer placed it (for tests/tuning). */
  layer: 'hedge' | 'hedge-tree' | 'corner' | 'rock' | 'belt';
}

const DECOR_SEED = 0x7a11e;
/**
 * Instance caps per model (tree-a 408, tree-b 204, rocks 100 tris per instance): ≈ 75k triangles.
 */
const DECOR_BUDGET: Readonly<Record<DecorId, number>> = {
  'tree-a': 150,
  'tree-b': 120,
  'decor-rocks': 36,
};
/** Hedgerow centre line, measured from the plot edge (outside the kerb). */
export const HEDGE_OFFSET = KERB_WIDTH + 1.9;
/** Nothing may sit closer to the plot edge than this. */
export const DECOR_CLEAR_MARGIN = 1.2;
/**
 * Inner radius of the forest belt. The title camera orbits at ~33 units from the centre, so the
 * band between the hedgerow frame and the belt stays open meadow (no trees filling the lens).
 */
const BELT_INNER = 46;
const BELT_OUTER = 105;
/** Build-camera vertical FOV (Game.ts creates PerspectiveCamera(35, …)). */
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

/**
 * WP-12: the plot trees grew (tree-a/-b catalog scale 0.36 → 0.45) but the ring was planned for the
 * v0.1 templates. Planned scales stay in v0.1 units; this factor is applied when the instances are
 * composed, so the ring renders exactly as before (same plan, same sizes).
 */
const RING_SCALE_BASE = 0.36;
export const TEMPLATE_RESCALE: Readonly<Record<DecorId, number>> = {
  'tree-a': RING_SCALE_BASE / MODELS['tree-a'].scale,
  'tree-b': RING_SCALE_BASE / MODELS['tree-b'].scale,
  'decor-rocks': 1,
};

/** Approximate normalised model height (world units at scale 1, v0.1 templates) for the top-band test. */
const MODEL_HEIGHT: Readonly<Record<DecorId, number>> = { 'tree-a': 0.72, 'tree-b': 0.72, 'decor-rocks': 0.2 };

/** Deterministic placement (three.js maths only, no GPU objects). Sorted nearest first. */
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
        place('tree-a', x, z, 1.95 + rng() * 0.55, 'hedge', { squash: 0.58, sink: 0.45, spacing: false });
        // A hedgerow tree every so often, just behind the hedge.
        if (rng() < 0.13) {
          const [tx, tz] = side.map(u + (rng() - 0.5) * 0.6, HEDGE_OFFSET + 1.3 + rng() * 0.8);
          place(rng() < 0.55 ? 'tree-a' : 'tree-b', tx, tz, 1.6 + rng() * 0.6, 'hedge-tree');
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
      place(k % 2 === 0 ? 'tree-b' : 'tree-a', cx + Math.cos(a) * r, cz + Math.sin(a) * r, 1.5 + rng() * 0.5, 'corner');
    }
    place('tree-a', cx - sx * 1.3, cz - sz * 0.2, 2.4, 'hedge', { squash: 0.62, sink: 0.42, spacing: false });
    place('tree-a', cx - sx * 0.2, cz - sz * 1.3, 2.4, 'hedge', { squash: 0.62, sink: 0.42, spacing: false });
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
    const model: DecorId = grove > 0.56 ? (rng() < 0.6 ? 'tree-b' : 'tree-a') : rng() < 0.75 ? 'tree-a' : 'tree-b';
    place(model, x, z, (1.9 + rng() * 0.9) * (1 + far * 0.7), 'belt');
  }

  out.sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
  return out;
}

const DECOR_MODELS: readonly DecorId[] = ['tree-a', 'tree-b', 'decor-rocks'];

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
      const template = library.get(id);
      for (const part of template.parts) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.name = `decor:${id}`;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        const rescale = TEMPLATE_RESCALE[id];
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
