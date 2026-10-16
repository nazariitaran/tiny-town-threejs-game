import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { GROUND_MODELS } from '../catalog/models';
import { OBJECTS } from '../catalog/objects';
import { CELL_SIZE, GROUND_Y, PLOT_DEPTH, PLOT_WIDTH, setPlotSize, TOWN_PLOTS, worldToGridPoint } from '../game/config';
import { createGameBus } from '../game/events';
import { objectOrigin } from '../render/objectPose';
import { buildSampleTown } from '../town/sampleTown';
import { TownEditor } from '../town/TownEditor';
import { TownState } from '../town/TownState';
import type { GroundKind, ObjectKind, PlacedObject, Rotation, TownChange } from '../town/types';
import { createSeededRandom } from '../utils/random';
import {
  affectsSplashSurface,
  rasterSplashSurface,
  SPLASH_FOUNTAIN,
  SPLASH_GROUND,
  SPLASH_PITCH,
  SPLASH_POND,
  SPLASH_POOL,
  SPLASH_POOL_TERRACE,
  SPLASH_ROAD,
  SPLASH_SURFACE_STRIDE,
  SPLASH_SURFACES,
  SPLASH_TEXELS_PER_CELL,
  SPLASH_TIERED_FOUNTAIN,
  SURFACE_SHAPES,
} from './splashSurface';

const S = SPLASH_SURFACE_STRIDE;
const T = SPLASH_TEXELS_PER_CELL;
const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

const newMap = (): Uint8Array => new Uint8Array(S * S);

function paint(town: TownState, kind: GroundKind, x0: number, z0: number, x1 = x0, z1 = z0): void {
  const changes: TownChange[] = [];
  for (let z = z0; z <= z1; z += 1) {
    for (let x = x0; x <= x1; x += 1) changes.push({ layer: 'ground', cell: { x, z }, before: town.getGround({ x, z }), after: kind });
  }
  town.applyChanges(changes);
}

let nextId = 1;
function place(town: TownState, kind: ObjectKind, x: number, z: number, rotation: Rotation = 0): PlacedObject {
  const object: PlacedObject = { id: nextId++, kind, anchor: { x, z }, rotation, variant: 0 };
  town.applyChanges([{ layer: 'object', op: 'add', object }]);
  return object;
}

function countWater(map: Uint8Array): number {
  let n = 0;
  for (const id of map) if (SPLASH_SURFACES[id].water) n += 1;
  return n;
}

function raster(town: TownState, map = newMap()): Uint8Array {
  const water = rasterSplashSurface(town, map, S);
  expect(water).toBe(countWater(map));
  return map;
}

const at = (map: Uint8Array, tx: number, tz: number): number => map[tz * S + tx];

const origin = new THREE.Matrix4();
const point = new THREE.Vector3();
const grid = { x: 0, z: 0 };

/** Texel under model-space point (x, z) of `object`, placed by the renderer's own transform. */
function texelOf(object: PlacedObject, x: number, z: number): [number, number] {
  objectOrigin(object, OBJECTS[object.kind], origin);
  point.set(x, 0, z).applyMatrix4(origin);
  worldToGridPoint(point.x, point.z, grid);
  return [Math.floor(grid.x * T), Math.floor(grid.z * T)];
}

const idAt = (map: Uint8Array, object: PlacedObject, x: number, z: number): number => at(map, ...texelOf(object, x, z));

/** Bounds [tx0, tz0, tx1, tz1] (inclusive) of the texels holding `id`, or null. */
function boundsOf(map: Uint8Array, id: number): [number, number, number, number] | null {
  let b: [number, number, number, number] | null = null;
  for (let i = 0; i < map.length; i += 1) {
    if (map[i] !== id) continue;
    const tx = i % S;
    const tz = Math.floor(i / S);
    b = b ? [Math.min(b[0], tx), Math.min(b[1], tz), Math.max(b[2], tx), Math.max(b[3], tz)] : [tx, tz, tx, tz];
  }
  return b;
}

afterEach(() => setPlotSize(PLOT_WIDTH, PLOT_DEPTH));

