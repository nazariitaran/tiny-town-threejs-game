/**
 * Catalog integrity: every referenced file exists, every GLB loads through three's real GLTFLoader
 * (Node shims in src/testing/gltfNode.ts), and normalised sizes fit the grid (same scale/rotation as ModelLibrary).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { CELL_SIZE, PLOT_CONTENT_HEIGHT, ROAD_TILE_SIZE } from '../game/config';
import { ALTITUDE } from '../life/FlockSim';
import { CAR_FILES, CAR_SCALE } from '../life/LifeSystem';
import { MODEL_STYLES } from '../render/modelStyles';
import { EDGE_MODELS, GROUND_MODELS, MODELS, ROAD_JOINT_MODELS, ROAD_PIECE_MODELS, ZEBRA_JOINT_MODELS, type ModelId } from './models';
import { footprintOf, heightScale, OBJECT_KINDS, OBJECTS } from './objects';
import { RETIRED_TOOLS, TOOL_CATEGORIES, TOOLS, toolsInCategory, variantIcon, type ToolLayer } from './tools';
import { createGlbLoader, PUBLIC_DIR, publicPath } from '../testing/gltfNode';


const JOINT_MODELS: readonly ModelId[] = [ROAD_JOINT_MODELS, ZEBRA_JOINT_MODELS].flatMap((table) => Object.values(table).flatMap((byLots) => Object.values(byLots)));

/** Normalised (scaled + rotationOffset) size of each model. */
const sizes = new Map<ModelId, THREE.Vector3>();
const carSizes = new Map<string, THREE.Vector3>();

beforeAll(async () => {
  const load = await createGlbLoader();
  for (const [id, spec] of Object.entries(MODELS) as Array<[ModelId, (typeof MODELS)[ModelId]]>) {
    const gltf = await load(spec.url);
    const root = new THREE.Group();
    root.add(gltf.scene);
    gltf.scene.scale.setScalar(spec.scale);
    gltf.scene.rotation.y = (spec.rotationOffset * Math.PI) / 2;
    root.updateMatrixWorld(true);
    sizes.set(id, new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()));
  }
  for (const name of CAR_FILES) {
    const gltf = await load(`/assets/models/cars/${name}.glb`);
    gltf.scene.scale.setScalar(CAR_SCALE);
    gltf.scene.updateMatrixWorld(true);
    carSizes.set(name, new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()));
  }
}, 60_000);

