/**
 * Pure traffic simulation on the road block grid (2 × 2 cells, one road tile each): below, "cell" means a
 * block and Car.cx/cz are block coordinates.
 *  - A car crosses one cell per manoeuvre and picks its next exit on entry: uniformly among the road
 *    neighbours except straight back; a U-turn only at a dead end.
 *  - In a roundabout only the centre and the 4 arms are drivable; cars join and leave through the arms
 *    and circle the island on the ring's outer lane: bending on and off in the arm blocks, the arc
 *    itself in the centre block (the paths reach beyond their own block).
 *  - target = min(MAX_CARS, drivable cells / CELLS_PER_CAR), scaled by the density. Spawns top up
 *    synchronously on every town change, so a state is fully determined by the town + seed.
 *  - A car whose cell or next cell stops being road is removed at once; extra cars leave newest first.
 *  - Mutual waits resolve by id, and any wait longer than MAX_WAIT_S gives way.
 *  - A private stream, reseeded on 'reset'/'load', keeps spawn layouts deterministic without
 *    consuming gameplay randomness.
 */
import type { TownChange, TownStateReader } from '../town/types';
import { createSeededRandom } from '../utils/random';
import { armPath, DIR_X, DIR_Z, lanePath, opposite, ringPath, samplePath, type Dir, type LanePath, type PathSample } from './lanePaths';
import { roadBlockCentreWorld } from '../game/config';
import { objectDef } from '../catalog/objects';
import { ROAD_BLOCK } from '../town/grid';
import { featureArmSide, isFeatureArm, isFeatureCentre, roadFeatureAt } from '../town/roadTiles';

export const MAX_CARS = 6;
export const CELLS_PER_CAR = 6;
export const CAR_MODELS = 4;

export const CRUISE_SPEED = 0.95;
const TURN_SPEED = 0.62;
const UTURN_SPEED = 0.4;
const ACCEL = 1.6;
const BRAKE = 4.5;
/** Look-ahead distance (world units, car centre to car centre) for braking. */
const FOLLOW_DISTANCE = 0.56;
/** Lateral half-width of a lane band: cars further sideways than this are in the other lane. */
const LANE_BAND = 0.2;
const MAX_WAIT_S = 1.6;
const PUSH_THROUGH_S = 0.9;

export interface Car {
  readonly id: number;
  model: number;
  x: number;
  z: number;
  /** Current road cell. */
  cx: number;
  cz: number;
  inDir: Dir;
  outDir: Dir;
  /** Arc length travelled through the current manoeuvre. */
  s: number;
  speed: number;
  /** Unit heading. */
  hx: number;
  hz: number;
  waited: number;
  /** > 0 while the car ignores blockers after waiting too long (breaks any gridlock). */
  pushThrough: number;
  /** Seconds since spawn; drives the pop-in. */
  age: number;
  /** Spawned by a load/reset (no pop-in). */
  instant: boolean;
  /** The current block is a roundabout centre: the car follows ringPath, not lanePath. */
  ring: boolean;
  /** The current block is a roundabout arm: the direction from the island towards it (the car follows armPath), else -1. */
  arm: number;
}

export interface TrafficStats {
  cars: number;
  target: number;
  drivableCells: number;
  spawned: number;
  despawned: number;
  /** Cars that are braking/waiting this frame. */
  waiting: number;
}

export class TrafficSim {
  readonly cars: Car[] = [];
  private rand: () => number;
  private nextId = 1;
  private spawned = 0;
  private despawned = 0;
  private drivable = 0;
  private target = 0;
  /** Target before density (the road network's capacity). */
  private baseTarget = 0;
  private densityFactor = 1;
  private waiting = 0;
  private readonly sample: PathSample = { x: 0, z: 0, hx: 0, hz: 1 };
  private readonly world = { x: 0, z: 0 };
  private readonly probe = { x: 0, z: 0 };
  private readonly probeNext = { x: 0, z: 0 };
  private readonly blockedBy: number[] = [];
  /** Called after a car is removed. */
  onRemove: ((car: Car) => void) | null = null;

