/**
 * Day/night clock and keyframes (WP-16, v0.3). Pure: no three.js, no DOM.
 *
 * CONTRACT (integrator): every exported name and signature in the "Contract" section below.
 * Game.ts, Environment, NightLights, LifeSystem and the UI build against them. WP-16a owns the
 * implementation (keyframes, blending, sweep) and may add exports, but must not change these.
 *
 * Time: `t ∈ [0, 1)` is the fraction of a day (docs/plans/wp-16-day-night.md §1).
 *   dawn 0.00–0.10 · day 0.10–0.65 (afternoon 0.55 = the v0.2 look, exactly) · dusk 0.65–0.75 · night 0.75–1.00
 *
 * WP-16a: keyframed look (smoothstep between neighbours, colours blended in linear RGB, wrapping
 * across 1 → 0), a stylised sun path anchored so t = 0.55 is exactly today's SUN_DIRECTION, a fixed
 * moon, one key light that swaps sun ↔ moon where its intensity is 0 (sunrise 0.05, sunset 0.70),
 * and a clock that sweeps forward to a mode's target over MODE_SWEEP_S.
 */

// ---- Contract ---------------------------------------------------------------------------------

export type TimeMode = 'auto' | 'day' | 'night';
export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

/** Cycle order of the HUD time button and the T key. */
export const TIME_MODES: readonly TimeMode[] = ['auto', 'day', 'night'];

/** Real seconds per day in Auto mode (owner decision: 10 minutes, 25% night). */
export const DAY_LENGTH_S = 600;
/** Auto mode starts here on Start (New or Continue). */
export const T_MORNING = 0.12;
/** Day mode, the title screen and every test state except night-town: today's look, exactly. */
export const T_AFTERNOON = 0.55;
/** Night mode and the night-town test state: early night, every lit house on. */
export const T_NIGHT = 0.82;
/** Seconds a mode switch takes to sweep the clock forward to its target (0 under reduced motion). */
export const MODE_SWEEP_S = 2.5;

/** Display-space (sRGB) colour components 0..1, i.e. what a '#rrggbb' literal means. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Everything the world needs for one moment of the day. Written in place by sampleDay() into a
 * caller-owned object (no per-frame allocations).
 */
export interface DaySample {
  t: number;
  phase: DayPhase;
  /** Unit vector TOWARDS the key light: the sun by day, the moon at night (one DirectionalLight). */
  keyDir: Vec3;
  keyColor: Rgb;
  keyIntensity: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  skyTop: Rgb;
  /** Also the fog colour (the sky equals the fog below the horizon). */
  skyHorizon: Rgb;
  skyGlow: Rgb;
  /** Sun disc colour. */
  skyDisc: Rgb;
  /** Unit vector towards the sun disc drawn in the sky (may differ from keyDir at night). */
  sunDir: Vec3;
  /** 0..1 sun disc/halo visibility. */
  sunVisible: number;
  /** Unit vector towards the moon disc. */
  moonDir: Vec3;
  /** 0..1 moon disc/halo visibility. */
  moonVisible: number;
  /** 1 = today's bright clouds, ~0.25 at night. */
  cloudShade: number;
  /** 0..1 star field. */
  stars: number;
  /** scene.environmentIntensity (every graphics preset since WP-25). */
  envIntensity: number;
  /** 0 day .. 1 full night. Drives every light source (windows, lamps, lenses, headlights). */
  night: number;
  /** Fraction of houses with lit windows (0 → 1 across dusk). */
  lightsOn: number;
  /** Fraction switched off again late at night (0 → ~0.35). */
  lightsOff: number;
}

