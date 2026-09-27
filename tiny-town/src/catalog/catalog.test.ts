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
import { OBJECT_KINDS, OBJECTS } from './objects';
import { TOOL_CATEGORIES, TOOLS, toolsInCategory, type ToolLayer } from './tools';

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

  it('every tool icon file exists', () => {
    for (const tool of TOOLS) expect(fs.existsSync(publicPath(tool.icon)), `${tool.id}: ${tool.icon}`).toBe(true);
  });

  it('placing tools use their own tool-<id>.png icon, and the icons folder holds nothing else', () => {
    const placing = TOOLS.filter((tool) => tool.category !== 'mode');
    for (const tool of placing) expect(tool.icon, tool.id).toBe(`/assets/icons/tool-${tool.id}.png`);
    const files = fs.readdirSync(path.join(PUBLIC, 'assets/icons')).filter((f) => !f.startsWith('.')).sort();
    expect(files).toEqual(placing.map((tool) => `tool-${tool.id}.png`).sort());
  });

  it('every category has at most 9 tools (digit shortcuts 1–9)', () => {
    for (const { id } of TOOL_CATEGORIES) {
      expect(toolsInCategory(id).length, id).toBeGreaterThan(0);
      expect(toolsInCategory(id).length, id).toBeLessThanOrEqual(9);
    }
  });

  it('every tool except bulldoze belongs to a dock category', () => {
    const categories = new Set<string>(TOOL_CATEGORIES.map((c) => c.id));
    for (const tool of TOOLS) {
      if (tool.id === 'bulldoze') expect(tool.category).toBe('mode');
      else expect(categories.has(tool.category), `${tool.id}: ${tool.category}`).toBe(true);
    }
  });

  it('within a category tools run ground → edge → object', () => {
    const rank: Record<ToolLayer, number> = { ground: 0, edge: 1, object: 2, bulldoze: 3 };
    for (const { id } of TOOL_CATEGORIES) {
      const ranks = toolsInCategory(id).map((tool) => rank[tool.layer]);
      expect(ranks, id).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('every ObjectKind has exactly one object tool, and every object tool an ObjectDef', () => {
    for (const kind of OBJECT_KINDS) {
      expect(TOOLS.filter((tool) => tool.id === kind && tool.layer === 'object'), kind).toHaveLength(1);
    }
    for (const tool of TOOLS.filter((t) => t.layer === 'object')) expect(OBJECT_KINDS, tool.id).toContain(tool.id);
  });

  it('every edge kind has a model and an edge tool', () => {
    for (const kind of Object.keys(EDGE_MODELS)) {
      expect(TOOLS.filter((tool) => tool.id === kind && tool.layer === 'edge'), kind).toHaveLength(1);
    }
  });

  it('tool ids are unique', () => {
    expect(new Set(TOOLS.map((tool) => tool.id)).size).toBe(TOOLS.length);
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

  it('edge models are one cell long along X and thin along Z', () => {
    for (const id of Object.values(EDGE_MODELS)) {
      expect(sizes.get(id)!.x, `${id} native length`).toBeCloseTo(CELL_SIZE, 2);
      expect(drawn(id).z, `${id} thickness`).toBeLessThan(0.35 * CELL_SIZE);
    }
  });

  it('fences are drawn exactly one cell long; the hedge overlaps its neighbours by at most 15 %', () => {
    expect(drawn('fence-low').x).toBeCloseTo(CELL_SIZE, 2);
    expect(drawn('fence-tall').x).toBeCloseTo(CELL_SIZE, 2);
    expect(drawn('hedge').x).toBeGreaterThanOrEqual(CELL_SIZE);
    expect(drawn('hedge').x).toBeLessThanOrEqual(1.15 * CELL_SIZE);
  });

  it('objects fit inside their footprint (× CELL_SIZE), including their authored offset', () => {
    for (const def of Object.values(OBJECTS)) {
      if (def.roadFeature) continue; // flat road pieces: checked below
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

  it('road features fill their whole footprint (whole road blocks) at road-tile height', () => {
    const roadHeight = sizes.get('road-straight')!.y;
    const features = Object.values(OBJECTS).filter((def) => def.roadFeature);
    expect(features.map((def) => def.kind)).toEqual(['roundabout']);
    for (const def of features) {
      expect(def.footprint[0] % 2, `${def.kind} blocks`).toBe(0);
      expect(def.footprint[1] % 2, `${def.kind} blocks`).toBe(0);
      for (const id of def.models) {
        const size = drawn(id);
        expect(size.x, `${id} width`).toBeCloseTo(def.footprint[0] * CELL_SIZE, 1);
        expect(size.z, `${id} depth`).toBeCloseTo(def.footprint[1] * CELL_SIZE, 1);
        expect(size.y, `${id} height`).toBeCloseTo(roadHeight, 2);
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
    const cottage = drawn('cottage');
    const carLength = Math.max(...cars().map((c) => c.z));
    expect(cottage.x / carLength).toBeGreaterThan(2.5);
    expect(cottage.x / LANE).toBeGreaterThan(3);
    // Cars fit a lane.
    for (const car of cars()) expect(car.x).toBeLessThan(LANE);
  });

  it('every home is more than two car lengths along its longer side', () => {
    const carLength = Math.max(...cars().map((c) => c.z));
    for (const def of Object.values(OBJECTS).filter((d) => d.group === 'home')) {
      for (const id of def.models) expect(Math.max(drawn(id).x, drawn(id).z) / carLength, id).toBeGreaterThan(2);
    }
  });

  it('trees are about cottage height and below the townhouse ridges', () => {
    const cottage = h('cottage');
    const townhouseRidge = Math.min(h('townhouse'), h('townhouse-alt'));
    for (const tree of ['oak', 'pine', 'birch'] as const) {
      expect(h(tree) / cottage, `${tree} vs cottage`).toBeGreaterThan(0.85);
      expect(h(tree) / cottage, `${tree} vs cottage`).toBeLessThan(1.25);
      expect(h(tree), `${tree} vs townhouse`).toBeLessThan(townhouseRidge);
    }
  });

  it('the lamppost is taller than the garage and the bus stop, and below the eaves', () => {
    const lamp = h('lamppost');
    expect(lamp).toBeGreaterThan(h('garage'));
    expect(lamp).toBeGreaterThan(h('bus-stop'));
    expect(lamp).toBeLessThan(h('cottage'));
    expect(lamp).toBeGreaterThan(0.6);
  });

  it('traffic lights are taller than a car and below the lamppost', () => {
    const carHeight = Math.max(...cars().map((c) => c.y));
    for (const id of ['traffic-light', 'traffic-light-hanging'] as const) {
      expect(h(id), id).toBeGreaterThan(carHeight);
      expect(h(id), id).toBeLessThan(h('lamppost'));
    }
  });

  it('a bush is a low shrub (under half an oak) and the small birch is shorter than the big one', () => {
    expect(h('bush') / h('oak')).toBeLessThan(0.5);
    expect(h('birch-small')).toBeLessThan(h('birch'));
  });

  it('the bungalows are single-storey (lower than the two-storey family home)', () => {
    expect(h('bungalow')).toBeLessThan(h('family-home'));
    expect(h('bungalow-l')).toBeLessThan(h('family-home'));
  });

  it('the church tower is the tallest building', () => {
    for (const def of Object.values(OBJECTS)) {
      if (def.kind === 'church' || def.roadFeature) continue;
      for (const id of def.models) expect(h(id), id).toBeLessThan(h('church'));
    }
  });

  it('garden furniture stays below the lamppost and the cottage eaves', () => {
    for (const def of Object.values(OBJECTS).filter((d) => d.group === 'garden')) {
      for (const id of def.models) {
        expect(h(id), id).toBeLessThan(h('lamppost'));
        expect(h(id), id).toBeLessThan(0.6 * h('cottage'));
      }
    }
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
    expect(metres(h('fence-low'))).toBeGreaterThan(0.6);
    expect(metres(h('fence-low'))).toBeLessThan(1.0);
  });
});
