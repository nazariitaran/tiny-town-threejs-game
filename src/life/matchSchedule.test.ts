import { describe, expect, it } from 'vitest';
import { advanceCycle, DAY_LENGTH_S, nightAt, T_AFTERNOON, T_MORNING, T_NIGHT } from '../world/dayCycle';
import {
  CROWD_CUTOFF_DISTANCE,
  CROWD_FULL_DISTANCE,
  crowdGainAt,
  HELD_NIGHT_S,
  isMatchNight,
  KICKOFF_T,
  MATCH_FADE_IN_S,
  MATCH_FADE_OUT_S,
  MATCH_NIGHT_S,
  MatchSchedule,
} from './matchSchedule';

const STEP = 0.1;

/** Runs the Auto clock for `seconds`, returning the new time. `each` sees every step. */
function runAuto(schedule: MatchSchedule, t: number, seconds: number, each?: (t: number, elapsed: number) => void): number {
  let time = t;
  for (let elapsed = STEP; elapsed <= seconds + 1e-9; elapsed += STEP) {
    time = advanceCycle(time, STEP);
    schedule.advance(time, STEP);
    schedule.tick(nightAt(time), STEP);
    each?.(time, elapsed);
  }
  return time;
}

/** A mode sweep from `from` forward to `to` over 2.5 s, then one settled frame. */
function sweep(schedule: MatchSchedule, from: number, to: number, each?: (t: number) => void): void {
  const distance = (((to - from) % 1) + 1) % 1;
  for (let i = 1; i <= 25; i += 1) {
    const t = i < 25 ? (from + (distance * i) / 25) % 1 : to;
    schedule.advance(t, STEP, i < 25);
    schedule.tick(nightAt(t), STEP);
    each?.(t);
  }
}

function hold(schedule: MatchSchedule, t: number, seconds: number, each?: (t: number) => void): void {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += STEP) {
    schedule.advance(t, STEP);
    schedule.tick(nightAt(t), STEP);
    each?.(t);
  }
}