/** A fresh sample (afternoon values) for callers to own and pass to sampleDay() every frame. */
export function createDaySample(): DaySample {
  const rgb = (): Rgb => ({ r: 1, g: 1, b: 1 });
  const vec = (): Vec3 => ({ x: 0, y: 1, z: 0 });
  const out: DaySample = {
    t: T_AFTERNOON,
    phase: 'day',
    keyDir: vec(),
    keyColor: rgb(),
    keyIntensity: 0,
    hemiSky: rgb(),
    hemiGround: rgb(),
    hemiIntensity: 0,
    skyTop: rgb(),
    skyHorizon: rgb(),
    skyGlow: rgb(),
    skyDisc: rgb(),
    sunDir: vec(),
    sunVisible: 1,
    moonDir: vec(),
    moonVisible: 0,
    cloudShade: 1,
    stars: 0,
    envIntensity: 0,
    night: 0,
    lightsOn: 0,
    lightsOff: 0,
  };
  return sampleDay(T_AFTERNOON, out);
}

/** Phase of a time of day (boundaries 0.10 / 0.65 / 0.75). */
export function phaseAt(t: number): DayPhase {
  const u = wrap01(t);
  if (u < 0.1) return 'dawn';
  if (u < 0.65) return 'day';
  if (u < 0.75) return 'dusk';
  return 'night';
}

/** The fixed time a mode shows (Auto: the morning it starts at). */
export function modeTarget(mode: TimeMode): number {
  return mode === 'night' ? T_NIGHT : mode === 'day' ? T_AFTERNOON : T_MORNING;
}

/** Writes the look at time `t` into `out` and returns it. No allocations. */
export function sampleDay(t: number, out: DaySample): DaySample {
  const u = wrap01(t);
  out.t = u;
  out.phase = phaseAt(u);

  // Keyframed values: the segment [a, b) holding u. Before the first keyframe (or after the last)
  // u sits in the wrapping segment last → first.
  const frames = DAY_KEYFRAMES;
  const n = frames.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    if (frames[k].t > u) break;
    i = k;
  }
  const a = frames[i];
  const b = frames[(i + 1) % n];
  const span = wrap01(b.t - a.t) || 1;
  const w = smooth01(wrap01(u - a.t) / span);
  blendFrame(a, b, w, out);

  sunDirection(u, out.sunDir);
  out.moonDir.x = MOON_DIRECTION.x;
  out.moonDir.y = MOON_DIRECTION.y;
  out.moonDir.z = MOON_DIRECTION.z;
  keyDirection(u, out.sunDir, out.keyDir);

  out.night = nightAt(u);
  out.lightsOn = lightsOnAt(u);
  out.lightsOff = lightsOffAt(u);
  return out;
}

/**
 * The game clock. Auto advances `t` by delta / dayLengthS (default DAY_LENGTH_S); Day and Night hold their target.
 * Switching mode sweeps `t` forward to the new target over MODE_SWEEP_S (or snaps). A pin (tests,
 * title screen) overrides everything until released.
 */
export class DayClock {
  private currentMode: TimeMode;
  private time: number;
  private pinned: number | null = null;
  /** Real seconds per Auto day. Debug only (Game sets it from `?debug&day=N` for evidence captures). */
  dayLengthS = DAY_LENGTH_S;
  // Mode sweep (no allocations): from `sweepFrom`, forward by `sweepDistance`, eased over MODE_SWEEP_S.
  private sweeping = false;
  private sweepFrom = 0;
  private sweepDistance = 0;
  private sweepTarget = 0;
  private sweepElapsed = 0;

  constructor(mode: TimeMode = 'auto') {
    this.currentMode = mode;
    this.time = modeTarget(mode);
  }

  get mode(): TimeMode {
    return this.currentMode;
  }

  /** The time of day being shown (the pin if pinned). */
  get t(): number {
    return this.pinned ?? this.time;
  }

  get phase(): DayPhase {
    return phaseAt(this.t);
  }

  get isPinned(): boolean {
    return this.pinned !== null;
  }

  /** True while a mode switch is still sweeping the clock towards its target. */
  get isSweeping(): boolean {
    return this.sweeping;
  }

  /** Jump to the end of a running mode sweep (reduced motion switched on mid-sweep). */
  finishSweep(): void {
    if (!this.sweeping) return;
    this.time = this.sweepTarget;
    this.sweeping = false;
  }

