/**
 * Pure flock simulation: now and then a small flock crosses the plot on a quadratic Bézier through a
 * point near the centre, at constant ground speed, and flies off the far side.
 * Per bird it outputs world position, yaw (+Y rotation; the bird's +Z is its beak), bank (roll about its
 * own +Z), scale and inner/outer wing angles (radians, + = tip up).
 * Its private seeded stream keeps flocks from shifting the game's other randomness.
 */
import { createSeededRandom } from '../utils/random';

export type BirdSpecies = 'pigeon' | 'starling' | 'goose' | 'gull';
export const BIRD_SPECIES: readonly BirdSpecies[] = ['pigeon', 'starling', 'goose', 'gull'];
export type Formation = 'v' | 'cloud' | 'tight' | 'line';

export interface SpeciesSpec {
  /** sRGB; multiplies the bird's vertex shading. */
  color: number;
  /** Relative to the base bird (BIRD_WINGSPAN). */
  size: number;
  count: readonly [number, number];
  flapHz: number;
  /** Peak inner-wing angle while flapping, radians. */
  flapAmp: number;
  /** Chance that a flapping bout ends in a glide (otherwise another bout). */
  glideChance: number;
  flapS: readonly [number, number];
  glideS: readonly [number, number];
  formation: Formation;
}

export const SPECIES: Readonly<Record<BirdSpecies, SpeciesSpec>> = {
  pigeon: { color: 0x8d98ad, size: 1.15, count: [4, 7], flapHz: 4.5, flapAmp: 0.85, glideChance: 0.45, flapS: [1.2, 2.6], glideS: [0.6, 1.4], formation: 'cloud' },
  starling: { color: 0x3f4658, size: 1, count: [6, 9], flapHz: 6, flapAmp: 0.8, glideChance: 0.2, flapS: [1.4, 3], glideS: [0.4, 0.8], formation: 'tight' },
  goose: { color: 0x9a8b78, size: 1.5, count: [5, 9], flapHz: 3, flapAmp: 0.7, glideChance: 0.1, flapS: [2.5, 5], glideS: [0.5, 1], formation: 'v' },
  gull: { color: 0xf3f1ea, size: 1.45, count: [2, 4], flapHz: 2.5, flapAmp: 0.65, glideChance: 0.75, flapS: [0.8, 1.8], glideS: [1.5, 3.5], formation: 'line' },
};

const WEIGHTS_DAY: Readonly<Record<BirdSpecies, number>> = { pigeon: 0.35, starling: 0.2, goose: 0.2, gull: 0.25 };
const WEIGHTS_TWILIGHT: Readonly<Record<BirdSpecies, number>> = { pigeon: 0.2, starling: 0.45, goose: 0.25, gull: 0.1 };

export const MAX_FLOCKS = 2;
export const MAX_BIRDS = 16;
export const FIRST_FLOCK_S: readonly [number, number] = [10, 25];
export const FLOCK_INTERVAL_S: readonly [number, number] = [45, 110];
export const TWILIGHT_FACTOR = 0.6;
/** Trees shorten the wait by up to this share, fully at TREES_FULL trees. */
export const TREE_FACTOR_MAX = 0.25;
export const TREES_FULL = 40;
/** No new flock while night is above this. */
export const NIGHT_CUTOFF = 0.5;
/** A flock due at night (or while the sky is full) is re-tried after this long. */
const RETRY_S: readonly [number, number] = [3, 12];

/** Entry/exit distance from the plot centre (the plot is 32 × 32 units). */
export const ENTRY_RADIUS = 34;
/** The Bézier control point lies within this distance of the centre: the flock passes over the town. */
export const CENTRE_JITTER = 6;
/** Exit angle spread around "straight across" (radians, ±35°): the path passes within ~8 units of the centre. */
const EXIT_SPREAD = 0.61;
export const SPEED: readonly [number, number] = [2.4, 3.2];
/** Flight altitude band (world units): above the stadium floodlights (2.85), below the shadow frustum top (PLOT_CONTENT_HEIGHT, 4.5). */
export const ALTITUDE: readonly [number, number] = [3.1, 4.2];
/** A flock's cruising height: low or high lane (a second flock takes the other one, so crossing flocks never meet). */
const LOW_LANE: readonly [number, number] = [3.3, 3.5];
const HIGH_LANE: readonly [number, number] = [3.8, 4.0];
/** Vertical spread inside a flock: slot ± and wander ± (keeps birds inside their lane ± 0.12). */
const SLOT_UP = 0.07;
const WANDER_UP = 0.04;
/** Share of the path over which birds grow in / shrink out. */
export const FADE = 0.06;
/** Base wingspan (world units, before species size and the renderer's scale). */
export const BIRD_WINGSPAN = 0.36;
/** Minimum gap between formation slots on the ground plane, in wingspans, before wander. */
const MIN_SLOT_GAP = 1.3;
/** Slow wander about the slot, in wingspans (side, back); small enough to keep MIN_SLOT_GAP − 2·wander > 0.8. */
const WANDER_SIDE = 0.16;
const WANDER_BACK = 0.13;
/** Glide pose: wings held slightly up (radians). */
const GLIDE_DIHEDRAL = 0.12;
/** The outer wing trails the inner stroke by this phase (radians) at this share of its amplitude. */
const OUTER_LAG = 0.8;
const OUTER_SHARE = 0.55;
const MAX_BANK = 0.45;
const BANK_GAIN = 2.2;

