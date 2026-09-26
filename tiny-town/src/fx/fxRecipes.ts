/**
 * Burst recipes: which particles a build:placed / build:removed event emits. Pure TypeScript
 * (no three.js, no DOM), seeded RNG only, so the output is deterministic and unit-tested.
 *
 * Sizing (PLAN WP-08): effects scale with what was built. A road tile gets a small kerb-level
 * dust ring, a tree drops leaves, wildflowers throw petals, a building gets a wide dust ring,
 * a few chips and a sparkle ring timed to land as its pop-in (TownRenderer, 0.22 s) finishes.
 * Removal is a "poof" plus debris chips sized by layer/kind. Inside a drag stroke
 * (strokeIndex > 0) counts drop so a 30-tile road stays readable rather than a sandstorm.
 *
 * Two pools ⇒ two draw calls: `solid` (lit dust puffs, chips, leaves, petals share one
 * low-poly mesh) and `glint` (unlit additive sparkles).
 *
 * WP-08 (Feel & VFX).
 */
import { Curve, type ParticlePool, type ParticleSpec } from './particlePool';

export type FxClass = 'path' | 'road' | 'lawn' | 'meadow' | 'tree' | 'building' | 'small-building' | 'prop' | 'fence';

export interface FxPools {
  solid: ParticlePool;
  glint: ParticlePool;
}

type Rgb = readonly [number, number, number];
type Range = readonly [number, number];

/** sRGB hex → linear RGB (three's working colour space for instanceColor). */
function hex(value: number): Rgb {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [channel((value >> 16) & 255), channel((value >> 8) & 255), channel(value & 255)];
}

export const PALETTES = {
  dustPath: [hex(0xf1e8d4), hex(0xe4d8bf), hex(0xd8ceb9)],
  dustRoad: [hex(0xe0dcd5), hex(0xd0cbc3), hex(0xeeeae2)],
  dustNature: [hex(0xe9e3c6), hex(0xdce4b8)],
  dustBuild: [hex(0xf5ecda), hex(0xe8ddc5), hex(0xfcf8ee)],
  poof: [hex(0xdcd6cc), hex(0xcbc4ba), hex(0xefeae2)],
  leaves: [hex(0x5cb85c), hex(0x4ab480), hex(0x86d160), hex(0x3da679)],
  petals: [hex(0xff9ec7), hex(0xffe066), hex(0xffffff), hex(0xc9a7ff)],
  debrisBuild: [hex(0xc8674f), hex(0x8a5a3c), hex(0xf2efe8), hex(0x5f6b7a)],
  debrisPath: [hex(0x7d8190), hex(0xa0a8c9), hex(0x5d6070)],
  debrisFence: [hex(0xb98a5a), hex(0xf2efe8), hex(0x8a6a4a)],
  debrisProp: [hex(0x7a7f88), hex(0xc7433a), hex(0x3a3d44)],
  glint: [hex(0xfff3b0), hex(0xffffff), hex(0xffd66b)],
} as const satisfies Record<string, readonly Rgb[]>;

interface Burst {
  count: number;
  /** Spawn ring radius around the event point, plus random jitter inside [0, radiusJitter]. */
  radius: number;
  radiusJitter?: number;
  y: Range;
  /** Outward speed. */
  speed: Range;
  up: Range;
  size: Range;
  life: Range;
  gravity: number;
  drag: number;
  spin?: Range;
  flat?: number;
  delay?: Range;
  curve: Curve;
  palette: readonly Rgb[];
}

/** Map a tool id (placed) or removed kind to its effect class. */
export function classify(id: string): FxClass {
  if (id === 'road') return 'road';
  if (id === 'pavement' || id === 'walkway') return 'path';
  if (id === 'grass') return 'lawn';
  if (id === 'meadow') return 'meadow';
  if (id.startsWith('tree')) return 'tree';
  if (id.startsWith('townhouse') || id === 'garage') return 'building';
  if (id === 'bus-stop') return 'small-building';
  if (id.startsWith('fence')) return 'fence';
  return 'prop';
}

/** Fewer particles per cell once a drag stroke is under way (never below `min`). */
export function strokeCount(base: number, strokeIndex: number, min = 1): number {
  if (strokeIndex <= 0) return base;
  const factor = strokeIndex < 4 ? 0.6 : 0.4;
  return Math.max(min, Math.round(base * factor));
}

const spec: ParticleSpec = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, delay: 0, size: 0.1, gravity: 0, drag: 0,
  spin: 0, flat: 1, curve: Curve.Puff, r: 1, g: 1, b: 1,
};

const lerp = (range: Range, t: number): number => range[0] + (range[1] - range[0]) * t;

