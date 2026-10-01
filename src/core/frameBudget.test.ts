import { describe, expect, it } from 'vitest';
import { FrameBudget } from './FrameBudget';
import { paceFrame } from './Loop';

/** Feed display ticks of `displayHz` for `seconds` through paceFrame; returns the rendered tick times. */
function simulate(displayHz: number, targetFps: number, seconds = 2): number[] {
  const rendered: number[] = [];
  let anchor = -Infinity;
  const period = 1000 / displayHz;
  for (let tick = 0; tick * period < seconds * 1000; tick += 1) {
    const time = tick * period;
    const next = paceFrame(time, anchor, targetFps);
    if (next === null) continue;
    anchor = next;
    rendered.push(time);
  }
  return rendered;
}

describe('paceFrame', () => {
  it('renders every tick when uncapped', () => {
    expect(simulate(120, 0, 1)).toHaveLength(120);
  });

  it('halves a 120 Hz display to 60 fps, evenly', () => {
    const frames = simulate(120, 60, 2);
    expect(frames).toHaveLength(120);
    const gaps = frames.slice(1).map((t, i) => t - frames[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(1000 / 60, 5);
  });

  it('keeps every frame of a 60 Hz display at a 60 fps cap', () => {
    expect(simulate(60, 60, 2)).toHaveLength(120);
  });

  it('averages the target on a display that is not a multiple of it (144 Hz → 60)', () => {
    const fps = simulate(144, 60, 4).length / 4;
    expect(fps).toBeGreaterThan(57);
    expect(fps).toBeLessThanOrEqual(60.5);
  });

  it('gives 30 fps from 120 Hz and 60 Hz displays', () => {
    expect(simulate(120, 30, 2)).toHaveLength(60);
    expect(simulate(60, 30, 2)).toHaveLength(60);
  });

  it('never renders faster than the display', () => {
    expect(simulate(50, 60, 2)).toHaveLength(100);
  });

  it('restarts the grid after a long gap (hidden tab) instead of bursting to catch up', () => {
    expect(paceFrame(10_000, 16.7, 60)).toBe(10_000);
    // The next tick one display frame later is skipped.
    expect(paceFrame(10_008.3, 10_000, 60)).toBeNull();
  });
});

describe('FrameBudget', () => {
  function budget() {
    let now = 0;
    const b = new FrameBudget(() => now);
    return { b, advance: (s: number) => (now += s * 1000) };
  }

  it('is active after an input and idles after idleAfterS', () => {
    const { b, advance } = budget();
    const target = new EventTarget();
    b.attach(target);
    expect(b.idle).toBe(false);
    expect(b.targetFps).toBe(60);
    advance(b.tuning.idleAfterS - 0.1);
    expect(b.idle).toBe(false);
    advance(0.2);
    expect(b.idle).toBe(true);
    expect(b.targetFps).toBe(30);
    target.dispatchEvent(new Event('pointermove'));
    expect(b.idle).toBe(false);
    expect(b.targetFps).toBe(60);
  });

  it('markActive() counts as activity (camera glide, tweens)', () => {
    const { b, advance } = budget();
    advance(100);
    expect(b.idle).toBe(true);
    b.markActive();
    expect(b.idle).toBe(false);
  });

  it('stops listening after detach()', () => {
    const { b, advance } = budget();
    const target = new EventTarget();
    b.attach(target);
    b.detach();
    advance(100);
    target.dispatchEvent(new Event('keydown'));
    expect(b.idle).toBe(true);
  });
});
