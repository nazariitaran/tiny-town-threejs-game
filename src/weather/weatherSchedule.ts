/**
 * Rain showers. Pure: no three.js, no DOM.
 *
 * Mostly the town is dry. Now and then a shower comes: clouds gather, rain falls for a while, the sky
 * clears. A shower is light rain, rain or a storm; a storm builds through rain to a heavy peak with
 * lightning and thunder. The schedule only sets targets; the shown levels move towards them at fixed
 * rates, so nothing here can snap the sky. Runs on real seconds, whatever the time of day. Nothing is saved.
 */
import type { DaySample, Rgb } from '../world/dayCycle';

export type RainKind = 'light' | 'rain' | 'storm';
export const RAIN_KINDS: readonly RainKind[] = ['light', 'rain', 'storm'];

export function isRainKind(value: unknown): value is RainKind {
  return (RAIN_KINDS as readonly unknown[]).includes(value);
}

/** Share of showers of each kind, in RAIN_KINDS order. */
export const RAIN_WEIGHTS: readonly number[] = [45, 35, 20];
/** Rain strength at a kind's peak, 0..1. */
export const RAIN_LEVEL: Readonly<Record<RainKind, number>> = { light: 0.28, rain: 0.6, storm: 1 };
/** Cloud cover and gloom at a kind's peak, 0..1. */
export const OVERCAST_LEVEL: Readonly<Record<RainKind, number>> = { light: 0.5, rain: 0.78, storm: 1 };

/** Real seconds between the end of one shower and the first clouds of the next. */
export const DRY_MIN_S = 360;
export const DRY_MAX_S = 960;
/** Real seconds of falling rain, per kind. */
export const BODY_S: Readonly<Record<RainKind, readonly [number, number]>> = { light: [60, 120], rain: [75, 150], storm: [100, 160] };
/** Clouds gather for this long before the first drops. */
export const GATHER_S = 22;
/** Seconds for the clouds to come or go fully, and for the rain to. */
export const OVERCAST_FADE_S = 24;
export const RAIN_FADE_S = 9;
/** A storm is heavy rain between these shares of its body; before and after it is plain rain. */
const STORM_PEAK_FROM = 0.25;
const STORM_PEAK_TO = 0.8;

/** Lightning strikes only while the rain is at least this strong. */
export const LIGHTNING_FROM = 0.85;
/** Real seconds between strikes. */
export const STRIKE_MIN_S = 5;
export const STRIKE_MAX_S = 15;
/** Seconds from the flash to the thunder: the further the strike, the later and quieter. */
export const THUNDER_MIN_DELAY_S = 0.25;
export const THUNDER_MAX_DELAY_S = 2.8;
/** A strike is two pulses, 2 flashes in under half a second, then at least STRIKE_MIN_S of nothing. */
export const FLASH_S = 0.46;

/** 0..1 brightness of a strike `age` seconds after it began: a sharp pulse, a gap, a longer afterglow. */
export function flashAt(age: number): number {
  if (!(age >= 0) || age >= FLASH_S) return 0;
  if (age < 0.07) return 1;
  if (age < 0.15) return 0.12;
  const k = (age - 0.15) / (FLASH_S - 0.15);
  return 0.75 * (1 - k) * (1 - k);
}

export interface WeatherSample {
  /** The shower in progress, from its first clouds to its last. */
  kind: RainKind | null;
  /** 0..1 falling rain. */
  rain: number;
  /** 0..1 cloud cover and gloom. */
  overcast: number;
  /** 0..1 lightning brightness this frame. */
  flash: number;
  /** Unit heading (xz) of the last strike, as seen from the town. */
  flashX: number;
  flashZ: number;
  /** Multiplier on the breeze: 1 dry, about 2.4 in a storm. */
  wind: number;
}

export interface Strike {
  /** Seconds from the flash to its thunder. */
  delay: number;
  /** 0..1 loudness: 1 overhead. */
  strength: number;
}

export interface WeatherDiagnostics extends WeatherSample {
  phase: 'dry' | 'gather' | 'rain' | 'clear';
  /** Seconds left in the phase; null while a kind is forced. */
  remaining: number | null;
  forced: RainKind | 'clear' | null;
  /** Showers begun and lightning strikes since the last reset. */
  showers: number;
  strikes: number;
}

