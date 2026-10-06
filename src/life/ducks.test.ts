import { describe, expect, it } from 'vitest';
import { cellToWorld, worldToCell } from '../game/config';
import { TownState } from '../town/TownState';
import type { TownChange } from '../town/types';
import { DuckSim, ducksForPond, MAX_DUCKS, MAX_DUCKS_PER_POND, MIN_POND_CELLS } from './DuckSim';

function town(): TownState {
  return new TownState(64, 64);
}

function dig(state: TownState, x0: number, z0: number, x1: number, z1: number): void {
  const changes: TownChange[] = [];
  for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) changes.push({ layer: 'ground', cell: { x, z }, before: state.getGround({ x, z }), after: 'pond' });
  state.applyChanges(changes);
}

function fill(state: TownState, x0: number, z0: number, x1: number, z1: number): void {
  const changes: TownChange[] = [];
  for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) changes.push({ layer: 'ground', cell: { x, z }, before: state.getGround({ x, z }), after: 'field' });
  state.applyChanges(changes);
}

const live = (sim: DuckSim) => sim.ducks.filter((duck) => !duck.leaving);

describe('ducks', () => {
  it('a pond keeps more ducks as it grows, up to its cap; puddles keep none', () => {
    expect(ducksForPond(MIN_POND_CELLS - 1)).toBe(0);
    expect(ducksForPond(MIN_POND_CELLS)).toBe(1);
    expect(ducksForPond(16)).toBe(2);
    expect(ducksForPond(36)).toBe(4);
    expect(ducksForPond(1000)).toBe(MAX_DUCKS_PER_POND);
    for (let cells = 1; cells < 200; cells += 1) expect(ducksForPond(cells + 1)).toBeGreaterThanOrEqual(ducksForPond(cells));
  });

  it('arrive on each pond by its size, settled at once on a load', () => {
    const state = town();
    dig(state, 4, 4, 9, 9); // 36 cells → 4
    dig(state, 20, 4, 21, 6); // 6 cells → 1
    dig(state, 30, 30, 31, 31); // 4 cells → none
    const sim = new DuckSim(1);
    sim.sync(state, true);
    expect(sim.ponds).toBe(2);
    expect(sim.wanted).toBe(5);
    expect(live(sim)).toHaveLength(5);
    for (const duck of sim.ducks) {
      expect(duck.scale).toBe(1);
      expect(sim.isOpenWater(duck.x, duck.z)).toBe(true);
    }
  });

  it('is deterministic for a seed', () => {
    const state = town();
    dig(state, 4, 4, 12, 12);
    const run = () => {
      const sim = new DuckSim(42);
      sim.sync(state, true);
      for (let i = 0; i < 600; i += 1) sim.step(1 / 30);
      return sim.ducks.map((d) => [d.x, d.z, d.yaw]);
    };
    expect(run()).toEqual(run());
  });

  it('paddle about for minutes and never leave open water', () => {
    const state = town();
    // An L-shaped pond with a notch, so straight lines across it would cross land.
    dig(state, 4, 4, 15, 8);
    dig(state, 4, 9, 8, 18);
    state.applyChanges([{ layer: 'object', op: 'add', object: { id: 1, kind: 'bird-house', anchor: { x: 6, z: 6 }, rotation: 0, variant: 0 } }]);
    const sim = new DuckSim(7);
    sim.sync(state, true);
    const start = sim.ducks.map((d) => [d.x, d.z]);
    let travelled = 0;
    for (let i = 0; i < 30 * 240; i += 1) {
      const before = sim.ducks.map((d) => [d.x, d.z]);
      sim.step(1 / 30);
      sim.ducks.forEach((duck, k) => {
        travelled += Math.hypot(duck.x - before[k][0], duck.z - before[k][1]);
        expect(sim.isOpenWater(duck.x, duck.z), `duck ${duck.id} at ${duck.x}, ${duck.z}`).toBe(true);
        // Never on the bird house's cell.
        const cell = worldToCell(duck.x, duck.z);
        expect(cell.x === 6 && cell.z === 6).toBe(false);
      });
    }
    expect(travelled).toBeGreaterThan(3);
    expect(sim.ducks.map((d) => [d.x, d.z])).not.toEqual(start);
  });

  it('rest at night', () => {
    const state = town();
    dig(state, 4, 4, 12, 12);
    const sim = new DuckSim(3);
    sim.sync(state, true);
    sim.setNight(1);
    // Let any swim in progress end, then nobody moves.
    for (let i = 0; i < 30 * 60; i += 1) sim.step(1 / 30);
    const settled = sim.ducks.map((d) => [d.x, d.z]);
    for (let i = 0; i < 30 * 60; i += 1) sim.step(1 / 30);
    expect(sim.ducks.map((d) => [d.x, d.z])).toEqual(settled);
  });

  it('stay put when not on auto (test states)', () => {
    const state = town();
    dig(state, 4, 4, 12, 12);
    const sim = new DuckSim(3);
    sim.auto = false;
    sim.sync(state, true);
    const start = JSON.stringify(sim.ducks);
    for (let i = 0; i < 300; i += 1) sim.step(1 / 30);
    expect(JSON.stringify(sim.ducks)).toBe(start);
  });

  it('follow the town: a filled-in pond loses its ducks, a shrunk pond thins out, a grown one fills up', () => {
    const state = town();
    dig(state, 4, 4, 9, 9);
    const sim = new DuckSim(5);
    sim.sync(state, true);
    expect(live(sim)).toHaveLength(4);
    fill(state, 4, 7, 9, 9); // 18 cells left → 2
    sim.sync(state);
    expect(live(sim)).toHaveLength(2);
    for (const duck of live(sim)) expect(sim.isOpenWater(duck.x, duck.z)).toBe(true);
    // Leaving ducks shrink out, then go.
    for (let i = 0; i < 30; i += 1) sim.step(1 / 30);
    expect(sim.ducks).toHaveLength(2);
    dig(state, 4, 4, 13, 13); // 100 cells → the cap
    sim.sync(state);
    expect(live(sim)).toHaveLength(MAX_DUCKS_PER_POND);
    expect(live(sim).some((duck) => duck.scale < 1)).toBe(true);
    fill(state, 0, 0, 63, 63);
    sim.sync(state, true);
    expect(sim.ducks).toHaveLength(0);
  });

  it('never more than MAX_DUCKS on the plot', () => {
    const state = town();
    for (let k = 0; k < 6; k += 1) dig(state, 2 + k * 10, 2, 9 + k * 10 > 63 ? 63 : 9 + k * 10, 12);
    const sim = new DuckSim(9);
    sim.sync(state, true);
    expect(sim.wanted).toBe(MAX_DUCKS);
    expect(live(sim).length).toBeLessThanOrEqual(MAX_DUCKS);
  });

  it('the world mapping puts a duck in its pond cell', () => {
    const state = town();
    dig(state, 10, 10, 13, 13);
    const sim = new DuckSim(2);
    sim.sync(state, true);
    const centre = cellToWorld({ x: 11, z: 11 });
    expect(sim.isOpenWater(centre.x + 0.25, centre.z + 0.25)).toBe(true);
    expect(sim.isOpenWater(cellToWorld({ x: 10, z: 10 }).x - 0.2, centre.z)).toBe(false);
  });
});
