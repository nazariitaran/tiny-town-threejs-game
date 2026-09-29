import { describe, expect, it } from 'vitest';
import {
  ALTITUDE,
  BIRD_SPECIES,
  BIRD_WINGSPAN,
  CENTRE_JITTER,
  ENTRY_RADIUS,
  FIRST_FLOCK_S,
  FLOCK_INTERVAL_S,
  FlockSim,
  MAX_BIRDS,
  MAX_FLOCKS,
  SPECIES,
  TREE_FACTOR_MAX,
  TWILIGHT_FACTOR,
  type Bird,
} from './FlockSim';
import { createBirdGeometry, isBirdSpecies } from './BirdSystem';

const DT = 1 / 30;

/** Step until the sky is empty (or `limit` seconds pass); returns the seconds taken. */
function flyOut(sim: FlockSim, limit = 60): number {
  let t = 0;
  while (sim.flocks.length > 0 && t < limit) {
    sim.step(DT);
    t += DT;
  }
  return t;
}

const snapshot = (birds: readonly Bird[]) => birds.map((b) => [b.x, b.y, b.z, b.yaw, b.wingInner].map((v) => v.toFixed(5)).join(','));

describe('FlockSim schedule', () => {
  it('launches the first flock within FIRST_FLOCK_S, then waits FLOCK_INTERVAL_S', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const sim = new FlockSim(seed);
      const first = sim.stats.nextFlockIn;
      expect(first).toBeGreaterThanOrEqual(FIRST_FLOCK_S[0]);
      expect(first).toBeLessThanOrEqual(FIRST_FLOCK_S[1]);
      let t = 0;
      while (sim.stats.spawned === 0 && t < 30) {
        sim.step(DT);
        t += DT;
      }
      expect(sim.stats.spawned).toBe(1);
      expect(Math.abs(t - first)).toBeLessThan(2 * DT);
      expect(sim.stats.nextFlockIn).toBeGreaterThanOrEqual(FLOCK_INTERVAL_S[0] - DT);
      expect(sim.stats.nextFlockIn).toBeLessThanOrEqual(FLOCK_INTERVAL_S[1]);
    }
  });

  it('waits less at dawn/dusk and in a leafy town', () => {
    const waits = (twilight: boolean, trees: number) => {
      const sim = new FlockSim(7, () => trees);
      sim.setNight(0, twilight);
      return Array.from({ length: 200 }, () => sim.interval());
    };
    const max = (list: number[]) => Math.max(...list);
    const min = (list: number[]) => Math.min(...list);
    expect(max(waits(false, 0))).toBeLessThanOrEqual(FLOCK_INTERVAL_S[1]);
    expect(max(waits(true, 0))).toBeLessThanOrEqual(FLOCK_INTERVAL_S[1] * TWILIGHT_FACTOR + 1e-9);
    expect(max(waits(false, 400))).toBeLessThanOrEqual(FLOCK_INTERVAL_S[1] * (1 - TREE_FACTOR_MAX) + 1e-9);
    expect(min(waits(false, 400))).toBeGreaterThanOrEqual(FLOCK_INTERVAL_S[0] * (1 - TREE_FACTOR_MAX) - 1e-9);
  });

  it('never launches a spontaneous flock at night, and catches up in the morning', () => {
    const sim = new FlockSim(3);
    sim.setNight(1, false);
    for (let t = 0; t < 400; t += DT) sim.step(DT);
    expect(sim.stats.spawned).toBe(0);
    sim.setNight(0, true);
    for (let t = 0; t < 15; t += DT) sim.step(DT);
    expect(sim.stats.spawned).toBe(1);
  });

  it('launches nothing by itself with auto off, but spawn() still works', () => {
    const sim = new FlockSim(4);
    sim.auto = false;
    for (let t = 0; t < 400; t += DT) sim.step(DT);
    expect(sim.stats.spawned).toBe(0);
    expect(sim.spawn('goose')).toBeGreaterThan(0);
    expect(sim.flocks[0].species).toBe('goose');
  });

  it('honours the debug interval override', () => {
    const sim = new FlockSim(5);
    sim.intervalOverride = 3;
    sim.reset(5);
    expect(sim.stats.nextFlockIn).toBe(3);
    for (let t = 0; t < 3.05; t += DT) sim.step(DT);
    expect(sim.stats.spawned).toBe(1);
    expect(sim.stats.nextFlockIn).toBeCloseTo(3, 1);
  });

  it('caps the sky at MAX_FLOCKS flocks and MAX_BIRDS birds', () => {
    const sim = new FlockSim(6);
    let launched = 0;
    for (let i = 0; i < 10; i += 1) if (sim.spawn('starling') > 0) launched += 1;
    expect(launched).toBeLessThanOrEqual(MAX_FLOCKS);
    expect(sim.flocks.length).toBeLessThanOrEqual(MAX_FLOCKS);
    expect(sim.birds.length).toBeLessThanOrEqual(MAX_BIRDS);
    expect(sim.spawn()).toBe(0);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const run = (seed: number) => {
      const sim = new FlockSim(seed);
      sim.spawn();
      for (let i = 0; i < 90; i += 1) sim.step(DT);
      return snapshot(sim.birds);
    };
    expect(run(11)).toEqual(run(11));
    expect(run(11)).not.toEqual(run(12));
  });

  it('reset() clears the sky and restarts the schedule', () => {
    const sim = new FlockSim(8);
    sim.spawn();
    sim.reset(8);
    expect(sim.flocks.length).toBe(0);
    expect(sim.birds.length).toBe(0);
    expect(sim.stats.spawned).toBe(0);
  });
});

