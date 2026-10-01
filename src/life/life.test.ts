import { describe, expect, it } from 'vitest';
import { TownState } from '../town/TownState';
import type { GroundKind, TownChange } from '../town/types';
import { createSeededRandom } from '../utils/random';
import { DIR_X, DIR_Z, LANE_OFFSET, lanePath, manoeuvreKind, RING_RADIUS, ringPath, samplePath, type Dir } from './lanePaths';
import { createGameBus } from '../game/events';
import { buildSampleTown, demoOffset } from '../town/sampleTown';
import { TownEditor } from '../town/TownEditor';
import { densityTarget, MAX_CARS, TrafficSim } from './TrafficSim';
import { PLOT_DEPTH, PLOT_WIDTH, roadBlockCentreWorld, worldToCell } from '../game/config';

/**
 * The sim runs on road BLOCKS (2 × 2 cells, WP-12). Coordinates in these tests are block
 * coordinates; paint() fills all 4 cells of each block.
 */
function paint(town: TownState, blocks: Array<[number, number]>, after: GroundKind = 'road'): TownChange[] {
  const changes: TownChange[] = [];
  for (const [bx, bz] of blocks) {
    for (let dz = 0; dz < 2; dz += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        const cell = { x: bx * 2 + dx, z: bz * 2 + dz };
        changes.push({ layer: 'ground', cell, before: town.getGround(cell), after });
      }
    }
  }
  town.applyChanges(changes);
  return changes;
}

const newTown = () => new TownState(PLOT_WIDTH, PLOT_DEPTH);
const blockCentre = (bx: number, bz: number, out = { x: 0, z: 0 }) => roadBlockCentreWorld({ x: bx * 2, z: bz * 2 }, out);

/** A 6×6 ring road (20 cells) around (4..9, 4..9). */
function ringCells(): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let x = 4; x <= 9; x += 1) cells.push([x, 4], [x, 9]);
  for (let z = 5; z <= 8; z += 1) cells.push([4, z], [9, z]);
  return cells;
}

function sampleTownRoads(): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let x = 2; x <= 21; x += 1) cells.push([x, 12]);
  for (let z = 4; z <= 11; z += 1) cells.push([11, z]);
  for (let z = 13; z <= 20; z += 1) cells.push([11, z]);
  return cells;
}

describe('lane paths', () => {
  const sample = { x: 0, z: 0, hx: 0, hz: 0 };
  it('classifies manoeuvres', () => {
    expect(manoeuvreKind(0, 0)).toBe('straight');
    expect(manoeuvreKind(0, 1)).toBe('right');
    expect(manoeuvreKind(0, 3)).toBe('left');
    expect(manoeuvreKind(1, 3)).toBe('uturn');
  });

  it('every manoeuvre starts and ends on the right-hand lane at the cell edges, and is continuous', () => {
    for (let a = 0; a < 4; a += 1) {
      for (let b = 0; b < 4; b += 1) {
        const inDir = a as Dir;
        const outDir = b as Dir;
        const path = lanePath(inDir, outDir);
        samplePath(path, 0, sample);
        // Entry edge midpoint + right of travel.
        expect(sample.x).toBeCloseTo(-DIR_X[inDir] * 0.5 - DIR_Z[inDir] * LANE_OFFSET, 5);
        expect(sample.z).toBeCloseTo(-DIR_Z[inDir] * 0.5 + DIR_X[inDir] * LANE_OFFSET, 5);
        samplePath(path, path.length, sample);
        expect(sample.x).toBeCloseTo(DIR_X[outDir] * 0.5 - DIR_Z[outDir] * LANE_OFFSET, 5);
        expect(sample.z).toBeCloseTo(DIR_Z[outDir] * 0.5 + DIR_X[outDir] * LANE_OFFSET, 5);
        // Stays inside the cell, no jumps.
        let px = Number.NaN;
        let pz = Number.NaN;
        for (let s = 0; s <= path.length; s += 0.01) {
          samplePath(path, s, sample);
          expect(Math.abs(sample.x)).toBeLessThanOrEqual(0.5 + 1e-5);
          expect(Math.abs(sample.z)).toBeLessThanOrEqual(0.5 + 1e-5);
          expect(Math.hypot(sample.hx, sample.hz)).toBeCloseTo(1, 4);
          if (!Number.isNaN(px)) expect(Math.hypot(sample.x - px, sample.z - pz)).toBeLessThanOrEqual(0.0101);
          px = sample.x;
          pz = sample.z;
        }
        // Exit heading equals the out direction.
        samplePath(path, path.length, sample);
        expect(sample.hx).toBeCloseTo(DIR_X[outDir], 1);
        expect(sample.hz).toBeCloseTo(DIR_Z[outDir], 1);
      }
    }
  });

  it('keeps to the right: a car heading north drives on the east (+x) half', () => {
    const path = lanePath(0, 0);
    samplePath(path, path.length / 2, sample);
    expect(sample.x).toBeCloseTo(LANE_OFFSET, 5);
    expect(sample.hz).toBeCloseTo(-1, 5);
  });
});

