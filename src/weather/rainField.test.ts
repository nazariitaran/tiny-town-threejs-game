import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../utils/random';
import {
  advanceFall,
  dropPosition,
  dropSpeed,
  fallDirection,
  OCTAVE_BASE,
  octaveScale,
  octaveSlots,
  PHASE_WRAP,
  RAIN_TUNING,
  rainCuts,
  rainOctave,
  thinning,
  type RainCuts,
  type Vec3Like,
} from './rainField';

type Seed = [number, number, number, number];

function seeds(count: number): Seed[] {
  const rng = createSeededRandom(7);
  return Array.from({ length: count }, () => [rng(), rng(), rng(), rng()] as Seed);
}

const vec = (): Vec3Like => ({ x: 0, y: 0, z: 0 });
const cuts = (): RainCuts => ({ even: 0, odd: 0, band: 1, instances: 0 });

/** Distance between two values on a circle of circumference `period`. */
function wrapped(a: number, b: number, period: number): number {
  const d = Math.abs(a - b) % period;
  return Math.min(d, period - d);
}

describe('rainOctave', () => {
  it('picks the octave below the camera distance and the share of the one above', () => {
    const out = { k: -1, mix: -1 };
    expect(rainOctave(OCTAVE_BASE, out)).toEqual({ k: 0, mix: 0 });
    expect(rainOctave(2 * OCTAVE_BASE, out)).toEqual({ k: 1, mix: 0 });
    expect(rainOctave(OCTAVE_BASE * Math.SQRT2, out).k).toBe(0);
    expect(out.mix).toBeCloseTo(0.5, 9);
    expect(rainOctave(60, out).k).toBe(3);
    expect(rainOctave(1, out)).toEqual({ k: 0, mix: 0 });
  });

  it('cross-fades continuously: the weights never jump as the zoom crosses an octave', () => {
    const out = { k: 0, mix: 0 };
    // Weight of each absolute scale; continuous in distance.
    const weightOf = (scale: number, d: number) => {
      rainOctave(d, out);
      if (octaveScale(out.k) === scale) return 1 - out.mix;
      if (octaveScale(out.k + 1) === scale) return out.mix;
      return 0;
    };
    for (let d = 6; d < 80; d += 0.01) {
      for (const scale of [6, 12, 24, 48, 96]) expect(Math.abs(weightOf(scale, d + 0.01) - weightOf(scale, d))).toBeLessThan(0.01);
    }
  });
});

describe('octaveSlots', () => {
  it('keeps every drop on its scale as the zoom crosses an octave', () => {
    const octave = { k: 0, mix: 0 };
    const slots = { evenScale: 0, oddScale: 0, evenWeight: 0 };
    for (const boundary of [12, 24, 48]) {
      octaveSlots(rainOctave(boundary * 0.9999, octave), slots);
      const before = { ...slots };
      octaveSlots(rainOctave(boundary * 1.0001, octave), slots);
      // Each half keeps its scale and weight, or changes scale only while it is not shown.
      for (const half of ['even', 'odd'] as const) {
        const weight = (s: typeof slots) => (half === 'even' ? s.evenWeight : 1 - s.evenWeight);
        const scale = (s: typeof slots) => (half === 'even' ? s.evenScale : s.oddScale);
        expect(Math.abs(weight(slots) - weight(before))).toBeLessThan(0.001);
        if (scale(slots) !== scale(before)) expect(weight(slots)).toBeLessThan(0.001);
      }
    }
  });

  it('draws the octave below the camera distance and the one above', () => {
    const slots = octaveSlots(rainOctave(17, { k: 0, mix: 0 }), { evenScale: 0, oddScale: 0, evenWeight: 0 });
    expect([slots.evenScale, slots.oddScale].sort((a, b) => a - b)).toEqual([12, 24]);
  });
});

