/**
 * Pure traffic simulation on the road block grid (2 × 2 cells, one road tile each): below, "cell" means a
 * block and Car.cx/cz are block coordinates.
 *  - A car crosses one cell per manoeuvre and picks its next exit on entry: uniformly among the road
 *    neighbours except straight back; a U-turn only at a dead end.
 *  - In a roundabout only the centre and the 4 arms are drivable; cars join and leave through the arms
 *    and cross the centre on a ring path.
 *  - target = min(MAX_CARS, drivable cells / CELLS_PER_CAR), scaled by the density. Spawns top up
 *    synchronously on every town change, so a state is fully determined by the town + seed.
 *  - A car whose cell or next cell stops being road is removed at once; extra cars leave newest first.
 *  - Mutual waits resolve by id, and any wait longer than MAX_WAIT_S gives way.
 *  - A private stream, reseeded on 'reset'/'load', keeps spawn layouts deterministic without
 *    consuming gameplay randomness.
 *  - Car parks: a car entering a road block in front of a lot's entrance may take a free stall, drive in
 *    on a lot route (parkingLayout), stay a while, reverse out and rejoin the street. Stalls and locks
 *    are read off the cars themselves (a stall is taken while a car names it), so removing a car frees
 *    them. One car manoeuvres per lot. While a car is on its way in or out it holds the lot's front
 *    block: nobody else is in it when the car starts, and other cars stop short of it. A car takes a
 *    block only when its whole way is clear of other held blocks, so a holder never waits for a holder.
 *    A town without car parks draws nothing extra from the stream.
 */
import type { TownChange, TownStateReader } from '../town/types';
import { createSeededRandom } from '../utils/random';
import { DIR_X, DIR_Z, lanePath, opposite, ringPath, samplePath, type Dir, type LanePath, type PathSample } from './lanePaths';
import { ROAD_TILE_SIZE, roadBlockCentreWorld } from '../game/config';
import { objectDef } from '../catalog/objects';
import { ROAD_BLOCK } from '../town/grid';
import { isFeatureArm, isFeatureCentre, roadFeatureAt } from '../town/roadTiles';
import type { PlacedObject } from '../town/types';
import {
  entryRoute,
  exitRoute,
  lotFrame,
  lotToWorld,
  sampleLeg,
  stallCount,
  stallPose,
  type Approach,
  type ExitSide,
  type LotFrame,
  type LotLeg,
  type LotRoute,
  type LotSample,
} from './parkingLayout';

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
/**
 * A car bound for a held block stops this far before the end of its path when it has the room: its nose
 * stays clear of the tail of a car that has just crossed the edge.
 */
const STOP_LINE = 0.55;
const GATE_BRAKE = 2.5;
/** Where a gated car stops on a turn path, from its start. */
const TURN_STOP = 0.2;
/** Extra following distance behind a car that waits at a held block. */
const QUEUE_GAP = 0.12;
/** ... and never closer than this (its nose stays out of the held block). */
const NOSE_ROOM = 0.26;
/** A car closer than this to the end of its path can no longer stop at the line. */
const STOP_ROOM = 0.7;
/** No car parks with another car this close to it (centre to centre). */
const PARK_CLEARANCE = 0.75;
/** A car driving off a bay waits this far before the end of its route (its nose still short of the next block) ... */
const MERGE_LOOK = 0.3;
/** ... while a moving car in that block is this close to where the route ends. */
const MERGE_CLEARANCE = 0.9;
/** A car that has waited this long to leave asks for its front block: cars that can still stop keep out of it. */
const ASK_AFTER_S = 3;
/** From this long, no other car within two blocks starts to park or leave before the asking car has gone. */
const ASK_FIRST_S = 6;
/** ... but no car stands longer than this for a block that is only asked for. */
const ASK_PATIENCE_S = 3;
/** A car's body reaches this far past its centre: a car this close to a block's edge is partly in the block. */
const BODY_REACH = 0.26;
/** A car that has not moved for this long is taken off the road (a guard; no known way to get there). */
const STALL_LIMIT_S = 30;
/** The same guard for a car that cannot get out of its car park: this long asking and it is taken away. */
const ASK_LIMIT_S = 60;
const LOT_BRAKE = 1.2;
/** A car comes onto a lot route at no more than this many times the first leg's speed (the legs cap the turn rate). */
const ENTRY_SPEED = 1.5;
const LEAVE_RETRY_S = 0.5;
const HOLD_EPS = 1e-3;
/** Keeps a braking lot car moving until it reaches its stop point. */
const CREEP = 0.04;
/** Road blocks a car drives after spawning or leaving a lot before it may park. */
const BLOCKS_BETWEEN_PARKS = 4;