/** Size as drawn: normalised size × MODEL_STYLES non-uniform scale. */
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

  it('placing tools use their own tool-<id>.png icon (+ tool-<id>-v<n>.png per extra model), and the icons folder holds nothing else', () => {
    const placing = TOOLS.filter((tool) => tool.category !== 'mode');
    for (const tool of placing) expect(tool.icon, tool.id).toBe(`/assets/icons/tool-${tool.id}.png`);
    const variantIcons = placing.flatMap((tool) => {
      const def = tool.layer === 'object' ? OBJECTS[tool.id as keyof typeof OBJECTS] : null;
      return def ? Array.from({ length: def.variants - 1 }, (_, i) => `tool-${tool.id}-v${i + 1}.png`) : [];
    });
    const files = fs.readdirSync(path.join(PUBLIC_DIR, 'assets/icons')).filter((f) => !f.startsWith('.')).sort();
    expect(files).toEqual([...placing.map((tool) => `tool-${tool.id}.png`), ...variantIcons].sort());
  });

  it('variant picker: model 0 is the tool icon, the others tool-<id>-v<n>.png', () => {
    for (const tool of TOOLS.filter((t) => t.layer === 'object')) {
      const def = OBJECTS[tool.id as keyof typeof OBJECTS];
      expect(variantIcon(tool.id, 0)).toBe(tool.icon);
      for (let n = 1; n < def.variants; n++) expect(variantIcon(tool.id, n)).toBe(`/assets/icons/tool-${tool.id}-v${n}.png`);
    }
  });

  it('every category has at most 12 tools (digits 1–9 reach the first nine; ~12 fill a desktop row)', () => {
    for (const { id } of TOOL_CATEGORIES) {
      expect(toolsInCategory(id).length, id).toBeGreaterThan(0);
      expect(toolsInCategory(id).length, id).toBeLessThanOrEqual(12);
    }
  });

  it('every tool except the Move and Bulldoze modes belongs to a dock category', () => {
    const categories = new Set<string>(TOOL_CATEGORIES.map((c) => c.id));
    for (const tool of TOOLS) {
      if (tool.id === 'bulldoze' || tool.id === 'move') expect(tool.category).toBe('mode');
      else expect(categories.has(tool.category), `${tool.id}: ${tool.category}`).toBe(true);
    }
    expect(TOOLS.filter((tool) => tool.category === 'mode').map((tool) => [tool.id, tool.layer, tool.icon])).toEqual([
      ['move', 'move', '/assets/ui/move.svg'],
      ['bulldoze', 'bulldoze', '/assets/ui/bulldoze.svg'],
    ]);
  });

  it('within a category tools run ground → edge → object', () => {
    const rank: Record<ToolLayer, number> = { ground: 0, edge: 1, object: 2, move: 3, bulldoze: 4 };
    for (const { id } of TOOL_CATEGORIES) {
      const ranks = toolsInCategory(id).map((tool) => rank[tool.layer]);
      expect(ranks, id).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('every ObjectKind has exactly one object tool (none once retired), and every object tool an ObjectDef', () => {
    for (const kind of OBJECT_KINDS) {
      expect(TOOLS.filter((tool) => tool.id === kind && tool.layer === 'object'), kind).toHaveLength(RETIRED_TOOLS.has(kind) ? 0 : 1);
    }
    for (const tool of TOOLS.filter((t) => t.layer === 'object')) expect(OBJECT_KINDS, tool.id).toContain(tool.id);
  });

  it('every edge kind has a model and an edge tool', () => {
    for (const kind of Object.keys(EDGE_MODELS)) {
      expect(TOOLS.filter((tool) => tool.id === kind && tool.layer === 'edge'), kind).toHaveLength(1);
    }
  });

  it('retired tools are out of the dock but their kinds still load and draw (old saves, town files)', () => {
    for (const id of RETIRED_TOOLS) {
      expect(TOOLS.some((tool) => tool.id === id), id).toBe(false);
      expect(id in OBJECTS || id in GROUND_MODELS, id).toBe(true);
    }
  });

  it('tool ids are unique', () => {
    expect(new Set(TOOLS.map((tool) => tool.id)).size).toBe(TOOLS.length);
  });

  it('every object/edge/ground/road reference points at a registered model', () => {
    const ids = new Set(Object.keys(MODELS));
    for (const def of Object.values(OBJECTS)) for (const m of def.models) expect(ids.has(m), `${def.kind} → ${m}`).toBe(true);
    for (const m of Object.values(ROAD_PIECE_MODELS)) expect(ids.has(m)).toBe(true);
    for (const m of JOINT_MODELS) expect(ids.has(m), m).toBe(true);
    for (const m of Object.values(EDGE_MODELS)) expect(ids.has(m)).toBe(true);
    for (const v of Object.values(GROUND_MODELS)) if (v.type === 'model') expect(ids.has(v.model)).toBe(true);
  });

  it('road tiles (car-park joints too) fill one 2 × 2 road block at road height; pavement tiles fill one cell with the kerb-height top', () => {
    const roadHeight = sizes.get('road-straight')!.y;
    for (const id of [...Object.values(ROAD_PIECE_MODELS), ...JOINT_MODELS]) {
      const size = sizes.get(id)!;
      expect(size.x, `${id} x`).toBeCloseTo(ROAD_TILE_SIZE, 1);
      expect(size.z, `${id} z`).toBeCloseTo(ROAD_TILE_SIZE, 1);
      expect(size.y, `${id} y`).toBeCloseTo(roadHeight, 3);
    }
    // Joints keep their Kenney piece's native turn.
    for (const [piece, byLots] of Object.entries(ROAD_JOINT_MODELS)) {
      for (const id of Object.values(byLots)) expect(MODELS[id].rotationOffset, id).toBe(MODELS[ROAD_PIECE_MODELS[piece as keyof typeof ROAD_PIECE_MODELS]].rotationOffset);
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
      if (def.roadFeature || def.roadMarking) continue; // flat road pieces: checked below
      def.models.forEach((id, variant) => {
        const size = drawn(id);
        const [ox, , oz] = MODELS[id].offset ?? [0, 0, 0];
        const [fw, fd] = footprintOf(def, variant);
        // Centred on the footprint then offset: the far side reaches size/2 + |offset| from the centre.
        expect(size.x / 2 + Math.abs(ox), `${id} width`).toBeLessThanOrEqual((fw * CELL_SIZE) / 2 + 0.03);
        expect(size.z / 2 + Math.abs(oz), `${id} depth`).toBeLessThanOrEqual((fd * CELL_SIZE) / 2 + 0.03);
        expect(size.y, `${id} height`).toBeGreaterThan(0.1);
      });
    }
  });

  it('footprints of every object kind', () => {
    const footprints = Object.fromEntries(Object.values(OBJECTS).map((def) => [def.kind, def.footprint]));
    expect(footprints).toEqual({
      roundabout: [6, 6], parking: [4, 2], 'zebra-crossing': [2, 2], 'traffic-light': [1, 1], lamppost: [1, 1], 'bus-stop': [2, 1], postbox: [1, 1],
      mailbox: [1, 1],
      cottage: [4, 4], townhouse: [3, 4], bungalow: [4, 4], 'family-home': [4, 4], 'garage-house': [4, 4], 'big-house': [5, 4],
      'corner-shop': [3, 3], 'donut-shop': [3, 3], supermarket: [5, 4], church: [3, 4], stadium: [14, 11], cinema: [6, 4], 'swimming-pool': [4, 3], fountain: [2, 2],
      'tiered-fountain': [3, 3],
      oak: [2, 2], pine: [1, 1], birch: [1, 1], bush: [1, 1], tulips: [1, 1],
      planter: [1, 1], bench: [1, 1], 'long-bench': [1, 1], 'garden-table': [1, 1], swing: [2, 1], slide: [2, 1], barbecue: [1, 1],
    });
    // Only parking lots differ in size per style: small, medium, large (style 0 is `footprint`).
    expect(Object.values(OBJECTS).filter((def) => def.footprints).map((def) => def.kind)).toEqual(['parking']);
    expect(OBJECTS.parking.footprints).toEqual([[4, 2], [4, 4], [4, 6]]);
    for (const def of Object.values(OBJECTS)) {
      if (def.footprints) expect(def.footprints, def.kind).toHaveLength(def.variants);
      expect(footprintOf(def, def.variants), `${def.kind} unknown style`).toEqual(def.footprint);
    }
  });

  it('objects stay inside their footprint at every rotation (drawn bounds turned with the object)', () => {
    for (const def of Object.values(OBJECTS)) {
      if (def.roadFeature) continue;
      def.models.forEach((id, variant) => {
        const size = drawn(id);
        const [ox, , oz] = MODELS[id].offset ?? [0, 0, 0];
        // Model-space box (footprint-centred, then offset), turned like TownRenderer turns the object.
        const box = new THREE.Box3(new THREE.Vector3(ox - size.x / 2, 0, oz - size.z / 2), new THREE.Vector3(ox + size.x / 2, size.y, oz + size.z / 2));
        for (const rotation of [0, 1, 2, 3] as const) {
          const turned = box.clone().applyMatrix4(new THREE.Matrix4().makeRotationY((rotation * Math.PI) / 2));
          const [fw, fd] = footprintOf(def, variant);
          const [w, d] = rotation % 2 === 0 ? [fw, fd] : [fd, fw];
          const halfW = (w * CELL_SIZE) / 2 + 0.03;
          const halfD = (d * CELL_SIZE) / 2 + 0.03;
          expect(Math.max(-turned.min.x, turned.max.x), `${id} r${rotation} x`).toBeLessThanOrEqual(halfW);
          expect(Math.max(-turned.min.z, turned.max.z), `${id} r${rotation} z`).toBeLessThanOrEqual(halfD);
        }
      });
    }
  });

  it('homes and town buildings fill their lot (≥ 80 % of it along their longer fit)', () => {
    const grown = Object.values(OBJECTS).filter((def) => def.group === 'home' || ['corner-shop', 'supermarket', 'church', 'stadium'].includes(def.kind));
    expect(grown).toHaveLength(10);
    for (const def of grown) {
      for (const id of def.models) {
        const size = drawn(id);
        const fill = Math.max(size.x / (def.footprint[0] * CELL_SIZE), size.z / (def.footprint[1] * CELL_SIZE));
        expect(fill, id).toBeGreaterThanOrEqual(0.8);
      }
    }
  });

  it('the swing is 10–15 % smaller than its native 0.56 wide set, on 2 × 1 cells', () => {
    expect(OBJECTS.swing.footprint).toEqual([2, 1]);
    expect(MODELS.swing.scale).toBeGreaterThanOrEqual(0.85);
    expect(MODELS.swing.scale).toBeLessThanOrEqual(0.9);
    expect(drawn('swing').x).toBeLessThan(0.5);
  });

  it('road features fill their style\'s whole footprint (whole road blocks); the roundabout is road-tile height', () => {
    const roadHeight = sizes.get('road-straight')!.y;
    const features = Object.values(OBJECTS).filter((def) => def.roadFeature);
    expect(features.map((def) => def.kind)).toEqual(['roundabout', 'parking']);
    for (const def of features) {
      def.models.forEach((id, variant) => {
        const [w, d] = footprintOf(def, variant);
        expect(w % 2, `${id} blocks`).toBe(0);
        expect(d % 2, `${id} blocks`).toBe(0);
        const size = drawn(id);
        expect(size.x, `${id} width`).toBeCloseTo(w * CELL_SIZE, 1);
        expect(size.z, `${id} depth`).toBeCloseTo(d * CELL_SIZE, 1);
      });
    }
    expect(drawn('roundabout').y).toBeCloseTo(roadHeight, 2);
  });

  it('parking lots lie at road height round their whole rim (only the sign and bushes stand up, inside it)', async () => {
    const roadHeight = sizes.get('road-straight')!.y;
    const load = await createGlbLoader();
    for (const id of OBJECTS.parking.models) {
      const gltf = await load(MODELS[id].url);
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const v = new THREE.Vector3();
      let rim = 0;
      gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const position = mesh.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i += 1) {
          v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
          const onRim = v.x - box.min.x < 0.01 || box.max.x - v.x < 0.01 || v.z - box.min.z < 0.01 || box.max.z - v.z < 0.01;
          if (!onRim) continue;
          rim += 1;
          expect(v.y, `${id} rim vertex at ${v.x.toFixed(2)}, ${v.z.toFixed(2)}`).toBeLessThanOrEqual(roadHeight + 0.001);
        }
      });
      expect(rim, id).toBeGreaterThan(0);
      // Taller than a road (the sign), but no taller than a lamppost.
      expect(drawn(id).y, id).toBeLessThan(drawn('lamppost').y);
    }
  });
});