export interface Bird {
  readonly id: number;
  readonly species: BirdSpecies;
  // Formation slot in the flock frame (units): + side = the flock's left, + back = behind the leader.
  readonly side: number;
  readonly back: number;
  readonly up: number;
  readonly wander: number;
  readonly hz: number;
  flapPhase: number;
  amp: number;
  gliding: boolean;
  stateLeft: number;
  // Output (updated by step()).
  x: number;
  y: number;
  z: number;
  yaw: number;
  bank: number;
  scale: number;
  wingInner: number;
  wingOuter: number;
}

export interface Flock {
  readonly id: number;
  readonly species: BirdSpecies;
  readonly birds: Bird[];
  readonly p0x: number;
  readonly p0z: number;
  readonly p1x: number;
  readonly p1z: number;
  readonly p2x: number;
  readonly p2z: number;
  readonly altitude: number;
  readonly speed: number;
  /** Bézier parameter 0..1. */
  u: number;
  age: number;
  yaw: number;
  bank: number;
}

export interface FlockStats {
  auto: boolean;
  flocks: number;
  birds: number;
  spawned: number;
  nextFlockIn: number;
}

export class FlockSim {
  readonly flocks: Flock[] = [];
  /** Every bird in the air, flock by flock (the renderer's instance order). Rebuilt only on change. */
  readonly birds: Bird[] = [];
  /** Bumped whenever `birds` changes membership (the renderer re-writes instance colours). */
  version = 0;
  /** Spontaneous flocks on/off; spawn() works either way. */
  auto = true;
  /** `?debug&flock=N`: a fixed wait between flocks instead of the schedule. */
  intervalOverride: number | null = null;
  /** Ground speed multiplier (lil-gui). */
  speedScale = 1;
  private rand: () => number;
  private nextIn = 0;
  private spawned = 0;
  private nextId = 1;
  private night = 0;
  private twilight = false;
  private readonly point = { x: 0, z: 0, dx: 0, dz: 1 };

  constructor(
    seed: number,
    private readonly treeCount: () => number = () => 0,
  ) {
    this.rand = createSeededRandom(seed);
    this.reset(seed);
  }

  get stats(): FlockStats {
    return { auto: this.auto, flocks: this.flocks.length, birds: this.birds.length, spawned: this.spawned, nextFlockIn: this.nextIn };
  }

  /** Clears the sky, re-seeds and restarts the schedule. */
  reset(seed: number): void {
    this.rand = createSeededRandom(seed);
    this.clear();
    this.spawned = 0;
    this.nextIn = this.intervalOverride ?? this.between(FIRST_FLOCK_S);
  }

  /** Removes every flock in the air; the schedule carries on. */
  clear(): void {
    if (this.flocks.length === 0) return;
    this.flocks.length = 0;
    this.rebuildBirds();
  }

  /** `night` 0 day .. 1 full night; `twilight` = dawn or dusk. */
  setNight(night: number, twilight: boolean): void {
    this.night = Number.isFinite(night) ? night : 0;
    this.twilight = twilight;
  }