  /** Advance by real seconds (Game passes animDelta: 0 under reduced motion ⇒ frozen). */
  advance(delta: number): void {
    if (!(delta > 0)) return;
    if (this.sweeping) {
      this.sweepElapsed += delta;
      const p = this.sweepElapsed / MODE_SWEEP_S;
      if (p >= 1) {
        this.time = this.sweepTarget;
        this.sweeping = false;
      } else {
        this.time = wrap01(this.sweepFrom + this.sweepDistance * easeInOut(p));
      }
      return;
    }
    if (this.currentMode === 'auto') this.time = wrap01(this.time + delta / this.dayLengthS);
  }

  /** Change mode. `snap` jumps straight to the target (reduced motion); otherwise it sweeps. */
  setMode(mode: TimeMode, snap = false): void {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    if (mode === 'auto') {
      // Auto continues from wherever the clock is now (mid-sweep included).
      this.sweeping = false;
      return;
    }
    const target = modeTarget(mode);
    const distance = wrap01(target - this.time); // forward only: Night → Day plays a quick dawn
    if (snap || distance === 0) {
      this.time = target;
      this.sweeping = false;
      return;
    }
    this.sweeping = true;
    this.sweepFrom = this.time;
    this.sweepDistance = distance;
    this.sweepTarget = target;
    this.sweepElapsed = 0;
  }

  /** Start of a building session (Start → New or Continue): Auto ⇒ morning, else the mode's time. */
  startDay(): void {
    this.time = modeTarget(this.currentMode);
    this.sweeping = false;
  }

  /** Pin the displayed time (tests, title screen); null releases it. */
  pin(t: number | null): void {
    this.pinned = t === null ? null : wrap01(t);
  }

  /** The current look into `out`. */
  sample(out: DaySample): DaySample {
    return sampleDay(this.t, out);
  }
}

// ---- Keyframes (WP-16a) ------------------------------------------------------------------------

/** One authored moment of the day. Colours are display-space (sRGB), like '#rrggbb'. */
export interface DayKeyframe {
  name: string;
  t: number;
  keyColor: Rgb;
  keyIntensity: number;
  hemiSky: Rgb;
  hemiGround: Rgb;
  hemiIntensity: number;
  skyTop: Rgb;
  skyHorizon: Rgb;
  skyGlow: Rgb;
  skyDisc: Rgb;
  sunVisible: number;
  moonVisible: number;
  cloudShade: number;
  stars: number;
  envIntensity: number;
}

interface KeyframeSpec {
  key: number;
  keyI: number;
  hemiSky: number;
  hemiGround: number;
  hemiI: number;
  top: number;
  horizon: number;
  glow: number;
  disc: number;
  sun: number;
  moon: number;
  clouds: number;
  stars: number;
  env: number;
}

function keyframe(name: string, t: number, s: KeyframeSpec): DayKeyframe {
  return {
    name,
    t,
    keyColor: hexRgb(s.key),
    keyIntensity: s.keyI,
    hemiSky: hexRgb(s.hemiSky),
    hemiGround: hexRgb(s.hemiGround),
    hemiIntensity: s.hemiI,
    skyTop: hexRgb(s.top),
    skyHorizon: hexRgb(s.horizon),
    skyGlow: hexRgb(s.glow),
    skyDisc: hexRgb(s.disc),
    sunVisible: s.sun,
    moonVisible: s.moon,
    cloudShade: s.clouds,
    stars: s.stars,
    envIntensity: s.env,
  };
}

/**
 * The v0.2 "golden afternoon" (Environment.ts LIGHTING / SKY_PALETTE / SUN_DIRECTION).
 * sampleDay(T_AFTERNOON) reproduces these exactly; Environment keeps its own exports (IconStudio
 * imports LIGHTING) and the unit test pins both copies to the same numbers.
 */
