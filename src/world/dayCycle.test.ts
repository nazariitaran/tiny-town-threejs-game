import { describe, expect, it } from 'vitest';
import {
  advanceCycle,
  AFTERNOON,
  createDaySample,
  DAY_KEYFRAMES,
  DAY_LENGTH_S,
  DayClock,
  hexRgb,
  lightsOffAt,
  lightsOnAt,
  MODE_SWEEP_S,
  modeTarget,
  MOON_DIRECTION,
  nightAt,
  PHASE_SPANS,
  phaseAt,
  sampleDay,
  sunElevation,
  T_AFTERNOON,
  T_MORNING,
  T_NIGHT,
  T_SUNRISE,
  T_SUNSET,
  wrap01,
  type DaySample,
  type Rgb,
  type Vec3,
} from './dayCycle';

/** The afternoon look, copied from Environment.ts so this test needs no WebGL; keep the two in sync. */
const V02 = {
  sunColor: '#ffe6c4',
  sunIntensity: 3.0,
  hemiSky: '#cfe6ff',
  hemiGround: '#7d9a5c',
  hemiIntensity: 0.8,
  envIntensity: 0.18,
  skyTop: '#4f9fe3',
  skyHorizon: '#d4ebf6',
  skyGlow: '#ffd49a',
  skyDisc: '#fff1d2',
  sunDirection: [-0.66, 0.74, 0.42],
};

const EPS = 1e-6;

function css(hex: string): Rgb {
  return hexRgb(parseInt(hex.slice(1), 16));
}

function expectRgb(actual: Rgb, expected: Rgb, eps = EPS): void {
  expect(actual.r).toBeCloseTo(expected.r, -Math.log10(eps));
  expect(Math.abs(actual.r - expected.r)).toBeLessThan(eps);
  expect(Math.abs(actual.g - expected.g)).toBeLessThan(eps);
  expect(Math.abs(actual.b - expected.b)).toBeLessThan(eps);
}

function expectVec(actual: Vec3, expected: Vec3, eps = EPS): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(eps);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(eps);
  expect(Math.abs(actual.z - expected.z)).toBeLessThan(eps);
}

function normalized([x, y, z]: number[]): Vec3 {
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}

/** Every numeric channel of a sample, flattened (for continuity checks). */
function channels(s: DaySample, withKeyDir = true): number[] {
  const rgb = (c: Rgb) => [c.r, c.g, c.b];
  const vec = (v: Vec3) => [v.x, v.y, v.z];
  return [
    ...(withKeyDir ? vec(s.keyDir) : []),
    ...rgb(s.keyColor),
    s.keyIntensity,
    ...rgb(s.hemiSky),
    ...rgb(s.hemiGround),
    s.hemiIntensity,
    ...rgb(s.skyTop),
    ...rgb(s.skyHorizon),
    ...rgb(s.skyGlow),
    ...rgb(s.skyDisc),
    ...vec(s.sunDir),
    s.sunVisible,
    ...vec(s.moonDir),
    s.moonVisible,
    s.cloudShade,
    s.stars,
    s.envIntensity,
    s.night,
    s.lightsOn,
    s.lightsOff,
  ];
}

function maxJump(t0: number, t1: number, withKeyDir = true): number {
  const a = channels(sampleDay(t0, createDaySample()), withKeyDir);
  const b = channels(sampleDay(t1, createDaySample()), withKeyDir);
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
}