  constructor(
    private readonly town: TownStateReader,
    private readonly seedSource: () => number,
  ) {
    this.rand = createSeededRandom(this.drawSeed());
  }

  get stats(): TrafficStats {
    return {
      cars: this.cars.length,
      target: this.target,
      drivableCells: this.drivable,
      spawned: this.spawned,
      despawned: this.despawned,
      waiting: this.waiting,
    };
  }

  /** Clears every car and reseeds the private stream. */
  reset(): void {
    while (this.cars.length > 0) this.removeAt(this.cars.length - 1, false);
    this.rand = createSeededRandom(this.drawSeed());
    this.nextId = 1;
    // A rebuilt town spawns at full density and the caller re-applies the night (setDensity removes
    // the newest), so a state's cars never depend on the previous state's time of day.
    this.densityFactor = 1;
  }

  onTownChanged(changes: readonly TownChange[], cause: 'edit' | 'undo' | 'redo' | 'load' | 'reset'): void {
    if (cause === 'reset' || cause === 'load') this.reset();
    const touchesRoads =
      cause === 'reset' ||
      cause === 'load' ||
      changes.some((c) => (c.layer === 'ground' ? c.before === 'road' || c.after === 'road' : c.layer === 'object' && objectDef(c.object.kind).roadFeature));
    if (!touchesRoads) return;
    // Despawn cars whose road is gone (under them or in front of them).
    for (let i = this.cars.length - 1; i >= 0; i -= 1) {
      const car = this.cars[i];
      if (!this.isRoad(car.cx, car.cz) || !this.linked(car.cx, car.cz, car.outDir)) this.removeAt(i, true);
    }
    this.refreshTarget();
    // Too many for the network that is left: remove the newest.
    while (this.cars.length > this.target) this.removeAt(this.cars.length - 1, true);
    this.topUp(cause === 'load' || cause === 'reset');
  }

  /** 0..1 share of the network's car capacity to fill (1 by day). */
  get density(): number {
    return this.densityFactor;
  }

  /** Extra cars leave newest first; missing ones pop in. No allocation or randomness while the target is unchanged. */
  setDensity(factor: number): void {
    const f = Math.min(1, Math.max(0, Number.isFinite(factor) ? factor : 1));
    this.densityFactor = f;
    const target = densityTarget(this.baseTarget, f);
    if (target === this.target) return;
    this.target = target;
    while (this.cars.length > this.target) this.removeAt(this.cars.length - 1, true);
    this.topUp(false);
  }

  /** dt <= 0 is a no-op. */
  step(dt: number): void {
    if (dt <= 0) return;
    this.computeBlocking();
    this.waiting = 0;
    for (let i = this.cars.length - 1; i >= 0; i -= 1) {
      const car = this.cars[i];
      car.age += dt;
      const path = pathOf(car);
      const blocked = this.blockedBy[i] >= 0;
      if (car.pushThrough > 0) car.pushThrough -= dt;
      if (blocked) {
        car.waited += dt;
        this.waiting += 1;
        if (car.waited > MAX_WAIT_S) {
          car.waited = 0;
          car.pushThrough = PUSH_THROUGH_S;
        }
      } else {
        car.waited = 0;
      }
      const cruise = blocked ? 0 : speedFor(path);
      car.speed = car.speed < cruise ? Math.min(cruise, car.speed + ACCEL * dt) : Math.max(cruise, car.speed - BRAKE * dt);
      car.s += car.speed * dt;
      if (car.s >= path.length && !this.advance(i, car, path)) continue;
      this.place(car);
    }
  }

  private drawSeed(): number {
    return Math.floor(this.seedSource() * 0x100000000) >>> 0;
  }

  /** Blocks are all road or none, so the anchor cell decides. */
  private isRoad(x: number, z: number): boolean {
    this.probe.x = x * ROAD_BLOCK;
    this.probe.z = z * ROAD_BLOCK;
    if (!this.town.inBounds(this.probe) || this.town.getGround(this.probe) !== 'road') return false;
    // Inside a road feature only the centre and the arms carry traffic (the corners are kerb/verge).
    const feature = roadFeatureAt(this.town, this.probe);
    return !feature || isFeatureCentre(feature, this.probe) || isFeatureArm(feature, this.probe, 0) !== isFeatureArm(feature, this.probe, 1);
  }

