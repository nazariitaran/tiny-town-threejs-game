import { describe, expect, it } from 'vitest';
import { createSeededRandom } from '../utils/random';
import { createDaySample, sampleDay, T_AFTERNOON, T_NIGHT } from '../world/dayCycle';
import {
  DRY_MIN_S,
  FLASH_S,
  flashAt,
  gloomAt,
  LIGHTNING_FROM,
  OVERCAST_FADE_S,
  RAIN_FADE_S,
  RAIN_LEVEL,
  shadeDaySample,
  STRIKE_MIN_S,
  WeatherSchedule,
} from './weatherSchedule';

const STEP = 1 / 30;

function run(schedule: WeatherSchedule, seconds: number, each?: (t: number) => void): void {
  for (let t = 0; t < seconds; t += STEP) {
    schedule.advance(STEP);
    each?.(t);
  }
}

describe('WeatherSchedule', () => {
  it('starts dry and stays dry for the shortest dry spell', () => {
    const schedule = new WeatherSchedule(createSeededRandom(1));
    run(schedule, DRY_MIN_S - 1, () => {
      expect(schedule.sample.rain).toBe(0);
      expect(schedule.sample.overcast).toBe(0);
    });
  });

  it('rains now and then: clouds first, never a jump, and mostly it is dry', () => {
    for (const seed of [1, 2, 3]) {
      const schedule = new WeatherSchedule(createSeededRandom(seed));
      let wet = 0;
      let total = 0;
      let lastRain = 0;
      let lastOvercast = 0;
      let rainJump = 0;
      let overcastJump = 0;
      let rainUnderClearSky = 0;
      run(schedule, 4 * 3600, () => {
        const { rain, overcast } = schedule.sample;
        rainJump = Math.max(rainJump, Math.abs(rain - lastRain));
        overcastJump = Math.max(overcastJump, Math.abs(overcast - lastOvercast));
        if (rain > 0 && overcast === 0) rainUnderClearSky += 1;
        lastRain = rain;
        lastOvercast = overcast;
        total += 1;
        if (rain > 0) wet += 1;
      });
      expect(rainJump).toBeLessThanOrEqual(STEP / RAIN_FADE_S + 1e-9);
      // Smoothstepped: its steepest slope is 1.5 × the linear rate.
      expect(overcastJump).toBeLessThanOrEqual((1.5 * STEP) / OVERCAST_FADE_S + 1e-9);
      expect(rainUnderClearSky).toBe(0);
      const { showers } = schedule.diagnostics;
      expect(showers).toBeGreaterThanOrEqual(10);
      expect(showers).toBeLessThanOrEqual(36);
      expect(wet / total).toBeGreaterThan(0.05);
      expect(wet / total).toBeLessThan(0.3);
    }
  });

  it('a storm peaks at full rain and strikes there, never closer together than STRIKE_MIN_S', () => {
    const schedule = new WeatherSchedule(createSeededRandom(7));
    schedule.begin('storm');
    let peak = 0;
    let lastStrikeAt = -Infinity;
    let strikes = 0;
    run(schedule, 320, (t) => {
      peak = Math.max(peak, schedule.sample.rain);
      const strike = schedule.takeStrike();
      if (!strike) return;
      expect(schedule.sample.rain).toBeGreaterThanOrEqual(LIGHTNING_FROM);
      expect(t - lastStrikeAt).toBeGreaterThanOrEqual(STRIKE_MIN_S - STEP);
      expect(strike.delay).toBeGreaterThan(0);
      expect(strike.strength).toBeGreaterThan(0);
      expect(strike.strength).toBeLessThanOrEqual(1);
      lastStrikeAt = t;
      strikes += 1;
    });
    expect(peak).toBe(RAIN_LEVEL.storm);
    expect(strikes).toBeGreaterThanOrEqual(3);
    expect(schedule.sample.rain).toBe(0);
    expect(schedule.sample.overcast).toBe(0);
  });

  it('light rain and plain rain never strike', () => {
    for (const kind of ['light', 'rain'] as const) {
      const schedule = new WeatherSchedule(createSeededRandom(3));
      schedule.begin(kind);
      run(schedule, 300, () => {
        expect(schedule.takeStrike()).toBeNull();
        expect(schedule.sample.flash).toBe(0);
        expect(schedule.sample.rain).toBeLessThanOrEqual(RAIN_LEVEL[kind] + 1e-9);
      });
    }
  });

  it('holds a forced kind, at once when asked, and shows no flash with flashes off', () => {
    const schedule = new WeatherSchedule(createSeededRandom(5));
    schedule.flashes = false;
    schedule.force('storm', true);
    expect(schedule.sample.rain).toBe(1);
    expect(schedule.sample.overcast).toBe(1);
    let strikes = 0;
    run(schedule, 120, () => {
      if (schedule.takeStrike()) strikes += 1;
      expect(schedule.sample.flash).toBe(0);
      expect(schedule.sample.rain).toBe(1);
    });
    expect(strikes).toBeGreaterThan(3);
    schedule.force('clear', true);
    expect(schedule.sample.rain).toBe(0);
    expect(schedule.sample.kind).toBeNull();
  });

  it('does nothing with auto off', () => {
    const schedule = new WeatherSchedule(createSeededRandom(1));
    schedule.auto = false;
    run(schedule, 3600);
    expect(schedule.diagnostics.showers).toBe(0);
  });
});

describe('flashAt', () => {
  it('is two pulses inside FLASH_S and nothing outside it', () => {
    expect(flashAt(-1)).toBe(0);
    expect(flashAt(0)).toBe(1);
    expect(flashAt(0.1)).toBeLessThan(0.2);
    expect(flashAt(0.16)).toBeGreaterThan(0.6);
    expect(flashAt(FLASH_S)).toBe(0);
    expect(flashAt(Infinity)).toBe(0);
  });
});

describe('shadeDaySample', () => {
  it('leaves a dry sample bit-identical', () => {
    for (const t of [T_AFTERNOON, T_NIGHT, 0.05, 0.7]) {
      const shaded = sampleDay(t, createDaySample());
      shadeDaySample(shaded, 0, 0);
      expect(shaded).toEqual(sampleDay(t, createDaySample()));
    }
  });

  it('hides the sun, dims the key light and greys the sky under full cloud', () => {
    const clear = sampleDay(T_AFTERNOON, createDaySample());
    const storm = sampleDay(T_AFTERNOON, createDaySample());
    shadeDaySample(storm, 1, 0);
    expect(storm.sunVisible).toBe(0);
    expect(storm.keyIntensity).toBeLessThan(clear.keyIntensity * 0.25);
    expect(storm.skyTop.b - storm.skyTop.r).toBeLessThan((clear.skyTop.b - clear.skyTop.r) * 0.3);
    expect(storm.night).toBe(clear.night);
  });

  it('a flash only adds light', () => {
    const storm = sampleDay(T_NIGHT, createDaySample());
    shadeDaySample(storm, 1, 0);
    const lit = sampleDay(T_NIGHT, createDaySample());
    shadeDaySample(lit, 1, 1);
    expect(lit.hemiIntensity).toBeGreaterThan(storm.hemiIntensity + 2);
    expect(lit.skyHorizon.g).toBeGreaterThan(storm.skyHorizon.g);
    expect(lit.keyIntensity).toBe(storm.keyIntensity);
  });
});

describe('gloomAt', () => {
  it('is 0 under light cloud and enough for the street lamps in a storm', () => {
    expect(gloomAt(0)).toBe(0);
    expect(gloomAt(0.5)).toBe(0);
    expect(gloomAt(1)).toBeGreaterThan(0.42);
  });
});
