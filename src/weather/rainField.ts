/**
 * The rain field's maths, kept free of three.js so it can be unit-tested: which world scales the rain is
 * drawn at for a camera distance, the fall integrated over time, how many drops each scale shows, and a
 * CPU copy of where the streak shader puts a drop.
 *
 * The rain is drawn at two fixed world scales at once ("octaves", S = OCTAVE_BASE · 2^k), cross-faded by
 * thinning as the camera zooms. Within an octave nothing depends on the camera distance, so the drops stay
 * put in the world: the camera moves through them instead of the rain scaling with the view.
 */

export interface RainTuning {
  /** Streaks per octave at full strength (two octaves are drawn); the preset's density scales it. */
  maxStreaks: number;
  maxSplashes: number;
  /** Box width and height around the view, in octave scales S. */
  boxWidth: number;
  boxHeight: number;
  /** How far past the view's ground point the box is centred, along the look direction, in camera distances. */
  ahead: number;
  /** Streak length and width, and fall speed per second, in octave scales S. */
  length: number;
  width: number;
  speed: number;
  /** Sideways drift per unit of fall at wind 1. */
  slant: number;
  opacity: number;
  /** Streaks closer to the camera than this (view depth, in S) fade out: from 0 at `.x` to full at `.y`. */
  nearFrom: number;
  nearTo: number;
  /** Share of the rain the scene fog takes away at the fog's far distance. */
  fogFade: number;
  /** Splash radius in world units, and the least it may be, in octave scales S. */
  splashSize: number;
  splashMinSize: number;
  splashOpacity: number;
  /** Splashes fade out between these view depths (world units), before the depth buffer runs out of precision. */
  splashFarFrom: number;
  splashFarTo: number;
}

export const RAIN_TUNING: RainTuning = {
  maxStreaks: 4000,
  maxSplashes: 1400,
  boxWidth: 2,
  boxHeight: 0.5,
  ahead: 0.3,
  length: 0.03,
  width: 0.0015,
  speed: 0.85,
  slant: 0.1,
  opacity: 0.55,
  nearFrom: 0.2,
  nearTo: 0.4,
  fogFade: 0.7,
  splashSize: 0.07,
  splashMinSize: 0.0031,
  splashOpacity: 0.5,
  splashFarFrom: 80,
  splashFarTo: 110,
};

/** The smallest octave scale: the camera's closest zoom. */
export const OCTAVE_BASE = 6;

/**
 * The fall phase wraps at this many boxes. Drop speeds are j/8 of the base (j = 6..10), so a jump of 8 in
 * the phase moves every drop a whole number of boxes: the wrap is invisible and the phase stays precise.
 */
export const PHASE_WRAP = 8;

/** Drop speed factor for a seed in [0, 1): 0.75, 0.875, 1, 1.125 or 1.25. */
export function dropSpeed(seed: number): number {
  return (6 + Math.min(4, Math.floor(seed * 5))) / PHASE_WRAP;
}

/** Splash clock wrap, seconds; float32 stays precise to well under a millisecond below it. */
export const SPLASH_CLOCK_WRAP = 1000;

/** Share of a scale's drops over which the thinning fades a drop in or out, so none pops. */
export const THIN_BAND = 0.08;

/** World heading (xz) the rain leans towards: the foliage's wind heading. */
export const WIND_X = 0.86;
export const WIND_Z = 0.51;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface RainOctave {
  /** Lower octave index; the scales drawn are OCTAVE_BASE · 2^k and twice that. */
  k: number;
  /** Weight of the upper octave, 0..1; the lower one has 1 − mix. */
  mix: number;
}

/** Octaves for a camera distance; writes into `out`. */
export function rainOctave(distance: number, out: RainOctave): RainOctave {
  const level = Math.log2(Math.max(OCTAVE_BASE, distance) / OCTAVE_BASE);
  out.k = Math.floor(level);
  out.mix = level - out.k;
  return out;
}

export function octaveScale(k: number): number {
  return OCTAVE_BASE * 2 ** k;
}

/** The fall direction for a wind multiplier: down, leaning with the wind. Writes a unit vector into `out`. */
export function fallDirection(wind: number, tuning: Readonly<RainTuning>, out: Vec3Like): Vec3Like {
  const lean = tuning.slant * wind;
  const x = WIND_X * lean;
  const z = WIND_Z * lean;
  const length = Math.hypot(x, 1, z);
  out.x = x / length;
  out.y = -1 / length;
  out.z = z / length;
  return out;
}