describe('sampleDay: afternoon is the v0.2 look', () => {
  it('reproduces LIGHTING / SKY_PALETTE / SUN_DIRECTION at t = 0.55 (1e-6)', () => {
    const s = sampleDay(T_AFTERNOON, createDaySample());
    expect(s.t).toBe(T_AFTERNOON);
    expect(s.phase).toBe('day');
    expectRgb(s.keyColor, css(V02.sunColor));
    expect(Math.abs(s.keyIntensity - V02.sunIntensity)).toBeLessThan(EPS);
    expectRgb(s.hemiSky, css(V02.hemiSky));
    expectRgb(s.hemiGround, css(V02.hemiGround));
    expect(Math.abs(s.hemiIntensity - V02.hemiIntensity)).toBeLessThan(EPS);
    expect(Math.abs(s.envIntensity - V02.envIntensity)).toBeLessThan(EPS);
    expectRgb(s.skyTop, css(V02.skyTop));
    expectRgb(s.skyHorizon, css(V02.skyHorizon));
    expectRgb(s.skyGlow, css(V02.skyGlow));
    expectRgb(s.skyDisc, css(V02.skyDisc));
    const sun = normalized(V02.sunDirection);
    expectVec(s.sunDir, sun);
    expectVec(s.keyDir, sun);
    expect(s.sunVisible).toBe(1);
    expect(s.moonVisible).toBe(0);
    expect(s.cloudShade).toBe(1);
    expect(s.stars).toBe(0);
    expect(s.night).toBe(0);
    expect(s.lightsOn).toBe(0);
    expect(s.lightsOff).toBe(0);
  });

  it('is bit-exact (no colour round trip) and matches the AFTERNOON constants', () => {
    const s = createDaySample();
    expect(s.keyColor).toEqual(hexRgb(AFTERNOON.sunColor));
    expect(s.skyHorizon).toEqual(hexRgb(AFTERNOON.skyHorizon));
    expect(s.keyIntensity).toBe(AFTERNOON.sunIntensity);
    expect(s.hemiIntensity).toBe(AFTERNOON.hemiIntensity);
    expect(s.envIntensity).toBe(AFTERNOON.envIntensity);
    // Normalised exactly as THREE.Vector3.normalize() (x * (1 / length)).
    const [x, y, z] = V02.sunDirection;
    const inv = 1 / Math.sqrt(x * x + y * y + z * z);
    expect(s.keyDir).toEqual({ x: x * inv, y: y * inv, z: z * inv });
  });

  it('the analytic sun path passes through the anchor at 0.55 (not only the shortcut)', () => {
    const [x, y, z] = V02.sunDirection;
    const anchorElevation = Math.asin(y / Math.hypot(x, y, z));
    expect(Math.abs(sunElevation(T_AFTERNOON) - anchorElevation)).toBeLessThan(1e-9);
    expect(maxJump(T_AFTERNOON, T_AFTERNOON + 1e-9)).toBeLessThan(1e-6);
    expect(maxJump(T_AFTERNOON - 1e-9, T_AFTERNOON)).toBeLessThan(1e-6);
  });
});

