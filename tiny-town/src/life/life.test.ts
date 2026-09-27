import { describe, expect, it } from 'vitest';
import { TownState } from '../town/TownState';
import type { GroundKind, TownChange } from '../town/types';
import { createSeededRandom } from '../utils/random';
import { DIR_X, DIR_Z, LANE_OFFSET, lanePath, manoeuvreKind, samplePath, type Dir } from './lanePaths';
import { MAX_CARS, TrafficSim } from './TrafficSim';
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