export const AFTERNOON = {
  sunColor: 0xffe6c4,
  sunIntensity: 3.0,
  hemiSky: 0xcfe6ff,
  hemiGround: 0x7d9a5c,
  hemiIntensity: 0.8,
  envIntensity: 0.18,
  skyTop: 0x4f9fe3,
  skyHorizon: 0xd4ebf6,
  skyGlow: 0xffd49a,
  skyDisc: 0xfff1d2,
  /** Direction towards the sun (not normalised), from the build camera's left. */
  sunDirection: { x: -0.66, y: 0.74, z: 0.42 },
} as const;

const NIGHT_SPEC: KeyframeSpec = {
  key: 0x8aa2ff, keyI: 0.95,
  hemiSky: 0x3c54b4, hemiGround: 0x1c2444, hemiI: 0.85,
  top: 0x0b1430, horizon: 0x22325a, glow: 0x243558, disc: 0xfff1d2,
  sun: 0, moon: 1, clouds: 0.25, stars: 1, env: 0.0,
};

/**
 * Keyframes in time order (debug-tunable in the lil-gui `Daylight` folder). Key intensity is 0 at
 * sunrise (0.05) and sunset (0.70): that is where the one key light swaps between sun and moon.
 */
export const DAY_KEYFRAMES: DayKeyframe[] = [
  keyframe('pre-dawn', 0.015, {
    key: 0x8aa2ff, keyI: 0.5,
    hemiSky: 0x4a5cae, hemiGround: 0x282e4c, hemiI: 0.98,
    top: 0x101c3e, horizon: 0x2c3a62, glow: 0x4a5282, disc: 0xffd2a0,
    sun: 0, moon: 0.9, clouds: 0.3, stars: 0.8, env: 0.01,
  }),
  keyframe('sunrise', 0.05, {
    key: 0xffb890, keyI: 0,
    hemiSky: 0xc8a6c0, hemiGround: 0x584858, hemiI: 1.15,
    top: 0x3a5594, horizon: 0xe2a592, glow: 0xff9d6e, disc: 0xffc896,
    sun: 0.7, moon: 0.25, clouds: 0.55, stars: 0.15, env: 0.05,
  }),
  keyframe('dawn', 0.085, {
    key: 0xffc8a0, keyI: 1.0,
    hemiSky: 0xbac6e8, hemiGround: 0x6c7c55, hemiI: 0.85,
    top: 0x6d8fc9, horizon: 0xf6c1a0, glow: 0xffb27f, disc: 0xffdcb0,
    sun: 1, moon: 0, clouds: 0.85, stars: 0, env: 0.12,
  }),
  keyframe('morning', T_MORNING, {
    key: 0xffe4c2, keyI: 2.4,
    hemiSky: 0xcde3fb, hemiGround: 0x7a9658, hemiI: 0.8,
    top: 0x5a9ee2, horizon: 0xdcecf4, glow: 0xffd6a8, disc: 0xfff0d6,
    sun: 1, moon: 0, clouds: 1, stars: 0, env: 0.16,
  }),
  keyframe('midday', 0.35, {
    key: 0xfff4e0, keyI: 3.1,
    hemiSky: 0xd4eaff, hemiGround: 0x7f9e5e, hemiI: 0.72,
    top: 0x4a9ae6, horizon: 0xd6edf8, glow: 0xffe0b0, disc: 0xfff6e4,
    sun: 1, moon: 0, clouds: 1, stars: 0, env: 0.2,
  }),
  keyframe('afternoon', T_AFTERNOON, {
    key: AFTERNOON.sunColor, keyI: AFTERNOON.sunIntensity,
    hemiSky: AFTERNOON.hemiSky, hemiGround: AFTERNOON.hemiGround, hemiI: AFTERNOON.hemiIntensity,
    top: AFTERNOON.skyTop, horizon: AFTERNOON.skyHorizon, glow: AFTERNOON.skyGlow, disc: AFTERNOON.skyDisc,
    sun: 1, moon: 0, clouds: 1, stars: 0, env: AFTERNOON.envIntensity,
  }),
  keyframe('golden', 0.62, {
    key: 0xffc98a, keyI: 2.4,
    hemiSky: 0xd6dcf2, hemiGround: 0x7d9258, hemiI: 0.8,
    top: 0x5790d4, horizon: 0xf7d6a8, glow: 0xffbe78, disc: 0xffe0ae,
    sun: 1, moon: 0, clouds: 0.95, stars: 0, env: 0.16,
  }),
  keyframe('dusk', 0.67, {
    key: 0xff9a5c, keyI: 1.0,
    hemiSky: 0xb4a4d8, hemiGround: 0x6a5a4a, hemiI: 0.9,
    top: 0x4a5d9a, horizon: 0xf3a26b, glow: 0xff8a4d, disc: 0xffb27a,
    sun: 1, moon: 0.15, clouds: 0.7, stars: 0.05, env: 0.09,
  }),
  keyframe('sunset', 0.7, {
    key: 0xd8a0c0, keyI: 0,
    hemiSky: 0xa88ac8, hemiGround: 0x4a3c50, hemiI: 1.15,
    top: 0x283a78, horizon: 0xb4808e, glow: 0xe07a5a, disc: 0xff9a66,
    sun: 0.3, moon: 0.6, clouds: 0.45, stars: 0.35, env: 0.03,
  }),
  keyframe('blue hour', 0.75, {
    key: 0x8aa2ff, keyI: 0.55,
    hemiSky: 0x4a5cb4, hemiGround: 0x2a2c50, hemiI: 1.0,
    top: 0x142254, horizon: 0x2c3d6a, glow: 0x3c4c80, disc: 0xfff1d2,
    sun: 0, moon: 1, clouds: 0.32, stars: 0.8, env: 0.01,
  }),
  keyframe('night', T_NIGHT, NIGHT_SPEC),
  keyframe('late night', 0.95, NIGHT_SPEC),
];

