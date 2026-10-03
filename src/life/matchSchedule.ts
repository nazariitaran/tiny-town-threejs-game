/**
 * Match nights at the stadium. Pure: no three.js, no DOM.
 *
 * Every other night is a match night, the first one included. A night begins when the clock passes
 * sunset (the middle of dusk) and stays in the evening: a mode sweep that only passes through it on the
 * way to Day mode counts for nothing. A held night (Night mode) begins a new one every Auto day's length,
 * so matches come as often in Night mode as in Auto. On a match night the floodlights and the crowd come
 * on at sunset and go off once MATCH_NIGHT_S of night have passed. Nothing here is saved.
 */
import { CELL_SIZE, cellToWorld } from '../game/config';
import { footprintOf, objectDef } from '../catalog/objects';
import { LampRegistry } from '../render/lampRegistry';
import { rotatedFootprint } from '../town/grid';
import type { TownChange, TownStateReader } from '../town/types';
import { DAY_LENGTH_S, phaseAt, T_SUNSET, wrap01 } from '../world/dayCycle';

/** The clock time the lights come on: sunset, halfway through dusk. */
export const KICKOFF_T = T_SUNSET;
/** Real seconds of night the lights stay on for. */
export const MATCH_NIGHT_S = 30;
export const MATCH_FADE_IN_S = 4;
export const MATCH_FADE_OUT_S = 5;
/** Real seconds a held night lasts before the next one begins. */
export const HELD_NIGHT_S = DAY_LENGTH_S;
/** The lights need this much `night` (the street lamps' switch-on range), so the level is 0 by day. */
const DARK_FROM = 0.3;
const DARK_TO = 0.42;

/** World units from a stadium's centre within which the crowd is at full volume. */
export const CROWD_FULL_DISTANCE = 3.5;
/** World units from a stadium's centre beyond which the crowd is silent, wherever the stadium stands. */
export const CROWD_CUTOFF_DISTANCE = 20;

function smooth01(x: number): number {
  const c = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return c * c * (3 - 2 * c);
}

/** 0 below the darkness the street lamps switch on at, 1 above it. */
function darkGate(night: number): number {
  return night > DARK_FROM ? smooth01((night - DARK_FROM) / (DARK_TO - DARK_FROM)) : 0;
}

/** 0..1 loudness of the crowd `distance` world units from the nearest stadium's centre. */
export function crowdGainAt(distance: number): number {
  if (!(distance < CROWD_CUTOFF_DISTANCE)) return 0;
  if (distance <= CROWD_FULL_DISTANCE) return 1;
  const x = (distance - CROWD_FULL_DISTANCE) / (CROWD_CUTOFF_DISTANCE - CROWD_FULL_DISTANCE);
  return (1 - x) * (1 - x);
}

/** Odd nights are match nights: the first night of a session, then every other one. */
export function isMatchNight(nightIndex: number): boolean {
  return nightIndex % 2 === 1;
}

export interface MatchDiagnostics {
  /** Nights begun this session (0 before the first sunset). */
  night: number;
  /** The current night is a match night. */
  matchNight: boolean;
  /** Lights and crowd are on or fading. */
  playing: boolean;
  /** The test hook's override, if any. */
  forced: boolean | null;
}

export class MatchSchedule {
  private nightIndex = 0;
  /** A match night's window is open: from kickoff until MATCH_NIGHT_S of night have passed. */
  private playing = false;
  private nightSeconds = 0;
  /** 0..1, moved towards on / off at the fade rates, so no clock jump can snap the lights or the crowd. */
  private shown = 0;
  private held = 0;
  private lastT = 0;
  /** Sunset was passed during the mode sweep still running. */
  private crossed = false;
  private forced: boolean | null = null;

  constructor(t = 0) {
    this.lastT = wrap01(t);
  }

  /** A new session or test state at clock time `t`: no night has begun. */
  reset(t: number): void {
    this.nightIndex = 0;
    this.playing = false;
    this.nightSeconds = 0;
    this.shown = 0;
    this.held = 0;
    this.crossed = false;
    this.forced = null;
    this.lastT = wrap01(t);
  }

  /** The clock jumped to `t` without time passing (a pin, a release): nothing is counted. */
  sync(t: number): void {
    this.lastT = wrap01(t);
    this.crossed = false;
  }

  /** A session that starts after sunset (Night mode) starts its first night at once. */
  start(t: number): void {
    this.reset(t);
    if (wrap01(t) >= KICKOFF_T) this.beginNight();
  }

