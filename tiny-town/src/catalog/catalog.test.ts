/**
 * Catalog integrity: every referenced file exists, every GLB loads through three's real
 * GLTFLoader (Node shims), and normalised sizes fit the grid (same scale/rotation as ModelLibrary).
 * Runs in Node — no browser needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CELL_SIZE, ROAD_TILE_SIZE } from '../game/config';
import { CAR_FILES, CAR_SCALE } from '../life/LifeSystem';
import { MODEL_STYLES } from '../render/TownRenderer';
import { EDGE_MODELS, GROUND_MODELS, MODELS, ROAD_PIECE_MODELS, type ModelId } from './models';
import { OBJECTS } from './objects';
import { TOOLS } from './tools';

const PUBLIC = path.resolve(__dirname, '../../public');
const publicPath = (url: string) => path.join(PUBLIC, url.replace(/^\//, ''));

/** Normalised (scaled + rotationOffset) size of each model, filled in beforeAll. */
const sizes = new Map<ModelId, THREE.Vector3>();
/** Car Kit models at CAR_SCALE (LifeSystem), filled in beforeAll. */
const carSizes = new Map<string, THREE.Vector3>();

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
  for (const name of CAR_FILES) {
    const file = publicPath(`/assets/models/cars/${name}.glb`);
    const data = fs.readFileSync(file);
    const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), `file://${path.dirname(file)}/`);
    gltf.scene.scale.setScalar(CAR_SCALE);
    gltf.scene.updateMatrixWorld(true);
    carSizes.set(name, new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()));
  }
}, 60_000);

/** Size as drawn: normalised size × TownRenderer's MODEL_STYLES non-uniform scale. */
function drawn(id: ModelId): THREE.Vector3 {
  const size = sizes.get(id)!.clone();
  const style = MODEL_STYLES[id]?.scale;
  if (style) size.multiply(new THREE.Vector3(style[0], style[1], style[2]));
  return size;
}

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

  it('road tiles fill one 2 × 2 road block; pavement tiles fill one cell with the kerb-height top', () => {
    for (const id of Object.values(ROAD_PIECE_MODELS)) {
      const size = sizes.get(id)!;
      expect(size.x, `${id} x`).toBeCloseTo(ROAD_TILE_SIZE, 1);
      expect(size.z, `${id} z`).toBeCloseTo(ROAD_TILE_SIZE, 1);
    }
    const pavement = drawn('pavement-tile');
    expect(pavement.x).toBeCloseTo(CELL_SIZE, 2);
    expect(pavement.z).toBeCloseTo(CELL_SIZE, 2);
    expect(pavement.y).toBeCloseTo(0.02, 3);
  });

  it('fences are one cell long along X and thin along Z', () => {
    for (const id of Object.values(EDGE_MODELS)) {
      const size = drawn(id);
      expect(size.x, `${id} length`).toBeCloseTo(CELL_SIZE, 1);
      expect(size.z, `${id} thickness`).toBeLessThan(0.3 * CELL_SIZE);
    }
  });

  it('objects fit inside their footprint (× CELL_SIZE), including their authored offset', () => {
    for (const def of Object.values(OBJECTS)) {
      for (const id of def.models) {
        const size = drawn(id);
        const [ox, , oz] = MODELS[id].offset ?? [0, 0, 0];
        // Centred on the footprint then offset: the far side reaches size/2 + |offset| from the centre.
        expect(size.x / 2 + Math.abs(ox), `${id} width`).toBeLessThanOrEqual((def.footprint[0] * CELL_SIZE) / 2 + 0.03);
        expect(size.z / 2 + Math.abs(oz), `${id} depth`).toBeLessThanOrEqual((def.footprint[1] * CELL_SIZE) / 2 + 0.03);
        expect(size.y, `${id} height`).toBeGreaterThan(0.1);
      }
    }
  });
});

/**
 * WP-12 proportions (docs/plans/wp-12-scale.md §2). Toy scale: 1 world unit ≈ 8 m, a cell ≈ 4 m.
 * Logs the drawn bounding boxes (w × h × d, world units) so the table in the plan/hand-off can be
 * checked against the real models.
 */
describe('proportions', () => {
  const LANE = 0.37;
  const h = (id: ModelId) => drawn(id).y;
  const cars = () => [...carSizes.values()];

  it('logs the bounding-box table', () => {
    const rows = (Object.keys(MODELS) as ModelId[])
      .filter((id) => !id.startsWith('walkway') && !id.startsWith('decor') && !id.startsWith('road-'))
      .map((id) => {
        const s = drawn(id);
        return `${id.padEnd(20)} ${s.x.toFixed(3)} × ${s.y.toFixed(3)} × ${s.z.toFixed(3)}`;
      });
    for (const [name, s] of carSizes) rows.push(`${`car-${name}`.padEnd(20)} ${s.x.toFixed(3)} × ${s.y.toFixed(3)} × ${s.z.toFixed(3)}`);
    console.info(`[proportions] w × h × d (world units, CELL_SIZE ${CELL_SIZE})\n${rows.join('\n')}`);
    expect(rows.length).toBeGreaterThan(10);
  });

  it('a house is clearly bigger than a car and a lane', () => {
    const cottage = drawn('townhouse-a');
    const carLength = Math.max(...cars().map((c) => c.z));
    expect(cottage.x / carLength).toBeGreaterThan(2.5);
    expect(cottage.x / LANE).toBeGreaterThan(3);
    // Cars fit a lane.
    for (const car of cars()) expect(car.x).toBeLessThan(LANE);
  });

  it('trees are about cottage height and below the townhouse ridges', () => {
    const cottage = h('townhouse-a');
    const townhouseRidge = Math.min(h('townhouse-b'), h('townhouse-b-alt'));
    for (const tree of ['tree-a', 'tree-b', 'tree-c'] as const) {
      expect(h(tree) / cottage, `${tree} vs cottage`).toBeGreaterThan(0.85);
      expect(h(tree) / cottage, `${tree} vs cottage`).toBeLessThan(1.25);
      expect(h(tree), `${tree} vs townhouse`).toBeLessThan(townhouseRidge);
    }
  });

  it('the lamppost is taller than the garage and the bus stop, and below the eaves', () => {
    const lamp = h('lamppost');
    expect(lamp).toBeGreaterThan(h('garage'));
    expect(lamp).toBeGreaterThan(h('bus-stop'));
    expect(lamp).toBeLessThan(h('townhouse-a'));
    expect(lamp).toBeGreaterThan(0.6);
  });

  it('the postbox is about car height (≈ 1.2× real: 1.5 m ≈ 0.19)', () => {
    const carHeight = Math.max(...cars().map((c) => c.y));
    expect(h('postbox') / carHeight).toBeGreaterThan(0.8);
    expect(h('postbox') / carHeight).toBeLessThan(1.5);
  });

  it('fences come out at about 1.65 m (tall) and 0.8 m (low)', () => {
    const metres = (units: number) => units * 8;
    expect(metres(h('fence-tall'))).toBeGreaterThan(1.4);
    expect(metres(h('fence-tall'))).toBeLessThan(1.9);
    expect(metres(h('fence-small'))).toBeGreaterThan(0.6);
    expect(metres(h('fence-small'))).toBeLessThan(1.0);
  });
});