/**
 * drive: on the road · approach: crossing the front block towards an aisle lot · in: on the entry route ·
 * parked · out: on the exit route (reversing, then driving off).
 */
export type CarPhase = 'drive' | 'approach' | 'in' | 'parked' | 'out';

export interface ParkingTuning {
  /** Chance that a car passing a usable stall parks. */
  parkChance: number;
  /** Seconds parked: uniform in [dwellMin, dwellMax]. */
  dwellMin: number;
  dwellMax: number;
  /** Share of the cars that may be in car parks at once (at least one car may). */
  parkedShare: number;
}

export const DEFAULT_PARKING_TUNING: Readonly<ParkingTuning> = { parkChance: 0.55, dwellMin: 10, dwellMax: 30, parkedShare: 0.5 };

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
  phase: CarPhase;
  /** Object id of the car park this car uses, 0 = none. In every lot phase cx/cz are the gate's front block. */
  lot: number;
  stall: number;
  gate: 0 | 1;
  route: LotRoute | null;
  leg: number;
  /** The lot's pose and anchor, cached when the car commits. */
  readonly frame: LotFrame;
  lotAx: number;
  lotAz: number;
  /** Stopping short of a block that is held, or asked for by a car waiting to leave. */
  gated: boolean;
  /** Gated, or queued behind a car that is. */
  held: boolean;
  /** The car this one waits behind, as of the last step. */
  ahead: Car | null;
  /** Seconds this car has waited for its front block to leave; from ASK_AFTER_S it asks for the block. */
  asking: number;
  /** Holds the lot's front block (cx, cz); a car that has just left an aisle lot holds it until it drives on. */
  locks: boolean;
  /** Seconds without moving; not counted while parked or waiting at a lot's hold point. */
  still: number;
  /** Seconds left parked; then seconds until the next try to leave. */
  timer: number;
  /** Total seconds in the stall. */
  parkedFor: number;
  /** Road blocks driven since spawning or leaving a lot. */
  sincePark: number;
  /** The gate and direction to leave by are chosen (when the dwell ends). */
  exitSet: boolean;
  /** The direction the car leaves the front block on its way out. */
  exitDir: Dir;
}

export interface TrafficStats {
  cars: number;
  target: number;
  drivableCells: number;
  spawned: number;
  despawned: number;
  /** Cars that are braking/waiting this frame. */
  waiting: number;
  /** Cars standing in a stall. */
  parked: number;
  /** Cars on their way into or out of a car park. */
  manoeuvring: number;
  /** Cars removed because they stood still too long. */
  unstuck: number;
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
  private readonly lotSample: LotSample = { x: 0, y: 0, hx: 0, hy: 1 };
  private readonly lotWorld = { x: 0, z: 0, hx: 0, hz: 1 };
  private readonly scratchFrame: LotFrame = { x: 0, z: 0, rotation: 0, style: 0, depth: 1 };
  private readonly gateOut = { x: 0, z: 0 };
  private unstuck = 0;
  private readonly optLot: PlacedObject[] = [];
  private readonly optStall: number[] = [];
  private readonly optGate: Array<0 | 1> = [];
  private readonly optInto: Dir[] = [];
  private readonly sides: ExitSide[] = [];
  /** lil-gui `Life` folder. */
  readonly parking: ParkingTuning = { ...DEFAULT_PARKING_TUNING };
  /** Called after a car is removed. */
  onRemove: ((car: Car) => void) | null = null;

  constructor(
    private readonly town: TownStateReader,
    private readonly seedSource: () => number,
  ) {
    this.rand = createSeededRandom(this.drawSeed());
  }