function smooth01(x: number): number {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

export class WeatherSchedule {
  /** Spontaneous showers; a test state turns them off until a reload. */
  auto = true;
  /** No flashes (the OS "reduce motion" setting); thunder still rolls. */
  flashes = true;
  readonly sample: WeatherSample = { kind: null, rain: 0, overcast: 0, flash: 0, flashX: 1, flashZ: 0, wind: 1 };
  private phase: WeatherDiagnostics['phase'] = 'dry';
  private kind: RainKind | null = null;
  private remaining = 0;
  private bodySeconds = 0;
  private forced: RainKind | 'clear' | null = null;
  private rain = 0;
  private overcast = 0;
  private nextStrike = 0;
  private strikeAge = Infinity;
  private showers = 0;
  private strikes = 0;
  private readonly pending: Strike = { delay: 0, strength: 0 };
  private hasPending = false;

  constructor(private rng: () => number) {
    this.reset(rng);
  }

  /** A new session or test state: dry, with the first shower a dry spell away. */
  reset(rng: () => number = this.rng): void {
    this.rng = rng;
    this.phase = 'dry';
    this.kind = null;
    this.forced = null;
    this.rain = 0;
    this.overcast = 0;
    this.strikeAge = Infinity;
    this.hasPending = false;
    this.showers = 0;
    this.strikes = 0;
    this.remaining = this.dryspell();
    this.write();
  }

  /** Test hook and debug: hold a kind, hold clear skies, or (null) return to the schedule. `now`: no fade. */
  force(kind: RainKind | 'clear' | null, now = false): void {
    this.forced = kind;
    if (kind === null) {
      // Back on the schedule: whatever is showing clears, then a dry spell.
      this.phase = 'dry';
      this.kind = null;
      this.remaining = this.dryspell();
    } else if (kind !== 'clear') {
      this.nextStrike = Math.min(this.nextStrike, 2);
    }
    if (now) {
      this.rain = this.targetRain();
      this.overcast = this.targetOvercast();
      this.strikeAge = Infinity;
    }
    this.write();
  }

  /** Starts a shower of `kind` now, as the schedule would (debug). */
  begin(kind: RainKind): void {
    this.forced = null;
    this.startShower(kind);
  }

  /** `delta`: real seconds of unfrozen play. */
  advance(delta: number): void {
    if (!(delta > 0)) return;
    if (this.forced === null && this.auto) this.step(delta);
    this.rain = approach(this.rain, this.targetRain(), delta / RAIN_FADE_S);
    this.overcast = approach(this.overcast, this.targetOvercast(), delta / OVERCAST_FADE_S);
    this.strikeAge += delta;
    if (this.stormy() && this.rain >= LIGHTNING_FROM) {
      this.nextStrike -= delta;
      if (this.nextStrike <= 0) this.strike();
    }
    this.write();
  }

  /** The thunder of a strike that began since the last call, once. */
  takeStrike(): Readonly<Strike> | null {
    if (!this.hasPending) return null;
    this.hasPending = false;
    return this.pending;
  }

  get diagnostics(): WeatherDiagnostics {
    return {
      ...this.sample,
      phase: this.phase,
      remaining: this.forced === null ? this.remaining : null,
      forced: this.forced,
      showers: this.showers,
      strikes: this.strikes,
    };
  }

  private step(delta: number): void {
    this.remaining -= delta;
    if (this.remaining > 0) return;
    if (this.phase === 'dry') {
      const roll = this.rng() * RAIN_WEIGHTS.reduce((sum, w) => sum + w, 0);
      let acc = 0;
      let kind: RainKind = 'light';
      for (let i = 0; i < RAIN_KINDS.length; i += 1) {
        acc += RAIN_WEIGHTS[i];
        if (roll < acc) {
          kind = RAIN_KINDS[i];
          break;
        }
      }
      this.startShower(kind);
    } else if (this.phase === 'gather') {
      const [min, max] = BODY_S[this.kind ?? 'light'];
      this.phase = 'rain';
      this.bodySeconds = min + (max - min) * this.rng();
      this.remaining = this.bodySeconds;
      this.nextStrike = STRIKE_MIN_S * 0.5;
    } else if (this.phase === 'rain') {
      this.phase = 'clear';
      this.remaining = RAIN_FADE_S + OVERCAST_FADE_S;
    } else {
      this.phase = 'dry';
      this.kind = null;
      this.remaining = this.dryspell();
    }
  }

  private startShower(kind: RainKind): void {
    this.kind = kind;
    this.phase = 'gather';
    this.remaining = GATHER_S;
    this.showers += 1;
  }

  private dryspell(): number {
    return DRY_MIN_S + (DRY_MAX_S - DRY_MIN_S) * this.rng();
  }

  private stormy(): boolean {
    return this.forced === null ? this.kind === 'storm' && this.phase === 'rain' : this.forced === 'storm';
  }

  private targetRain(): number {
    if (this.forced !== null) return this.forced === 'clear' ? 0 : RAIN_LEVEL[this.forced];
    if (this.phase !== 'rain' || !this.kind) return 0;
    if (this.kind !== 'storm') return RAIN_LEVEL[this.kind];
    const done = 1 - this.remaining / this.bodySeconds;
    return done >= STORM_PEAK_FROM && done < STORM_PEAK_TO ? RAIN_LEVEL.storm : RAIN_LEVEL.rain;
  }

  private targetOvercast(): number {
    if (this.forced !== null) return this.forced === 'clear' ? 0 : OVERCAST_LEVEL[this.forced];
    if (!this.kind || this.phase === 'dry') return 0;
    // The rain stops first; the clouds break once it has.
    if (this.phase === 'clear') return this.remaining > OVERCAST_FADE_S ? OVERCAST_LEVEL[this.kind] : 0;
    return OVERCAST_LEVEL[this.kind];
  }

  private strike(): void {
    this.nextStrike = STRIKE_MIN_S + (STRIKE_MAX_S - STRIKE_MIN_S) * this.rng();
    this.strikeAge = 0;
    this.strikes += 1;
    const near = this.rng();
    const heading = this.rng() * Math.PI * 2;
    this.sample.flashX = Math.cos(heading);
    this.sample.flashZ = Math.sin(heading);
    this.pending.delay = THUNDER_MIN_DELAY_S + (THUNDER_MAX_DELAY_S - THUNDER_MIN_DELAY_S) * near;
    this.pending.strength = 1 - 0.65 * near;
    this.hasPending = true;
  }

  private write(): void {
    const s = this.sample;
    s.kind = this.forced !== null ? (this.forced === 'clear' ? null : this.forced) : this.kind;
    s.rain = this.rain;
    s.overcast = smooth01(this.overcast);
    s.flash = this.flashes ? flashAt(this.strikeAge) : 0;
    s.wind = 1 + 0.5 * this.overcast + 0.9 * this.rain * this.rain;
  }
}

const GREY: Readonly<Rgb> = { r: 0.72, g: 0.76, b: 0.82 };

function luma(c: Readonly<Rgb>): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** `c` towards a cool grey of `gain` × its own brightness, by `k`. */
function grey(c: Rgb, k: number, gain: number): void {
  const l = (luma(c) / luma(GREY)) * gain;
  c.r += (GREY.r * l - c.r) * k;
  c.g += (GREY.g * l - c.g) * k;
  c.b += (GREY.b * l - c.b) * k;
}

function lift(c: Rgb, k: number): void {
  c.r += (0.86 - c.r) * k;
  c.g += (0.9 - c.g) * k;
  c.b += (1 - c.b) * k;
}

/**
 * The day sample under this weather, in place: a hidden sun, grey sky and fog, flatter and dimmer light,
 * and a lightning flash on top. With overcast 0 and flash 0 it changes nothing.
 */
export function shadeDaySample(s: DaySample, overcast: number, flash: number): void {
  if (overcast > 0) {
    const k = overcast;
    // The night is dark already: clouds take the moonlight, not much more.
    const dim = k * (1 - 0.7 * s.night);
    s.keyIntensity *= 1 - 0.85 * k * (1 - 0.55 * s.night);
    grey(s.keyColor, 0.8 * k, 1);
    s.hemiIntensity *= 1 - 0.3 * dim * k;
    grey(s.hemiSky, 0.85 * k, 0.95);
    grey(s.hemiGround, 0.5 * k, 0.9);
    grey(s.skyTop, 0.92 * k, 1 - 0.45 * dim);
    grey(s.skyHorizon, 0.9 * k, 1 - 0.5 * dim);
    grey(s.skyGlow, 0.95 * k, 1 - 0.5 * dim);
    s.sunVisible *= 1 - k;
    s.moonVisible *= 1 - k;
    s.stars *= 1 - k;
    s.cloudShade *= 1 - 0.5 * k;
    s.envIntensity *= 1 - 0.4 * dim;
  }
  if (flash > 0) {
    s.hemiIntensity += 2.6 * flash;
    lift(s.hemiSky, 0.8 * flash);
    lift(s.skyHorizon, 0.45 * flash);
    lift(s.skyTop, 0.3 * flash);
  }
}

/** How dark a storm makes the day for the town's lights, as a `night` value: lamps and windows come on. */
export function gloomAt(overcast: number): number {
  return 0.55 * smooth01((overcast - 0.7) / 0.3);
}