const wrap = (value: number): number => ((value % PHASE_WRAP) + PHASE_WRAP) % PHASE_WRAP;

/**
 * Advances the fall `phase` (box units, the same for every octave since speed and box both scale with S)
 * by `delta` seconds along `fall`. Integrated, not `time × speed`, so a change in rain or wind changes the
 * drops' speed, never their place.
 */
export function advanceFall(phase: Vec3Like, delta: number, rain: number, fall: Readonly<Vec3Like>, tuning: Readonly<RainTuning>): void {
  const speed = tuning.speed * (0.8 + 0.4 * rain) * delta;
  phase.x = wrap(phase.x + (fall.x * speed) / tuning.boxWidth);
  phase.y = wrap(phase.y + (fall.y * speed) / tuning.boxHeight);
  phase.z = wrap(phase.z + (fall.z * speed) / tuning.boxWidth);
}

/**
 * Octaves are dealt to the two halves of the instances by the octave's parity: even instances always draw
 * an even k, odd ones an odd k. So as the zoom crosses into the next octave, the scale that was fully shown
 * keeps its drops, and the half that changes scale does so while its weight is 0.
 */
export interface OctaveSlots {
  /** Scale S drawn by the even and the odd instances. */
  evenScale: number;
  oddScale: number;
  /** Weight of the even instances' octave; the odd ones have 1 − evenWeight. */
  evenWeight: number;
}

export function octaveSlots(octave: Readonly<RainOctave>, out: OctaveSlots): OctaveSlots {
  const lower = octaveScale(octave.k);
  const lowerIsEven = octave.k % 2 === 0;
  out.evenScale = lowerIsEven ? lower : 2 * lower;
  out.oddScale = lowerIsEven ? 2 * lower : lower;
  out.evenWeight = lowerIsEven ? 1 - octave.mix : octave.mix;
  return out;
}

export interface RainCuts {
  /** Drops shown by the even and the odd instances, as a rank: drop r of a half shows if r < cut (soft over the band). */
  even: number;
  odd: number;
  /** Width of the soft edge, in ranks. */
  band: number;
  /** Instances to submit: both halves interleaved, up to the last drop that can show. */
  instances: number;
}

/** Drops per half for a strength (rain × density) and the even half's weight; writes into `out`. */
export function rainCuts(perOctave: number, strength: number, evenWeight: number, out: RainCuts): RainCuts {
  const shown = perOctave * Math.max(0, Math.min(1, strength));
  out.even = shown * evenWeight;
  out.odd = shown * (1 - evenWeight);
  out.band = Math.max(1, THIN_BAND * perOctave);
  const last = Math.min(perOctave, Math.ceil(Math.max(out.even, out.odd) + out.band / 2));
  out.instances = shown > 0 ? 2 * last : 0;
  return out;
}

/** Opacity share of drop `rank` under a cut: 1 well inside, 0 well past it. Mirrors the shaders. */
export function thinning(rank: number, cut: number, band: number): number {
  return Math.max(0, Math.min(1, (cut - rank) / band + 0.5));
}

const fract = (value: number): number => value - Math.floor(value);

/**
 * Where the streak shader puts a drop's head (CPU copy of STREAK_VERTEX, for tests): `seed` its four seeds,
 * `phase` the fall phase, `centre` the box centre on the ground, `scale` its octave's S. Writes into `out`.
 */
export function dropPosition(
  seed: readonly [number, number, number, number],
  phase: Readonly<Vec3Like>,
  centre: Readonly<Vec3Like>,
  scale: number,
  tuning: Readonly<RainTuning>,
  out: Vec3Like,
): Vec3Like {
  const speed = dropSpeed(seed[3]);
  const bx = tuning.boxWidth * scale;
  const by = tuning.boxHeight * scale;
  out.x = (fract(seed[0] + phase.x * speed - centre.x / bx) - 0.5) * bx + centre.x;
  out.y = fract(seed[1] + phase.y * speed) * by;
  out.z = (fract(seed[2] + phase.z * speed - centre.z / bx) - 0.5) * bx + centre.z;
  return out;
}