/** Tunables that are not keyframed (debug `Daylight` folder). */
export const DAY_TUNING = {
  /** The key light never drops below this elevation (degrees): no endless shadows at dawn/dusk. */
  minKeyElevationDeg: 15,
};

// ---- Sun and moon ------------------------------------------------------------------------------

const DEG = Math.PI / 180;
/** Sunrise and sunset: key light intensity 0, where it swaps between sun and moon. */
export const T_SUNRISE = 0.05;
export const T_SUNSET = 0.7;
const T_NOON = 0.35;
/** Peak sun elevation at noon. */
const SUN_MAX_ELEVATION = 55 * DEG;
/** How deep the (invisible) sun dips at midnight. */
const SUN_NIGHT_DEPTH = 40 * DEG;
/** Azimuth swept from sunrise to sunset (east → towards the camera → west). */
const SUN_DAY_SWEEP = 190 * DEG;

/** Today's SUN_DIRECTION, normalised the way THREE.Vector3.normalize() does it. */
const SUN_ANCHOR: Readonly<Vec3> = (() => {
  const { x, y, z } = AFTERNOON.sunDirection;
  const inv = 1 / Math.sqrt(x * x + y * y + z * z);
  return { x: x * inv, y: y * inv, z: z * inv };
})();
const ANCHOR_ELEVATION = Math.asin(SUN_ANCHOR.y);
const ANCHOR_AZIMUTH = Math.atan2(SUN_ANCHOR.z, SUN_ANCHOR.x);
/**
 * Shape of the afternoon descent: e = E_max · cos(π/2 · s^q), s = (u − noon) / (sunset − noon), with
 * q chosen so the path passes exactly through the anchor at 0.55 (q ≈ 1.55: smooth at both ends).
 */
const SET_EXPONENT =
  Math.log(Math.acos(ANCHOR_ELEVATION / SUN_MAX_ELEVATION) / (Math.PI / 2)) /
  Math.log((T_AFTERNOON - T_NOON) / (T_SUNSET - T_NOON));