  /** Launches a flock now, whatever the time of day. Returns its bird count (0 = sky full). */
  spawn(species?: BirdSpecies): number {
    if (this.flocks.length >= MAX_FLOCKS) return 0;
    const kind = species ?? this.pickSpecies();
    const spec = SPECIES[kind];
    const room = MAX_BIRDS - this.birds.length;
    const count = Math.min(room, Math.round(this.between([spec.count[0], spec.count[1] + 0.49])));
    if (count < Math.min(2, spec.count[0])) return 0;
    const entry = this.rand() * Math.PI * 2;
    const exit = entry + Math.PI + (this.rand() * 2 - 1) * EXIT_SPREAD;
    const c = Math.sqrt(this.rand()) * CENTRE_JITTER;
    const ca = this.rand() * Math.PI * 2;
    const flock: Flock = {
      id: this.nextId,
      species: kind,
      birds: [],
      p0x: Math.cos(entry) * ENTRY_RADIUS,
      p0z: Math.sin(entry) * ENTRY_RADIUS,
      p1x: Math.cos(ca) * c,
      p1z: Math.sin(ca) * c,
      p2x: Math.cos(exit) * ENTRY_RADIUS,
      p2z: Math.sin(exit) * ENTRY_RADIUS,
      altitude: this.between(this.flocks.length === 0 ? (this.rand() < 0.5 ? LOW_LANE : HIGH_LANE) : this.flocks[0].altitude < 3.65 ? HIGH_LANE : LOW_LANE),
      speed: this.between(SPEED),
      u: 0,
      age: 0,
      yaw: 0,
      bank: 0,
    };
    this.nextId += 1;
    for (const slot of this.formation(spec, count)) {
      flock.birds.push({
        id: this.nextId,
        species: kind,
        side: slot.side,
        back: slot.back,
        up: slot.up,
        wander: this.rand() * Math.PI * 2,
        hz: spec.flapHz * (0.9 + this.rand() * 0.2),
        flapPhase: this.rand() * Math.PI * 2,
        amp: spec.flapAmp,
        gliding: false,
        stateLeft: this.between(spec.flapS) * this.rand(),
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        bank: 0,
        scale: 0,
        wingInner: 0,
        wingOuter: 0,
      });
      this.nextId += 1;
    }
    this.bezier(flock, 0);
    flock.yaw = Math.atan2(this.point.dx, this.point.dz);
    this.flocks.push(flock);
    this.spawned += 1;
    this.rebuildBirds();
    this.pose(flock, 0);
    return count;
  }

  /** Advance by dt seconds. dt <= 0 changes nothing. */
  step(dt: number): void {
    if (!(dt > 0)) return;
    let removed = false;
    for (let i = this.flocks.length - 1; i >= 0; i -= 1) {
      const flock = this.flocks[i];
      if (this.advance(flock, dt)) {
        this.flocks.splice(i, 1);
        removed = true;
      }
    }
    if (removed) this.rebuildBirds();
    if (!this.auto) return;
    this.nextIn -= dt;
    if (this.nextIn > 0) return;
    if (this.night > NIGHT_CUTOFF || this.spawn() === 0) this.nextIn = this.between(RETRY_S);
    else this.nextIn = this.interval();
  }

  /** Seconds until the next flock, from the schedule or the debug override. */
  interval(): number {
    if (this.intervalOverride !== null) return this.intervalOverride;
    const trees = Math.min(1, Math.max(0, this.treeCount()) / TREES_FULL);
    return this.between(FLOCK_INTERVAL_S) * (this.twilight ? TWILIGHT_FACTOR : 1) * (1 - TREE_FACTOR_MAX * trees);
  }

  /** Returns true once the flock has left. */
  private advance(flock: Flock, dt: number): boolean {
    this.bezier(flock, flock.u);
    const tangent = Math.hypot(this.point.dx, this.point.dz) || 1;
    flock.u += (flock.speed * this.speedScale * dt) / tangent;
    flock.age += dt;
    if (flock.u >= 1) return true;
    this.bezier(flock, flock.u);
    const yaw = Math.atan2(this.point.dx, this.point.dz);
    const turn = wrapAngle(yaw - flock.yaw) / dt;
    flock.yaw = yaw;
    // Bank into the turn (a left turn = yaw increasing = left wing down = negative roll), eased.
    const target = clamp(-turn * BANK_GAIN, -MAX_BANK, MAX_BANK);
    flock.bank += (target - flock.bank) * Math.min(1, dt * 2);
    this.pose(flock, dt);
    return false;
  }

  /** this.point must hold the flock's current Bézier sample. */
  private pose(flock: Flock, dt: number): void {
    const spec = SPECIES[flock.species];
    const fx = Math.sin(flock.yaw);
    const fz = Math.cos(flock.yaw);
    // The flock's left (Y × forward).
    const lx = fz;
    const lz = -fx;
    const fade = Math.min(smoothstep(0, FADE, flock.u), smoothstep(1, 1 - FADE, flock.u));
    const t = flock.age;
    const span = BIRD_WINGSPAN * spec.size;
    for (const bird of flock.birds) {
      const w = bird.wander;
      const side = bird.side + Math.sin(t * 0.63 + w) * WANDER_SIDE * span;
      const back = bird.back + Math.cos(t * 0.51 + w * 1.7) * WANDER_BACK * span;
      bird.x = this.point.x + lx * side - fx * back;
      bird.z = this.point.z + lz * side - fz * back;
      bird.y = flock.altitude + bird.up + Math.sin(t * 0.8 + w * 2.3) * WANDER_UP;
      bird.yaw = flock.yaw + Math.sin(t * 0.7 + w * 3.1) * 0.05;
      bird.bank = flock.bank + Math.sin(t * 0.9 + w * 1.3) * 0.06;
      bird.scale = spec.size * fade;
      this.flap(bird, spec, dt);
    }
  }