describe('splash surfaces', () => {
  it('lists every surface by its id, a ring a little above its surface, the ground at the old splash height', () => {
    const ids = [SPLASH_GROUND, SPLASH_ROAD, SPLASH_POND, SPLASH_POOL, SPLASH_POOL_TERRACE, SPLASH_FOUNTAIN, SPLASH_TIERED_FOUNTAIN, SPLASH_PITCH];
    expect(ids).toEqual(SPLASH_SURFACES.map((_, i) => i));
    expect(SPLASH_SURFACES.filter((s) => s.water).map((s) => SPLASH_SURFACES.indexOf(s))).toEqual([SPLASH_POND, SPLASH_POOL, SPLASH_FOUNTAIN, SPLASH_TIERED_FOUNTAIN]);
    for (const surface of SPLASH_SURFACES) {
      expect(surface.y - surface.top).toBeGreaterThanOrEqual(0.004 - 1e-9);
      expect(surface.y - surface.top).toBeLessThanOrEqual(0.0065);
      expect(surface.size).toBeGreaterThan(0);
      // Ripples on water read fainter than splashes on land, so water rings are drawn stronger.
      if (surface.water) expect(surface.strength).toBeGreaterThan(1);
      else expect(surface.strength).toBe(1);
    }
    expect(SPLASH_SURFACES[SPLASH_GROUND]).toMatchObject({ top: GROUND_Y, y: GROUND_Y + 0.006, size: 1, strength: 1 });
    const pond = GROUND_MODELS.pond;
    expect(pond.type === 'flat' && pond.height).toBe(SPLASH_SURFACES[SPLASH_POND].top);
  });

  it('has a stride for the largest plot, 4 texels a cell', () => {
    expect(T).toBe(4);
    expect(S).toBe(Math.max(...Object.values(TOWN_PLOTS).flatMap((p) => [p.width, p.depth])) * 4);
    expect(S).toBe(336);
  });

  it('gives every shape a known surface', () => {
    for (const shapes of Object.values(SURFACE_SHAPES)) for (const shape of shapes) expect(shape.id).toBeLessThan(SPLASH_SURFACES.length);
  });
});

