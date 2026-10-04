import { describe, expect, it } from 'vitest';
import { TownState } from '../town/TownState';
import type { GroundKind, TownChange } from '../town/types';
import { createSeededRandom } from '../utils/random';
import { armPath, DIR_X, DIR_Z, LANE_OFFSET, lanePath, manoeuvreKind, opposite, RING_RADIUS, ringPath, samplePath, type Dir, type LanePath } from './lanePaths';
import { createGameBus } from '../game/events';
import { buildSampleTown, demoOffset } from '../town/sampleTown';
import { TownEditor, type BatchItem } from '../town/TownEditor';
import { DEFAULT_PARKING_TUNING, densityTarget, MAX_CARS, TrafficSim, type Car } from './TrafficSim';
import { PLOT_DEPTH, PLOT_WIDTH, ROAD_TILE_SIZE, roadBlockCentreWorld, worldToCell } from '../game/config';

/** Coordinates are road block coordinates; paint() fills all 4 cells of each block. */
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
    expect(visited.size).toBeGreaterThan(25);
    expect(turns).toBeGreaterThan(0);
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

  /** Island-centre world points of a path from the block one tile out along `arm` (−1: the centre block). */
  function inIslandFrame(path: LanePath, arm: number): number[] {
    const ox = arm < 0 ? 0 : DIR_X[arm] * ROAD_TILE_SIZE;
    const oz = arm < 0 ? 0 : DIR_Z[arm] * ROAD_TILE_SIZE;
    return Array.from(path.points, (v, i) => v + (i % 2 === 0 ? ox : oz));
  }

  /** The route a car takes in by arm `from`, round the ring and out by arm `to` (the same arm: a lap). */
  function route(from: Dir, to: Dir): number[] {
    const inward = inIslandFrame(armPath(from, opposite(from), opposite(from)), from);
    const ring = inIslandFrame(ringPath(opposite(from), to), -1);
    const outward = inIslandFrame(armPath(to, to, to), to);
    // Each piece starts exactly where the previous one ends.
    for (let c = 0; c < 2; c += 1) {
      expect(ring[c]).toBeCloseTo(inward[inward.length - 2 + c], 5);
      expect(outward[c]).toBeCloseTo(ring[ring.length - 2 + c], 5);
    }
    return [...inward, ...ring.slice(2), ...outward.slice(2)];
  }

  const headingOf = (pts: readonly number[], i: number) => Math.atan2(pts[i * 2 + 3] - pts[i * 2 + 1], pts[i * 2 + 2] - pts[i * 2]);
  const turnBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

  it('the ring lane is the outer one: between the lane marking and the kerb gutter of the road model', () => {
    // road-roundabout: island kerb to r 0.45, lane marking at 0.755, gutter from 1.05, outer kerb 1.15.
    expect(RING_RADIUS).toBeGreaterThan(0.755 + 0.1);
    expect(RING_RADIUS).toBeLessThan(1.05 - 0.1);
  });

  it('ring arcs lie on the outer lane and run counter-clockwise, whichever arms they join', () => {
    for (let inDir = 0; inDir < 4; inDir += 1) {
      for (let outDir = 0; outDir < 4; outDir += 1) {
        const path = ringPath(inDir as Dir, outDir as Dir);
        const sample = { x: 0, z: 0, hx: 0, hz: 0 };
        for (let s = 0; s <= path.length; s += 0.02) {
          samplePath(path, s, sample);
          // Chords of the polyline sag a little inside the circle.
          expect(Math.hypot(sample.x, sample.z)).toBeGreaterThan(RING_RADIUS - 0.002);
          expect(Math.hypot(sample.x, sample.z)).toBeLessThan(RING_RADIUS + 1e-4);
          // Counter-clockwise with north up: the heading turns left of the radius (cross product > 0).
          expect(sample.x * -sample.hz - -sample.z * sample.hx).toBeGreaterThan(0);
        }
      }
    }
  });

  it('ring arc lengths: the next arm is a short hop, straight on a third of a lap, the arm it came by most of a lap', () => {
    const lap = 2 * Math.PI * RING_RADIUS;
    // Driving in towards north (from the south arm): next arm anticlockwise is east.
    expect(ringPath(0, 1).length).toBeLessThan(lap * 0.15);
    expect(ringPath(0, 0).length).toBeGreaterThan(lap * 0.28);
    expect(ringPath(0, 0).length).toBeLessThan(lap * 0.35);
    expect(ringPath(0, 2).length).toBeGreaterThan(lap * 0.75);
    expect(ringPath(0, 2).length).toBeLessThan(lap);
  });

  it('every route in, round and out is continuous, smooth and clear of the island and the other lanes', () => {
    for (let from = 0; from < 4; from += 1) {
      for (let to = 0; to < 4; to += 1) {
        const pts = route(from as Dir, to as Dir);
        const where = `${from}->${to}`;
        const count = pts.length / 2;
        for (let i = 0; i < count - 1; i += 1) {
          const len = Math.hypot(pts[i * 2 + 2] - pts[i * 2], pts[i * 2 + 3] - pts[i * 2 + 1]);
          // Pieces join without a jump or a doubled point.
          expect(len, `${where} segment ${i}`).toBeGreaterThan(1e-4);
          expect(len, `${where} segment ${i}`).toBeLessThan(0.4);
          if (i > 0) expect(turnBetween(headingOf(pts, i - 1), headingOf(pts, i)), `${where} kink at ${i}`).toBeLessThan(0.2);
        }
        for (let i = 0; i < count; i += 1) {
          const r = Math.hypot(pts[i * 2], pts[i * 2 + 1]);
          expect(r, `${where} point ${i} keeps to the outer lane or further out`).toBeGreaterThan(RING_RADIUS - 1e-3);
        }
      }
    }
  });

  it('every route keeps clear of the kerb', () => {
    // Inner kerb edge of the road model beside an arm, as (a, l) with l to the entry side: the arm's
    // kerb, then its fillet into the ring kerb (r 1.15) at 45 degrees, where the next arm's fillet starts.
    const edge: Array<[number, number]> = [[1.5, 0.4], [1.08, 0.4], [1.06, 0.44], [1.03, 0.5], [1.0, 0.57], [0.91, 0.7], [0.81, 0.81]];
    const kerbs: number[][] = [];
    for (let arm = 0; arm < 4; arm += 1) {
      for (const side of [1, -1]) {
        kerbs.push(edge.flatMap(([a, l]) => [DIR_X[arm] * a + DIR_Z[arm] * l * side, DIR_Z[arm] * a - DIR_X[arm] * l * side]));
      }
    }
    const distance = (px: number, pz: number, k: readonly number[]) => {
      let best = Infinity;
      for (let i = 0; i + 3 < k.length; i += 2) {
        const dx = k[i + 2] - k[i];
        const dz = k[i + 3] - k[i + 1];
        const t = Math.max(0, Math.min(1, ((px - k[i]) * dx + (pz - k[i + 1]) * dz) / (dx * dx + dz * dz)));
        best = Math.min(best, Math.hypot(px - (k[i] + dx * t), pz - (k[i + 1] + dz * t)));
      }
      return best;
    };
    // A car is about 0.25 wide.
    const halfCar = 0.125;
    for (let from = 0; from < 4; from += 1) {
      for (let to = 0; to < 4; to += 1) {
        const pts = route(from as Dir, to as Dir);
        for (let i = 0; i < pts.length; i += 2) {
          for (const k of kerbs) expect(distance(pts[i], pts[i + 1], k), `${from}->${to} point ${i / 2}`).toBeGreaterThan(halfCar + 0.03);
        }
      }
    }
  });

  it('routes start on the arm lane they enter by and end on the lane they leave by', () => {
    for (let arm = 0; arm < 4; arm += 1) {
      const ox = DIR_X[arm];
      const oz = DIR_Z[arm];
      const inward = inIslandFrame(armPath(arm as Dir, opposite(arm as Dir), opposite(arm as Dir)), arm);
      const outward = inIslandFrame(armPath(arm as Dir, arm as Dir, arm as Dir), arm);
      // Right of a car driving in is (oz, −ox): the entry lane is on that side, the exit lane opposite.
      expect(inward[0]).toBeCloseTo(ox * 1.5 + oz * LANE_OFFSET, 5);
      expect(inward[1]).toBeCloseTo(oz * 1.5 - ox * LANE_OFFSET, 5);
      expect(outward[outward.length - 2]).toBeCloseTo(ox * 1.5 - oz * LANE_OFFSET, 5);
      expect(outward[outward.length - 1]).toBeCloseTo(oz * 1.5 + ox * LANE_OFFSET, 5);
      // They meet the plain lane paths of the neighbouring road block (one tile further out).
      const next = lanePath(arm as Dir, arm as Dir);
      expect(outward[outward.length - 2]).toBeCloseTo(next.points[0] + ox * 2 * ROAD_TILE_SIZE, 5);
      expect(outward[outward.length - 1]).toBeCloseTo(next.points[1] + oz * 2 * ROAD_TILE_SIZE, 5);
      const prev = lanePath(opposite(arm as Dir), opposite(arm as Dir));
      expect(inward[0]).toBeCloseTo(prev.points[prev.points.length - 2] + ox * 2 * ROAD_TILE_SIZE, 5);
      expect(inward[1]).toBeCloseTo(prev.points[prev.points.length - 1] + oz * 2 * ROAD_TILE_SIZE, 5);
    }
  });

  it('turning round in an arm with no road beyond it goes out by the exit lane and back in by the entry lane', () => {
    for (let arm = 0; arm < 4; arm += 1) {
      const turn = armPath(arm as Dir, arm as Dir, opposite(arm as Dir));
      const outward = armPath(arm as Dir, arm as Dir, arm as Dir);
      const inward = armPath(arm as Dir, opposite(arm as Dir), opposite(arm as Dir));
      expect(turn.kind).toBe('uturn');
      // Starts where the last ring arc ends and ends where the next ring arc starts, in the arm's frame.
      expect(turn.points[0]).toBeCloseTo(outward.points[0], 5);
      expect(turn.points[1]).toBeCloseTo(outward.points[1], 5);
      expect(turn.points[turn.points.length - 2]).toBeCloseTo(inward.points[inward.points.length - 2], 5);
      expect(turn.points[turn.points.length - 1]).toBeCloseTo(inward.points[inward.points.length - 1], 5);
      const pts = inIslandFrame(turn, arm);
      for (let i = 0; i < pts.length / 2 - 1; i += 1) {
        expect(Math.hypot(pts[i * 2], pts[i * 2 + 1])).toBeGreaterThan(RING_RADIUS - 1e-3);
        // Never leaves the arm block (it ends 1.5 from the island centre).
        expect(pts[i * 2] * DIR_X[arm] + pts[i * 2 + 1] * DIR_Z[arm]).toBeLessThan(1.5);
        if (i > 0) expect(turnBetween(headingOf(pts, i - 1), headingOf(pts, i))).toBeLessThan(0.25);
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

describe('traffic: roundabout lane, simulated', () => {
  /** Sample-town roundabout (blocks 10-12 x 11-13 before the plot shift) or one with roads on `arms` only. */
  function townWith(arms: readonly Dir[] | null) {
    const editor = new TownEditor(new TownState(PLOT_WIDTH, PLOT_DEPTH), createGameBus(), createSeededRandom(1));
    if (arms === null) {
      buildSampleTown(editor);
      return editor.state;
    }
    const items: BatchItem[] = [{ toolId: 'roundabout', action: { type: 'place-object', kind: 'roundabout', cell: { x: 20, z: 22 }, rotation: 0 } }];
    for (const d of arms) {
      // Centre block (11, 12); six blocks of road beyond the arm block.
      for (let k = 2; k <= 7; k += 1) {
        items.push({ toolId: 'road', action: { type: 'paint-ground', kind: 'road', cell: { x: (11 + DIR_X[d] * k) * 2, z: (12 + DIR_Z[d] * k) * 2 } } });
      }
    }
    editor.applyBatch(items, { silent: true });
    return editor.state;
  }

  /** Drives the sim and checks every car's distance from the island, and its step-to-step motion. */
  function drive(arms: readonly Dir[] | null, seed: number, steps: number) {
    const town = townWith(arms);
    const sim = new TrafficSim(town, createSeededRandom(seed));
    sim.onTownChanged([], 'load');
    const centre = { x: 0, z: 0 };
    const last = new Map<number, { x: number; z: number; hx: number; hz: number }>();
    const seen = { ring: 0, arm: 0, turn: 0 };
    let ringMin = Infinity;
    let ringMax = 0;
    let armMin = Infinity;
    for (let i = 0; i < steps; i += 1) {
      sim.step(1 / 30);
      for (const car of sim.cars) {
        const prev = last.get(car.id);
        if (prev) {
          // No jump where a car passes from one block's path to the next, and no kink.
          expect(Math.hypot(car.x - prev.x, car.z - prev.z), `car ${car.id} step ${i}`).toBeLessThan(0.04);
          expect(car.hx * prev.hx + car.hz * prev.hz, `car ${car.id} step ${i} heading`).toBeGreaterThan(0.9);
        }
        last.set(car.id, { x: car.x, z: car.z, hx: car.hx, hz: car.hz });
        if (!car.ring && car.arm < 0) continue;
        const island = car.ring ? { x: car.cx, z: car.cz } : { x: car.cx - DIR_X[car.arm], z: car.cz - DIR_Z[car.arm] };
        roadBlockCentreWorld({ x: island.x * 2, z: island.z * 2 }, centre);
        const r = Math.hypot(car.x - centre.x, car.z - centre.z);
        if (car.ring) {
          seen.ring += 1;
          ringMin = Math.min(ringMin, r);
          ringMax = Math.max(ringMax, r);
        } else {
          seen.arm += 1;
          armMin = Math.min(armMin, r);
          if (car.inDir !== car.outDir) seen.turn += 1;
        }
      }
    }
    return { seen, ringMin, ringMax, armMin };
  }

  it('cars on the ring drive its outer lane, never nearer the island', () => {
    for (const seed of [2, 5, 11]) {
      const { seen, ringMin, ringMax, armMin } = drive(null, seed, 6000);
      expect(seen.ring).toBeGreaterThan(100);
      expect(ringMin).toBeGreaterThan(RING_RADIUS - 0.005);
      expect(ringMax).toBeLessThan(RING_RADIUS + 0.005);
      // Cars bending on and off in the arm blocks stay on or outside the same circle.
      expect(seen.arm).toBeGreaterThan(100);
      expect(armMin).toBeGreaterThan(RING_RADIUS - 0.005);
    }
  });

  it('cars turn round in a roundabout arm that has no road beyond it, still on the outer lane', () => {
    const { seen, ringMin, armMin } = drive([0, 2], 3, 12000);
    expect(seen.ring).toBeGreaterThan(100);
    expect(seen.turn, 'cars that went into the empty east/west arms and came back').toBeGreaterThan(20);
    expect(ringMin).toBeGreaterThan(RING_RADIUS - 0.005);
    expect(armMin).toBeGreaterThan(RING_RADIUS - 0.005);
  });
});

describe('traffic: night density', () => {
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
    // Night, then a load: the town respawns at full density whatever the previous time of day.
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

/** The trajectory hash of the sample-town roads, seed 7, two minutes at 60 Hz; it changes only if street driving does. */
const PINNED_NO_LOT_HASH = -742453351;

describe('traffic: car parks', () => {
  /**
   * A street of `length` road blocks along block row 12 from block 4, with a car park of `style` in the
   * middle: north of it facing south (rotation 0) or south of it facing north (rotation 2). `side` adds a
   * side street of 18 blocks at the west end, enough road for MAX_CARS.
   */
  function lotTown(style: 0 | 1 | 2, rotation: 0 | 2 = 0, seed = 5, side = false) {
    const length = 18;
    const bus = createGameBus();
    const editor = new TownEditor(newTown(), bus, createSeededRandom(1));
    const sim = new TrafficSim(editor.state, createSeededRandom(seed));
    bus.on('town:changed', ({ changes, cause }) => sim.onTownChanged(changes, cause));
    editor.beginStroke();
    for (let bx = 4; bx < 4 + length; bx += 1) editor.apply({ type: 'paint-ground', kind: 'road', cell: { x: bx * 2, z: 24 } }, 'road');
    if (side) for (let bz = 13; bz < 31; bz += 1) editor.apply({ type: 'paint-ground', kind: 'road', cell: { x: 8, z: bz * 2 } }, 'road');
    editor.endStroke();
    const deep = (style + 1) * 2;
    const anchor = { x: 24, z: rotation === 0 ? 24 - deep : 26 };
    const placed = editor.apply({ type: 'place-object', kind: 'parking', cell: anchor, rotation, variant: style }, 'parking');
    expect(placed.ok).toBe(true);
    const lot = [...editor.state.objects()].find((o) => o.kind === 'parking')!;
    return { editor, sim, lot, anchor, deep };
  }

  const run = (sim: TrafficSim, seconds: number, each?: () => void) => {
    for (let i = 0; i < seconds * 30; i += 1) {
      sim.step(1 / 30);
      each?.();
    }
  };

  const inLot = (car: Car) => car.phase !== 'drive' && car.phase !== 'approach';

  it('cars park nose-in in a free stall of every style, stay a bounded while and drive off again', () => {
    for (const style of [0, 1, 2] as const) {
      for (const rotation of [0, 2] as const) {
        const { sim, lot, anchor, deep } = lotTown(style, rotation);
        const what = `style ${style} rotation ${rotation}`;
        const parkedIds = new Set<number>();
        const left = new Set<number>();
        const stalls = new Set<number>();
        let longest = 0;
        const cell = { x: 0, z: 0 };
        run(sim, 400, () => {
          const taken = new Set<number>();
          let manoeuvring = 0;
          for (const car of sim.cars) {
            expect(Number.isFinite(car.x) && Number.isFinite(car.z), what).toBe(true);
            if (car.lot === 0) {
              expect(car.phase, what).toBe('drive');
              if (parkedIds.has(car.id)) left.add(car.id);
              continue;
            }
            expect(car.lot, what).toBe(lot.id);
            expect(taken.has(car.stall), `${what}: two cars in stall ${car.stall}`).toBe(false);
            taken.add(car.stall);
            if (car.phase !== 'parked') manoeuvring += 1;
            if (car.phase !== 'parked') continue;
            parkedIds.add(car.id);
            stalls.add(car.stall);
            longest = Math.max(longest, car.parkedFor);
            expect(car.speed, what).toBe(0);
            worldToCell(car.x, car.z, cell);
            expect(cell.x >= anchor.x && cell.x < anchor.x + 4 && cell.z >= anchor.z && cell.z < anchor.z + deep, `${what}: parked inside the lot`).toBe(true);
            // Nose-in: small bays face away from the street, aisle stalls face away from the aisle.
            if (style === 0) expect(car.hz, what).toBeCloseTo(rotation === 0 ? -1 : 1, 5);
            else expect(Math.abs(car.hx), what).toBeCloseTo(1, 5);
          }
          expect(manoeuvring, `${what}: one car manoeuvres per lot`).toBeLessThanOrEqual(1);
          expect(sim.cars.length, what).toBeLessThanOrEqual(MAX_CARS);
        });
        expect(parkedIds.size, `${what}: cars parked`).toBeGreaterThan(2);
        expect(left.size, `${what}: cars left again`).toBeGreaterThan(1);
        expect(stalls.size, `${what}: stalls used`).toBeGreaterThan(1);
        expect(longest, what).toBeGreaterThanOrEqual(DEFAULT_PARKING_TUNING.dwellMin - 0.1);
        expect(longest, `${what}: nobody waits long to leave`).toBeLessThan(DEFAULT_PARKING_TUNING.dwellMax + 20);
        expect(sim.stats.despawned, what).toBe(0);
      }
    }
  });

  it('cars use car parks at every rotation', () => {
    for (const style of [0, 1, 2] as const) {
      for (const rotation of [0, 1, 2, 3] as const) {
        const bus = createGameBus();
        const editor = new TownEditor(newTown(), bus, createSeededRandom(1));
        const sim = new TrafficSim(editor.state, createSeededRandom(11));
        bus.on('town:changed', ({ changes, cause }) => sim.onTownChanged(changes, cause));
        // An east–west street (rotations 0, 2) or a north–south one (1, 3) through block 12, the lot beside it.
        const alongX = rotation % 2 === 0;
        editor.beginStroke();
        for (let b = 3; b < 21; b += 1) editor.apply({ type: 'paint-ground', kind: 'road', cell: alongX ? { x: b * 2, z: 24 } : { x: 24, z: b * 2 } }, 'road');
        editor.endStroke();
        const deep = (style + 1) * 2;
        // Rotation 0 fronts south, 1 east, 2 north, 3 west: the lot sits on the other side of the street.
        const cell = rotation === 0 ? { x: 22, z: 24 - deep } : rotation === 2 ? { x: 22, z: 26 } : rotation === 1 ? { x: 24 - deep, z: 22 } : { x: 26, z: 22 };
        const what = `style ${style} rotation ${rotation}`;
        expect(editor.apply({ type: 'place-object', kind: 'parking', cell, rotation, variant: style }, 'parking').ok, what).toBe(true);
        const [w, d] = alongX ? [4, deep] : [deep, 4];
        const parked = new Set<number>();
        const left = new Set<number>();
        const at = { x: 0, z: 0 };
        run(sim, 300, () => {
          for (const car of sim.cars) {
            if (car.lot === 0 && parked.has(car.id)) left.add(car.id);
            if (car.phase !== 'parked') continue;
            parked.add(car.id);
            worldToCell(car.x, car.z, at);
            expect(at.x >= cell.x && at.x < cell.x + w && at.z >= cell.z && at.z < cell.z + d, `${what}: parked inside the lot`).toBe(true);
          }
        });
        expect(parked.size, `${what}: cars parked`).toBeGreaterThan(1);
        expect(left.size, `${what}: cars left again`).toBeGreaterThan(0);
        expect(sim.stats.despawned + sim.stats.unstuck, what).toBe(0);
      }
    }
  });

  it('other cars stay out of the front block while a car backs out of a bay or turns in', () => {
    const { sim } = lotTown(0, 0, 9);
    let holds = 0;
    run(sim, 400, () => {
      for (const holder of sim.cars) {
        if (!holder.locks) continue;
        holds += 1;
        for (const other of sim.cars) {
          if (other === holder || inLot(other)) continue;
          expect(other.cx === holder.cx && other.cz === holder.cz, `car ${other.id} in car ${holder.id}'s front block`).toBe(false);
          expect(Math.hypot(other.x - holder.x, other.z - holder.z)).toBeGreaterThan(0.3);
        }
      }
    });
    expect(holds).toBeGreaterThan(0);
  });

  describe('several car parks on a busy network', () => {
    /** A ring road (blocks 4–15 × 4–9, 32 blocks) with a spur, enough for MAX_CARS, and car parks on its north side. */
    function ringTown(lots: Array<{ bx: number; style: 0 | 1 | 2; south?: boolean }>, seed: number) {
      const bus = createGameBus();
      const editor = new TownEditor(newTown(), bus, createSeededRandom(1));
      const sim = new TrafficSim(editor.state, createSeededRandom(seed));
      bus.on('town:changed', ({ changes, cause }) => sim.onTownChanged(changes, cause));
      const road = (bx: number, bz: number) => editor.apply({ type: 'paint-ground', kind: 'road', cell: { x: bx * 2, z: bz * 2 } }, 'road');
      editor.beginStroke();
      for (let bx = 4; bx <= 15; bx += 1) road(bx, 4), road(bx, 9);
      for (let bz = 5; bz <= 8; bz += 1) road(4, bz), road(15, bz);
      for (let bz = 10; bz <= 14; bz += 1) road(8, bz);
      editor.endStroke();
      for (const lot of lots) {
        // North of row 4 facing south, or (south) inside the ring facing north onto the same street.
        const cell = lot.south ? { x: lot.bx * 2, z: 10 } : { x: lot.bx * 2, z: 8 - (lot.style + 1) * 2 };
        expect(editor.apply({ type: 'place-object', kind: 'parking', cell, rotation: lot.south ? 2 : 0, variant: lot.style }, 'parking').ok).toBe(true);
      }
      expect(sim.cars.length).toBe(MAX_CARS);
      return sim;
    }

    const layouts: Array<[string, Array<{ bx: number; style: 0 | 1 | 2; south?: boolean }>]> = [
      ['two bays side by side', [{ bx: 8, style: 0 }, { bx: 10, style: 0 }]],
      ['a bay lot beside an aisle lot', [{ bx: 8, style: 0 }, { bx: 10, style: 1 }]],
      ['two aisle lots facing each other', [{ bx: 8, style: 1 }, { bx: 8, style: 1, south: true }]],
      ['two bay lots facing each other', [{ bx: 8, style: 0 }, { bx: 8, style: 0, south: true }]],
      ['a bay lot facing an aisle lot', [{ bx: 8, style: 0 }, { bx: 8, style: 2, south: true }]],
    ];

    for (const eager of [false, true]) {
      for (const [name, lots] of layouts) {
        it(`${name}: traffic never locks up${eager ? ' (every car parks, short stays)' : ''}`, () => {
          for (const seed of [1, 2, 3, 4, 5, 6]) {
            const sim = ringTown(lots, seed);
            if (eager) Object.assign(sim.parking, { parkChance: 1, dwellMin: 1, dwellMax: 4, parkedShare: 1 });
            const dt = 1 / 30;
            let longest = 0;
            let hardest = 0;
            let asked = 0;
            let stayed = 0;
            const before = new Map<number, number>();
            for (let i = 0; i < 30 * 60 * (eager ? 10 : 20); i += 1) {
              for (const car of sim.cars) before.set(car.id, car.phase === 'drive' ? car.speed : -1);
              sim.step(dt);
              for (const car of sim.cars) {
                if (car.phase !== 'parked') longest = Math.max(longest, car.still);
                else stayed = Math.max(stayed, car.parkedFor);
                asked = Math.max(asked, car.asking);
                const was = before.get(car.id) ?? -1;
                if (was >= 0 && car.phase === 'drive') hardest = Math.max(hardest, was - car.speed);
              }
            }
            const what = `${name}, seed ${seed}`;
            expect(longest, `${what}: longest standstill of a car that is not parked`).toBeLessThan(12);
            // Every car gets out: nobody waits long for its front block, parked or at the hold point.
            expect(asked, `${what}: longest wait to leave`).toBeLessThan(40);
            expect(stayed, `${what}: longest stay`).toBeLessThan(sim.parking.dwellMax + 45);
            // Nobody stops dead: braking is the usual BRAKE (4.5 units/s²).
            expect(hardest, `${what}: hardest one-step slowdown`).toBeLessThanOrEqual(4.5 * dt + 1e-9);
            expect(sim.stats.unstuck, what).toBe(0);
            expect(sim.stats.despawned, what).toBe(0);
            expect(sim.cars.length, what).toBe(MAX_CARS);
          }
        });
      }
    }
  });

  it('a full car park is passed by, and no stall is ever shared', () => {
    const { sim, lot } = lotTown(0, 0, 3, true);
    Object.assign(sim.parking, { parkChance: 1, parkedShare: 1, dwellMin: 1e6, dwellMax: 1e6 });
    expect(sim.cars.length).toBe(MAX_CARS);
    run(sim, 300);
    const parked = sim.cars.filter((c) => c.phase === 'parked');
    expect(parked.map((c) => c.stall).sort()).toEqual([0, 1, 2, 3]);
    expect(parked.every((c) => c.lot === lot.id)).toBe(true);
    const driving = sim.cars.filter((c) => c.phase === 'drive');
    expect(driving.length).toBe(MAX_CARS - 4);
    const before = driving.map((c) => [c.x, c.z]);
    run(sim, 20, () => expect(sim.stats.manoeuvring).toBe(0));
    expect(driving.some((c, i) => c.x !== before[i][0] || c.z !== before[i][1])).toBe(true);
  });

  it('never has more than its share of the cars in car parks', () => {
    const { sim } = lotTown(2, 0, 4, true);
    Object.assign(sim.parking, { parkChance: 1 });
    run(sim, 300, () => expect(sim.cars.filter((c) => c.lot !== 0).length).toBeLessThanOrEqual(3));
  });

  it('a car park no car can reach changes nothing: same cars, same stream', () => {
    const trail = (withLot: boolean) => {
      const bus = createGameBus();
      const editor = new TownEditor(newTown(), bus, createSeededRandom(1));
      const sim = new TrafficSim(editor.state, createSeededRandom(7));
      bus.on('town:changed', ({ changes, cause }) => sim.onTownChanged(changes, cause));
      editor.beginStroke();
      for (let bx = 4; bx < 22; bx += 1) editor.apply({ type: 'paint-ground', kind: 'road', cell: { x: bx * 2, z: 24 } }, 'road');
      editor.endStroke();
      // Back to the street: its kerb, not its entrance, meets the road.
      if (withLot) expect(editor.apply({ type: 'place-object', kind: 'parking', cell: { x: 24, z: 20 }, rotation: 2, variant: 1 }, 'parking').ok).toBe(true);
      run(sim, 120);
      return sim.cars.map((c) => [c.id, c.model, c.cx, c.cz, c.x, c.z, c.phase]);
    };
    expect(trail(true)).toEqual(trail(false));
  });

  it('a town without car parks keeps its pinned trajectory', () => {
    const town = newTown();
    const sim = new TrafficSim(town, createSeededRandom(7));
    sim.onTownChanged(paint(town, sampleTownRoads()), 'load');
    let hash = 0;
    for (let i = 0; i < 60 * 120; i += 1) {
      sim.step(1 / 60);
      if (i % 60 === 59) for (const c of sim.cars) hash = (Math.imul(hash, 31) + c.id * 7919 + Math.round(c.x * 1e4) * 31 + Math.round(c.z * 1e4)) | 0;
    }
    expect(hash).toBe(PINNED_NO_LOT_HASH);
  });

  it('is deterministic with car parks in play', () => {
    const trail = (seed: number) => {
      const { sim } = lotTown(1, 0, seed);
      run(sim, 200);
      return sim.cars.map((c) => [c.id, c.phase, c.lot, c.stall, c.x.toFixed(5), c.z.toFixed(5)]);
    };
    expect(trail(3)).toEqual(trail(3));
    expect(trail(3)).not.toEqual(trail(4));
  });

  describe('town changes', () => {
    /** Runs until a car is in `phase` (and, for 'out', has started moving). */
    function until(sim: TrafficSim, phase: Car['phase']): Car {
      for (let i = 0; i < 30 * 600; i += 1) {
        sim.step(1 / 30);
        const car = sim.cars.find((c) => c.phase === phase);
        if (car) return car;
      }
      throw new Error(`no car reached ${phase}`);
    }

    for (const phase of ['approach', 'in', 'parked', 'out'] as const) {
      it(`bulldozing the car park removes a car that is ${phase}, and only lot cars`, () => {
        const { editor, sim, anchor } = lotTown(1, 0, 6);
        const car = until(sim, phase);
        const others = sim.cars.filter((c) => c.lot === 0).map((c) => c.id);
        const removed: number[] = [];
        sim.onRemove = (c) => removed.push(c.id);
        expect(editor.apply({ type: 'bulldoze', cell: anchor, edge: null }, 'bulldoze').ok).toBe(true);
        expect(removed).toContain(car.id);
        expect(sim.cars.every((c) => c.lot === 0 && c.phase === 'drive')).toBe(true);
        for (const id of others) expect(sim.cars.some((c) => c.id === id), `car ${id} keeps driving`).toBe(true);
        run(sim, 30, () => {
          for (const c of sim.cars) expect(c.lot).toBe(0);
        });
        // Undo brings the lot back, empty; cars use it again.
        editor.undo();
        expect(sim.cars.every((c) => c.lot === 0)).toBe(true);
        expect(until(sim, 'parked').lot).toBeGreaterThan(0);
      });
    }

    it('bulldozing the road in front of a bay removes the car parked in it; the other block still serves its bays', () => {
      const { editor, sim } = lotTown(0, 0, 8, true);
      Object.assign(sim.parking, { parkChance: 1, parkedShare: 1, dwellMin: 1e6, dwellMax: 1e6 });
      run(sim, 300);
      expect(sim.cars.filter((c) => c.phase === 'parked').length).toBe(4);
      // The front block of bays 0 and 1 (lot cells x 24–27 → blocks 12, 13; the street is block row 12).
      expect(editor.apply({ type: 'bulldoze', cell: { x: 24, z: 24 }, edge: null }, 'bulldoze').ok).toBe(true);
      expect(sim.cars.filter((c) => c.phase === 'parked').map((c) => c.stall).sort()).toEqual([2, 3]);
      expect(editor.apply({ type: 'bulldoze', cell: { x: 26, z: 24 }, edge: null }, 'bulldoze').ok).toBe(true);
      expect(sim.cars.every((c) => c.lot === 0)).toBe(true);
    });

    it('bulldozing the road a leaving car is about to drive onto removes it', () => {
      const { editor, sim } = lotTown(0, 0, 6);
      const car = until(sim, 'out');
      const next = { x: (car.cx + DIR_X[car.exitDir]) * 2, z: (car.cz + DIR_Z[car.exitDir]) * 2 };
      expect(editor.apply({ type: 'bulldoze', cell: next, edge: null }, 'bulldoze').ok).toBe(true);
      expect(sim.cars.some((c) => c.id === car.id)).toBe(false);
      expect(sim.cars.every((c) => !c.locks)).toBe(true);
    });

    it('load and reset clear every lot car; night thins parked cars like any other', () => {
      const { editor, sim } = lotTown(2, 0, 2);
      until(sim, 'parked');
      const save = editor.serialize();
      editor.load(save);
      expect(sim.cars.length).toBeGreaterThan(0);
      expect(sim.cars.every((c) => c.lot === 0 && c.phase === 'drive')).toBe(true);
      until(sim, 'parked');
      sim.setDensity(0);
      expect(sim.cars.length).toBe(1);
      sim.setDensity(1);
      const stalls = new Set<number>();
      for (const c of sim.cars) if (c.lot !== 0) expect(stalls.has(c.stall)).toBe(false), stalls.add(c.stall);
      until(sim, 'parked');
      editor.reset();
      expect(sim.cars.length).toBe(0);
      expect(sim.stats.parked + sim.stats.manoeuvring).toBe(0);
    });
  });
});