  /** Test hook: true = a match at full level, false = none, null = the schedule. */
  force(on: boolean | null): void {
    this.forced = on;
  }

  /** `t`: the clock after `delta` real seconds (the clock only moves forward); `sweeping`: a mode sweep is running. */
  advance(t: number, delta: number, sweeping = false): void {
    const now = wrap01(t);
    // Float noise must not read as a lap of the clock.
    const lap = wrap01(now - this.lastT);
    const moved = lap > 1 - 1e-9 ? 0 : lap;
    if (moved > 0) {
      const toKickoff = wrap01(KICKOFF_T - this.lastT);
      if (toKickoff > 0 && toKickoff <= moved) this.crossed = true;
      this.held = 0;
    }
    if (!sweeping && this.crossed) {
      this.crossed = false;
      if (now >= KICKOFF_T) this.beginNight();
    } else if (moved === 0 && !sweeping && delta > 0 && now >= KICKOFF_T) {
      this.held += delta;
      if (this.held >= HELD_NIGHT_S) {
        this.held -= HELD_NIGHT_S;
        this.beginNight();
      }
    }
    this.lastT = now;
    if (!this.playing || !(delta > 0)) return;
    if (phaseAt(now) === 'night') this.nightSeconds += delta;
    // Leaving the evening early (a sweep to Day mode) ends the match too.
    if (this.nightSeconds >= MATCH_NIGHT_S || now < KICKOFF_T) this.playing = false;
  }

  /** Every unfrozen frame, pinned clock or not: fade towards on or off. `night`: 0 day .. 1 full night. */
  tick(night: number, delta: number): void {
    if (!(delta > 0)) return;
    if (this.playing && night > DARK_FROM) this.shown = Math.min(1, this.shown + delta / MATCH_FADE_IN_S);
    else this.shown = Math.max(0, this.shown - delta / MATCH_FADE_OUT_S);
  }

  /** 0..1 for the floodlights at this `night`; exactly 0 by day. */
  level(night: number): number {
    const dark = darkGate(night);
    return dark > 0 ? this.fade() * dark : 0;
  }

  /** 0..1 for the crowd: the same fade, but not cut by the dawn of a sweep to Day mode. */
  sound(night: number): number {
    return this.forced === null ? this.fade() : this.level(night);
  }

  private fade(): number {
    if (this.forced !== null) return this.forced ? 1 : 0;
    return smooth01(this.shown);
  }

  get diagnostics(): MatchDiagnostics {
    return { night: this.nightIndex, matchNight: isMatchNight(this.nightIndex), playing: this.forced ?? (this.playing || this.shown > 0), forced: this.forced };
  }

  private beginNight(): void {
    this.nightIndex += 1;
    this.playing = isMatchNight(this.nightIndex);
    this.nightSeconds = 0;
  }
}

/** The stadiums on the plot and their centres, for the floodlights and the crowd's distance. */
export class StadiumSites {
  readonly registry = new LampRegistry('stadium');
  /** x, z per stadium (world units). */
  private readonly centres: number[] = [];
  private builtVersion = -1;

  rebuild(town: TownStateReader): void {
    this.registry.rebuild(town);
  }

  onTownChanged(changes: readonly TownChange[], cause: 'edit' | 'undo' | 'redo' | 'load' | 'reset', town: TownStateReader): void {
    this.registry.onTownChanged(changes, cause, town);
  }

  get count(): number {
    return this.registry.count;
  }

  /** World units from (x, z) to the nearest stadium's centre; Infinity without one. No allocations once built. */
  distanceTo(x: number, z: number): number {
    if (this.builtVersion !== this.registry.version) this.measure();
    let best = Infinity;
    for (let i = 0; i < this.centres.length; i += 2) {
      const d = Math.hypot(this.centres[i] - x, this.centres[i + 1] - z);
      if (d < best) best = d;
    }
    return best;
  }

  private measure(): void {
    this.centres.length = 0;
    for (const placed of this.registry.values()) {
      const [w, d] = rotatedFootprint(footprintOf(objectDef(placed.kind), placed.variant), placed.rotation);
      const first = cellToWorld(placed.anchor);
      this.centres.push(first.x + ((w - 1) * CELL_SIZE) / 2, first.z + ((d - 1) * CELL_SIZE) / 2);
    }
    this.builtVersion = this.registry.version;
  }
}