  get stats(): TrafficStats {
    let parked = 0;
    let manoeuvring = 0;
    for (let i = 0; i < this.cars.length; i += 1) {
      const phase = this.cars[i].phase;
      if (phase === 'parked') parked += 1;
      else if (phase !== 'drive') manoeuvring += 1;
    }
    return {
      cars: this.cars.length,
      target: this.target,
      drivableCells: this.drivable,
      spawned: this.spawned,
      despawned: this.despawned,
      waiting: this.waiting,
      parked,
      manoeuvring,
      unstuck: this.unstuck,
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
    // Despawn cars whose road is gone (under them or in front of them), or whose car park is.
    for (let i = this.cars.length - 1; i >= 0; i -= 1) {
      const car = this.cars[i];
      const keep = car.lot !== 0 ? this.lotCarValid(car) : this.isRoad(car.cx, car.cz) && this.linked(car.cx, car.cz, car.outDir);
      if (!keep) this.removeAt(i, true);
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
    let removed = false;
    for (let i = this.cars.length - 1; i >= 0; i -= 1) {
      const car = this.cars[i];
      car.age += dt;
      if (car.phase === 'parked' && car.asking <= ASK_LIMIT_S) {
        this.stepParked(car, dt);
        continue;
      }
      car.still = car.speed < 0.01 ? car.still + dt : 0;
      if (car.still > STALL_LIMIT_S || car.asking > ASK_LIMIT_S) {
        this.removeAt(i, true);
        this.unstuck += 1;
        removed = true;
        continue;
      }
      if (car.phase === 'in' || car.phase === 'out') {
        if (this.stepLot(i, car, dt)) this.place(car);
        continue;
      }
      const path = pathOf(car);
      const blocked = this.yields(car, dt);
      let cruise = blocked ? 0 : speedFor(path);
      const gated = car.gated;
      const limit = path.length - NOSE_ROOM;
      if (gated) {
        if (!blocked) this.waiting += 1;
        // Eases to the stop line; past it (a short turn), brakes as hard as it can. On a turn it stops at the
        // start of the arc while it still can, not in the middle of the junction.
        const early = path.kind !== 'straight' && car.s + (car.speed * car.speed) / (2 * BRAKE) <= TURN_STOP;
        const line = early ? Math.min(TURN_STOP, path.length - STOP_LINE) : path.length - STOP_LINE;
        cruise = Math.min(cruise, Math.sqrt(2 * GATE_BRAKE * Math.max(0, line - car.s)));
      }
      car.speed = car.speed < cruise ? Math.min(cruise, car.speed + ACCEL * dt) : Math.max(cruise, car.speed - BRAKE * dt);
      const before = car.s;
      car.s += car.speed * dt;
      if (gated && car.s > limit) {
        car.s = Math.max(before, limit);
        car.speed = 0;
      }
      if (car.s >= path.length && !this.advance(i, car, path)) continue;
      this.place(car);
    }
    if (removed) this.topUp(false);
  }

  /** Is `car` waiting for the car ahead? Counts the wait towards the gridlock breaker. */
  private yields(car: Car, dt: number): boolean {
    const ahead = car.ahead;
    if (car.pushThrough > 0) car.pushThrough -= dt;
    if (ahead === null) {
      car.waited = 0;
      return false;
    }
    this.waiting += 1;
    // Behind a car that waits for a manoeuvre, or in its queue: not a gridlock, so no push through
    // (unless that car waits for this one's own block: then this one must get past it).
    const waitsElsewhere = ahead.gated && !(car.locks && ahead.cx + DIR_X[ahead.outDir] === car.cx && ahead.cz + DIR_Z[ahead.outDir] === car.cz);
    if (!car.held && !waitsElsewhere) car.waited += dt;
    if (car.waited > MAX_WAIT_S) {
      car.waited = 0;
      car.pushThrough = PUSH_THROUGH_S;
    }
    return true;
  }

  private drawSeed(): number {
    return Math.floor(this.seedSource() * 0x100000000) >>> 0;
  }

  /** Blocks are all road or none, so the anchor cell decides. */
  private isRoad(x: number, z: number): boolean {
    this.probe.x = x * ROAD_BLOCK;
    this.probe.z = z * ROAD_BLOCK;
    if (!this.town.inBounds(this.probe) || this.town.getGround(this.probe) !== 'road') return false;
    // Inside a road feature only the centre and the arms carry traffic (the corners are kerb/verge);
    // a no-traffic feature (a parking lot) carries none.
    const feature = roadFeatureAt(this.town, this.probe);
    if (!feature) return true;
    if (objectDef(feature.kind).noTraffic) return false;
    return isFeatureCentre(feature, this.probe) || isFeatureArm(feature, this.probe, 0) !== isFeatureArm(feature, this.probe, 1);
  }

  /** Is block (x, z) a roundabout's island tile? */
  private isRingBlock(x: number, z: number): boolean {
    this.probe.x = x * ROAD_BLOCK;
    this.probe.z = z * ROAD_BLOCK;
    const feature = this.town.inBounds(this.probe) ? roadFeatureAt(this.town, this.probe) : undefined;
    return feature !== undefined && isFeatureCentre(feature, this.probe);
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
    if (car.phase === 'approach') {
      car.s -= path.length;
      car.phase = 'in';
      car.leg = 0;
      car.speed = Math.min(car.speed, ENTRY_SPEED * car.route!.legs[0].speed);
      return true;
    }
    const nx = car.cx + DIR_X[car.outDir];
    const nz = car.cz + DIR_Z[car.outDir];
    if (!this.linked(car.cx, car.cz, car.outDir)) {
      this.removeAt(index, true);
      return false;
    }
    car.s -= path.length;
    car.locks = false;
    car.cx = nx;
    car.cz = nz;
    car.inDir = car.outDir;
    car.sincePark += 1;
    car.ring = this.isRingBlock(nx, nz);
    if (!car.ring && this.tryPark(car)) {
      if (car.phase === 'in' && car.s > car.route!.legs[0].length) car.s = car.route!.legs[0].length;
      return true;
    }
    car.outDir = this.chooseExit(nx, nz, car.inDir);
    const next = pathOf(car);
    if (car.s > next.length) car.s = next.length; // huge dt: never skip a whole cell
    return true;
  }

  private place(car: Car): void {
    if (car.phase !== 'drive' && car.phase !== 'approach') {
      if (car.phase === 'parked') stallPose(car.frame.style, car.stall, this.lotSample);
      else sampleLeg(car.route!.legs[car.leg], car.s, this.lotSample);
      lotToWorld(car.frame, this.lotSample, this.lotWorld);
      car.x = this.lotWorld.x;
      car.z = this.lotWorld.z;
      car.hx = this.lotWorld.hx;
      car.hz = this.lotWorld.hz;
      return;
    }
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
        ring: this.isRingBlock(pick.x, pick.z),
        phase: 'drive',
        lot: 0,
        stall: 0,
        gate: 0,
        route: null,
        leg: 0,
        frame: { x: 0, z: 0, rotation: 0, style: 0, depth: 1 },
        lotAx: 0,
        lotAz: 0,
        gated: false,
        held: false,
        ahead: null,
        asking: 0,
        locks: false,
        still: 0,
        timer: 0,
        parkedFor: 0,
        sincePark: 0,
        exitSet: false,
        exitDir: 0,
      };
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
    // Nothing to stop for unless some car holds or asks for a block.
    let claims = false;
    for (let i = 0; i < cars.length; i += 1) claims ||= cars[i].locks || cars[i].asking >= ASK_AFTER_S;
    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i];
      car.gated = claims && car.phase === 'drive' && !car.locks && this.mustStop(car);
    }
    for (let i = 0; i < cars.length; i += 1) {
      this.blockedBy[i] = -1;
      const a = cars[i];
      // Lot cars don't wait for the car ahead (their lot and front block are theirs alone) until they merge.
      if (a.phase !== 'drive' && !isMerging(a)) continue;
      if (a.pushThrough > 0) continue; // waited long enough: stop giving way for a moment
      let best = FOLLOW_DISTANCE + QUEUE_GAP;
      for (let j = 0; j < cars.length; j += 1) {
        if (j === i) continue;
        const b = cars[j];
        if (b.phase !== 'drive' && !isMerging(b)) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const ahead = dx * a.hx + dz * a.hz;
        const lateral = Math.abs(dx * a.hz - dz * a.hx);
        // Two cars on the same spot heading the same way: the newer one lets the other get ahead.
        if (Math.abs(ahead) <= 0.02 && lateral < 0.05 && a.hx * b.hx + a.hz * b.hz > 0.9 && a.id > b.id) {
          best = 0;
          this.blockedBy[i] = j;
          break;
        }
        // Behind a car that stands at a held block the queue leaves a little more room (`held` as of the last step).
        if (ahead <= 0.02 || ahead >= best || ahead >= (b.held ? FOLLOW_DISTANCE + QUEUE_GAP : FOLLOW_DISTANCE)) continue;
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
    for (let i = 0; i < cars.length; i += 1) {
      cars[i].held = cars[i].gated;
      cars[i].ahead = this.blockedBy[i] >= 0 ? cars[this.blockedBy[i]] : null;
    }
    // A queue behind a held car is held too; a car that holds a block never is (it must be able to push on).
    for (let pass = 1; pass < cars.length; pass += 1) {
      let changed = false;
      for (let i = 0; i < cars.length; i += 1) {
        const j = this.blockedBy[i];
        if (j >= 0 && cars[j].held && !cars[i].held && !cars[i].locks) {
          cars[i].held = true;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  // --- Car parks ---------------------------------------------------------------------------------

  /** A road block that is no part of a road feature. */
  private plainRoad(x: number, z: number): boolean {
    this.probe.x = x * ROAD_BLOCK;
    this.probe.z = z * ROAD_BLOCK;
    return this.town.inBounds(this.probe) && this.town.getGround(this.probe) === 'road' && roadFeatureAt(this.town, this.probe) === undefined;
  }

  /** The car park whose entrance block (x, z) a car reaches travelling in direction `dir`. */
  private lotAt(x: number, z: number, dir: Dir): PlacedObject | undefined {
    this.probe.x = x * ROAD_BLOCK;
    this.probe.z = z * ROAD_BLOCK;
    if (!this.town.inBounds(this.probe)) return undefined;
    const feature = roadFeatureAt(this.town, this.probe);
    return feature && feature.kind === 'parking' && isFeatureArm(feature, this.probe, dir) ? feature : undefined;
  }

  /** Front block of gate `gate` of a lot at block anchor (ax, az); writes block coordinates. */
  private gateBlock(frame: LotFrame, ax: number, az: number, gate: number, out: { x: number; z: number }): void {
    const deep = frame.depth;
    switch (frame.rotation) {
      case 0:
        out.x = ax + gate;
        out.z = az + deep;
        break;
      case 1:
        out.x = ax + deep;
        out.z = az + 1 - gate;
        break;
      case 2:
        out.x = ax + 1 - gate;
        out.z = az - 1;
        break;
      default:
        out.x = ax - 1;
        out.z = az + gate;
    }
  }

  private isLotBusy(lot: number, self: Car): boolean {
    for (const car of this.cars) if (car !== self && car.lot === lot && car.phase !== 'parked') return true;
    return false;
  }

  private stallTaken(lot: number, stall: number): boolean {
    for (const car of this.cars) if (car.lot === lot && car.stall === stall) return true;
    return false;
  }

  /** Does another car hold block (x, z) for its manoeuvre? */
  private blockHeld(x: number, z: number, self: Car): boolean {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i];
      if (car !== self && car.locks && car.cx === x && car.cz === z) return true;
    }
    return false;
  }

  /** Is another holder on its way out bound for block (x, z)? */
  private blockTargeted(x: number, z: number, self: Car): boolean {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i];
      if (car === self || !isLeaving(car)) continue;
      const dir = car.phase === 'out' ? car.exitDir : car.outDir;
      if (car.cx + DIR_X[dir] === x && car.cz + DIR_Z[dir] === z) return true;
    }
    return false;
  }

  /** Has another car waited long enough to leave through front block (x, z) that it asks for it? */
  private blockAsked(x: number, z: number, self: Car): boolean {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i];
      if (car !== self && car.asking >= ASK_AFTER_S && car.cx === x && car.cz === z) return true;
    }
    return false;
  }

  /**
   * A driving car stops short of its next block when the block is held, or asked for while the car can
   * still stop in time (or is already stopping) and has not stood long. A car standing in a block that is
   * itself asked for drives on, so two waiting cars never keep each other's block occupied.
   */
  private mustStop(car: Car): boolean {
    const nx = car.cx + DIR_X[car.outDir];
    const nz = car.cz + DIR_Z[car.outDir];
    if (this.blockHeld(nx, nz, car)) return true;
    if (!this.blockAsked(nx, nz, car) || this.blockAsked(car.cx, car.cz, car)) return false;
    // A car that has already stood through one manoeuvre goes first.
    return car.still < ASK_PATIENCE_S && (car.gated || car.s <= pathOf(car).length - STOP_ROOM);
  }

  /** `self` may take front block (x, z): nobody is in it, holds it, is bound for it, or is too close to stop before it. */
  private blockFree(x: number, z: number, self: Car): boolean {
    if (!this.plainRoad(x, z) || this.blockHeld(x, z, self) || this.blockTargeted(x, z, self)) return false;
    this.probe.x = x * ROAD_BLOCK;
    this.probe.z = z * ROAD_BLOCK;
    roadBlockCentreWorld(this.probe, this.world);
    const reach = ROAD_TILE_SIZE / 2 + BODY_REACH;
    const cars = this.cars;
    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i];
      if (car === self || car.phase !== 'drive') continue;
      // In the block, or with its nose or tail over the edge.
      if (Math.abs(car.x - this.world.x) < reach && Math.abs(car.z - this.world.z) < reach) return false;
      if (car.gated) continue;
      if (car.cx + DIR_X[car.outDir] === x && car.cz + DIR_Z[car.outDir] === z && car.s > pathOf(car).length - STOP_ROOM) return false;
    }
    return true;
  }

  /**
   * `self` may take its front block to leave towards `car.exitDir`: the block it then drives into is nobody's,
   * and no other car is on its way out within two blocks (two leavers could each end up behind the cars that
   * wait for the other's block).
   */
  private canLeave(car: Car): boolean {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i += 1) {
      const other = cars[i];
      if (other === car || Math.abs(other.cx - car.cx) + Math.abs(other.cz - car.cz) > 2) continue;
      if (isLeaving(other)) return false;
      // A neighbour that has waited long, and clearly longer than this car, goes first. Waits within one
      // retry of each other defer to nobody (the counters tick at different moments).
      if (other.asking >= ASK_FIRST_S && other.asking > car.asking + LEAVE_RETRY_S) return false;
    }
    return this.blockFree(car.cx, car.cz, car) && !this.blockHeld(car.cx + DIR_X[car.exitDir], car.cz + DIR_Z[car.exitDir], car);
  }

  /** Sides of front block (fx, fz) through which `stall` can leave by gate `gate`, written to this.sides. */
  private exitSides(frame: LotFrame, stall: number, gate: 0 | 1, fx: number, fz: number, into: Dir): ExitSide[] {
    const out = this.sides;
    out.length = 0;
    if (!this.plainRoad(fx, fz)) return out;
    for (let side = 0; side < 3; side += 1) {
      if (exitRoute(frame.style, stall, gate, side as ExitSide) && this.linked(fx, fz, sideDir(into, side as ExitSide))) out.push(side as ExitSide);
    }
    return out;
  }

  /** Can a car in `stall` ever leave, through either gate? */
  private stallHasExit(frame: LotFrame, ax: number, az: number, stall: number, into: Dir): boolean {
    for (let gate = 0; gate < 2; gate += 1) {
      this.gateBlock(frame, ax, az, gate, this.gateOut);
      if (this.exitSides(frame, stall, gate as 0 | 1, this.gateOut.x, this.gateOut.z, into).length > 0) return true;
    }
    return false;
  }

  /** On entering a front block: maybe commit to a free stall. Draws from the stream only when one is on offer. */
  private tryPark(car: Car): boolean {
    if (car.sincePark < BLOCKS_BETWEEN_PARKS) return false;
    const fx = car.cx;
    const fz = car.cz;
    let found = false;
    for (let d = 0; d < 4 && !found; d += 1) found = this.lotAt(fx + DIR_X[d], fz + DIR_Z[d], d as Dir) !== undefined;
    if (!found || this.blockAsked(fx, fz, car) || !this.blockFree(fx, fz, car)) return false;
    let inLots = 0;
    for (const other of this.cars) {
      if (other.asking >= ASK_FIRST_S && Math.abs(other.cx - fx) + Math.abs(other.cz - fz) <= 2) return false;
      if (other.lot !== 0) inLots += 1;
      // Its tail is still in the block behind: nobody may be following closely or alongside.
      else if (other !== car && Math.hypot(other.x - car.x, other.z - car.z) < PARK_CLEARANCE) return false;
    }
    if (inLots >= Math.max(1, Math.floor(this.cars.length * this.parking.parkedShare))) return false;
    const frame = this.scratchFrame;
    let options = 0;
    for (let d = 0; d < 4; d += 1) {
      const into = d as Dir;
      if (into === opposite(car.inDir)) continue;
      const lot = this.lotAt(fx + DIR_X[d], fz + DIR_Z[d], into);
      if (!lot || this.isLotBusy(lot.id, car)) continue;
      lotFrame(lot, frame);
      const ax = lot.anchor.x / ROAD_BLOCK;
      const az = lot.anchor.z / ROAD_BLOCK;
      this.gateBlock(frame, ax, az, 0, this.gateOut);
      const gate: 0 | 1 = this.gateOut.x === fx && this.gateOut.z === fz ? 0 : 1;
      const approach = approachOf(into, car.inDir);
      const stalls = stallCount(frame.style);
      for (let stall = 0; stall < stalls; stall += 1) {
        if (!entryRoute(frame.style, gate, approach, stall) || this.stallTaken(lot.id, stall)) continue;
        if (!this.stallHasExit(frame, ax, az, stall, into)) continue;
        this.optLot[options] = lot;
        this.optStall[options] = stall;
        this.optGate[options] = gate;
        this.optInto[options] = into;
        options += 1;
      }
    }
    if (options === 0) return false;
    const park = this.rand() < this.parking.parkChance;
    const pick = park ? Math.min(options - 1, Math.floor(this.rand() * options)) : 0;
    const lot = this.optLot[pick];
    this.optLot.length = 0;
    if (!park) return false;
    const into = this.optInto[pick];
    lotFrame(lot, car.frame);
    car.lot = lot.id;
    car.lotAx = lot.anchor.x / ROAD_BLOCK;
    car.lotAz = lot.anchor.z / ROAD_BLOCK;
    car.stall = this.optStall[pick];
    car.gate = this.optGate[pick];
    car.route = entryRoute(car.frame.style, car.gate, approachOf(into, car.inDir), car.stall)!;
    car.leg = 0;
    car.locks = true;
    car.asking = 0;
    car.exitSet = false;
    car.waited = 0;
    car.pushThrough = 0;
    if (car.frame.style === 0) {
      car.phase = 'in';
      car.speed = Math.min(car.speed, ENTRY_SPEED * car.route.legs[0].speed);
    } else {
      car.phase = 'approach';
      car.outDir = into;
    }
    return true;
  }

  /** Picks the gate and the direction a parked car leaves by; false when there is no way out. */
  private chooseWayOut(car: Car): boolean {
    const into = intoDir(car.frame);
    // Aisle lots leave through gate 0 (the right-hand side of the way out) when they can.
    const first = car.frame.style === 0 ? car.gate : 0;
    for (let n = 0; n < 2; n += 1) {
      const gate = ((first + n) % 2) as 0 | 1;
      this.gateBlock(car.frame, car.lotAx, car.lotAz, gate, this.gateOut);
      const fx = this.gateOut.x;
      const fz = this.gateOut.z;
      const sides = this.exitSides(car.frame, car.stall, gate, fx, fz, into);
      if (sides.length === 0) continue;
      const side = sides.length === 1 ? sides[0] : sides[Math.min(sides.length - 1, Math.floor(this.rand() * sides.length))];
      car.gate = gate;
      car.cx = fx;
      car.cz = fz;
      car.exitDir = sideDir(into, side);
      car.route = exitRoute(car.frame.style, car.stall, gate, side);
      car.exitSet = true;
      return true;
    }
    return false;
  }

  private stepParked(car: Car, dt: number): void {
    car.parkedFor += dt;
    car.timer -= dt;
    if (car.timer > 0) return;
    car.timer = LEAVE_RETRY_S;
    if (this.isLotBusy(car.lot, car)) {
      car.asking = 0;
      return;
    }
    const stillOpen = car.exitSet && this.plainRoad(car.cx, car.cz) && this.linked(car.cx, car.cz, car.exitDir);
    if (!stillOpen && !this.chooseWayOut(car)) return;
    const route = car.route!;
    // A small lot backs straight into the street: the car waits in its stall for the front block.
    const holdsInStall = route.holdLeg === 0 && route.holdS <= 0;
    if (holdsInStall && !this.canLeave(car)) {
      car.asking += LEAVE_RETRY_S;
      return;
    }
    car.asking = 0;
    car.phase = 'out';
    car.leg = 0;
    car.s = 0;
    car.speed = 0;
    car.still = 0;
    car.waited = 0;
    car.pushThrough = 0;
    car.locks = holdsInStall;
  }

  /** Advances a car along its lot route. Returns false when the car was removed. */
  private stepLot(index: number, car: Car, dt: number): boolean {
    const route = car.route!;
    let leg = route.legs[car.leg];
    // Where this leg must end at rest: its end when the car then stops or changes direction, or the hold point.
    const last = car.leg === route.legs.length - 1;
    const stopsAtEnd = last ? car.phase === 'in' : route.legs[car.leg + 1].reverse !== leg.reverse;
    let stop = stopsAtEnd ? leg.length : Infinity;
    if (car.phase === 'out' && !car.locks && car.leg <= route.holdLeg) {
      const atHold = car.leg === route.holdLeg && car.s >= route.holdS - HOLD_EPS;
      if (atHold && this.canLeave(car)) {
        car.locks = true;
        car.asking = 0;
      } else if (car.leg === route.holdLeg) {
        stop = Math.min(stop, route.holdS);
        if (atHold) {
          car.asking += dt;
          // Waiting inside the lot for a gap is not being stuck.
          car.still = 0;
        }
      }
    }
    let cruise = Math.min(leg.speed, Math.sqrt(2 * LOT_BRAKE * Math.max(0, stop - car.s)) + CREEP);
    // Driving off a bay it joins the lane like any car: it waits for the car ahead.
    if (isMerging(car) && (this.yields(car, dt) || (car.s <= leg.length - MERGE_LOOK && !this.mergeClear(car, leg)))) cruise = 0;
    car.speed = car.speed < cruise ? Math.min(cruise, car.speed + ACCEL * dt) : Math.max(cruise, car.speed - BRAKE * dt);
    car.s += car.speed * dt;
    if (car.s >= stop) {
      car.s = stop;
      car.speed = 0;
    }
    if (car.phase === 'in' && car.locks && (car.leg > route.clearLeg || (car.leg === route.clearLeg && car.s >= route.clearS))) car.locks = false;
    while (car.s >= leg.length) {
      if (car.leg === route.legs.length - 1) return this.finishRoute(index, car);
      car.s = stopsAtEnd ? 0 : car.s - leg.length;
      car.leg += 1;
      leg = route.legs[car.leg];
      if (car.s > leg.length) car.s = leg.length;
      // Never past the hold point without the front block.
      if (car.phase === 'out' && !car.locks && car.leg === route.holdLeg && car.s > route.holdS) car.s = route.holdS;
      if (stopsAtEnd) break;
    }
    return true;
  }

  /**
   * No car is in the next block, or about to enter it, near where this bay's exit route ends. Cars held up for a
   * block don't count: they stand at their line, and the look-ahead sees the ones in this lane.
   */
  private mergeClear(car: Car, last: LotLeg): boolean {
    sampleLeg(last, last.length, this.lotSample);
    lotToWorld(car.frame, this.lotSample, this.lotWorld);
    const nx = car.cx + DIR_X[car.exitDir];
    const nz = car.cz + DIR_Z[car.exitDir];
    const cars = this.cars;
    for (let i = 0; i < cars.length; i += 1) {
      const other = cars[i];
      if (other === car || other.phase !== 'drive' || other.held) continue;
      const inNext = other.cx === nx && other.cz === nz;
      const entering = other.cx + DIR_X[other.outDir] === nx && other.cz + DIR_Z[other.outDir] === nz && other.s > pathOf(other).length - MERGE_LOOK;
      if ((inNext || entering) && Math.hypot(other.x - this.lotWorld.x, other.z - this.lotWorld.z) < MERGE_CLEARANCE) return false;
    }
    return true;
  }

  /** Returns false when the car was removed. */
  private finishRoute(index: number, car: Car): boolean {
    if (car.phase === 'in') {
      car.phase = 'parked';
      car.locks = false;
      car.speed = 0;
      car.s = 0;
      car.parkedFor = 0;
      car.timer = this.parking.dwellMin + this.rand() * Math.max(0, this.parking.dwellMax - this.parking.dwellMin);
      this.place(car);
      return true;
    }
    const small = car.frame.style === 0;
    car.phase = 'drive';
    car.lot = 0;
    car.route = null;
    car.sincePark = 0;
    car.ring = false;
    if (small) {
      // The route ends on the front block's exit edge: cross it like any car.
      car.inDir = car.exitDir;
      car.outDir = car.exitDir;
      const path = pathOf(car);
      car.s = path.length;
      return this.advance(index, car, path);
    }
    // Still turning out across the front block: it stays the car's until it drives on.
    car.inDir = opposite(intoDir(car.frame));
    car.outDir = car.exitDir;
    car.s = 0;
    car.waited = 0;
    return true;
  }

  /** A lot car survives a town change while its lot stands unchanged and its way in or out still exists. */
  private lotCarValid(car: Car): boolean {
    const lot = this.town.getObject(car.lot);
    if (!lot || lot.kind !== 'parking' || lot.variant !== car.frame.style || lot.rotation !== car.frame.rotation) return false;
    if (lot.anchor.x !== car.lotAx * ROAD_BLOCK || lot.anchor.z !== car.lotAz * ROAD_BLOCK) return false;
    if (car.locks && !this.plainRoad(car.cx, car.cz)) return false;
    if (car.phase === 'out') return this.plainRoad(car.cx, car.cz) && this.linked(car.cx, car.cz, car.exitDir);
    return this.stallHasExit(car.frame, car.lotAx, car.lotAz, car.stall, intoDir(car.frame));
  }
}