  /** Sets `car.ring` and `car.arm` from the block the car is in. */
  private classify(car: Car): void {
    this.probe.x = car.cx * ROAD_BLOCK;
    this.probe.z = car.cz * ROAD_BLOCK;
    const feature = this.town.inBounds(this.probe) ? roadFeatureAt(this.town, this.probe) : undefined;
    car.ring = feature !== undefined && isFeatureCentre(feature, this.probe);
    car.arm = feature !== undefined ? featureArmSide(feature, this.probe) : -1;
  }

  /** Can a car drive from road block (x, z) to its road neighbour in direction `dir`? */
  private linked(x: number, z: number, dir: Dir): boolean {
    if (!this.isRoad(x + DIR_X[dir], z + DIR_Z[dir])) return false;
    this.probe.x = x * ROAD_BLOCK;
    this.probe.z = z * ROAD_BLOCK;
    const from = roadFeatureAt(this.town, this.probe);
    this.probeNext.x = (x + DIR_X[dir]) * ROAD_BLOCK;
    this.probeNext.z = (z + DIR_Z[dir]) * ROAD_BLOCK;
    const to = roadFeatureAt(this.town, this.probeNext);
    if (from === to) return true; // plain road, or two blocks of the same roundabout ring
    // Crossing a feature's boundary: only through its arms (Dir and NEIGHBOURS share N, E, S, W order).
    if (to && !isFeatureArm(to, this.probeNext, dir)) return false;
    if (from && !isFeatureArm(from, this.probe, dir)) return false;
    return true;
  }

  private get blocksWide(): number {
    return Math.floor(this.town.width / ROAD_BLOCK);
  }

  private get blocksDeep(): number {
    return Math.floor(this.town.depth / ROAD_BLOCK);
  }

  private roadExits(x: number, z: number, out: Dir[]): Dir[] {
    out.length = 0;
    for (let d = 0; d < 4; d += 1) if (this.linked(x, z, d as Dir)) out.push(d as Dir);
    return out;
  }

  private readonly exits: Dir[] = [];

  private chooseExit(x: number, z: number, inDir: Dir): Dir {
    const back = opposite(inDir);
    const options = this.roadExits(x, z, this.exits).filter((d) => d !== back);
    if (options.length === 0) return back; // dead end: U-turn
    return options[Math.min(options.length - 1, Math.floor(this.rand() * options.length))];
  }

  /** Returns false when the car was removed. */
  private advance(index: number, car: Car, path: LanePath): boolean {
    const nx = car.cx + DIR_X[car.outDir];
    const nz = car.cz + DIR_Z[car.outDir];
    if (!this.linked(car.cx, car.cz, car.outDir)) {
      this.removeAt(index, true);
      return false;
    }
    car.s -= path.length;
    car.cx = nx;
    car.cz = nz;
    car.inDir = car.outDir;
    car.outDir = this.chooseExit(nx, nz, car.inDir);
    this.classify(car);
    const next = pathOf(car);
    if (car.s > next.length) car.s = next.length; // huge dt: never skip a whole cell
    return true;
  }

  private place(car: Car): void {
    samplePath(pathOf(car), car.s, this.sample);
    this.probe.x = car.cx * ROAD_BLOCK;
    this.probe.z = car.cz * ROAD_BLOCK;
    roadBlockCentreWorld(this.probe, this.world);
    car.x = this.world.x + this.sample.x;
    car.z = this.world.z + this.sample.z;
    car.hx = this.sample.hx;
    car.hz = this.sample.hz;
  }

  private refreshTarget(): void {
    let drivable = 0;
    for (let z = 0; z < this.blocksDeep; z += 1) {
      for (let x = 0; x < this.blocksWide; x += 1) {
        if (this.isRoad(x, z) && this.roadExits(x, z, this.exits).length > 0) drivable += 1;
      }
    }
    this.drivable = drivable;
    this.baseTarget = Math.min(MAX_CARS, Math.floor(drivable / CELLS_PER_CAR));
    this.target = densityTarget(this.baseTarget, this.densityFactor);
  }