describe('match nights', () => {
  it('every other night, the first included', () => {
    expect([0, 1, 2, 3, 4, 5].map(isMatchNight)).toEqual([false, true, false, true, false, true]);
  });

  it('kickoff is sunset, the middle of dusk', () => {
    expect(KICKOFF_T).toBe(0.7);
    expect(nightAt(KICKOFF_T)).toBeCloseTo(0.5, 6);
  });

  it('Auto: lights from mid-dusk until 30 s into the night, on the 1st and 3rd nights, not the 2nd', () => {
    const schedule = new MatchSchedule();
    schedule.start(T_MORNING);
    let t = T_MORNING;
    const litSeconds: number[] = [];
    for (let day = 0; day < 3; day += 1) {
      let lit = 0;
      let firstLit = -1;
      let lastLit = -1;
      t = runAuto(schedule, t, DAY_LENGTH_S, (time) => {
        const level = schedule.level(nightAt(time));
        if (level > 0.5) {
          lit += STEP;
          if (firstLit < 0) firstLit = time;
          lastLit = time;
        }
        if (time >= 0.1 && time < 0.69) expect(level, `day ${day} t ${time}`).toBe(0);
      });
      litSeconds.push(lit);
      expect(schedule.diagnostics.night).toBe(day + 1);
      if (day !== 1) {
        // Half way up the fade-in shortly after 0.70; half way down shortly after 0.8125 (0.75 + 30 s of the 120 s night).
        expect(firstLit).toBeGreaterThan(0.7);
        expect(firstLit).toBeLessThan(0.71);
        expect(lastLit).toBeGreaterThan(0.8125);
        expect(lastLit).toBeLessThan(0.8125 + (MATCH_FADE_OUT_S / 120) * 0.25);
      }
    }
    // 30 s of dusk + 30 s of night, give or take the fades.
    expect(litSeconds[0]).toBeGreaterThan(58);
    expect(litSeconds[0]).toBeLessThan(63);
    expect(litSeconds[1]).toBe(0);
    expect(litSeconds[2]).toBeCloseTo(litSeconds[0], 1);
  });

  it('fades in over MATCH_FADE_IN_S and out over MATCH_FADE_OUT_S, never snapping', () => {
    const schedule = new MatchSchedule();
    schedule.start(0.69);
    let previous = 0;
    let peak = 0;
    runAuto(schedule, 0.69, 80, (time) => {
      const level = schedule.level(nightAt(time));
      expect(Math.abs(level - previous)).toBeLessThan(0.06);
      previous = level;
      peak = Math.max(peak, level);
    });
    expect(peak).toBe(1);
    expect(previous).toBe(0);
    expect(schedule.sound(1)).toBe(0);
    expect(schedule.diagnostics.playing).toBe(false);
    expect(MATCH_FADE_IN_S).toBeGreaterThan(1);
    expect(MATCH_FADE_OUT_S).toBeGreaterThan(1);
  });

  it('the level is exactly 0 by day whatever the schedule or the override says', () => {
    const schedule = new MatchSchedule();
    schedule.force(true);
    expect(schedule.level(0)).toBe(0);
    expect(schedule.sound(0)).toBe(0);
    expect(schedule.sound(1)).toBe(1);
    expect(schedule.level(0.3)).toBe(0);
    expect(schedule.level(0.36)).toBeGreaterThan(0);
    expect(schedule.level(0.5)).toBe(1);
    expect(schedule.level(1)).toBe(1);
    schedule.force(false);
    expect(schedule.level(1)).toBe(0);
    schedule.force(null);
    expect(schedule.level(1)).toBe(0);
  });

  it('Night mode: the sweep into the night starts a night; 30 s later the lights go off; every other visit is a match', () => {
    const schedule = new MatchSchedule();
    schedule.start(T_MORNING);
    sweep(schedule, T_MORNING, T_NIGHT);
    expect(schedule.diagnostics).toMatchObject({ night: 1, matchNight: true, playing: true });
    hold(schedule, T_NIGHT, MATCH_FADE_IN_S);
    expect(schedule.level(1)).toBe(1);
    hold(schedule, T_NIGHT, MATCH_NIGHT_S - MATCH_FADE_IN_S - 2);
    expect(schedule.level(1)).toBe(1);
    hold(schedule, T_NIGHT, 2 + MATCH_FADE_OUT_S + 0.5);
    expect(schedule.level(1)).toBe(0);
    expect(schedule.diagnostics.playing).toBe(false);
    // Day and back: the second night has no match; once more: the third has.
    sweep(schedule, T_NIGHT, T_AFTERNOON);
    expect(schedule.diagnostics.night).toBe(1);
    sweep(schedule, T_AFTERNOON, T_NIGHT);
    expect(schedule.diagnostics).toMatchObject({ night: 2, matchNight: false, playing: false });
    hold(schedule, T_NIGHT, 10);
    expect(schedule.level(1)).toBe(0);
    sweep(schedule, T_NIGHT, T_AFTERNOON);
    sweep(schedule, T_AFTERNOON, T_NIGHT);
    expect(schedule.diagnostics).toMatchObject({ night: 3, matchNight: true, playing: true });
  });

  it('a held night begins a new one every Auto day, so Night mode keeps the every-other-night rhythm', () => {
    const schedule = new MatchSchedule();
    schedule.start(T_NIGHT);
    expect(schedule.diagnostics).toMatchObject({ night: 1, playing: true });
    expect(HELD_NIGHT_S).toBe(DAY_LENGTH_S);
    hold(schedule, T_NIGHT, HELD_NIGHT_S - 1);
    expect(schedule.diagnostics.night).toBe(1);
    hold(schedule, T_NIGHT, 2);
    expect(schedule.diagnostics).toMatchObject({ night: 2, playing: false });
    hold(schedule, T_NIGHT, HELD_NIGHT_S);
    expect(schedule.diagnostics).toMatchObject({ night: 3, playing: true });
  });

  it('a sweep that only passes sunset on its way to Day mode does not use up a night', () => {
    const schedule = new MatchSchedule();
    schedule.start(0.66);
    sweep(schedule, 0.66, T_AFTERNOON); // forward: through the night and the morning
    expect(schedule.diagnostics).toMatchObject({ night: 0, playing: false });
    expect(schedule.level(1)).toBe(0);
    sweep(schedule, T_AFTERNOON, T_NIGHT);
    expect(schedule.diagnostics).toMatchObject({ night: 1, playing: true });
  });

  it('switching to Day mode mid-match ends it; a short sweep inside one night is not a new night', () => {
    const schedule = new MatchSchedule();
    schedule.start(0.69);
    const t = runAuto(schedule, 0.69, 20);
    expect(schedule.level(nightAt(t))).toBe(1);
    sweep(schedule, t, T_NIGHT); // Auto → Night mode, a few hundredths forward
    expect(schedule.diagnostics.night).toBe(1);
    expect(schedule.level(1)).toBe(1);
    // The crowd fades out over the full fade, not with the 2.5 s sweep; the lights are 0 once it is day.
    let previous = schedule.sound(1);
    const smoothly = (time: number) => {
      const sound = schedule.sound(nightAt(time));
      expect(Math.abs(sound - previous), `t ${time}`).toBeLessThan(0.04);
      previous = sound;
    };
    sweep(schedule, T_NIGHT, T_AFTERNOON, smoothly);
    expect(previous).toBeGreaterThan(0.3);
    expect(schedule.level(nightAt(T_AFTERNOON))).toBe(0);
    hold(schedule, T_AFTERNOON, MATCH_FADE_OUT_S, smoothly);
    expect(previous).toBe(0);
    expect(schedule.diagnostics.playing).toBe(false);
    expect(schedule.diagnostics.night).toBe(1);
  });

  it('cycling the mode quickly never snaps: a match cut short keeps fading out, also into a night without one', () => {
    const schedule = new MatchSchedule();
    schedule.start(T_NIGHT);
    hold(schedule, T_NIGHT, 10);
    expect(schedule.level(1)).toBe(1);
    // Night → Auto → Day → Night at once: one lap of the clock, arriving on the second night.
    let previous = schedule.sound(1);
    let previousLit = 1;
    const smoothly = (time: number) => {
      const sound = schedule.sound(nightAt(time));
      expect(sound, `t ${time}`).toBeLessThanOrEqual(previous);
      expect(previous - sound).toBeLessThan(0.04);
      previous = sound;
      // The lights may only follow the sky down and back up under that fading level, never above it.
      const lit = schedule.level(nightAt(time));
      expect(lit).toBeLessThanOrEqual(sound);
      previousLit = lit;
    };
    sweep(schedule, T_NIGHT + 0.001, T_NIGHT, smoothly);
    expect(schedule.diagnostics).toMatchObject({ night: 2, matchNight: false });
    expect(previousLit).toBeGreaterThan(0.2); // still fading when the night comes back
    hold(schedule, T_NIGHT, MATCH_FADE_OUT_S, smoothly);
    expect(previous).toBe(0);
    expect(previousLit).toBe(0);
    expect(schedule.diagnostics.playing).toBe(false);
  });

  it('a frozen clock (menu, reduced motion: delta 0) counts nothing; sync and reset count nothing', () => {
    const schedule = new MatchSchedule();
    schedule.start(T_NIGHT);
    hold(schedule, T_NIGHT, 5);
    const level = schedule.level(1);
    for (let i = 0; i < 100; i += 1) {
      schedule.advance(T_NIGHT, 0);
      schedule.tick(1, 0);
    }
    expect(schedule.level(1)).toBe(level);
    schedule.reset(T_AFTERNOON);
    schedule.sync(T_NIGHT); // a test pin jumps the clock
    schedule.advance(T_NIGHT, STEP);
    expect(schedule.diagnostics).toEqual({ night: 0, matchNight: false, playing: false, forced: null });
    schedule.reset(T_NIGHT); // a test state at night: no match unless forced
    hold(schedule, T_NIGHT, 5);
    expect(schedule.level(1)).toBe(0);
  });
});

