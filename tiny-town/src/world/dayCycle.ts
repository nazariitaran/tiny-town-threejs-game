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
 * STUB (contract commit): sampleDay() always returns the afternoon look and the clock only tracks
 * mode/pin. WP-16a replaces the bodies.
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
  /** scene.environmentIntensity on the high tier. */
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

/** Writes the look at time `t` into `out` and returns it. STUB: afternoon only (WP-16a). */
export function sampleDay(t: number, out: DaySample): DaySample {
  out.t = wrap01(t);
  out.phase = phaseAt(t);
  // Afternoon = Environment.ts LIGHTING / SKY_PALETTE / SUN_DIRECTION (v0.2 look).
  setVec(out.keyDir, -0.66, 0.74, 0.42);
  setHex(out.keyColor, 0xffe6c4);
  out.keyIntensity = 3.0;
  setHex(out.hemiSky, 0xcfe6ff);
  setHex(out.hemiGround, 0x7d9a5c);
  out.hemiIntensity = 0.8;
  setHex(out.skyTop, 0x4f9fe3);
  setHex(out.skyHorizon, 0xd4ebf6);
  setHex(out.skyGlow, 0xffd49a);
  setHex(out.skyDisc, 0xfff1d2);
  setVec(out.sunDir, -0.66, 0.74, 0.42);
  out.sunVisible = 1;
  setVec(out.moonDir, 0.5, 0.64, 0.58);
  out.moonVisible = 0;
  out.cloudShade = 1;
  out.stars = 0;
  out.envIntensity = 0.18;
  out.night = 0;
  out.lightsOn = 0;
  out.lightsOff = 0;
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

  /** Advance by real seconds (Game passes animDelta: 0 under reduced motion ⇒ frozen). */
  advance(delta: number): void {
    if (this.currentMode === 'auto' && delta > 0) this.time = wrap01(this.time + delta / this.dayLengthS);
  }

  /** Change mode. `snap` jumps straight to the target (reduced motion); otherwise it sweeps. */
  setMode(mode: TimeMode, snap = false): void {
    void snap; // STUB: no sweep yet (WP-16a)
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    if (mode !== 'auto') this.time = modeTarget(mode);
  }

  /** Start of a building session (Start → New or Continue): Auto ⇒ morning, else the mode's time. */
  startDay(): void {
    this.time = modeTarget(this.currentMode);
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

// ---- Helpers (WP-16a may change) ----------------------------------------------------------------

export function wrap01(t: number): number {
  return t - Math.floor(t);
}

function setVec(v: Vec3, x: number, y: number, z: number): void {
  const len = Math.hypot(x, y, z) || 1;
  v.x = x / len;
  v.y = y / len;
  v.z = z / len;
}

function setHex(c: Rgb, hex: number): void {
  c.r = ((hex >> 16) & 0xff) / 255;
  c.g = ((hex >> 8) & 0xff) / 255;
  c.b = (hex & 0xff) / 255;
}
