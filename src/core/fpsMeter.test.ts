import { describe, expect, it } from 'vitest';
import { FPS_WINDOW_S, FpsMeter } from './FpsMeter';

/** Feeds frames `step` seconds apart from `start` and returns every reading. */
function run(meter: FpsMeter, start: number, step: number, count: number): number[] {
  const readings: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const fps = meter.frame(start + i * step);
    if (fps !== null) readings.push(fps);
  }
  return readings;
}

describe('FpsMeter', () => {
  it('reports the average rate once per window', () => {
    expect(run(new FpsMeter(), 10, 1 / 60, 70)).toEqual([60, 60]);
    expect(run(new FpsMeter(), 10, 1 / 30, 35)).toEqual([30, 30]);
  });

  it('reports nothing before a window closes', () => {
    const frames = Math.floor(FPS_WINDOW_S * 60) - 1;
    expect(run(new FpsMeter(), 0, 1 / 60, frames)).toEqual([]);
  });

  it('restarts after a stall instead of reporting it', () => {
    const meter = new FpsMeter();
    run(meter, 0, 1 / 60, 10);
    expect(meter.frame(30)).toBeNull();
    expect(run(meter, 30 + 1 / 60, 1 / 60, 40)).toEqual([60]);
  });

  it('reset drops the open window', () => {
    const meter = new FpsMeter();
    run(meter, 0, 1 / 60, 29);
    meter.reset();
    expect(run(meter, 0.5, 1 / 60, 40)).toEqual([60]);
  });
});
