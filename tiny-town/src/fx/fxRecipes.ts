/**
 * Burst recipes: which particles a build:placed / build:removed event emits. Pure TypeScript
 * (no three.js, no DOM), seeded RNG only, so the output is deterministic and unit-tested.
 *
 * Sizing (PLAN WP-08): effects scale with what was built. A road tile gets a small kerb-level
 * dust ring, a tree drops leaves, wildflowers throw petals, a building gets a wide dust ring,
 * a few chips and a sparkle ring timed to land as its pop-in (TownRenderer, 0.22 s) finishes.
 * Removal is a low "poof" ringing the footprint (delayed a beat and kept at ground level, so the
 * object's shrink-out stays visible) plus a few small debris chips sized by layer/kind. Inside a
 * drag stroke (strokeIndex > 0) counts drop so a 30-tile road stays readable, not a sandstorm.
 *
 * Three pools ⇒ at most three draw calls: `dust` (soft feathered billboards that scale out and
 * fade), `solid` (small faceted chips, leaves, petals) and `glint` (unlit gold sparkles).
 * M3 polish: dust used to be faceted Lambert icosahedra that read as beige boulders.
 *
 * WP-08 (Feel & VFX).
 */
import { OBJECTS } from '../catalog/objects';
import { CELL_SIZE } from '../game/config';
import type { ObjectKind } from '../town/types';
import { Curve, type ParticlePool, type ParticleSpec } from './particlePool';

export type FxClass = 'path' | 'road' | 'lawn' | 'meadow' | 'tree' | 'building' | 'small-building' | 'prop' | 'fence';

