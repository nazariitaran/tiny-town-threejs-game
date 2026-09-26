/**
 * Catalog integrity: every referenced file exists, every GLB loads through three's real
 * GLTFLoader (Node shims), and normalised sizes fit the grid (same scale/rotation as ModelLibrary).
 * Runs in Node — no browser needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { EDGE_MODELS, GROUND_MODELS, MODELS, ROAD_PIECE_MODELS, type ModelId } from './models';
import { OBJECTS } from './objects';
import { TOOLS } from './tools';

const PUBLIC = path.resolve(__dirname, '../../public');
const publicPath = (url: string) => path.join(PUBLIC, url.replace(/^\//, ''));

/** Normalised (scaled + rotationOffset) size of each model, filled in beforeAll. */
const sizes = new Map<ModelId, THREE.Vector3>();

beforeAll(async () => {
  // Minimal browser shims so GLTFLoader can resolve external textures from disk.
  (globalThis as { self?: unknown }).self ??= globalThis;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith('file:')) return realFetch(url, init);
    const file = new URL(u).pathname;
    return fs.existsSync(file) ? new Response(fs.readFileSync(file)) : new Response(null, { status: 404 });
  }) as typeof fetch;
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async (blob: Blob) => {
    const bytes = Buffer.from(await blob.arrayBuffer());
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), close() {} };
  };
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  for (const [id, spec] of Object.entries(MODELS) as Array<[ModelId, (typeof MODELS)[ModelId]]>) {
    const file = publicPath(spec.url);
    const data = fs.readFileSync(file);
    const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), `file://${path.dirname(file)}/`);
    const root = new THREE.Group();
    root.add(gltf.scene);
    gltf.scene.scale.setScalar(spec.scale);
    gltf.scene.rotation.y = (spec.rotationOffset * Math.PI) / 2;
    root.updateMatrixWorld(true);
    sizes.set(id, new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()));
  }
}, 60_000);

describe('catalog', () => {
  it('every model file exists and loads', () => {
    for (const [id, spec] of Object.entries(MODELS)) {
      expect(fs.existsSync(publicPath(spec.url)), `${id}: ${spec.url}`).toBe(true);
    }
    expect(sizes.size).toBe(Object.keys(MODELS).length);
  });

  it('every tool icon exists (except UI glyphs owned by WP-06)', () => {
    for (const tool of TOOLS) {
      if (tool.icon.startsWith('/assets/ui/')) continue;
      expect(fs.existsSync(publicPath(tool.icon)), `${tool.id}: ${tool.icon}`).toBe(true);
    }
  });

  it('every object/edge/ground/road reference points at a registered model', () => {
    const ids = new Set(Object.keys(MODELS));
    for (const def of Object.values(OBJECTS)) for (const m of def.models) expect(ids.has(m), `${def.kind} → ${m}`).toBe(true);
    for (const m of Object.values(ROAD_PIECE_MODELS)) expect(ids.has(m)).toBe(true);
    for (const m of Object.values(EDGE_MODELS)) expect(ids.has(m)).toBe(true);
    for (const v of Object.values(GROUND_MODELS)) if (v.type === 'model') expect(ids.has(v.model)).toBe(true);
  });

  it('road and pavement tiles fill exactly one cell', () => {
    for (const id of [...Object.values(ROAD_PIECE_MODELS), 'pavement-tile'] as ModelId[]) {
      const size = sizes.get(id)!;
      expect(size.x, `${id} x`).toBeCloseTo(1, 1);
      expect(size.z, `${id} z`).toBeCloseTo(1, 1);
    }
  });

  it('fences are one cell long along X and thin along Z', () => {
    for (const id of Object.values(EDGE_MODELS)) {
      const size = sizes.get(id)!;
      expect(size.x, `${id} length`).toBeCloseTo(1, 1);
      expect(size.z, `${id} thickness`).toBeLessThan(0.3);
    }
  });

  it('objects fit inside their footprint', () => {
    for (const def of Object.values(OBJECTS)) {
      for (const id of def.models) {
        const size = sizes.get(id)!;
        expect(size.x, `${id} width`).toBeLessThanOrEqual(def.footprint[0] + 0.05);
        expect(size.z, `${id} depth`).toBeLessThanOrEqual(def.footprint[1] + 0.05);
        expect(size.y, `${id} height`).toBeGreaterThan(0.1);
      }
    }
  });
});