describe('TrafficSim', () => {
  it('spawns nothing without roads and scales the car count with the road network (max 6)', () => {
    const town = newTown();
    const sim = new TrafficSim(town, createSeededRandom(1));
    sim.onTownChanged([], 'reset');
    expect(sim.cars.length).toBe(0);
    sim.onTownChanged(paint(town, [[3, 3], [4, 3], [5, 3], [6, 3], [7, 3]]), 'edit');
    expect(sim.cars.length).toBe(0); // 5 drivable cells < 6
    sim.onTownChanged(paint(town, [[8, 3]]), 'edit');
    expect(sim.cars.length).toBe(1);
    sim.onTownChanged(paint(town, sampleTownRoads()), 'edit');
    expect(sim.cars.length).toBe(MAX_CARS);
  });

  it('isolated single road tiles are not drivable', () => {
    const town = newTown();
    const sim = new TrafficSim(town, createSeededRandom(1));
    const lone: Array<[number, number]> = [];
    for (let i = 0; i < 12; i += 1) lone.push([(i % 6) * 2, Math.floor(i / 6) * 2]);
    sim.onTownChanged(paint(town, lone), 'edit');
    expect(sim.stats.drivableCells).toBe(0);
    expect(sim.cars.length).toBe(0);
  });

  it('is deterministic for a seed and reseeds on reset', () => {
    const run = (seed: number) => {
      const town = newTown();
      const sim = new TrafficSim(town, createSeededRandom(seed));
      sim.onTownChanged([], 'reset');
      sim.onTownChanged(paint(town, sampleTownRoads()), 'edit');
      for (let i = 0; i < 300; i += 1) sim.step(1 / 60);
      return sim.cars.map((c) => [c.id, c.model, c.cx, c.cz, c.x.toFixed(4), c.z.toFixed(4)]);
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it('cars stay on road cells, in their lane, for a long drive (sample-town roads)', () => {
    const town = newTown();
    const sim = new TrafficSim(town, createSeededRandom(3));
    sim.onTownChanged(paint(town, sampleTownRoads()), 'load');
    const visited = new Set<string>();
    const cell = { x: 0, z: 0 };
    const centre = { x: 0, z: 0 };
    let turns = 0;
    for (let i = 0; i < 60 * 60; i += 1) {
      sim.step(1 / 60);
      for (const car of sim.cars) {
        worldToCell(car.x, car.z, cell);
        // Position is inside a road block (the edge between two road blocks belongs to either).
        const onRoad = town.getGround(cell) === 'road' || town.getGround({ x: car.cx * 2, z: car.cz * 2 }) === 'road';
        expect(onRoad).toBe(true);
        expect(town.getGround({ x: car.cx * 2, z: car.cz * 2 })).toBe('road');
        blockCentre(car.cx, car.cz, centre);
        expect(Math.abs(car.x - centre.x)).toBeLessThanOrEqual(0.5 + 1e-4);
        expect(Math.abs(car.z - centre.z)).toBeLessThanOrEqual(0.5 + 1e-4);
        visited.add(`${car.cx},${car.cz}`);
        if (car.inDir !== car.outDir) turns += 1;
      }
    }
    expect(sim.cars.length).toBe(MAX_CARS);
    expect(sim.stats.despawned).toBe(0);
    expect(visited.size).toBeGreaterThan(25); // they really wander the network
    expect(turns).toBeGreaterThan(0); // and choose at junctions / dead ends
  });

  it('cars never overlap for long (following distance + gridlock breaker)', () => {
    const town = newTown();
    const sim = new TrafficSim(town, createSeededRandom(11));
    sim.onTownChanged(paint(town, ringCells()), 'load');
    expect(sim.cars.length).toBe(3); // 20 cells / 6
    let overlapFrames = 0;
    let moved = 0;
    const before = sim.cars.map((c) => [c.x, c.z]);
    for (let i = 0; i < 60 * 30; i += 1) {
      sim.step(1 / 60);
      for (let a = 0; a < sim.cars.length; a += 1) {
        for (let b = a + 1; b < sim.cars.length; b += 1) {
          if (Math.hypot(sim.cars[a].x - sim.cars[b].x, sim.cars[a].z - sim.cars[b].z) < 0.2) overlapFrames += 1;
        }
      }
    }
    sim.cars.forEach((c, i) => (moved += Math.hypot(c.x - before[i][0], c.z - before[i][1]) > 0 ? 1 : 0));
    expect(moved).toBe(3);
    expect(overlapFrames).toBeLessThan(60); // under a second of contact in 30 s
  });

  it('despawns a car when the road under it is bulldozed, and only that car', () => {
    const town = newTown();
    const sim = new TrafficSim(town, createSeededRandom(5));
    sim.onTownChanged(paint(town, sampleTownRoads()), 'load');
    for (let i = 0; i < 30; i += 1) sim.step(1 / 60);
    const victim = sim.cars[0];
    const removed: number[] = [];
    sim.onRemove = (car) => removed.push(car.id);
    const count = sim.cars.length;
    sim.onTownChanged(paint(town, [[victim.cx, victim.cz]], 'field'), 'edit');
    expect(removed).toContain(victim.id);
    expect(sim.cars.find((c) => c.id === victim.id)).toBeUndefined();
    expect(sim.stats.despawned).toBeGreaterThanOrEqual(1);
    for (const car of sim.cars) expect(town.getGround({ x: car.cx * 2, z: car.cz * 2 })).toBe('road');
    // The count is topped back up to what the remaining network supports.
    expect(sim.cars.length).toBe(Math.min(count, sim.stats.target));
    expect(sim.stats.target).toBeGreaterThanOrEqual(count - 1);
  });

  it('removes every car when all roads go, and step(0) freezes cars', () => {
    const town = newTown();
    const sim = new TrafficSim(town, createSeededRandom(5));
    const roads = sampleTownRoads();
    sim.onTownChanged(paint(town, roads), 'load');
    const frozen = sim.cars.map((c) => [c.x, c.z]);
    sim.step(0);
    expect(sim.cars.map((c) => [c.x, c.z])).toEqual(frozen);
    sim.onTownChanged(paint(town, roads, 'field'), 'edit');
    expect(sim.cars.length).toBe(0);
    sim.onTownChanged([], 'reset');
    expect(sim.stats.cars).toBe(0);
  });
});

describe('traffic: roundabouts', () => {
  /** The sample town has a roundabout on blocks 10–12 × 11–13 where both streets meet. */
  function roundaboutTown() {
    const editor = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(1));
    buildSampleTown(editor);
    return editor.state;
  }

  it('ring paths start and end on the lanes, circle the island counter-clockwise and never cut it', () => {
    for (let inDir = 0; inDir < 4; inDir += 1) {
      for (let outDir = 0; outDir < 4; outDir += 1) {
        const path = ringPath(inDir as Dir, outDir as Dir);
        const start = samplePath(path, 0, { x: 0, z: 0, hx: 0, hz: 0 });
        const end = samplePath(path, path.length, { x: 0, z: 0, hx: 0, hz: 0 });
        // Entry on the incoming edge's right lane, exit on the outgoing edge's right lane.
        expect(start.x).toBeCloseTo(-DIR_X[inDir] * 0.5 - DIR_Z[inDir] * LANE_OFFSET, 5);
        expect(start.z).toBeCloseTo(-DIR_Z[inDir] * 0.5 + DIR_X[inDir] * LANE_OFFSET, 5);
        expect(end.x).toBeCloseTo(DIR_X[outDir] * 0.5 - DIR_Z[outDir] * LANE_OFFSET, 5);
        expect(end.z).toBeCloseTo(DIR_Z[outDir] * 0.5 + DIR_X[outDir] * LANE_OFFSET, 5);
        const sample = { x: 0, z: 0, hx: 0, hz: 0 };
        for (let s = 0; s <= path.length; s += 0.02) {
          samplePath(path, s, sample);
          expect(Math.hypot(sample.x, sample.z)).toBeGreaterThan(RING_RADIUS * 0.8);
          // Counter-clockwise with north up: the heading turns left of the radius (cross product > 0).
          if (Math.hypot(sample.x, sample.z) < RING_RADIUS * 1.05) expect(sample.x * -sample.hz - -sample.z * sample.hx).toBeGreaterThan(0);
        }
      }
    }
  });

  it('cars drive through the roundabout on its centre and arms only, never its corners', () => {
    const town = roundaboutTown();
    const sim = new TrafficSim(town, createSeededRandom(2));
    sim.onTownChanged([], 'load');
    expect(sim.cars.length).toBeGreaterThan(0);
    const visited = new Set<string>();
    for (let i = 0; i < 6000; i += 1) {
      sim.step(1 / 30);
      for (const car of sim.cars) {
        // The sample roundabout's min block (layout cell (20, 22), shifted to the plot centre).
        const rx = car.cx - 10 - demoOffset(PLOT_WIDTH) / 2;
        const rz = car.cz - 11 - demoOffset(PLOT_DEPTH) / 2;
        if (rx < 0 || rx > 2 || rz < 0 || rz > 2) continue;
        visited.add(`${rx},${rz}`);
        expect(rx === 1 || rz === 1, `car ${car.id} on corner block ${rx},${rz}`).toBe(true);
        expect(car.ring).toBe(rx === 1 && rz === 1);
      }
    }
    expect(visited.has('1,1')).toBe(true);
    expect([...visited].filter((k) => k !== '1,1').length).toBeGreaterThanOrEqual(3);
  });
});

describe('traffic: night density (WP-16b)', () => {
  function sampleSim(seed = 4) {
    const editor = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(1));
    buildSampleTown(editor);
    const sim = new TrafficSim(editor.state, createSeededRandom(seed));
    sim.onTownChanged([], 'load');
    return sim;
  }

  it('densityTarget = max(1, round(base × f)) while the network has room, else 0', () => {
    expect(densityTarget(6, 1)).toBe(6);
    expect(densityTarget(6, 0.5)).toBe(3);
    expect(densityTarget(6, 0.75)).toBe(5); // round(4.5)
    expect(densityTarget(6, 0)).toBe(1);
    expect(densityTarget(1, 0.5)).toBe(1);
    expect(densityTarget(0, 1)).toBe(0);
    expect(densityTarget(0, 0.5)).toBe(0);
    expect(densityTarget(4, 2)).toBe(4); // never above the network's capacity
  });

  it('halves the cars at full night, newest first, and tops them back up at dawn', () => {
    const sim = sampleSim();
    expect(sim.cars.length).toBe(MAX_CARS);
    const ids = sim.cars.map((c) => c.id);
    const removed: number[] = [];
    sim.onRemove = (car) => removed.push(car.id);
    sim.setDensity(1 - 0.5 * 1);
    expect(sim.stats.target).toBe(3);
    expect(sim.cars.map((c) => c.id)).toEqual(ids.slice(0, 3));
    expect(removed).toEqual(ids.slice(3).reverse());
    expect(sim.stats.despawned).toBe(3);
    // Unchanged target: no-op (no spawns, no stream draws).
    const spawned = sim.stats.spawned;
    sim.setDensity(0.52);
    expect(sim.cars.length).toBe(3);
    expect(sim.stats.spawned).toBe(spawned);
    // Dawn: new cars pop in (not instant) until the full target.
    sim.setDensity(1);
    expect(sim.cars.length).toBe(MAX_CARS);
    expect(sim.cars.slice(3).every((c) => !c.instant && c.id > Math.max(...ids))).toBe(true);
    for (const car of sim.cars) expect(Number.isFinite(car.x) && Number.isFinite(car.z)).toBe(true);
  });

  it('density 1 changes nothing, and a reset/load always rebuilds at full density', () => {
    const a = sampleSim(9);
    const b = sampleSim(9);
    b.setDensity(1);
    expect(b.cars.map((c) => [c.id, c.x, c.z])).toEqual(a.cars.map((c) => [c.id, c.x, c.z]));
    // Night, then a load: the town respawns at full density whatever the previous time of day was
    // (so a test state never depends on the one before it); the owner then re-applies the night.
    const d = sampleSim(9);
    d.setDensity(0.5);
    expect(d.density).toBe(0.5);
    expect(d.cars.length).toBe(3);
    d.onTownChanged([], 'load');
    expect(d.density).toBe(1);
    expect(d.cars.length).toBe(MAX_CARS);
    d.setDensity(0.5);
    expect(d.cars.length).toBe(3);
  });

  it('keeps one car on a small network and none without roads', () => {
    const town = newTown();
    const sim = new TrafficSim(town, createSeededRandom(2));
    sim.setDensity(0.5);
    expect(sim.cars.length).toBe(0);
    sim.onTownChanged(paint(town, ringCells()), 'edit'); // 20 blocks ⇒ base 3
    expect(sim.stats.target).toBe(densityTarget(3, 0.5));
    expect(sim.cars.length).toBe(2);
    sim.setDensity(0);
    expect(sim.cars.length).toBe(1);
  });
});