export interface FxPools {
  dust: ParticlePool;
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
  // Dust: light, warm, low-contrast (unlit billboards, so these are close to on-screen values).
  dustPath: [hex(0xf3ead9), hex(0xefe4cf), hex(0xf7f0e3)],
  dustRoad: [hex(0xece6dc), hex(0xe6dfd3), hex(0xf2ede5)],
  dustNature: [hex(0xefe9cf), hex(0xe8ebcc)],
  dustBuild: [hex(0xf6eddc), hex(0xf1e6d1), hex(0xfaf4e8)],
  poof: [hex(0xefe8dc), hex(0xe9e1d3), hex(0xf5f0e7)],
  leaves: [hex(0x7fd35a), hex(0xa8e063), hex(0x5cb85c), hex(0xd8e86a)],
  petals: [hex(0xff9ec7), hex(0xffe066), hex(0xffffff), hex(0xc9a7ff)],
  debrisBuild: [hex(0xc8674f), hex(0x8a5a3c), hex(0xf2efe8), hex(0x5f6b7a)],
  debrisPath: [hex(0x7d8190), hex(0xa0a8c9), hex(0x5d6070)],
  debrisFence: [hex(0xb98a5a), hex(0xf2efe8), hex(0x8a6a4a)],
  debrisProp: [hex(0x7a7f88), hex(0xc7433a), hex(0x3a3d44)],
  glint: [hex(0xffe27a), hex(0xfff4c2), hex(0xffd04d)],
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

/**
 * WP-12: removal-poof ring radius for a (multi-cell) object: ≈ half its longer footprint side, so the
 * ring hugs a 3×3 cottage as well as a 1×2 garage; never below `min`.
 */
export function footprintPoofRadius(kind: string, min: number): number {
  const def = Object.prototype.hasOwnProperty.call(OBJECTS, kind) ? OBJECTS[kind as ObjectKind] : undefined;
  if (!def) return min;
  return Math.max(min, (Math.max(def.footprint[0], def.footprint[1]) * CELL_SIZE) / 2 - 0.05);
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

/** Soft dust ring at kerb level, drifting outward and slightly up while it scales out and fades. */
const dust = (count: number, radius: number, size: Range, palette: readonly Rgb[], speed: Range = [0.35, 0.7]): Burst => ({
  count, radius, radiusJitter: 0.08, y: [0.02, 0.06], speed, up: [0.08, 0.22], size, life: [0.55, 0.8],
  gravity: -0.15, drag: 3.6, curve: Curve.Puff, palette,
});

const flakes = (count: number, y: Range, palette: readonly Rgb[], up: Range = [0.9, 1.4]): Burst => ({
  count, radius: 0.16, radiusJitter: 0.18, y, speed: [0.35, 0.8], up, size: [0.04, 0.055], life: [0.9, 1.2],
  gravity: 2.2, drag: 2.4, spin: [6, 11], flat: 0.22, curve: Curve.Chip, palette,
});

/** Small tumbling chips (never boulders: ≤ 0.035 world units). */
const debris = (count: number, palette: readonly Rgb[], y: Range = [0.08, 0.25], size: Range = [0.02, 0.032]): Burst => ({
  count, radius: 0.12, radiusJitter: 0.18, y, speed: [0.6, 1.2], up: [1.2, 2.0], size, life: [0.7, 0.95],
  gravity: 6, drag: 1.2, spin: [7, 14], flat: 0.5, curve: Curve.Chip, palette,
});

const sparkleRing = (count: number, radius: number, delay: Range): Burst => ({
  count, radius, radiusJitter: 0.06, y: [0.3, 0.7], speed: [0.02, 0.08], up: [0.25, 0.45], size: [0.06, 0.085],
  life: [0.6, 0.85], gravity: -0.1, drag: 1, flat: 1.8, delay, curve: Curve.Glint, palette: PALETTES.glint,
});

/**
 * Removal poof: a soft ring AROUND the footprint at ground level (radius ≈ the object's half
 * width), starting a beat late so the shrink-out (TownRenderer, 0.15 s) is seen first, then rolling
 * outward. It never covers the object's centre.
 */
const poof = (count: number, radius: number, size: Range): Burst => ({
  count, radius, radiusJitter: 0.06, y: [0.02, 0.07], speed: [0.55, 0.95], up: [0.1, 0.3], size, life: [0.55, 0.8],
  gravity: -0.2, drag: 3.4, delay: [0.05, 0.12], curve: Curve.Puff, palette: PALETTES.poof,
});

// ---- recipes ----------------------------------------------------------------------------------

/** Effects for one placed thing at world (x, z). */
export function emitPlaced(pools: FxPools, rng: () => number, id: string, x: number, z: number, strokeIndex: number): void {
  const n = (base: number, min = 1) => strokeCount(base, strokeIndex, min);
  switch (classify(id)) {
    case 'road':
      emitBurst(pools.dust, rng, x, z, dust(n(5, 2), 0.4, [0.09, 0.12], PALETTES.dustRoad));
      return;
    case 'path':
      emitBurst(pools.dust, rng, x, z, dust(n(5, 2), 0.4, [0.085, 0.115], PALETTES.dustPath));
      return;
    case 'lawn':
      emitBurst(pools.dust, rng, x, z, dust(n(3, 1), 0.3, [0.08, 0.1], PALETTES.dustNature));
      emitBurst(pools.solid, rng, x, z, flakes(n(5, 2), [0.06, 0.12], PALETTES.leaves));
      return;
    case 'meadow':
      emitBurst(pools.dust, rng, x, z, dust(n(3, 1), 0.3, [0.08, 0.1], PALETTES.dustNature));
      emitBurst(pools.solid, rng, x, z, flakes(n(6, 2), [0.08, 0.16], PALETTES.petals, [1.1, 1.6]));
      return;
    case 'tree':
      emitBurst(pools.dust, rng, x, z, dust(n(5, 2), 0.28, [0.085, 0.11], PALETTES.dustNature));
      emitBurst(pools.solid, rng, x, z, flakes(n(8, 3), [0.42, 0.6], PALETTES.leaves, [0.3, 0.8]));
      return;
    case 'building':
      emitBurst(pools.dust, rng, x, z, dust(12, 0.48, [0.12, 0.16], PALETTES.dustBuild, [0.5, 0.9]));
      emitBurst(pools.solid, rng, x, z, debris(3, PALETTES.debrisBuild, [0.04, 0.12]));
      emitBurst(pools.glint, rng, x, z, sparkleRing(10, 0.5, [0.16, 0.3]));
      return;
    case 'small-building':
      emitBurst(pools.dust, rng, x, z, dust(9, 0.42, [0.1, 0.13], PALETTES.dustBuild, [0.45, 0.8]));
      emitBurst(pools.glint, rng, x, z, sparkleRing(7, 0.42, [0.16, 0.28]), 0.8);
      return;
    case 'fence':
      emitBurst(pools.dust, rng, x, z, dust(n(4, 2), 0.28, [0.075, 0.1], PALETTES.dustPath));
      return;
    case 'prop':
      emitBurst(pools.dust, rng, x, z, dust(n(5, 2), 0.24, [0.08, 0.105], PALETTES.dustPath));
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
      emitBurst(pools.dust, rng, x, z, poof(big ? 12 : 9, footprintPoofRadius(kind, big ? 0.3 : 0.28), big ? [0.13, 0.17] : [0.11, 0.14]));
      emitBurst(pools.solid, rng, x, z, debris(big ? 5 : 3, PALETTES.debrisBuild, [0.15, 0.35], [0.022, 0.035]));
      return;
    }
    case 'tree':
      emitBurst(pools.dust, rng, x, z, poof(n(6, 3), 0.28, [0.095, 0.12]));
      emitBurst(pools.solid, rng, x, z, flakes(n(9, 4), [0.35, 0.6], PALETTES.leaves, [0.5, 1.1]));
      emitBurst(pools.solid, rng, x, z, debris(n(2, 1), PALETTES.debrisFence));
      return;
    case 'prop':
      emitBurst(pools.dust, rng, x, z, poof(n(5, 3), 0.22, [0.09, 0.115]));
      emitBurst(pools.solid, rng, x, z, debris(n(3, 2), PALETTES.debrisProp));
      return;
    case 'fence':
      emitBurst(pools.dust, rng, x, z, poof(n(4, 2), 0.24, [0.08, 0.105]));
      emitBurst(pools.solid, rng, x, z, debris(n(4, 2), PALETTES.debrisFence, [0.08, 0.25], [0.02, 0.03]));
      return;
    case 'lawn':
      emitBurst(pools.dust, rng, x, z, poof(n(3, 1), 0.3, [0.08, 0.1]));
      emitBurst(pools.solid, rng, x, z, flakes(n(5, 2), [0.05, 0.1], PALETTES.leaves));
      return;
    case 'meadow':
      emitBurst(pools.dust, rng, x, z, poof(n(3, 1), 0.3, [0.08, 0.1]));
      emitBurst(pools.solid, rng, x, z, flakes(n(6, 2), [0.06, 0.12], PALETTES.petals));
      return;
    case 'road':
    case 'path':
      emitBurst(pools.dust, rng, x, z, poof(n(4, 2), 0.36, [0.085, 0.11]));
      emitBurst(pools.solid, rng, x, z, debris(n(3, 2), PALETTES.debrisPath, [0.04, 0.1], [0.02, 0.03]));
      return;
  }
}