const DAY_AZ_RATE = SUN_DAY_SWEEP / (T_SUNSET - T_SUNRISE);
const AZ_RISE = ANCHOR_AZIMUTH + (T_SUNRISE - T_AFTERNOON) * DAY_AZ_RATE;
const AZ_SET = ANCHOR_AZIMUTH + (T_SUNSET - T_AFTERNOON) * DAY_AZ_RATE;
const NIGHT_LENGTH = 1 + T_SUNRISE - T_SUNSET;

/** Fixed moon (and night key light): from the build camera's right, ~40° up, a little towards the camera. */
export const MOON_DIRECTION: Readonly<Vec3> = (() => {
  const hx = 1;
  const hz = -0.35;
  const hl = Math.hypot(hx, hz);
  const e = 40 * DEG;
  return { x: (hx / hl) * Math.cos(e), y: Math.sin(e), z: (hz / hl) * Math.cos(e) };
})();

/** Sun elevation (radians): 0 at sunrise, 55° at noon, through the anchor at 0.55, 0 at sunset, below at night. */
export function sunElevation(t: number): number {
  const u = wrap01(t);
  if (u >= T_SUNRISE && u < T_NOON) {
    return SUN_MAX_ELEVATION * Math.sin((Math.PI / 2) * ((u - T_SUNRISE) / (T_NOON - T_SUNRISE)));
  }
  if (u >= T_NOON && u < T_SUNSET) {
    const s = Math.pow((u - T_NOON) / (T_SUNSET - T_NOON), SET_EXPONENT);
    return SUN_MAX_ELEVATION * Math.cos((Math.PI / 2) * s);
  }
  const v = u < T_SUNRISE ? u + 1 : u;
  return -SUN_NIGHT_DEPTH * Math.sin(Math.PI * ((v - T_SUNSET) / NIGHT_LENGTH));
}

function sunAzimuth(u: number): number {
  if (u >= T_SUNRISE && u < T_SUNSET) return ANCHOR_AZIMUTH + (u - T_AFTERNOON) * DAY_AZ_RATE;
  const v = u < T_SUNRISE ? u + 1 : u;
  return AZ_SET + (AZ_RISE + Math.PI * 2 - AZ_SET) * ((v - T_SUNSET) / NIGHT_LENGTH);
}

function sunDirection(u: number, out: Vec3): void {
  if (u === T_AFTERNOON) {
    // The analytic path lands here to ~1e-16; copy the anchor so the v0.2 look is bit-identical.
    out.x = SUN_ANCHOR.x;
    out.y = SUN_ANCHOR.y;
    out.z = SUN_ANCHOR.z;
    return;
  }
  dirFromAngles(sunElevation(u), sunAzimuth(u), out);
}

/** Sun (elevation clamped to minKeyElevationDeg) between sunrise and sunset, otherwise the moon. */
function keyDirection(u: number, sunDir: Readonly<Vec3>, out: Vec3): void {
  if (u < T_SUNRISE || u >= T_SUNSET) {
    out.x = MOON_DIRECTION.x;
    out.y = MOON_DIRECTION.y;
    out.z = MOON_DIRECTION.z;
    return;
  }
  const minElevation = DAY_TUNING.minKeyElevationDeg * DEG;
  if (sunDir.y >= Math.sin(minElevation)) {
    out.x = sunDir.x;
    out.y = sunDir.y;
    out.z = sunDir.z;
    return;
  }
  dirFromAngles(minElevation, sunAzimuth(u), out);
}

function dirFromAngles(elevation: number, azimuth: number, out: Vec3): void {
  const c = Math.cos(elevation);
  out.x = c * Math.cos(azimuth);
  out.y = Math.sin(elevation);
  out.z = c * Math.sin(azimuth);
}

// ---- Night curves ------------------------------------------------------------------------------

const LIGHTS_OFF_MAX = 0.35;

