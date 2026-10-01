/**
 * WP-16b night lights: the lamp registry (add / remove / undo / reset / load), lamp-head world
 * positions, the UV-cell centroid measurement, and NightLights' visibility / draw-call rules
 * (driven headless: no renderer, the scene's onBeforeRender is called by hand).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CELL_SIZE, cellToWorld, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { createGameBus } from '../game/events';
import { LifeSystem } from '../life/LifeSystem';
import { buildSampleTown } from '../town/sampleTown';
import { TownEditor } from '../town/TownEditor';
import { TownState } from '../town/TownState';
import type { PlacedObject, Rotation } from '../town/types';
import { createSeededRandom } from '../utils/random';
import { createDaySample, sampleDay, T_AFTERNOON } from '../world/dayCycle';
import { LampRegistry, measureCellCentroid, objectPointToWorld } from './lampRegistry';
import { ModelLibrary } from './ModelLibrary';
import { MAX_FIREFLIES, pickFireflySpots } from './fireflies';
import { NightLights, VISIBLE_FROM } from './NightLights';

function setup() {
  const bus = createGameBus();
  const town = new TownState(PLOT_WIDTH, PLOT_DEPTH);
  const editor = new TownEditor(town, bus, createSeededRandom(1));
  return { bus, town, editor };
}

const lamp = (id: number, x: number, z: number, rotation: Rotation = 0): PlacedObject => ({ id, kind: 'lamppost', anchor: { x, z }, rotation, variant: 0 });

describe('LampRegistry', () => {
  it('tracks lamppost adds and removes from town:changed facts, ignoring everything else', () => {
    const { town } = setup();
    const registry = new LampRegistry();
    const v0 = registry.version;
    expect(registry.onTownChanged([{ layer: 'object', op: 'add', object: lamp(1, 4, 4) }], 'edit', town)).toBe(true);
    expect(registry.onTownChanged([{ layer: 'object', op: 'add', object: { ...lamp(2, 6, 6), kind: 'bench' } }], 'edit', town)).toBe(false);
    expect(registry.onTownChanged([{ layer: 'ground', cell: { x: 1, z: 1 }, before: 'field', after: 'road' }], 'edit', town)).toBe(false);
    registry.onTownChanged([{ layer: 'object', op: 'add', object: lamp(3, 8, 8) }], 'redo', town);
    expect(registry.count).toBe(2);
    expect(registry.version).toBeGreaterThan(v0);
    const v1 = registry.version;
    registry.onTownChanged([{ layer: 'object', op: 'remove', object: lamp(1, 4, 4) }], 'undo', town);
    expect([...registry.values()].map((l) => l.id)).toEqual([3]);
    expect(registry.version).toBe(v1 + 1);
  });

  it('rebuilds from the town on reset and load', () => {
    const { bus, town, editor } = setup();
    const registry = new LampRegistry();
    bus.on('town:changed', ({ changes, cause }) => registry.onTownChanged(changes, cause, town));
    buildSampleTown(editor);
    const lamps = [...town.objects()].filter((o) => o.kind === 'lamppost').length;
    expect(lamps).toBe(4);
    expect(registry.count).toBe(lamps);
    const save = editor.serialize();
    editor.reset();
    expect(registry.count).toBe(0);
    editor.load(save);
    expect(registry.count).toBe(lamps);
    // A real placement, its undo and redo.
    const before = registry.count;
    expect(editor.apply({ type: 'place-object', kind: 'lamppost', cell: { x: 1, z: 1 }, rotation: 0 }, 'lamppost').ok).toBe(true);
    expect(registry.count).toBe(before + 1);
    editor.undo();
    expect(registry.count).toBe(before);
    editor.redo();
    expect(registry.count).toBe(before + 1);
    // Bulldozing a lamp removes it.
    expect(editor.apply({ type: 'bulldoze', cell: { x: 1, z: 1 }, edge: null }, 'bulldoze').ok).toBe(true);
    expect(registry.count).toBe(before);
  });
});

describe('lamp head positions', () => {
  it('are the footprint centre plus the head turned with the object (scale-agnostic grid helpers)', () => {
    const head = { x: 0, y: 0.653, z: 0.177 };
    const out = { x: 0, y: 0, z: 0 };
    const centre = cellToWorld({ x: 10, z: 12 });
    objectPointToWorld(lamp(1, 10, 12, 0), head, out);
    expect(out.x).toBeCloseTo(centre.x, 6);
    expect(out.z).toBeCloseTo(centre.z + 0.177, 6);
    expect(out.y).toBeCloseTo(0.653, 6);
    // One quarter turn CCW (three +Y): +z → +x.
    objectPointToWorld(lamp(1, 10, 12, 1), head, out);
    expect(out.x).toBeCloseTo(centre.x + 0.177, 6);
    expect(out.z).toBeCloseTo(centre.z, 6);
    objectPointToWorld(lamp(1, 10, 12, 2), head, out);
    expect(out.z).toBeCloseTo(centre.z - 0.177, 6);
    objectPointToWorld(lamp(1, 10, 12, 3), head, out);
    expect(out.x).toBeCloseTo(centre.x - 0.177, 6);
    // Multi-cell footprints are centred like TownRenderer does (a 2 × 2 roundabout-sized check).
    objectPointToWorld({ kind: 'cottage', anchor: { x: 10, z: 12 }, rotation: 0 }, { x: 0, y: 0, z: 0 }, out);
    expect(out.x).toBeGreaterThanOrEqual(centre.x);
    expect(Math.abs(out.x - centre.x) % (CELL_SIZE / 2)).toBeCloseTo(0, 6);
  });

  it('measureCellCentroid: area-weighted centroid of the triangles in one atlas cell', () => {
    // Two triangles in cell (8, 2) (u 0.53, v 0.62) of different sizes, one elsewhere.
    const positions = [
      0, 1, 0, 2, 1, 0, 0, 1, 2, // area 2, centroid (2/3, 1, 2/3)
      10, 1, 10, 11, 1, 10, 10, 1, 11, // area 0.5, centroid (10.33, 1, 10.33)
      50, 0, 50, 51, 0, 50, 50, 0, 51, // other cell
    ];
    const inCell = [0.53, 0.62];
    const other = [0.1, 0.1];
    const uvs = [...inCell, ...inCell, ...inCell, ...inCell, ...inCell, ...inCell, ...other, ...other, ...other];
    const c = measureCellCentroid(positions, uvs, null, 8, 2)!;
    expect(c.triangles).toBe(2);
    expect(c.x).toBeCloseTo((2 * (2 / 3) + 0.5 * (10 + 1 / 3)) / 2.5, 6);
    expect(c.y).toBeCloseTo(1, 6);
    // Indexed geometry gives the same answer.
    const indexed = measureCellCentroid(positions, uvs, [0, 1, 2, 3, 4, 5, 6, 7, 8], 8, 2)!;
    expect(indexed.x).toBeCloseTo(c.x, 6);
    expect(measureCellCentroid(positions, uvs, null, 3, 3)).toBeNull();
  });
});

describe('NightLights (headless)', () => {
  function world(state: 'sample' | 'empty' = 'sample') {
    const { bus, town, editor } = setup();
    const scene = new THREE.Scene();
    let externalHookCalls = 0;
    scene.onBeforeRender = () => {
      externalHookCalls += 1;
    };
    const library = new ModelLibrary(); // nothing loaded: the lamp head falls back to the facts table
    const life = new LifeSystem(scene, town, bus, createSeededRandom(2));
    const lights = new NightLights(scene, library, town, bus, life);
    if (state === 'sample') buildSampleTown(editor);
    lights.populate();
    const render = () => scene.onBeforeRender(null as never, scene, null as never, null as never, null as never, null as never);
    const sample = createDaySample();
    const at = (night: number) => {
      sampleDay(T_AFTERNOON, sample);
      sample.night = night;
      sample.lightsOn = night;
      lights.update(sample);
      render();
    };
    const mesh = (name: string) => scene.getObjectByName(name) as THREE.InstancedMesh | undefined;
    return { bus, town, editor, scene, lights, life, render, at, mesh, hookCalls: () => externalHookCalls };
  }

  it('counts the sample town lamps and adds 0 draw calls by day, pools + halos at night', () => {
    const w = world();
    expect(w.lights.getDiagnostics().lamps).toBe(4);
    w.render(); // warm-up render: every layer drawn once with a zero-scale instance
    expect(w.mesh('night:pool')!.visible).toBe(true);
    expect(w.mesh('night:pool')!.count).toBe(1);
    w.at(0);
    expect(w.lights.getDiagnostics().drawCalls).toBe(0);
    for (const name of ['night:pool', 'night:halo', 'night:beam']) expect(w.mesh(name)!.visible, name).toBe(false);
    w.at(VISIBLE_FROM / 2);
    expect(w.lights.getDiagnostics().drawCalls).toBe(0);
    w.at(0.5);
    // Lamps on, fireflies not yet (they need a fully dark town); no cars loaded headless ⇒ no beams.
    expect(w.lights.getDiagnostics().drawCalls).toBe(2);
    expect(w.mesh('night:fireflies')!.visible).toBe(false);
    w.at(1);
    // Pools + halos + fireflies (the sample town has a meadow).
    expect(w.lights.getDiagnostics().drawCalls).toBe(3);
    expect(w.mesh('night:fireflies')!.visible).toBe(true);
    expect(w.mesh('night:fireflies')!.count).toBe(MAX_FIREFLIES);
    expect(w.mesh('night:pool')!.visible).toBe(true);
    expect(w.mesh('night:pool')!.count).toBe(4);
    expect(w.mesh('night:halo')!.count).toBe(4);
    expect(w.mesh('night:beam')!.visible).toBe(false);
    expect(w.hookCalls()).toBeGreaterThan(0); // the scene's previous hook still runs
  });

  it('pools sit under the lamp heads and follow edits', () => {
    const w = world();
    w.render();
    w.at(1);
    const pools = w.mesh('night:pool')!;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const lamps = [...w.town.objects()].filter((o) => o.kind === 'lamppost');
    for (let i = 0; i < lamps.length; i += 1) {
      pools.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      const cell = cellToWorld(lamps[i].anchor);
      expect(Math.hypot(p.x - cell.x, p.z - cell.z)).toBeLessThan(CELL_SIZE); // head overhangs < 1 cell
      expect(p.y).toBeGreaterThan(0.02);
    }
    expect(w.editor.apply({ type: 'bulldoze', cell: lamps[0].anchor, edge: null }, 'bulldoze').ok).toBe(true);
    w.at(1);
    expect(w.lights.getDiagnostics().lamps).toBe(3);
    expect(pools.count).toBe(3);
    w.editor.reset();
    w.at(1);
    expect(w.lights.getDiagnostics()).toEqual({ lamps: 0, drawCalls: 0 });
    expect(w.mesh('night:pool')!.visible).toBe(false);
  });

  it('grows the pool capacity for large towns', () => {
    const w = world('empty');
    const many: PlacedObject[] = [];
    for (let i = 0; i < 70; i += 1) many.push(lamp(1000 + i, (i * 3) % 48, Math.floor((i * 3) / 48) * 2));
    w.bus.emit('town:changed', { changes: many.map((object) => ({ layer: 'object' as const, op: 'add' as const, object })), cause: 'edit' });
    w.render();
    w.at(1);
    const pools = w.mesh('night:pool')!;
    expect(pools.count).toBe(70);
    expect(pools.instanceMatrix.count).toBeGreaterThanOrEqual(70);
    expect(w.scene.getObjectsByProperty('name', 'night:pool').length).toBe(1);
  });

  it('lamp halos off (Low preset) hides them live; dispose restores the scene hook and removes the layer', () => {
    const { bus, town, editor } = setup();
    const scene = new THREE.Scene();
    const hook = scene.onBeforeRender;
    const render = () => scene.onBeforeRender(null as never, scene, null as never, null as never, null as never, null as never);
    const life = new LifeSystem(scene, town, bus, createSeededRandom(2));
    const lights = new NightLights(scene, new ModelLibrary(), town, bus, life);
    buildSampleTown(editor);
    lights.populate();
    render(); // warm-up
    const sample = createDaySample();
    sample.night = 1;
    lights.update(sample);
    render();
    expect(lights.getDiagnostics().drawCalls).toBe(3); // pools + halos + fireflies
    expect((scene.getObjectByName('night:halo') as THREE.InstancedMesh).visible).toBe(true);
    lights.setLampHalos(false);
    expect(lights.halosEnabled).toBe(false);
    lights.update(sample);
    expect(lights.getDiagnostics().drawCalls).toBe(2); // pools + fireflies
    render();
    expect(lights.getDiagnostics().drawCalls).toBe(2);
    expect(scene.getObjectByName('night:halo')).toBeDefined(); // built, just not drawn
    expect((scene.getObjectByName('night:halo') as THREE.InstancedMesh).visible).toBe(false);
    lights.setLampHalos(true);
    render();
    expect((scene.getObjectByName('night:halo') as THREE.InstancedMesh).visible).toBe(true);
    expect(scene.getObjectByName('night:fireflies')).toBeDefined();
    lights.dispose();
    expect(scene.onBeforeRender).toBe(hook);
    expect(scene.getObjectByName('night-lights')).toBeUndefined();
  });
});

describe('fireflies (stretch)', () => {
  it('pick ≤ 24 stable spots over uncovered meadow cells, none without meadow', () => {
    const { town, editor } = setup();
    expect(pickFireflySpots(town)).toEqual([]);
    buildSampleTown(editor);
    const spots = pickFireflySpots(town);
    expect(spots.length).toBe(MAX_FIREFLIES);
    expect(pickFireflySpots(town)).toEqual(spots); // deterministic (hash, no RNG)
    for (const spot of spots) {
      const cell = { x: Math.floor(spot.x / CELL_SIZE + PLOT_WIDTH / 2), z: Math.floor(spot.z / CELL_SIZE + PLOT_DEPTH / 2) };
      expect(town.getGround(cell)).toBe('meadow');
      expect(town.getObjectAt(cell)).toBeUndefined();
      expect(spot.y).toBeGreaterThan(0.1);
    }
    expect(pickFireflySpots(town, 5)).toEqual(spots.slice(0, 5));
  });
});