  private topUp(instant: boolean): void {
    if (this.cars.length >= this.target) return;
    // Candidate cells in row-major order (deterministic), skipping cells a car already uses.
    const candidates: Array<{ x: number; z: number; exits: Dir[] }> = [];
    for (let z = 0; z < this.blocksDeep; z += 1) {
      for (let x = 0; x < this.blocksWide; x += 1) {
        if (!this.isRoad(x, z) || this.nearCar(x, z)) continue;
        const exits = this.roadExits(x, z, []);
        if (exits.length > 0) candidates.push({ x, z, exits });
      }
    }
    while (this.cars.length < this.target && candidates.length > 0) {
      const pick = candidates.splice(Math.floor(this.rand() * candidates.length), 1)[0];
      if (this.nearCar(pick.x, pick.z)) continue;
      const dir = pick.exits[Math.floor(this.rand() * pick.exits.length)];
      const car: Car = {
        id: this.nextId++,
        model: Math.floor(this.rand() * CAR_MODELS),
        x: 0,
        z: 0,
        cx: pick.x,
        cz: pick.z,
        inDir: dir,
        outDir: dir,
        s: 0, // set below: the middle of the path, facing a road neighbour
        speed: 0,
        hx: 0,
        hz: 1,
        waited: 0,
        pushThrough: 0,
        age: 0,
        instant,
        ring: false,
        arm: -1,
      };
      this.classify(car);
      car.s = pathOf(car).length / 2;
      this.place(car);
      this.cars.push(car);
      this.spawned += 1;
    }
  }

  /** A car is in this cell or a 4-neighbour (keeps spawns apart). */
  private nearCar(x: number, z: number): boolean {
    for (const car of this.cars) if (Math.abs(car.cx - x) + Math.abs(car.cz - z) <= 1) return true;
    return false;
  }

  private removeAt(index: number, counted: boolean): void {
    const [car] = this.cars.splice(index, 1);
    if (counted) this.despawned += 1;
    this.onRemove?.(car);
  }

  /** blockedBy[i] = index of the car that car i must wait for, or −1. */
  private computeBlocking(): void {
    const cars = this.cars;
    this.blockedBy.length = cars.length;
    for (let i = 0; i < cars.length; i += 1) {
      this.blockedBy[i] = -1;
      if (cars[i].pushThrough > 0) continue; // waited long enough: stop giving way for a moment
      const a = cars[i];
      let best = FOLLOW_DISTANCE;
      for (let j = 0; j < cars.length; j += 1) {
        if (j === i) continue;
        const b = cars[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const ahead = dx * a.hx + dz * a.hz;
        if (ahead <= 0.02 || ahead >= best) continue;
        const lateral = Math.abs(dx * a.hz - dz * a.hx);
        if (lateral > LANE_BAND) continue;
        // Oncoming traffic in its own lane is never a blocker (heading roughly opposite).
        if (a.hx * b.hx + a.hz * b.hz < -0.7 && lateral > 0.08) continue;
        best = ahead;
        this.blockedBy[i] = j;
      }
    }
    // Mutual waits (two cars nosing into the same junction): the lower id goes first.
    for (let i = 0; i < cars.length; i += 1) {
      const j = this.blockedBy[i];
      if (j >= 0 && this.blockedBy[j] === i && cars[i].id < cars[j].id) this.blockedBy[i] = -1;
    }
  }
}

/** max(1, round(base × f)), capped at base; 0 when the network has no room. */
export function densityTarget(base: number, f: number): number {
  if (base <= 0) return 0;
  return Math.min(base, Math.max(1, Math.round(base * f)));
}

const pathOf = (car: Car): LanePath =>
  car.ring ? ringPath(car.inDir, car.outDir) : car.arm >= 0 ? armPath(car.arm as Dir, car.inDir, car.outDir) : lanePath(car.inDir, car.outDir);

function speedFor(path: LanePath): number {
  return path.kind === 'straight' ? CRUISE_SPEED : path.kind === 'uturn' ? UTURN_SPEED : TURN_SPEED;
}