/** 0 by day → 1 through dusk (0.64–0.76), 1 all night, back to 0 across dawn (0.01–0.09). */
export function nightAt(t: number): number {
  const u = wrap01(t);
  if (u >= 0.64) return smoothstep(0.64, 0.76, u);
  if (u < 0.1) return 1 - smoothstep(0.01, 0.09, u);
  return 0;
}

/** Houses switch on across dusk (all on by 0.78) and off across dawn (0.02–0.08). */
export function lightsOnAt(t: number): number {
  const u = wrap01(t);
  if (u >= 0.66) return smoothstep(0.66, 0.78, u);
  if (u < 0.1) return 1 - smoothstep(0.02, 0.08, u);
  return 0;
}

/** Late at night (after 0.90) about a third go dark again; reset through dawn once all are off. */
export function lightsOffAt(t: number): number {
  const u = wrap01(t);
  if (u >= 0.75) return LIGHTS_OFF_MAX * smoothstep(0.9, 0.99, u);
  if (u < 0.1) return LIGHTS_OFF_MAX * (1 - smoothstep(0.06, 0.1, u));
  return 0;
}

// ---- Helpers (WP-16a may change) ----------------------------------------------------------------

export function wrap01(t: number): number {
  return t - Math.floor(t);
}

function smooth01(x: number): number {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  return smooth01((x - edge0) / (edge1 - edge0));
}

/** Symmetric cubic ease-in-out on [0, 1]. */
function easeInOut(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

function lerp(a: number, b: number, w: number): number {
  return w === 0 ? a : w === 1 ? b : a + (b - a) * w;
}

function blendFrame(a: DayKeyframe, b: DayKeyframe, w: number, out: DaySample): void {
  blendRgb(a.keyColor, b.keyColor, w, out.keyColor);
  out.keyIntensity = lerp(a.keyIntensity, b.keyIntensity, w);
  blendRgb(a.hemiSky, b.hemiSky, w, out.hemiSky);
  blendRgb(a.hemiGround, b.hemiGround, w, out.hemiGround);
  out.hemiIntensity = lerp(a.hemiIntensity, b.hemiIntensity, w);
  blendRgb(a.skyTop, b.skyTop, w, out.skyTop);
  blendRgb(a.skyHorizon, b.skyHorizon, w, out.skyHorizon);
  blendRgb(a.skyGlow, b.skyGlow, w, out.skyGlow);
  blendRgb(a.skyDisc, b.skyDisc, w, out.skyDisc);
  out.sunVisible = lerp(a.sunVisible, b.sunVisible, w);
  out.moonVisible = lerp(a.moonVisible, b.moonVisible, w);
  out.cloudShade = lerp(a.cloudShade, b.cloudShade, w);
  out.stars = lerp(a.stars, b.stars, w);
  out.envIntensity = lerp(a.envIntensity, b.envIntensity, w);
}

/** Blend two display-space colours in linear RGB. Exact at w = 0 / 1 (no round trip). */
function blendRgb(a: Readonly<Rgb>, b: Readonly<Rgb>, w: number, out: Rgb): void {
  if (w === 0 || w === 1) {
    const src = w === 0 ? a : b;
    out.r = src.r;
    out.g = src.g;
    out.b = src.b;
    return;
  }
  out.r = linearToSrgb(lerp(srgbToLinear(a.r), srgbToLinear(b.r), w));
  out.g = linearToSrgb(lerp(srgbToLinear(a.g), srgbToLinear(b.g), w));
  out.b = linearToSrgb(lerp(srgbToLinear(a.b), srgbToLinear(b.b), w));
}

/** sRGB transfer functions (the same maths as THREE.ColorManagement). */
function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

function linearToSrgb(c: number): number {
  return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Display components of 0xrrggbb, exactly as THREE.Color.setHex computes them. */
export function hexRgb(hex: number): Rgb {
  return { r: ((hex >> 16) & 0xff) / 255, g: ((hex >> 8) & 0xff) / 255, b: (hex & 0xff) / 255 };
}