describe('crowd loudness by distance', () => {
  it('is full at the stadium, falls off smoothly and is silent from the fixed cutoff on', () => {
    expect(crowdGainAt(0)).toBe(1);
    expect(crowdGainAt(CROWD_FULL_DISTANCE)).toBe(1);
    expect(crowdGainAt(CROWD_CUTOFF_DISTANCE)).toBe(0);
    expect(crowdGainAt(CROWD_CUTOFF_DISTANCE + 5)).toBe(0);
    expect(crowdGainAt(Infinity)).toBe(0);
    expect(crowdGainAt(Number.NaN)).toBe(0);
    let previous = 1;
    for (let d = CROWD_FULL_DISTANCE; d <= CROWD_CUTOFF_DISTANCE; d += 0.25) {
      const gain = crowdGainAt(d);
      expect(gain).toBeLessThanOrEqual(previous);
      expect(previous - gain).toBeLessThan(0.04);
      previous = gain;
    }
    expect(crowdGainAt((CROWD_FULL_DISTANCE + CROWD_CUTOFF_DISTANCE) / 2)).toBeCloseTo(0.25, 6);
  });

  it('one cutoff for every stadium: in the middle of the 32-unit plot it is faint at the edges, at one edge it is silent at the other', () => {
    expect(CROWD_CUTOFF_DISTANCE).toBe(20);
    const atEdge = crowdGainAt(16);
    expect(atEdge).toBeGreaterThan(0.02);
    expect(atEdge).toBeLessThan(0.1);
    expect(crowdGainAt(Math.hypot(16, 16))).toBe(0); // the corners
    expect(crowdGainAt(26)).toBe(0); // a stadium by one edge, the view at the other
  });
});
