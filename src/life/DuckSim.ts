/**
 * Ducks on the ponds (pure, own seeded stream). Each pond (4-connected pond cells, town/pondTiles)
 * keeps `ducksForPond(cells)` ducks; they paddle between points of open water, rest, now and then
 * dabble (tail up), and rest all night. Nothing is saved: ducks follow the town on every change.
 * Per duck it outputs a world position, yaw (+Y rotation; the duck's +Z is its bill), a dabble pitch
 * (radians, bill down), a bob height and a pop scale.
 */
import { CELL_SIZE, cellToWorld, worldToCell } from '../game/config';
import { findPonds, pondQuarter } from '../town/pondTiles';
import type { Cell, TownStateReader } from '../town/types';
import { createSeededRandom } from '../utils/random';

/** A pond smaller than this has no duck. */
export const MIN_POND_CELLS = 6;
/** One more duck per this many cells beyond the minimum. */
export const CELLS_PER_DUCK = 10;
export const MAX_DUCKS_PER_POND = 6;
export const MAX_DUCKS = 24;
/** World units per second. */
export const SWIM_SPEED = 0.09;
/** Radians per second. */
const TURN_RATE = 2.4;
/** A duck keeps this far (half a square, world units) from any land, objects other than lily pads included. */
export const SHORE_CLEARANCE = 0.12;
const REST_S: readonly [number, number] = [2, 7];
const DABBLE_CHANCE = 0.25;
const DABBLE_S = 1.6;
const DABBLE_PITCH = 1.9;
/** Ducks pick targets at most this far away (world units), so they potter rather than cross the pond. */
const MAX_LEG = 1.6;
/** Ducks keep this far apart when picking targets. */
const PERSONAL_SPACE = 0.22;
const POP_S = 0.35;
/** Night above this: ducks finish their swim and rest. */
const NIGHT_REST = 0.6;
const BOB_HZ = 0.35;

export type DuckPhase = 'swim' | 'rest' | 'dabble';

export interface Duck {
  id: number;
  x: number;
  z: number;
  yaw: number;
  phase: DuckPhase;
  /** Seconds left in rest or dabble. */
  timer: number;
  targetX: number;
  targetZ: number;
  /** Radians, bill down. */
  pitch: number;
  /** World units above the resting waterline. */
  bob: number;
  bobPhase: number;
  /** 0..1: pops in on arrival, out when it leaves. */
  scale: number;
  leaving: boolean;
  hen: boolean;
}

/** How many ducks a pond of `cells` cells keeps. */
export function ducksForPond(cells: number): number {
  if (cells < MIN_POND_CELLS) return 0;
  return Math.min(MAX_DUCKS_PER_POND, 1 + Math.floor((cells - MIN_POND_CELLS) / CELLS_PER_DUCK));
}

export class DuckSim {
  ducks: Duck[] = [];
  /** Off in test states: ducks stay where they arrived, so captures are stable. */
  auto = true;
  /** Ducks the ponds want after the last sync (at most MAX_DUCKS). */
  wanted = 0;
  /** Ponds big enough for a duck after the last sync. */
  ponds = 0;
  private rng: () => number;
  private nextId = 1;
  private night = 0;
  private town: TownStateReader | null = null;
  private readonly scratch: Cell = { x: 0, z: 0 };
  private readonly scratchCentre = { x: 0, z: 0 };

  constructor(seed: number) {
    this.rng = createSeededRandom(seed);
  }

  reset(seed: number): void {
    this.rng = createSeededRandom(seed);
    this.ducks = [];
    this.nextId = 1;
    this.wanted = 0;
    this.ponds = 0;
  }

  setNight(night: number): void {
    this.night = night;
  }