/** Emit `burst.count` particles evenly around (x, z) with seeded jitter. Returns how many got a slot. */
export function emitBurst(pool: ParticlePool, rng: () => number, x: number, z: number, burst: Burst, scale = 1): number {
  let emitted = 0;
  const offset = rng() * Math.PI * 2;
  for (let i = 0; i < burst.count; i += 1) {
    const angle = offset + (i / burst.count) * Math.PI * 2 + (rng() - 0.5) * 0.9;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const radius = (burst.radius + rng() * (burst.radiusJitter ?? 0)) * scale;
    const speed = lerp(burst.speed, rng()) * scale;
    const colour = burst.palette[Math.floor(rng() * burst.palette.length) % burst.palette.length];
    spec.x = x + cos * radius;
    spec.z = z + sin * radius;
    spec.y = lerp(burst.y, rng()) * (burst.curve === Curve.Glint ? scale : 1);
    spec.vx = cos * speed;
    spec.vz = sin * speed;
    spec.vy = lerp(burst.up, rng()) * Math.sqrt(scale);
    spec.size = lerp(burst.size, rng()) * scale;
    spec.life = lerp(burst.life, rng());
    spec.delay = burst.delay ? lerp(burst.delay, rng()) : 0;
    spec.gravity = burst.gravity;
    spec.drag = burst.drag;
    spec.spin = burst.spin ? lerp(burst.spin, rng()) * (rng() < 0.5 ? -1 : 1) : 0;
    spec.flat = burst.flat ?? 1;
    spec.curve = burst.curve;
    spec.r = colour[0];
    spec.g = colour[1];
    spec.b = colour[2];
    if (pool.spawn(spec, rng())) emitted += 1;
  }
  return emitted;
}

// ---- building blocks --------------------------------------------------------------------------

const dust = (count: number, radius: number, size: Range, palette: readonly Rgb[], speed: Range = [0.5, 0.9]): Burst => ({
  count, radius, radiusJitter: 0.08, y: [0.04, 0.09], speed, up: [0.15, 0.4], size, life: [0.42, 0.62],
  gravity: -0.3, drag: 3.4, spin: [0.5, 2], curve: Curve.Puff, palette,
});

const flakes = (count: number, y: Range, palette: readonly Rgb[], up: Range = [0.9, 1.4]): Burst => ({
  count, radius: 0.12, radiusJitter: 0.16, y, speed: [0.3, 0.75], up, size: [0.035, 0.05], life: [0.9, 1.25],
  gravity: 2.2, drag: 2.4, spin: [6, 11], flat: 0.22, curve: Curve.Chip, palette,
});

const debris = (count: number, palette: readonly Rgb[], y: Range = [0.1, 0.3], size: Range = [0.03, 0.05]): Burst => ({
  count, radius: 0.1, radiusJitter: 0.18, y, speed: [0.6, 1.3], up: [1.3, 2.2], size, life: [0.75, 1.05],
  gravity: 6, drag: 1.2, spin: [7, 14], flat: 0.45, curve: Curve.Chip, palette,
});

const sparkleRing = (count: number, radius: number, delay: Range): Burst => ({
  count, radius, radiusJitter: 0.06, y: [0.3, 0.7], speed: [0.02, 0.08], up: [0.25, 0.45], size: [0.035, 0.055],
  life: [0.55, 0.8], gravity: -0.1, drag: 1, flat: 1.8, delay, curve: Curve.Glint, palette: PALETTES.glint,
});

const poof = (count: number, size: Range): Burst => ({
  count, radius: 0.18, radiusJitter: 0.12, y: [0.08, 0.4], speed: [0.9, 1.5], up: [0.4, 0.8], size, life: [0.5, 0.72],
  gravity: -0.45, drag: 3.2, spin: [0.5, 2], curve: Curve.Puff, palette: PALETTES.poof,
});

// ---- recipes ----------------------------------------------------------------------------------