describe('rasterSplashSurface', () => {
  it('maps an empty town to ground, with no water', () => {
    const map = newMap().fill(9);
    expect(rasterSplashSurface(new TownState(64, 64), map, S)).toBe(0);
    expect(map.every((id) => id === SPLASH_GROUND)).toBe(true);
  });

  it('marks pond and road cells, 4 × 4 texels each, up to the plot edges', () => {
    const town = new TownState(64, 64);
    paint(town, 'pond', 0, 0);
    paint(town, 'pond', 63, 63);
    paint(town, 'road', 62, 0, 63, 1);
    const map = raster(town);
    expect(rasterSplashSurface(town, map, S)).toBe(2 * 16);
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        expect(at(map, i, j)).toBe(SPLASH_POND);
        expect(at(map, 252 + i, 252 + j)).toBe(SPLASH_POND);
        expect(at(map, 248 + i, j)).toBe(SPLASH_ROAD);
        expect(at(map, 252 + i, 4 + j)).toBe(SPLASH_ROAD);
      }
    }
    expect(at(map, 4, 0)).toBe(SPLASH_GROUND);
    expect(at(map, 0, 4)).toBe(SPLASH_GROUND);
    expect(at(map, 247, 0)).toBe(SPLASH_GROUND);
    expect(at(map, 256, 0)).toBe(SPLASH_GROUND);
    expect(at(map, 252, 256)).toBe(SPLASH_GROUND);
  });

  it('places the pool as the renderer draws it, at every rotation (the footprint turns at 1 and 3)', () => {
    for (const rotation of ROTATIONS) {
      const town = new TownState(64, 64);
      const pool = place(town, 'swimming-pool', 10, 20, rotation);
      const map = raster(town);
      expect(idAt(map, pool, 0.5, -0.45), `r${rotation}`).toBe(SPLASH_POOL);
      expect(idAt(map, pool, -0.6, 0.05), `r${rotation}`).toBe(SPLASH_POOL);
      expect(idAt(map, pool, -0.95, -0.7), `r${rotation}`).toBe(SPLASH_POOL_TERRACE);
      expect(idAt(map, pool, 0.95, 0.0), `r${rotation}`).toBe(SPLASH_POOL_TERRACE);
      expect(idAt(map, pool, 0.6, 0.6), `r${rotation}`).toBe(SPLASH_GROUND);
      expect(idAt(map, pool, -0.9, 0.7), `r${rotation}`).toBe(SPLASH_GROUND);

      // The water's texels are exactly those its corners, turned by the renderer, span.
      const [ax, az] = texelOf(pool, -0.7 + 1e-4, -0.6 + 1e-4);
      const [bx, bz] = texelOf(pool, 0.7 - 1e-4, 0.1 - 1e-4);
      expect(boundsOf(map, SPLASH_POOL), `r${rotation}`).toEqual([Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)]);
      // The terrace (with the water on it) fills its rect, 8 × 16 texels when turned a quarter.
      const [cx, cz] = texelOf(pool, -1 + 1e-4, -0.75 + 1e-4);
      const [dx, dz] = texelOf(pool, 1 - 1e-4, 0.25 - 1e-4);
      const terrace = boundsOf(map.map((id) => (id === SPLASH_POOL ? SPLASH_POOL_TERRACE : id)), SPLASH_POOL_TERRACE);
      expect(terrace, `r${rotation}`).toEqual([Math.min(cx, dx), Math.min(cz, dz), Math.max(cx, dx), Math.max(cz, dz)]);
      expect(terrace![2] - terrace![0] + 1).toBe(rotation % 2 === 0 ? 16 : 8);
    }
  });

  it('turns model +z onto world +x at rotation 1, as three turns a quarter about +y', () => {
    const town = new TownState(64, 64);
    const pool = place(town, 'swimming-pool', 10, 20, 1);
    const map = raster(town);
    // The front strip (model +z, ground) lies east; the back of the terrace (model −z) lies west.
    const [cx, cz] = texelOf(pool, 0, 0);
    expect(at(map, cx + 5, cz)).toBe(SPLASH_GROUND);
    expect(at(map, cx - 6, cz)).toBe(SPLASH_POOL_TERRACE);
    const front = texelOf(pool, 0, 0.5);
    expect(front[0] - cx).toBe(4);
    expect(front[1]).toBe(cz);
  });

  it('covers every texel a fountain basin touches, and nothing outside its footprint', () => {
    for (const [kind, id] of [['fountain', SPLASH_FOUNTAIN], ['tiered-fountain', SPLASH_TIERED_FOUNTAIN]] as const) {
      for (const rotation of ROTATIONS) {
        const town = new TownState(64, 64);
        const fountain = place(town, kind, 30, 31, rotation);
        const map = raster(town);
        const shape = SURFACE_SHAPES[OBJECTS[kind].models[0]]![0];
        if (!('circle' in shape)) throw new Error(`${kind}: expected a circle`);
        const r = (shape.circle[2] / CELL_SIZE) * T;
        objectOrigin(fountain, OBJECTS[kind], origin);
        point.set(0, 0, 0).applyMatrix4(origin);
        worldToGridPoint(point.x, point.z, grid);
        const cx = grid.x * T;
        const cz = grid.z * T;
        const size = OBJECTS[kind].footprint[0];
        let water = 0;
        let centreOutside = 0;
        for (let tz = 0; tz < 256; tz += 1) {
          for (let tx = 0; tx < 256; tx += 1) {
            const nx = Math.max(tx - cx, 0, cx - tx - 1);
            const nz = Math.max(tz - cz, 0, cz - tz - 1);
            const touches = nx * nx + nz * nz < r * r;
            expect(at(map, tx, tz) === id, `${kind} r${rotation} (${tx}, ${tz})`).toBe(touches);
            if (touches) {
              water += 1;
              if (Math.hypot(tx + 0.5 - cx, tz + 0.5 - cz) >= r) centreOutside += 1;
              expect(tx >= 30 * T && tx < (30 + size) * T && tz >= 31 * T && tz < (31 + size) * T).toBe(true);
            }
          }
        }
        expect(rasterSplashSurface(town, map, S)).toBe(water);
        expect(centreOutside).toBeGreaterThan(0);
      }
    }
  });

  it('claims land by texel centre: the pitch stops at the texel whose centre leaves it', () => {
    const town = new TownState(84, 84);
    setPlotSize(84, 84);
    const stadium = place(town, 'stadium', 20, 30, 1);
    const map = raster(town);
    const [x0, z0, x1, z1] = (SURFACE_SHAPES.stadium![0] as { rect: readonly number[] }).rect;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx < 0 ? x0 : x1;
        const z = sz < 0 ? z0 : z1;
        expect(idAt(map, stadium, x - sx * 0.07, z - sz * 0.07)).toBe(SPLASH_PITCH);
        expect(idAt(map, stadium, x + sx * 0.07, z + sz * 0.07)).toBe(SPLASH_GROUND);
      }
    }
    // Turned a quarter, model +x runs to world −z. The pitch (to x1 = 2.03) covers a quarter of the texel
    // 17 rows north of the centre, not its centre.
    const [cx, cz] = texelOf(stadium, 0, 0);
    const [ex, ez] = texelOf(stadium, x1 - 1e-4, 0);
    expect([ex, ez]).toEqual([cx, cz - 17]);
    expect(at(map, ex, ez)).toBe(SPLASH_GROUND);
    expect(at(map, ex, ez + 1)).toBe(SPLASH_PITCH);
    expect(rasterSplashSurface(town, map, S)).toBe(0);
  });

  it('keeps road rings on the roundabout asphalt only: its island, kerbs and corners take ground rings', () => {
    for (const rotation of ROTATIONS) {
      const town = new TownState(64, 64);
      paint(town, 'road', 20, 22, 25, 27);
      const roundabout = place(town, 'roundabout', 20, 22, rotation);
      const map = raster(town);
      const label = `r${rotation}`;
      for (const [x, z] of [[0.05, 0.05], [-0.1, 0.2], [0.3, -0.05]]) expect(idAt(map, roundabout, x, z), `${label} island (${x}, ${z})`).toBe(SPLASH_GROUND);
      for (const [x, z] of [[0.75, 0.75], [-0.6, 0.6], [0, -0.5], [1, 0]]) expect(idAt(map, roundabout, x, z), `${label} ring (${x}, ${z})`).toBe(SPLASH_ROAD);
      for (const [x, z] of [[1.3, 1.3], [-1.4, 1.1], [-1.1, -1.4], [0.95, -0.95]]) expect(idAt(map, roundabout, x, z), `${label} corner (${x}, ${z})`).toBe(SPLASH_GROUND);
      for (const [x, z] of [[0.05, 1.45], [-0.3, -1.45], [1.45, 0.3], [-1.45, -0.05]]) expect(idAt(map, roundabout, x, z), `${label} arm (${x}, ${z})`).toBe(SPLASH_ROAD);
      for (const [x, z] of [[0.45, 1.45], [-1.45, 0.45]]) expect(idAt(map, roundabout, x, z), `${label} arm kerb (${x}, ${z})`).toBe(SPLASH_GROUND);
      // Nothing past its footprint changes.
      expect(at(map, 20 * T - 1, 22 * T)).toBe(SPLASH_GROUND);
      expect(rasterSplashSurface(town, map, S)).toBe(0);
    }
  });

  it('lets water win over the land of its own object, and the lower water win over the higher', () => {
    const town = new TownState(64, 64);
    place(town, 'swimming-pool', 4, 4);
    const map = raster(town);
    const water = boundsOf(map, SPLASH_POOL)!;
    const terrace = boundsOf(map, SPLASH_POOL_TERRACE)!;
    expect(rasterSplashSurface(town, map, S)).toBe(12 * 6);
    expect(water[0]).toBeGreaterThan(terrace[0]);
    expect(water[1]).toBeGreaterThan(terrace[1]);
    expect(water[2]).toBeLessThan(terrace[2]);
    expect(water[3]).toBeLessThan(terrace[3]);
    for (let tz = water[1]; tz <= water[3]; tz += 1) for (let tx = water[0]; tx <= water[2]; tx += 1) expect(at(map, tx, tz)).toBe(SPLASH_POOL);

    // Rules keep fountains off ponds; the map still has to pick one surface if one stands there.
    const wet = new TownState(64, 64);
    paint(wet, 'pond', 10, 10, 10, 11);
    place(wet, 'fountain', 10, 10);
    const wetMap = raster(wet);
    let fountain = 0;
    let pond = 0;
    for (const id of wetMap) {
      if (id === SPLASH_FOUNTAIN) fountain += 1;
      if (id === SPLASH_POND) pond += 1;
    }
    expect(pond).toBe(2 * 16);
    expect(fountain).toBeGreaterThan(0);
    for (let tz = 40; tz < 48; tz += 1) for (let tx = 40; tx < 44; tx += 1) expect(at(wetMap, tx, tz)).toBe(SPLASH_POND);
    expect(rasterSplashSurface(wet, wetMap, S)).toBe(pond + fountain);
  });

  it('indexes a Large plot by its full stride and clears what a bigger town left behind', () => {
    const large = new TownState(84, 84);
    paint(large, 'pond', 0, 0, 83, 83);
    const map = newMap();
    expect(rasterSplashSurface(large, map, S)).toBe(84 * 84 * 16);
    expect(at(map, 335, 335)).toBe(SPLASH_POND);
    paint(large, 'road', 83, 0);
    raster(large, map);
    expect(at(map, 332, 0)).toBe(SPLASH_ROAD);
    expect(at(map, 335, 3)).toBe(SPLASH_ROAD);
    expect(at(map, 331, 0)).toBe(SPLASH_POND);

    const small = new TownState(64, 64);
    paint(small, 'pond', 63, 63);
    expect(rasterSplashSurface(small, map, S)).toBe(16);
    expect(countWater(map)).toBe(16);
    expect(at(map, 255, 255)).toBe(SPLASH_POND);
    expect(at(map, 256, 0)).toBe(SPLASH_GROUND);
    expect(at(map, 0, 256)).toBe(SPLASH_GROUND);
  });

  it('refuses a map too small for the town', () => {
    expect(() => rasterSplashSurface(new TownState(84, 84), new Uint8Array(256 * 256), 256)).toThrow(RangeError);
    expect(() => rasterSplashSurface(new TownState(64, 64), new Uint8Array(100), 256)).toThrow(RangeError);
  });

  it('maps the sample town: its pond, pools and fountains are water', () => {
    const editor = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(1));
    buildSampleTown(editor);
    let ponds = 0;
    for (let z = 0; z < PLOT_DEPTH; z += 1) for (let x = 0; x < PLOT_WIDTH; x += 1) if (editor.state.getGround({ x, z }) === 'pond') ponds += 1;
    const map = newMap();
    const water = rasterSplashSurface(editor.state, map, S);
    expect(water).toBe(countWater(map));
    expect(ponds).toBeGreaterThan(0);
    expect(water).toBeGreaterThanOrEqual(ponds * 16);
  });
});