describe('FlockSim flight', () => {
  it('crosses over the town and leaves; every bird stays in the altitude band', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const sim = new FlockSim(seed);
      sim.auto = false;
      const species = BIRD_SPECIES[seed % BIRD_SPECIES.length];
      expect(sim.spawn(species)).toBeGreaterThanOrEqual(2);
      let closest = Infinity;
      let t = 0;
      while (sim.flocks.length > 0 && t < 60) {
        sim.step(DT);
        t += DT;
        for (const bird of sim.birds) {
          expect(bird.y).toBeGreaterThanOrEqual(ALTITUDE[0]);
          expect(bird.y).toBeLessThanOrEqual(ALTITUDE[1]);
          closest = Math.min(closest, Math.hypot(bird.x, bird.z));
        }
      }
      expect(sim.flocks.length, `seed ${seed} flock left`).toBe(0);
      expect(t).toBeGreaterThan(15);
      expect(t).toBeLessThan(40);
      // Control point within CENTRE_JITTER of the centre, exit within ±35° of straight across: the
      // path's midpoint is within ~8 units, well inside the 16-unit half plot (over the town).
      expect(closest).toBeLessThan(CENTRE_JITTER / 2 + 6);
    }
  });

  it('enters and leaves off the plot, grown in / shrunk out at the ends', () => {
    const sim = new FlockSim(9);
    sim.spawn('pigeon');
    const leader = sim.birds[0];
    expect(Math.hypot(leader.x, leader.z)).toBeCloseTo(ENTRY_RADIUS, 0);
    expect(leader.scale).toBe(0);
    for (let i = 0; i < 150; i += 1) sim.step(DT);
    expect(leader.scale).toBeCloseTo(SPECIES.pigeon.size, 5);
  });

  it('keeps birds of a flock apart (no overlaps) all the way across', () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const sim = new FlockSim(seed * 13);
      sim.auto = false;
      const species = BIRD_SPECIES[seed % BIRD_SPECIES.length];
      sim.spawn(species);
      const span = BIRD_WINGSPAN * SPECIES[species].size;
      for (let step = 0; step < 900 && sim.flocks.length > 0; step += 10) {
        for (let k = 0; k < 10; k += 1) sim.step(DT);
        const birds = sim.birds;
        for (let i = 0; i < birds.length; i += 1) {
          for (let j = i + 1; j < birds.length; j += 1) {
            const d = Math.hypot(birds[i].x - birds[j].x, birds[i].y - birds[j].y, birds[i].z - birds[j].z);
            expect(d, `${species} seed ${seed}`).toBeGreaterThan(span * 0.8);
          }
        }
      }
    }
  });

  it('a second flock flies in the other height lane, so crossing flocks never meet', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const sim = new FlockSim(seed);
      sim.auto = false;
      sim.spawn('pigeon');
      sim.spawn('starling');
      const [a, b] = sim.flocks;
      expect(Math.abs(a.altitude - b.altitude)).toBeGreaterThanOrEqual(0.3);
      for (let i = 0; i < 900 && sim.flocks.length === 2; i += 1) {
        sim.step(DT);
        const low = Math.max(...a.birds.map((bird) => bird.y));
        const high = Math.min(...b.birds.map((bird) => bird.y));
        const [lowTop, highBottom] = a.altitude < b.altitude ? [low, high] : [Math.max(...b.birds.map((bird) => bird.y)), Math.min(...a.birds.map((bird) => bird.y))];
        expect(highBottom - lowTop).toBeGreaterThan(0.03);
      }
    }
  });

  it('flies beak first (the model +Z) and banks into its turns', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const sim = new FlockSim(seed * 7);
      sim.auto = false;
      sim.spawn('goose');
      const flock = sim.flocks[0];
      const leader = flock.birds[0];
      for (let i = 0; i < 400 && sim.flocks.length > 0; i += 1) {
        const [x, z, yaw] = [leader.x, leader.z, flock.yaw];
        sim.step(DT);
        if (sim.flocks.length === 0) break;
        const dx = leader.x - x;
        const dz = leader.z - z;
        const len = Math.hypot(dx, dz);
        // Leader's slot is the flock centre, so it moves along the heading (plus a tiny wander).
        expect((dx * Math.sin(yaw) + dz * Math.cos(yaw)) / len).toBeGreaterThan(0.97);
        const turn = Math.atan2(Math.sin(flock.yaw - yaw), Math.cos(flock.yaw - yaw));
        // A sustained left turn (yaw increasing) ends up with a negative roll (left wing down), and vice versa.
        if (i > 60 && Math.abs(turn) / DT > 0.05) expect(Math.sign(flock.bank)).toBe(-Math.sign(turn));
      }
    }
  });

  it('geese fly in a V behind their leader', () => {
    const sim = new FlockSim(10);
    sim.spawn('goose');
    const [leader, ...rest] = sim.flocks[0].birds;
    expect(leader.back).toBe(0);
    for (const bird of rest) {
      expect(bird.back).toBeGreaterThan(0);
      expect(Math.abs(bird.side)).toBeGreaterThan(0);
    }
  });

  it('flaps and glides with bounded wing angles', () => {
    const sim = new FlockSim(12);
    sim.spawn('gull');
    let glided = false;
    let flapped = false;
    for (let i = 0; i < 600 && sim.flocks.length > 0; i += 1) {
      sim.step(DT);
      for (const bird of sim.birds) {
        expect(Math.abs(bird.wingInner)).toBeLessThan(1.2);
        expect(Math.abs(bird.wingOuter)).toBeLessThan(0.8);
        if (bird.gliding) glided = true;
        else flapped = true;
      }
    }
    expect(glided).toBe(true);
    expect(flapped).toBe(true);
  });

  it('step(0) freezes everything, including the schedule', () => {
    const sim = new FlockSim(14);
    sim.spawn();
    for (let i = 0; i < 30; i += 1) sim.step(DT);
    const before = snapshot(sim.birds);
    const next = sim.stats.nextFlockIn;
    for (let i = 0; i < 30; i += 1) sim.step(0);
    expect(snapshot(sim.birds)).toEqual(before);
    expect(sim.stats.nextFlockIn).toBe(next);
  });

  it('clear() empties the sky but keeps the schedule', () => {
    const sim = new FlockSim(15);
    sim.spawn();
    const next = sim.stats.nextFlockIn;
    const version = sim.version;
    sim.clear();
    expect(sim.birds.length).toBe(0);
    expect(sim.version).toBeGreaterThan(version);
    expect(sim.stats.nextFlockIn).toBe(next);
    expect(flyOut(sim)).toBe(0);
  });
});

describe('bird geometry', () => {
  it('is 18 triangles, 0.36 units across, with a part tag per vertex', () => {
    const geometry = createBirdGeometry();
    const position = geometry.getAttribute('position');
    expect(position.count / 3).toBe(18);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(BIRD_WINGSPAN, 5);
    const parts = new Set(Array.from(geometry.getAttribute('aWing').array));
    expect([...parts].sort()).toEqual([0, 1, 2]);
    expect(geometry.getAttribute('color').count).toBe(position.count);
  });

  it('knows its species names', () => {
    for (const kind of BIRD_SPECIES) expect(isBirdSpecies(kind)).toBe(true);
    expect(isBirdSpecies('dragon')).toBe(false);
    expect(isBirdSpecies(undefined)).toBe(false);
  });
});