/** Effects for one placed thing at world (x, z). */
export function emitPlaced(pools: FxPools, rng: () => number, id: string, x: number, z: number, strokeIndex: number): void {
  const n = (base: number, min = 1) => strokeCount(base, strokeIndex, min);
  switch (classify(id)) {
    case 'road':
      emitBurst(pools.solid, rng, x, z, dust(n(6, 2), 0.4, [0.05, 0.08], PALETTES.dustRoad));
      return;
    case 'path':
      emitBurst(pools.solid, rng, x, z, dust(n(6, 2), 0.4, [0.045, 0.075], PALETTES.dustPath));
      return;
    case 'lawn':
      emitBurst(pools.solid, rng, x, z, dust(n(3, 1), 0.3, [0.04, 0.06], PALETTES.dustNature));
      emitBurst(pools.solid, rng, x, z, flakes(n(5, 2), [0.06, 0.12], PALETTES.leaves));
      return;
    case 'meadow':
      emitBurst(pools.solid, rng, x, z, dust(n(3, 1), 0.3, [0.04, 0.06], PALETTES.dustNature));
      emitBurst(pools.solid, rng, x, z, flakes(n(6, 2), [0.08, 0.16], PALETTES.petals, [1.1, 1.6]));
      return;
    case 'tree':
      emitBurst(pools.solid, rng, x, z, dust(n(5, 2), 0.22, [0.05, 0.08], PALETTES.dustNature));
      emitBurst(pools.solid, rng, x, z, flakes(n(9, 3), [0.42, 0.6], PALETTES.leaves, [0.3, 0.8]));
      return;
    case 'building':
      emitBurst(pools.solid, rng, x, z, dust(14, 0.46, [0.08, 0.13], PALETTES.dustBuild, [0.9, 1.4]));
      emitBurst(pools.solid, rng, x, z, debris(4, PALETTES.debrisBuild, [0.05, 0.15]));
      emitBurst(pools.glint, rng, x, z, sparkleRing(10, 0.5, [0.16, 0.3]));
      return;
    case 'small-building':
      emitBurst(pools.solid, rng, x, z, dust(10, 0.4, [0.06, 0.1], PALETTES.dustBuild, [0.8, 1.2]));
      emitBurst(pools.glint, rng, x, z, sparkleRing(7, 0.42, [0.16, 0.28]), 0.8);
      return;
    case 'fence':
      emitBurst(pools.solid, rng, x, z, dust(n(4, 2), 0.28, [0.04, 0.06], PALETTES.dustPath));
      return;
    case 'prop':
      emitBurst(pools.solid, rng, x, z, dust(n(6, 3), 0.22, [0.05, 0.08], PALETTES.dustPath));
      emitBurst(pools.glint, rng, x, z, sparkleRing(n(3, 2), 0.18, [0.12, 0.2]), 0.7);
      return;
  }
}

/** Effects for one removed thing (build:removed.layer / kind) at world (x, z). */
export function emitRemoved(
  pools: FxPools,
  rng: () => number,
  layer: 'ground' | 'object' | 'edge',
  kind: string,
  x: number,
  z: number,
  strokeIndex: number,
): void {
  const n = (base: number, min = 1) => strokeCount(base, strokeIndex, min);
  const fxClass = layer === 'edge' ? 'fence' : classify(kind);
  switch (fxClass) {
    case 'building':
    case 'small-building': {
      const big = fxClass === 'building';
      emitBurst(pools.solid, rng, x, z, poof(big ? 14 : 10, big ? [0.1, 0.16] : [0.08, 0.12]));
      emitBurst(pools.solid, rng, x, z, debris(big ? 8 : 5, PALETTES.debrisBuild, [0.2, 0.45], [0.035, 0.06]));
      return;
    }
    case 'tree':
      emitBurst(pools.solid, rng, x, z, poof(n(7, 3), [0.07, 0.11]));
      emitBurst(pools.solid, rng, x, z, flakes(n(10, 4), [0.35, 0.6], PALETTES.leaves, [0.5, 1.1]));
      emitBurst(pools.solid, rng, x, z, debris(n(2, 1), PALETTES.debrisFence));
      return;
    case 'prop':
      emitBurst(pools.solid, rng, x, z, poof(n(6, 3), [0.06, 0.09]));
      emitBurst(pools.solid, rng, x, z, debris(n(4, 2), PALETTES.debrisProp));
      return;
    case 'fence':
      emitBurst(pools.solid, rng, x, z, poof(n(4, 2), [0.05, 0.08]));
      emitBurst(pools.solid, rng, x, z, debris(n(5, 2), PALETTES.debrisFence, [0.1, 0.3], [0.025, 0.04]));
      return;
    case 'lawn':
      emitBurst(pools.solid, rng, x, z, poof(n(3, 1), [0.045, 0.07]));
      emitBurst(pools.solid, rng, x, z, flakes(n(5, 2), [0.05, 0.1], PALETTES.leaves));
      return;
    case 'meadow':
      emitBurst(pools.solid, rng, x, z, poof(n(3, 1), [0.045, 0.07]));
      emitBurst(pools.solid, rng, x, z, flakes(n(6, 2), [0.06, 0.12], PALETTES.petals));
      return;
    case 'road':
    case 'path':
      emitBurst(pools.solid, rng, x, z, poof(n(4, 2), [0.05, 0.08]));
      emitBurst(pools.solid, rng, x, z, debris(n(4, 2), PALETTES.debrisPath, [0.04, 0.1], [0.03, 0.045]));
      return;
  }
}