/** Toy scale: 1 world unit ≈ 8 m, a cell ≈ 4 m. */
describe('proportions', () => {
  const LANE = 0.37;
  const h = (id: ModelId) => drawn(id).y;
  const cars = () => [...carSizes.values()];

  it('tree heights: pine ×2, oak and birch natural; only the pine stretches, and the tallest stays under the church', () => {
    const TREE_JITTER = 1.12; // TownRenderer: ±12% per-tree size
    expect(heightScale(OBJECTS.pine)).toBe(2);
    expect(heightScale(OBJECTS.oak)).toBe(1);
    expect(heightScale(OBJECTS.birch)).toBe(1);
    for (const kind of OBJECT_KINDS) {
      const def = OBJECTS[kind];
      if (def.group !== 'tree') {
        expect(def.height, kind).toBeUndefined();
        continue;
      }
      for (const model of def.models) {
        expect(h(model) * heightScale(def) * TREE_JITTER, `${kind}/${model}`).toBeLessThan(h('church'));
      }
    }
  });

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
    for (const car of cars()) expect(car.x).toBeLessThan(LANE);
  });

  it('every home is more than two car lengths along its longer side', () => {
    const carLength = Math.max(...cars().map((c) => c.z));
    for (const def of Object.values(OBJECTS).filter((d) => d.group === 'home')) {
      for (const id of def.models) expect(Math.max(drawn(id).x, drawn(id).z) / carLength, id).toBeGreaterThan(2);
    }
  });

  it('trees reach about the cottage roof (75–100 % of its height) and stay below the townhouse ridges', () => {
    const cottage = h('cottage');
    const townhouseRidge = Math.min(h('townhouse'), h('townhouse-alt'));
    for (const tree of ['pine', 'birch'] as const) {
      expect(h(tree) / cottage, `${tree} vs cottage`).toBeGreaterThan(0.75);
      expect(h(tree) / cottage, `${tree} vs cottage`).toBeLessThan(1);
      expect(h(tree), `${tree} vs townhouse`).toBeLessThan(townhouseRidge);
    }
  });

  it('the oak is the big tree: its crown fills its 2 × 2 cell lot, it is taller than a cottage and below the church', () => {
    const [w, d] = OBJECTS.oak.footprint;
    const lot = w * CELL_SIZE;
    expect([w, d]).toEqual([2, 2]);
    expect(drawn('oak').x, 'oak width').toBeGreaterThan(0.9 * lot);
    expect(drawn('oak').z, 'oak depth').toBeGreaterThan(0.9 * lot);
    // ±12 % per-tree size jitter (TownRenderer) may push the crown a little past the lot, never far.
    expect(drawn('oak').x * 1.12).toBeLessThan(1.25 * lot);
    expect(h('oak')).toBeGreaterThan(h('cottage'));
    expect(h('oak') * 1.12).toBeLessThan(h('church'));
  });

  it('the lamppost is taller than the bus stop, and below the eaves', () => {
    const lamp = h('lamppost');
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

  it('the stadium floodlights are the tallest thing, the church tower the tallest of the rest', () => {
    for (const def of Object.values(OBJECTS)) {
      if (def.kind === 'church' || def.kind === 'stadium' || def.roadFeature) continue;
      for (const id of def.models) expect(h(id) * heightScale(def), id).toBeLessThan(h('church'));
    }
    expect(h('stadium')).toBeGreaterThan(h('church'));
    expect(h('stadium')).toBeCloseTo(2.85, 2);
  });

  it('everything stays under the birds, and the birds inside the sun-shadow frustum', () => {
    const TREE_JITTER = 1.12;
    for (const def of Object.values(OBJECTS)) {
      const jitter = def.group === 'tree' || def.group === 'plant' ? TREE_JITTER : 1;
      for (const id of def.models) expect(h(id) * heightScale(def) * jitter, id).toBeLessThan(ALTITUDE[0] - 0.2);
    }
    expect(ALTITUDE[1]).toBeLessThan(PLOT_CONTENT_HEIGHT);
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