describe('sampleDay: keyframes and continuity', () => {
  it('keyframes are sorted, inside [0, 1) and keep the afternoon at 0.55', () => {
    for (let i = 0; i < DAY_KEYFRAMES.length; i++) {
      const f = DAY_KEYFRAMES[i];
      expect(f.t).toBeGreaterThanOrEqual(0);
      expect(f.t).toBeLessThan(1);
      if (i > 0) expect(f.t).toBeGreaterThan(DAY_KEYFRAMES[i - 1].t);
    }
    expect(DAY_KEYFRAMES.find((f) => f.name === 'afternoon')?.t).toBe(T_AFTERNOON);
  });

  it('hits every keyframe exactly', () => {
    for (const f of DAY_KEYFRAMES) {
      const s = sampleDay(f.t, createDaySample());
      expectRgb(s.keyColor, f.keyColor, 1e-12);
      expectRgb(s.skyTop, f.skyTop, 1e-12);
      expectRgb(s.skyHorizon, f.skyHorizon, 1e-12);
      expect(s.keyIntensity).toBe(f.keyIntensity);
      expect(s.hemiIntensity).toBe(f.hemiIntensity);
      expect(s.stars).toBe(f.stars);
    }
  });

  it('is continuous at every keyframe (both sides)', () => {
    const h = 1e-7;
    for (const f of DAY_KEYFRAMES) {
      const withKeyDir = f.t !== T_SUNRISE && f.t !== T_SUNSET; // the key light swaps there (at 0 intensity)
      expect(maxJump(f.t - h, f.t, withKeyDir), `left of ${f.name}`).toBeLessThan(1e-4);
      expect(maxJump(f.t, f.t + h, withKeyDir), `right of ${f.name}`).toBeLessThan(1e-4);
    }
  });

  it('is continuous across the 1 → 0 wrap and periodic', () => {
    expect(maxJump(1 - 1e-9, 0)).toBeLessThan(1e-5);
    expect(maxJump(1.3, 0.3)).toBeLessThan(1e-12);
    expect(maxJump(-0.2, 0.8)).toBeLessThan(1e-12);
    expect(sampleDay(1, createDaySample()).t).toBe(0);
  });

  it('has no jumps anywhere in the day except the key-light swap, which happens at ~0 intensity', () => {
    const steps = 20000;
    let worst = 0;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      worst = Math.max(worst, maxJump(t0, t1, false));
    }
    expect(worst).toBeLessThan(0.02);
    for (const swap of [T_SUNRISE, T_SUNSET]) {
      const s = sampleDay(swap, createDaySample());
      expect(s.keyIntensity).toBeLessThan(1e-3);
      expect(sampleDay(swap - 1e-6, createDaySample()).keyIntensity).toBeLessThan(1e-3);
    }
  });

  it('swaps the key light between sun (day) and moon (night)', () => {
    const noon = sampleDay(0.35, createDaySample());
    expectVec(noon.keyDir, noon.sunDir, 1e-12);
    const night = sampleDay(T_NIGHT, createDaySample());
    expectVec(night.keyDir, MOON_DIRECTION, 1e-12);
    expectVec(night.moonDir, MOON_DIRECTION, 1e-12);
    // Moon from the build camera's right (camera looks along (-1, 0, -1)): +x, -z side, ~40° up.
    expect(MOON_DIRECTION.x).toBeGreaterThan(0);
    expect(MOON_DIRECTION.x - MOON_DIRECTION.z).toBeGreaterThan(0);
    expect(Math.asin(MOON_DIRECTION.y) * (180 / Math.PI)).toBeCloseTo(40, 5);
    // The key light never grazes the ground by day.
    for (let t = T_SUNRISE; t < T_SUNSET; t += 0.001) {
      expect(sampleDay(t, createDaySample()).keyDir.y).toBeGreaterThan(Math.sin((14.9 * Math.PI) / 180));
    }
  });

  it('sun path: up by day (≈55° at noon), down at night, unit vectors, east → west', () => {
    expect(sunElevation(T_SUNRISE)).toBeCloseTo(0, 9);
    expect(sunElevation(T_SUNSET)).toBeCloseTo(0, 9);
    expect(sunElevation(0.35) * (180 / Math.PI)).toBeCloseTo(55, 6);
    for (let t = 0; t < 1; t += 0.01) {
      const s = sampleDay(t, createDaySample());
      expect(Math.hypot(s.sunDir.x, s.sunDir.y, s.sunDir.z)).toBeCloseTo(1, 9);
      expect(Math.hypot(s.keyDir.x, s.keyDir.y, s.keyDir.z)).toBeCloseTo(1, 9);
      const up = t > T_SUNRISE + 1e-9 && t < T_SUNSET - 1e-9;
      if (up) expect(s.sunDir.y).toBeGreaterThan(0);
      else expect(s.sunDir.y).toBeLessThanOrEqual(1e-9);
    }
    // Morning sun on the +x side (east), evening sun on the -x side (west, the build camera's left).
    expect(sampleDay(0.1, createDaySample()).sunDir.x).toBeGreaterThan(0.5);
    expect(sampleDay(0.68, createDaySample()).sunDir.x).toBeLessThan(-0.5);
  });

  it('writes into the caller-owned object (no allocations) and returns it', () => {
    const s = createDaySample();
    const refs = [s.keyDir, s.keyColor, s.hemiSky, s.hemiGround, s.skyTop, s.skyHorizon, s.skyGlow, s.skyDisc, s.sunDir, s.moonDir];
    expect(sampleDay(0.3, s)).toBe(s);
    expect(sampleDay(T_NIGHT, s)).toBe(s);
    expect([s.keyDir, s.keyColor, s.hemiSky, s.hemiGround, s.skyTop, s.skyHorizon, s.skyGlow, s.skyDisc, s.sunDir, s.moonDir]).toEqual(refs);
    refs.forEach((r, i) => expect([s.keyDir, s.keyColor, s.hemiSky, s.hemiGround, s.skyTop, s.skyHorizon, s.skyGlow, s.skyDisc, s.sunDir, s.moonDir][i]).toBe(r));
    const clock = new DayClock();
    expect(clock.sample(s)).toBe(s);
  });

  it('keeps colour channels inside [0, 1]', () => {
    for (let t = 0; t < 1; t += 0.0025) {
      const s = sampleDay(t, createDaySample());
      for (const c of [s.keyColor, s.hemiSky, s.hemiGround, s.skyTop, s.skyHorizon, s.skyGlow, s.skyDisc]) {
        for (const v of [c.r, c.g, c.b]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });
});

describe('phases and night curves', () => {
  it('phase boundaries 0.10 / 0.65 / 0.75, wrapping', () => {
    expect(phaseAt(0)).toBe('dawn');
    expect(phaseAt(0.0999)).toBe('dawn');
    expect(phaseAt(0.1)).toBe('day');
    expect(phaseAt(0.6499)).toBe('day');
    expect(phaseAt(0.65)).toBe('dusk');
    expect(phaseAt(0.7499)).toBe('dusk');
    expect(phaseAt(0.75)).toBe('night');
    expect(phaseAt(0.9999)).toBe('night');
    expect(phaseAt(1)).toBe('dawn');
    expect(phaseAt(-0.01)).toBe('night');
    expect(sampleDay(0.7, createDaySample()).phase).toBe('dusk');
  });

  it('night is 0 all day, 1 at T_NIGHT and all night, and rises through dusk / falls through dawn', () => {
    for (let t = 0.1; t < 0.64; t += 0.01) expect(nightAt(t)).toBe(0);
    for (let t = 0.76; t < 1.01; t += 0.01) expect(nightAt(t)).toBeCloseTo(1, 9);
    expect(nightAt(T_NIGHT)).toBe(1);
    expect(nightAt(0.7)).toBeGreaterThan(0.3);
    expect(nightAt(0.7)).toBeLessThan(0.7);
    let prev = 0;
    for (let t = 0.64; t <= 0.76; t += 0.001) {
      expect(nightAt(t)).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = nightAt(t);
    }
  });

  it('lights: all on at T_NIGHT, a third off late at night, all off by day', () => {
    expect(lightsOnAt(T_NIGHT)).toBe(1);
    expect(lightsOffAt(T_NIGHT)).toBe(0);
    expect(lightsOffAt(0.899)).toBe(0);
    expect(lightsOffAt(0.995)).toBeCloseTo(0.35, 9);
    for (let t = 0.1; t < 0.66; t += 0.01) {
      expect(lightsOnAt(t)).toBe(0);
      expect(lightsOffAt(t)).toBe(0);
    }
    // The lit fraction min(on, 1 − off) only goes down between midnight and morning.
    let prev = 1;
    for (let t = 0.82; t < 1.1; t += 0.001) {
      const lit = Math.min(lightsOnAt(t), 1 - lightsOffAt(t));
      expect(lit).toBeLessThanOrEqual(prev + 1e-12);
      prev = lit;
    }
  });
});

describe('DayClock', () => {
  it('starts at its mode target; startDay goes to the morning in Auto', () => {
    expect(new DayClock('auto').t).toBe(T_MORNING);
    expect(new DayClock('day').t).toBe(T_AFTERNOON);
    expect(new DayClock('night').t).toBe(T_NIGHT);
    const clock = new DayClock('auto');
    clock.advance(100);
    expect(clock.t).not.toBe(T_MORNING);
    clock.startDay();
    expect(clock.t).toBe(T_MORNING);
    const night = new DayClock('night');
    night.startDay();
    expect(night.t).toBe(T_NIGHT);
  });

  it('phases last 1 min dawn, 5 min day, 1 min dusk, 2 min night in Auto (owner, 2026-09-30)', () => {
    expect(PHASE_SPANS.map((span) => [span.phase, span.seconds])).toEqual([['dawn', 60], ['day', 300], ['dusk', 60], ['night', 120]]);
    expect(DAY_LENGTH_S).toBe(540);
    // Phase by phase from midnight's end (t = 0 is the start of dawn)...
    let t = advanceCycle(0, 60);
    expect(t).toBeCloseTo(0.1, 12);
    t = advanceCycle(t, 300);
    expect(t).toBeCloseTo(0.65, 12);
    t = advanceCycle(t, 60);
    expect(t).toBeCloseTo(0.75, 12);
    t = advanceCycle(t, 119.999);
    expect(phaseAt(t)).toBe('night');
    expect(advanceCycle(t, 0.002)).toBeLessThan(0.1);
    // ...and across boundaries in one step: half of dusk + all of night + half of dawn.
    expect(advanceCycle(0.7, 30 + 120 + 30)).toBeCloseTo(0.05, 12);
    // Whole days change nothing; any t in [0, 1) stays in range.
    expect(advanceCycle(0.3, DAY_LENGTH_S * 3)).toBeCloseTo(0.3, 12);
    for (let i = 0; i < 200; i += 1) {
      const next = advanceCycle(i / 200, i * 7.3);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(1);
    }
  });

  it('Auto advances through the phases and wraps; a debug day length scales them all; Day / Night hold', () => {
    const clock = new DayClock('auto');
    // T_MORNING is in the day phase: 0.55 of the cycle in 300 s.
    clock.advance(30);
    expect(clock.t).toBeCloseTo(T_MORNING + (30 * 0.55) / 300, 12);
    clock.advance(DAY_LENGTH_S - 30);
    expect(clock.t).toBeCloseTo(T_MORNING, 9);
    clock.dayLengthS = DAY_LENGTH_S / 10; // ?debug&day=54: ten times faster, same proportions
    clock.advance(3);
    expect(clock.t).toBeCloseTo(T_MORNING + (30 * 0.55) / 300, 9);
    for (const mode of ['day', 'night'] as const) {
      const held = new DayClock(mode);
      held.advance(123);
      expect(held.t).toBe(modeTarget(mode));
    }
  });

  it('is frozen at delta 0 (reduced motion), also mid-sweep', () => {
    const clock = new DayClock('auto');
    clock.advance(0);
    expect(clock.t).toBe(T_MORNING);
    clock.setMode('night');
    clock.advance(0.5);
    const mid = clock.t;
    for (let i = 0; i < 10; i++) clock.advance(0);
    expect(clock.t).toBe(mid);
    expect(clock.isSweeping).toBe(true);
  });

  it('mode switch sweeps forward only, eased, and lands exactly on the target after MODE_SWEEP_S', () => {
    const clock = new DayClock('night');
    clock.setMode('day'); // 0.82 → 0.55: forward through midnight and dawn (0.73 of a day)
    expect(clock.mode).toBe('day');
    expect(clock.t).toBe(T_NIGHT);
    const dt = 1 / 60;
    let prev = clock.t;
    let travelled = 0;
    const steps: number[] = [];
    let passedDawn = false;
    for (let time = 0; time < MODE_SWEEP_S + 0.5; time += dt) {
      clock.advance(dt);
      const step = wrap01(clock.t - prev);
      expect(step).toBeLessThan(0.5); // never backwards (a backward step wraps to ~1)
      steps.push(step);
      travelled += step;
      if (clock.phase === 'dawn') passedDawn = true;
      prev = clock.t;
    }
    expect(passedDawn).toBe(true);
    expect(clock.t).toBe(T_AFTERNOON);
    expect(clock.isSweeping).toBe(false);
    expect(travelled).toBeCloseTo(wrap01(T_AFTERNOON - T_NIGHT), 9);
    // Ease in-out: slow at both ends, fastest in the middle.
    const moving = steps.filter((s) => s > 0);
    const peak = Math.max(...moving);
    expect(moving[0]).toBeLessThan(peak / 10);
    expect(moving[moving.length - 1]).toBeLessThan(peak / 5);
    // Holds afterwards.
    clock.advance(10);
    expect(clock.t).toBe(T_AFTERNOON);
  });

  it('the sweep takes MODE_SWEEP_S whatever the distance', () => {
    const clock = new DayClock('day');
    clock.setMode('night'); // 0.55 → 0.82
    clock.advance(MODE_SWEEP_S * 0.5);
    expect(clock.t).toBeCloseTo(T_AFTERNOON + (T_NIGHT - T_AFTERNOON) / 2, 9);
    clock.advance(MODE_SWEEP_S * 0.5 - 0.01);
    expect(clock.t).toBeLessThan(T_NIGHT);
    clock.advance(0.02);
    expect(clock.t).toBe(T_NIGHT);
  });

  it('snap jumps straight to the target', () => {
    const clock = new DayClock('night');
    clock.setMode('day', true);
    expect(clock.t).toBe(T_AFTERNOON);
    expect(clock.isSweeping).toBe(false);
    clock.setMode('night', true);
    expect(clock.t).toBe(T_NIGHT);
  });

  it('switching to Auto continues from the current time (mid-sweep too); same mode is a no-op', () => {
    const clock = new DayClock('day');
    clock.setMode('auto');
    expect(clock.t).toBe(T_AFTERNOON);
    clock.advance(6); // the afternoon is in the day phase: 0.55 of the cycle in 300 s
    expect(clock.t).toBeCloseTo(T_AFTERNOON + (6 * 0.55) / 300, 12);

    const sweeping = new DayClock('day');
    sweeping.setMode('night');
    sweeping.advance(1);
    const mid = sweeping.t;
    sweeping.setMode('auto');
    expect(sweeping.t).toBe(mid);
    expect(sweeping.isSweeping).toBe(false);
    const expected = advanceCycle(mid, 6);
    sweeping.advance(6);
    expect(sweeping.t).toBeCloseTo(expected, 12);
    expect(expected).toBeGreaterThan(mid);

    const same = new DayClock('night');
    same.setMode('night');
    expect(same.isSweeping).toBe(false);
  });

  it('pin overrides the shown time until released; the clock keeps its own time underneath', () => {
    const clock = new DayClock('auto');
    clock.pin(T_NIGHT);
    expect(clock.isPinned).toBe(true);
    expect(clock.t).toBe(T_NIGHT);
    expect(clock.phase).toBe('night');
    clock.advance(DAY_LENGTH_S * 0.1);
    expect(clock.t).toBe(T_NIGHT);
    expect(clock.sample(createDaySample()).t).toBe(T_NIGHT);
    clock.pin(1.25);
    expect(clock.t).toBe(0.25);
    clock.pin(null);
    expect(clock.isPinned).toBe(false);
    expect(clock.t).toBeCloseTo(advanceCycle(T_MORNING, DAY_LENGTH_S * 0.1), 12);
  });
});

describe('DayClock.finishSweep (integrator)', () => {
  it('jumps to the sweep target and is a no-op when not sweeping', () => {
    const clock = new DayClock('day');
    clock.setMode('night');
    expect(clock.isSweeping).toBe(true);
    clock.finishSweep();
    expect(clock.isSweeping).toBe(false);
    expect(clock.t).toBe(T_NIGHT);
    clock.finishSweep();
    expect(clock.t).toBe(T_NIGHT);
  });
});