describe('affectsSplashSurface', () => {
  const object = (kind: ObjectKind): TownChange => ({ layer: 'object', op: 'add', object: { id: 1, kind, anchor: { x: 0, z: 0 }, rotation: 0, variant: 0 } });
  const ground = (before: GroundKind, after: GroundKind): TownChange => ({ layer: 'ground', cell: { x: 0, z: 0 }, before, after });

  it('is true for a load or reset, whatever changed', () => {
    expect(affectsSplashSurface([], 'load')).toBe(true);
    expect(affectsSplashSurface([], 'reset')).toBe(true);
  });

  it('is true for pond and road ground, either way', () => {
    expect(affectsSplashSurface([ground('field', 'pond')], 'edit')).toBe(true);
    expect(affectsSplashSurface([ground('pond', 'grass')], 'undo')).toBe(true);
    expect(affectsSplashSurface([ground('road', 'field')], 'redo')).toBe(true);
    expect(affectsSplashSurface([ground('grass', 'pavement')], 'edit')).toBe(false);
  });

  it('is true for objects with a surface shape, and only those', () => {
    for (const kind of ['swimming-pool', 'fountain', 'tiered-fountain', 'stadium', 'roundabout'] as const) expect(affectsSplashSurface([object(kind)], 'edit'), kind).toBe(true);
    for (const kind of ['cottage', 'lily-pads', 'bird-house', 'bench'] as const) expect(affectsSplashSurface([object(kind)], 'edit'), kind).toBe(false);
    expect(affectsSplashSurface([{ layer: 'edge', op: 'add', placed: { kind: 'hedge', edge: { x: 1, z: 1, side: 'n' } } }], 'edit')).toBe(false);
    expect(affectsSplashSurface([object('bench'), ground('field', 'road')], 'edit')).toBe(true);
  });
});