  /** Follow the town: drop ducks whose water went, top up or thin out each pond. `settled`: no pop animations. */
  sync(town: TownStateReader, settled = false): void {
    this.town = town;
    const ponds = findPonds(town);
    const pondOf = new Map<number, number>();
    ponds.forEach((pond, i) => {
      for (const cell of pond) pondOf.set(cell.z * town.width + cell.x, i);
    });
    const byPond: Duck[][] = ponds.map(() => []);
    for (const duck of this.ducks) {
      if (duck.leaving) continue;
      const cell = worldToCell(duck.x, duck.z, this.scratch);
      const pond = pondOf.get(cell.z * town.width + cell.x);
      if (pond === undefined || !this.isOpenWater(duck.x, duck.z)) this.leave(duck, settled);
      else byPond[pond].push(duck);
    }
    let budget = MAX_DUCKS;
    this.wanted = 0;
    this.ponds = 0;
    ponds.forEach((pond, i) => {
      const want = Math.min(ducksForPond(pond.length), budget);
      if (ducksForPond(pond.length) > 0) this.ponds += 1;
      budget -= want;
      this.wanted += want;
      const here = byPond[i];
      // Newest leave first.
      for (let k = here.length - 1; k >= want; k -= 1) this.leave(here[k], settled);
      for (let k = here.length; k < want; k += 1) this.arrive(pond, settled);
    });
    for (const duck of this.ducks) {
      // A swim whose way is now blocked stops where it is.
      if (!duck.leaving && duck.phase === 'swim' && !this.clearPath(duck.x, duck.z, duck.targetX, duck.targetZ)) this.rest(duck);
    }
    if (settled) this.ducks = this.ducks.filter((duck) => !duck.leaving);
  }

  step(dt: number): void {
    if (dt <= 0) return;
    for (const duck of this.ducks) {
      duck.scale = duck.leaving ? Math.max(0, duck.scale - dt / POP_S) : Math.min(1, duck.scale + dt / POP_S);
      if (!this.auto) continue;
      duck.bobPhase = (duck.bobPhase + dt * BOB_HZ * Math.PI * 2) % (Math.PI * 2);
      duck.bob = 0.003 * Math.sin(duck.bobPhase);
      if (duck.leaving) continue;
      if (duck.phase === 'swim') this.swim(duck, dt);
      else if (duck.phase === 'dabble') {
        duck.timer -= dt;
        const u = 1 - Math.max(0, duck.timer) / DABBLE_S;
        duck.pitch = DABBLE_PITCH * Math.sin(Math.PI * Math.min(1, u)) ** 0.6;
        if (duck.timer <= 0) {
          duck.pitch = 0;
          this.rest(duck);
        }
      } else {
        duck.timer -= dt;
        if (duck.timer <= 0) this.wake(duck);
      }
    }
    if (this.ducks.some((duck) => duck.leaving && duck.scale <= 0)) this.ducks = this.ducks.filter((duck) => !duck.leaving || duck.scale > 0);
  }

  /** Finish pops (reduced motion, test states). */
  settle(): void {
    this.ducks = this.ducks.filter((duck) => !duck.leaving);
    for (const duck of this.ducks) {
      duck.scale = 1;
      duck.pitch = 0;
      duck.bob = 0;
    }
  }

  /**
   * Open water at (x, z): the four corners of a SHORE_CLEARANCE square round it are pond cells without a
   * standing object (lily pads float), and the point is not in a quarter cell with an outer corner bank,
   * whose land may reach well into the quarter.
   */
  isOpenWater(x: number, z: number): boolean {
    const town = this.town;
    if (!town) return false;
    const own = worldToCell(x, z, this.scratch);
    const centre = cellToWorld(own, this.scratchCentre);
    const q = z < centre.z ? (x < centre.x ? 0 : 1) : x < centre.x ? 3 : 2;
    if (town.inBounds(own) && town.getGround(own) === 'pond' && pondQuarter(town, own, q).piece === 'outer') return false;
    for (const [dx, dz] of CORNERS) {
      const cell = worldToCell(x + dx * SHORE_CLEARANCE, z + dz * SHORE_CLEARANCE, this.scratch);
      if (!town.inBounds(cell) || town.getGround(cell) !== 'pond') return false;
      const object = town.getObjectAt(cell);
      if (object && object.kind !== 'lily-pads') return false;
    }
    return true;
  }

