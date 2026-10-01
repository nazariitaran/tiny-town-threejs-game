import { describe, expect, it } from 'vitest';
import { ShadowScheduler, type ShadowFrame } from './ShadowScheduler';

const STILL: ShadowFrame = { settling: false, cars: false, birds: false };

/** Run `frames` frames of `delta` seconds; returns how many redrew the map. */
function run(s: ShadowScheduler, frames: number, delta: number, frame: ShadowFrame): number {
  let redraws = 0;
  for (let i = 0; i < frames; i += 1) if (s.step(delta, frame)) redraws += 1;
  return redraws;
}

describe('ShadowScheduler', () => {
  it('draws the first frame, then never again while nothing casts or moves', () => {
    const s = new ShadowScheduler();
    expect(s.step(1 / 60, STILL)).toBe(true);
    expect(run(s, 600, 1 / 60, STILL)).toBe(0);
    expect(s.renders).toBe(1);
  });

  it('redraws once after invalidate() (town changed, sun re-aimed)', () => {
    const s = new ShadowScheduler();
    s.step(1 / 60, STILL);
    s.invalidate();
    expect(s.step(1 / 60, STILL)).toBe(true);
    expect(s.step(1 / 60, STILL)).toBe(false);
  });

  it('redraws every frame while town tweens settle', () => {
    const s = new ShadowScheduler();
    expect(run(s, 30, 1 / 60, { ...STILL, settling: true })).toBe(30);
  });

  it('refreshes at carHz while cars drive (60 and 30 fps)', () => {
    const s = new ShadowScheduler();
    s.step(1 / 60, STILL);
    expect(run(s, 60, 1 / 60, { ...STILL, cars: true })).toBe(s.tuning.carHz);
    expect(run(s, 30, 1 / 30, { ...STILL, cars: true })).toBe(s.tuning.carHz);
  });

  it('refreshes at birdHz while a flock flies', () => {
    const s = new ShadowScheduler();
    s.step(1 / 60, STILL);
    expect(run(s, 60, 1 / 60, { ...STILL, birds: true })).toBe(s.tuning.birdHz);
  });

  it('uses the faster rate while cars drive and a flock flies', () => {
    const s = new ShadowScheduler();
    s.tuning.carHz = 30;
    s.tuning.birdHz = 15;
    s.step(1 / 60, STILL);
    expect(run(s, 60, 1 / 60, { ...STILL, cars: true, birds: true })).toBe(30);
    s.tuning.carHz = 10;
    expect(run(s, 60, 1 / 60, { ...STILL, cars: true, birds: true })).toBe(15);
  });

  it('never exceeds the frame rate', () => {
    const s = new ShadowScheduler();
    s.tuning.birdHz = 240;
    s.step(1 / 60, STILL);
    expect(run(s, 60, 1 / 60, { ...STILL, birds: true })).toBe(60);
  });
});
