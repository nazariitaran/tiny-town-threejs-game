/** The surface table against the real GLBs, normalised as ModelLibrary does (scale, quarter turns, centred, base on y = 0). */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { MODELS, type ModelId } from '../catalog/models';
import { OBJECT_KINDS, OBJECTS } from '../catalog/objects';
import { CELL_SIZE } from '../game/config';
import { MODEL_STYLES } from '../render/modelStyles';
import { hasJitter } from '../render/objectPose';
import { createGlbLoader } from '../testing/gltfNode';
import { SPLASH_ROAD, SPLASH_SURFACES, SURFACE_SHAPES, type SurfaceShape } from './splashSurface';

const SHAPED = Object.keys(SURFACE_SHAPES) as ModelId[];
const roots = new Map<ModelId, THREE.Object3D>();

beforeAll(async () => {
  const load = await createGlbLoader();
  for (const id of [...SHAPED, 'road-straight'] as ModelId[]) {
    const spec = MODELS[id];
    const scene = (await load(spec.url)).scene;
    const root = new THREE.Group();
    root.add(scene);
    scene.scale.setScalar(spec.scale);
    scene.rotation.y = (spec.rotationOffset * Math.PI) / 2;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const centre = bounds.getCenter(new THREE.Vector3());
    scene.position.set(-centre.x, -bounds.min.y, -centre.z);
    root.updateMatrixWorld(true);
    roots.set(id, root);
  }
}, 60_000);

/** Vertices of the model's upward-facing triangles that lie flat at height `y`. */
function flatVertices(root: THREE.Object3D, y: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const normal = new THREE.Vector3();
  const edge = new THREE.Vector3();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < 3; k += 1) v[k].fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld);
      if (v.some((p) => Math.abs(p.y - y) > 1e-3)) continue;
      normal.subVectors(v[1], v[0]).cross(edge.subVectors(v[2], v[0]));
      if (normal.y <= 1e-9) continue;
      out.push(...v.map((p) => p.clone()));
    }
  });
  return out;
}

function inside(shape: SurfaceShape, x: number, z: number, margin: number): boolean {
  if ('rect' in shape) {
    const [x0, z0, x1, z1] = shape.rect;
    return x >= x0 - margin && x <= x1 + margin && z >= z0 - margin && z <= z1 + margin;
  }
  const [cx, cz, r] = shape.circle;
  return Math.hypot(x - cx, z - cz) <= r + margin;
}

describe('splash surface shapes', () => {
  it('belong to one-model kinds drawn without stretch, jitter or style scale', () => {
    for (const model of SHAPED) {
      const kinds = OBJECT_KINDS.filter((kind) => OBJECTS[kind].models.includes(model));
      expect(kinds, model).toHaveLength(1);
      const def = OBJECTS[kinds[0]];
      expect(def.models, model).toEqual([model]);
      expect(def.height, model).toBeUndefined();
      expect(def.footprints, model).toBeUndefined();
      expect(hasJitter(def), model).toBe(false);
      expect(MODEL_STYLES[model]?.scale, model).toBeUndefined();
      const spec: { offset?: unknown; nativeOrigin?: boolean } = MODELS[model];
      expect(spec.offset, model).toBeUndefined();
      expect(spec.nativeOrigin, model).toBeUndefined();
    }
  });

  it('lie inside their footprint', () => {
    for (const model of SHAPED) {
      const def = OBJECTS[OBJECT_KINDS.find((kind) => OBJECTS[kind].models.includes(model))!];
      const hx = (def.footprint[0] * CELL_SIZE) / 2;
      const hz = (def.footprint[1] * CELL_SIZE) / 2;
      for (const shape of SURFACE_SHAPES[model]!) {
        const [x0, z0, x1, z1] = 'rect' in shape ? shape.rect : [shape.circle[0] - shape.circle[2], shape.circle[1] - shape.circle[2], shape.circle[0] + shape.circle[2], shape.circle[1] + shape.circle[2]];
        expect(x0 >= -hx && x1 <= hx && z0 >= -hz && z1 <= hz, `${model} ${JSON.stringify(shape)}`).toBe(true);
      }
    }
  });

  it('match a flat surface of the model at their height, covering it and no more', () => {
    for (const model of SHAPED) {
      for (const shape of SURFACE_SHAPES[model]!) {
        const label = `${model} ${JSON.stringify(shape)}`;
        const vertices = flatVertices(roots.get(model)!, SPLASH_SURFACES[shape.id].top);
        expect(vertices.length, label).toBeGreaterThan(0);
        for (const p of vertices) expect(inside(shape, p.x, p.z, 1e-3), `${label}: (${p.x.toFixed(3)}, ${p.z.toFixed(3)})`).toBe(true);
        if ('rect' in shape) {
          const box = new THREE.Box3().setFromPoints(vertices);
          const [x0, z0, x1, z1] = shape.rect;
          for (const [a, b] of [[x0, box.min.x], [z0, box.min.z], [x1, box.max.x], [z1, box.max.z]]) expect(Math.abs(a - b), label).toBeLessThan(0.01);
        } else {
          const [cx, cz, r] = shape.circle;
          const reach = Math.max(...vertices.map((p) => Math.hypot(p.x - cx, p.z - cz)));
          expect(r - reach, label).toBeLessThan(0.01);
        }
      }
    }
  });

  it('are seen from above: rain falling inside a shape often lands first on its surface', () => {
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const from = new THREE.Vector3();
    for (const model of SHAPED) {
      const root = roots.get(model)!;
      for (const shape of SURFACE_SHAPES[model]!) {
        const [x0, z0, x1, z1] = 'rect' in shape ? shape.rect : [shape.circle[0] - shape.circle[2], shape.circle[1] - shape.circle[2], shape.circle[0] + shape.circle[2], shape.circle[1] + shape.circle[2]];
        let samples = 0;
        let hits = 0;
        for (let i = 0; i < 40; i += 1) {
          for (let j = 0; j < 40; j += 1) {
            const x = x0 + ((i + 0.5) / 40) * (x1 - x0);
            const z = z0 + ((j + 0.5) / 40) * (z1 - z0);
            if (!inside(shape, x, z, 0)) continue;
            samples += 1;
            ray.set(from.set(x, 10, z), down);
            const hit = ray.intersectObject(root, true)[0];
            if (hit && Math.abs(hit.point.y - SPLASH_SURFACES[shape.id].top) < 1e-3) hits += 1;
          }
        }
        expect(hits / samples, `${model} ${JSON.stringify(shape)}`).toBeGreaterThan(0.4);
      }
    }
  });

  it('puts road rings over the asphalt', () => {
    expect(flatVertices(roots.get('road-straight')!, SPLASH_SURFACES[SPLASH_ROAD].top).length).toBeGreaterThan(0);
  });
});