  private flap(bird: Bird, spec: SpeciesSpec, dt: number): void {
    if (dt > 0) {
      bird.stateLeft -= dt;
      if (bird.stateLeft <= 0) {
        const glide = !bird.gliding && this.rand() < spec.glideChance;
        bird.gliding = glide;
        bird.stateLeft = this.between(glide ? spec.glideS : spec.flapS);
      }
      bird.flapPhase = (bird.flapPhase + dt * bird.hz * Math.PI * 2) % (Math.PI * 2);
      const target = bird.gliding ? 0 : spec.flapAmp;
      bird.amp += (target - bird.amp) * Math.min(1, dt * 5);
    }
    bird.wingInner = GLIDE_DIHEDRAL + Math.sin(bird.flapPhase) * bird.amp;
    bird.wingOuter = Math.sin(bird.flapPhase - OUTER_LAG) * bird.amp * OUTER_SHARE;
  }

  /** Leader first; slots are at least MIN_SLOT_GAP wingspans apart. */
  private formation(spec: SpeciesSpec, count: number): Array<{ side: number; back: number; up: number }> {
    const span = BIRD_WINGSPAN * spec.size;
    const slots: Array<{ side: number; back: number; up: number }> = [{ side: 0, back: 0, up: 0 }];
    if (spec.formation === 'v') {
      for (let i = 1; i < count; i += 1) {
        const k = Math.ceil(i / 2);
        const s = i % 2 === 1 ? 1 : -1;
        slots.push({ side: s * k * span * 1.15, back: k * span, up: Math.min(k * 0.015, SLOT_UP) });
      }
      return slots;
    }
    // Clouds and lines: rejection-sample slots in an ellipse (side half-width, back depth).
    const [halfSide, depth] =
      spec.formation === 'line' ? [span * 2.6, span * 1.4] : spec.formation === 'tight' ? [span * 1.6, span * 2.4] : [span * 2.2, span * 3];
    const gap = span * MIN_SLOT_GAP;
    for (let tries = 0; slots.length < count && tries < 400; tries += 1) {
      const side = (this.rand() * 2 - 1) * halfSide;
      const back = this.rand() * depth;
      const up = (this.rand() * 2 - 1) * SLOT_UP;
      if (slots.every((o) => Math.hypot(o.side - side, o.back - back) >= gap)) slots.push({ side, back, up });
    }
    // Rare fallback: a staggered row behind the rest (never overlaps).
    while (slots.length < count) {
      const i = slots.length;
      slots.push({ side: (i % 2 === 0 ? 1 : -1) * gap * 0.6, back: depth + gap * i, up: 0 });
    }
    return slots;
  }

  private pickSpecies(): BirdSpecies {
    const weights = this.twilight ? WEIGHTS_TWILIGHT : WEIGHTS_DAY;
    let roll = this.rand();
    for (const kind of BIRD_SPECIES) {
      roll -= weights[kind];
      if (roll < 0) return kind;
    }
    return 'pigeon';
  }

  /** Point and tangent of a flock's path at u (written to this.point). */
  private bezier(flock: Flock, u: number): void {
    const a = (1 - u) * (1 - u);
    const b = 2 * (1 - u) * u;
    const c = u * u;
    this.point.x = a * flock.p0x + b * flock.p1x + c * flock.p2x;
    this.point.z = a * flock.p0z + b * flock.p1z + c * flock.p2z;
    this.point.dx = 2 * (1 - u) * (flock.p1x - flock.p0x) + 2 * u * (flock.p2x - flock.p1x);
    this.point.dz = 2 * (1 - u) * (flock.p1z - flock.p0z) + 2 * u * (flock.p2z - flock.p1z);
  }

  private rebuildBirds(): void {
    this.birds.length = 0;
    for (const flock of this.flocks) for (const bird of flock.birds) this.birds.push(bird);
    this.version += 1;
  }

  private between(range: readonly [number, number]): number {
    return range[0] + this.rand() * (range[1] - range[0]);
  }
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