describe('drop positions', () => {
  const S = octaveScale(1);
  const box = { x: RAIN_TUNING.boxWidth * S, y: RAIN_TUNING.boxHeight * S };

  it('stay put in the world while the camera zooms and pans within an octave', () => {
    const phase = { x: 1.3, y: 5.7, z: 0.4 };
    const a = vec();
    const b = vec();
    // A zoom-to-cursor step from distance 20 to 23 (both octave 1) moves the view's centre too.
    expect(rainOctave(20, { k: 0, mix: 0 }).k).toBe(rainOctave(23, { k: 0, mix: 0 }).k);
    const before = { x: 14, y: 0, z: -10 };
    const after = { x: 15.6, y: 0, z: -8.9 };
    let unmoved = 0;
    for (const seed of seeds(500)) {
      dropPosition(seed, phase, before, S, RAIN_TUNING, a);
      dropPosition(seed, phase, after, S, RAIN_TUNING, b);
      expect(b.y).toBeCloseTo(a.y, 9);
      // Only the wrap on the box's edges may move a drop, by a whole box.
      expect(wrapped(a.x, b.x, box.x)).toBeLessThan(1e-9);
      expect(wrapped(a.z, b.z, box.x)).toBeLessThan(1e-9);
      if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9) unmoved += 1;
    }
    expect(unmoved).toBeGreaterThan(400);
  });

  it('move smoothly as the rain and wind change, however long the game has run', () => {
    const step = 1 / 30;
    const phase = vec();
    const fall = vec();
    // An hour of steady light rain first: a `time × speed` fall would now jump with any change of speed.
    for (let i = 0; i < 3600 * 30; i += 1) advanceFall(phase, step, 0.28, fallDirection(1.2, RAIN_TUNING, fall), RAIN_TUNING);
    const centre = { x: 3, y: 0, z: 2 };
    const drops = seeds(200);
    const last = drops.map((seed) => dropPosition(seed, phase, centre, S, RAIN_TUNING, vec()));
    // Fastest drop at full rain, per step, in world units.
    const most = 1.25 * RAIN_TUNING.speed * 1.2 * S * step * 1.001;
    // A storm builds: rain 0.28 → 1, wind 1.2 → 2.3, over nine seconds.
    for (let i = 1; i <= 270; i += 1) {
      const k = i / 270;
      advanceFall(phase, step, 0.28 + 0.72 * k, fallDirection(1.2 + 1.1 * k, RAIN_TUNING, fall), RAIN_TUNING);
      drops.forEach((seed, j) => {
        const p = dropPosition(seed, phase, centre, S, RAIN_TUNING, vec());
        const moved = Math.hypot(wrapped(p.x, last[j].x, box.x), wrapped(p.y, last[j].y, box.y), wrapped(p.z, last[j].z, box.x));
        expect(moved).toBeLessThan(most);
        last[j] = p;
      });
    }
  });

  it('do not move when the fall phase wraps', () => {
    const a = vec();
    const b = vec();
    const centre = { x: -7, y: 0, z: 11 };
    for (const seed of seeds(100)) {
      dropPosition(seed, { x: 0.3, y: 0.1, z: 0.6 }, centre, S, RAIN_TUNING, a);
      dropPosition(seed, { x: 0.3 + PHASE_WRAP, y: 0.1 - PHASE_WRAP, z: 0.6 + PHASE_WRAP }, centre, S, RAIN_TUNING, b);
      expect(wrapped(a.x, b.x, box.x)).toBeLessThan(1e-6);
      expect(wrapped(a.y, b.y, box.y)).toBeLessThan(1e-6);
      expect(wrapped(a.z, b.z, box.x)).toBeLessThan(1e-6);
    }
  });

  it('keeps the fall phase inside one wrap', () => {
    const phase = { x: 7.99, y: 0.01, z: 7.99 };
    advanceFall(phase, 1, 1, fallDirection(5, RAIN_TUNING, vec()), RAIN_TUNING);
    for (const value of [phase.x, phase.y, phase.z]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(PHASE_WRAP);
    }
  });

  it('use five speeds that are whole eighths', () => {
    const speeds = new Set(seeds(1000).map((seed) => dropSpeed(seed[3])));
    expect([...speeds].sort()).toEqual([0.75, 0.875, 1, 1.125, 1.25]);
    expect(dropSpeed(0.999999)).toBe(1.25);
  });
});

describe('rainCuts', () => {
  it('draws nothing while dry', () => {
    expect(rainCuts(4000, 0, 0.3, cuts()).instances).toBe(0);
  });

  it('splits the drops between the halves by weight', () => {
    const out = rainCuts(4000, 0.5, 0.75, cuts());
    expect(out.even).toBeCloseTo(1500, 9);
    expect(out.odd).toBeCloseTo(500, 9);
    expect(rainCuts(4000, 1, 1, cuts()).odd).toBe(0);
  });

  it('submits every instance that can show, and never more than the buffer holds', () => {
    for (const [strength, mix] of [
      [1, 0],
      [1, 0.5],
      [0.28, 0.9],
      [0.6, 0.1],
    ]) {
      const out = rainCuts(4000, strength, mix, cuts());
      expect(out.instances % 2).toBe(0);
      expect(out.instances).toBeLessThanOrEqual(8000);
      const firstUnsent = out.instances / 2;
      if (firstUnsent < 4000) {
        expect(thinning(firstUnsent, out.even, out.band)).toBe(0);
        expect(thinning(firstUnsent, out.odd, out.band)).toBe(0);
      }
    }
  });
});