/** NEIGHBOURS index of a lot's front side per rotation (roadTiles FRONT_SIDE). */
const FRONT: readonly Dir[] = [2, 1, 0, 3];

/** Holds its front block on the way out: leaving a stall, or just out of an aisle lot and turning into the street. */
const isLeaving = (car: Car): boolean => car.locks && (car.phase === 'out' || car.phase === 'drive');

/** On the last leg out of a bay a car is in the street lane, nose towards the next block. */
const isMerging = (car: Car): boolean => car.phase === 'out' && car.frame.style === 0 && car.leg === car.route!.legs.length - 1;

/** Direction from a lot's front block into the lot (lot-frame +y). */
const intoDir = (frame: LotFrame): Dir => opposite(FRONT[frame.rotation]);

/** World direction of a lot-frame exit side: 0 = −x, 1 = +x, 2 = −y (lot +x is `into` turned clockwise). */
const sideDir = (into: Dir, side: ExitSide): Dir => ((into + (side === 0 ? 3 : side === 1 ? 1 : 2)) % 4) as Dir;

/** Lot-frame approach of a car travelling `inDir` into the front block of a lot entered towards `into`. */
function approachOf(into: Dir, inDir: Dir): Approach {
  const rel = (inDir - into + 4) % 4;
  return rel === 0 ? 2 : rel === 1 ? 0 : 1;
}

/** max(1, round(base × f)), capped at base; 0 when the network has no room. */
export function densityTarget(base: number, f: number): number {
  if (base <= 0) return 0;
  return Math.min(base, Math.max(1, Math.round(base * f)));
}

const pathOf = (car: Car): LanePath => (car.ring ? ringPath(car.inDir, car.outDir) : lanePath(car.inDir, car.outDir));

function speedFor(path: LanePath): number {
  return path.kind === 'straight' ? CRUISE_SPEED : path.kind === 'uturn' ? UTURN_SPEED : TURN_SPEED;
}