  /** The straight swim from (x0, z0) to (x1, z1) stays in open water. */
  clearPath(x0: number, z0: number, x1: number, z1: number): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.04));
    for (let i = 0; i <= steps; i += 1) {
      const u = i / steps;
      if (!this.isOpenWater(x0 + (x1 - x0) * u, z0 + (z1 - z0) * u)) return false;
    }
    return true;
  }

  private arrive(pond: readonly Cell[], settled: boolean): void {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const cell = pond[Math.floor(this.rng() * pond.length) % pond.length];
      const centre = cellToWorld(cell);
      const x = centre.x + (this.rng() - 0.5) * 0.2 * CELL_SIZE;
      const z = centre.z + (this.rng() - 0.5) * 0.2 * CELL_SIZE;
      if (!this.isOpenWater(x, z) || this.crowded(x, z, null)) continue;
      const duck: Duck = {
        id: this.nextId++,
        x,
        z,
        yaw: this.rng() * Math.PI * 2,
        phase: 'rest',
        timer: lerp(REST_S, this.rng()),
        targetX: x,
        targetZ: z,
        pitch: 0,
        bob: 0,
        bobPhase: this.rng() * Math.PI * 2,
        scale: settled ? 1 : 0,
        leaving: false,
        hen: this.rng() < 0.5,
      };
      this.ducks.push(duck);
      return;
    }
  }

  private leave(duck: Duck, settled: boolean): void {
    duck.leaving = true;
    if (settled) duck.scale = 0;
  }

  private rest(duck: Duck): void {
    duck.phase = 'rest';
    duck.timer = lerp(REST_S, this.rng()) * (this.night > NIGHT_REST ? 4 : 1);
    duck.targetX = duck.x;
    duck.targetZ = duck.z;
  }

  /** End of a rest: dabble, or swim to a new spot (one draw for the choice). */
  private wake(duck: Duck): void {
    if (this.night > NIGHT_REST) {
      this.rest(duck);
      return;
    }
    if (this.rng() < DABBLE_CHANCE) {
      duck.phase = 'dabble';
      duck.timer = DABBLE_S;
      return;
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const angle = this.rng() * Math.PI * 2;
      const reach = 0.25 + this.rng() * (MAX_LEG - 0.25);
      const x = duck.x + Math.sin(angle) * reach;
      const z = duck.z + Math.cos(angle) * reach;
      if (this.crowded(x, z, duck) || !this.clearPath(duck.x, duck.z, x, z)) continue;
      duck.phase = 'swim';
      duck.targetX = x;
      duck.targetZ = z;
      return;
    }
    this.rest(duck);
  }

  private swim(duck: Duck, dt: number): void {
    const dx = duck.targetX - duck.x;
    const dz = duck.targetZ - duck.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.02) {
      this.rest(duck);
      return;
    }
    const want = Math.atan2(dx, dz);
    const turn = wrapAngle(want - duck.yaw);
    duck.yaw = wrapAngle(duck.yaw + Math.sign(turn) * Math.min(Math.abs(turn), TURN_RATE * dt));
    // Slow while facing away, so the turn happens on the spot rather than in a wide arc.
    const speed = SWIM_SPEED * Math.max(0, Math.cos(turn)) * Math.min(1, distance / 0.1 + 0.3);
    const step = Math.min(distance, speed * dt);
    const nx = duck.x + Math.sin(duck.yaw) * step;
    const nz = duck.z + Math.cos(duck.yaw) * step;
    if (!this.isOpenWater(nx, nz)) return;
    duck.x = nx;
    duck.z = nz;
  }

  /** Another duck is (or is heading) within PERSONAL_SPACE of (x, z). */
  private crowded(x: number, z: number, self: Duck | null): boolean {
    for (const other of this.ducks) {
      if (other === self || other.leaving) continue;
      if (Math.hypot(other.x - x, other.z - z) < PERSONAL_SPACE) return true;
      if (Math.hypot(other.targetX - x, other.targetZ - z) < PERSONAL_SPACE) return true;
    }
    return false;
  }
}

const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const lerp = (range: readonly [number, number], t: number): number => range[0] + (range[1] - range[0]) * t;

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
