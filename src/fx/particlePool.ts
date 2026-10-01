/**
 * Fixed-capacity particle pool in structure-of-arrays form. Pure TypeScript (no three.js, no DOM)
 * so it is unit-testable and allocation-free: spawn() writes into preallocated typed arrays and
 * step() integrates and swap-removes dead particles in place.
 *
 * A particle with a negative age is "scheduled" (delayed start, e.g. the sparkle ring that waits
 * for a building's pop-in): it occupies a slot but does not move and renders at scale 0.
 *
 * WP-08 (Feel & VFX).
 */

/** How a particle's size evolves over its life (see sizeAt()). */
export const Curve = {
  /** Soft dust / poof billboard: scales OUT over its life while its alpha fades to 0 (alphaAt()). */
  Puff: 0,
  /** Debris, leaves, petals: full size, shrinks in the last quarter. */
  Chip: 1,
  /** Sparkle: sine in/out with a twinkle. */
  Glint: 2,
} as const;
export type Curve = (typeof Curve)[keyof typeof Curve];

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds. */
  life: number;
  /** Seconds before the particle starts (0 = now). */
  delay: number;
  /** World-unit radius at full size. */
  size: number;
  /** Downward acceleration (negative = buoyant, rises). */
  gravity: number;
  /** Velocity damping per second (exponential-ish). */
  drag: number;
  /** Spin rate (rad/s) around the particle's tumble axes. */
  spin: number;
  /** Vertical squash of the unit mesh (1 = round, 0.2 = flake). */
  flat: number;
  curve: Curve;
  /** Linear RGB 0..1. */
  r: number;
  g: number;
  b: number;
}

/** Ground contact height (road/pavement tops sit at 0.02). */
export const FLOOR_Y = 0.03;
/** Largest integration step: a stalled tab must not fling particles through the ground. */
export const MAX_STEP = 1 / 20;

export class ParticlePool {
  count = 0;
  /** Total spawn() calls that got a slot (diagnostics). */
  spawned = 0;
  /** spawn() calls dropped because the pool was full. */
  dropped = 0;

  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly size: Float32Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array;
  readonly spin: Float32Array;
  readonly rotA: Float32Array;
  readonly rotB: Float32Array;
  readonly flat: Float32Array;
  readonly seed: Float32Array;
  readonly curve: Uint8Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;

  private readonly floats: Float32Array[];

  constructor(readonly capacity: number) {
    const f = () => new Float32Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.age = f();
    this.life = f();
    this.size = f();
    this.gravity = f();
    this.drag = f();
    this.spin = f();
    this.rotA = f();
    this.rotB = f();
    this.flat = f();
    this.seed = f();
    this.curve = new Uint8Array(capacity);
    this.r = f();
    this.g = f();
    this.b = f();
    this.floats = [
      this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.age, this.life, this.size, this.gravity,
      this.drag, this.spin, this.rotA, this.rotB, this.flat, this.seed, this.r, this.g, this.b,
    ];
  }

  /** Add one particle. `phase` (0..1, from the seeded rng) sets its initial rotation/twinkle. Returns false when full. */
  spawn(spec: ParticleSpec, phase: number): boolean {
    if (this.count >= this.capacity) {
      this.dropped += 1;
      return false;
    }
    const i = this.count;
    this.count += 1;
    this.spawned += 1;
    this.px[i] = spec.x;
    this.py[i] = spec.y;
    this.pz[i] = spec.z;
    this.vx[i] = spec.vx;
    this.vy[i] = spec.vy;
    this.vz[i] = spec.vz;
    this.age[i] = -Math.max(0, spec.delay);
    this.life[i] = Math.max(0.05, spec.life);
    this.size[i] = spec.size;
    this.gravity[i] = spec.gravity;
    this.drag[i] = spec.drag;
    this.spin[i] = spec.spin;
    this.rotA[i] = phase * Math.PI * 2;
    this.rotB[i] = phase * 7.31;
    this.flat[i] = spec.flat;
    this.seed[i] = phase;
    this.curve[i] = spec.curve;
    this.r[i] = spec.r;
    this.g[i] = spec.g;
    this.b[i] = spec.b;
    return true;
  }

  /** Advance every particle by `delta` seconds (clamped to MAX_STEP) and drop the dead ones. */
  step(delta: number): void {
    const dt = Math.min(Math.max(delta, 0), MAX_STEP);
    if (dt === 0) return;
    let i = 0;
    while (i < this.count) {
      const age = this.age[i] + dt;
      this.age[i] = age;
      if (age >= this.life[i]) {
        this.removeAt(i);
        continue; // the last particle moved into slot i
      }
      if (age > 0) {
        const damp = Math.max(0, 1 - this.drag[i] * dt);
        this.vx[i] *= damp;
        this.vz[i] *= damp;
        this.vy[i] = this.vy[i] * damp - this.gravity[i] * dt;
        this.px[i] += this.vx[i] * dt;
        this.py[i] += this.vy[i] * dt;
        this.pz[i] += this.vz[i] * dt;
        if (this.py[i] < FLOOR_Y) {
          // Settle on the ground: a small bounce, then slide to rest.
          this.py[i] = FLOOR_Y;
          if (this.vy[i] < 0) this.vy[i] = -this.vy[i] * 0.28;
          this.vx[i] *= 0.55;
          this.vz[i] *= 0.55;
          this.spin[i] *= 0.5;
        }
        this.rotA[i] += this.spin[i] * dt;
        this.rotB[i] += this.spin[i] * 0.63 * dt;
      }
      i += 1;
    }
  }

  /** Remove everything (reduced motion, screenshots). */
  clear(): void {
    this.count = 0;
  }

  /** Current size (world units) of particle `i`: 0 while scheduled, then the curve. */
  sizeAt(i: number): number {
    const age = this.age[i];
    if (age <= 0) return 0;
    const t = age / this.life[i];
    const size = this.size[i];
    switch (this.curve[i]) {
      case Curve.Puff: {
        // Scale out: starts at 40 %, expands to 115 % (ease-out) while alphaAt() fades it away.
        const k = 1 - t;
        return size * (0.4 + 0.75 * (1 - k * k * k));
      }
      case Curve.Chip:
        return t < 0.72 ? size : size * (1 - smooth((t - 0.72) / 0.28));
      default: {
        const envelope = Math.sin(Math.PI * t);
        const twinkle = 0.72 + 0.28 * Math.sin(age * 26 + this.seed[i] * 40);
        return size * envelope * twinkle;
      }
    }
  }

  /**
   * Opacity multiplier (0..1) of particle `i`. Puffs fade in over the first 12 % of their life
   * hold, then ease out to exactly 0 at the end; other curves are opaque while alive (they shrink instead).
   */
  alphaAt(i: number): number {
    const age = this.age[i];
    if (age <= 0) return 0;
    if (this.curve[i] !== Curve.Puff) return 1;
    const t = Math.min(1, age / this.life[i]);
    const fadeIn = Math.min(1, t / 0.1);
    return fadeIn * (1 - smooth((t - 0.3) / 0.7));
  }

  private removeAt(i: number): void {
    const last = this.count - 1;
    if (i !== last) {
      for (const array of this.floats) array[i] = array[last];
      this.curve[i] = this.curve[last];
    }
    this.count = last;
  }
}

function smooth(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}
