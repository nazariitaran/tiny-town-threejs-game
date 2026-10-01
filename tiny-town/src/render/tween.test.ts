import { describe, expect, it } from 'vitest';
import { easeOutBack, easeOutBackPeak, easeShrink, hash01, hopArc, hopHeight, moveEase } from './tween';

describe('pop-in easing', () => {
  it('starts at 0, ends at 1 and peaks at ~1.08', () => {
    expect(easeOutBack(0)).toBe(0);
    expect(easeOutBack(1)).toBe(1);
    let peak = 0;
    for (let i = 0; i <= 1000; i += 1) peak = Math.max(peak, easeOutBack(i / 1000));
    expect(peak).toBeCloseTo(1.08, 3);
    expect(easeOutBackPeak(1.5)).toBeCloseTo(1.08, 6);
  });

  it('shrinks from 1 to 0 monotonically', () => {
    let last = 1;
    for (let i = 0; i <= 10; i += 1) {
      const value = easeShrink(i / 10);
      expect(value).toBeLessThanOrEqual(last);
      last = value;
    }
    expect(easeShrink(1)).toBe(0);
  });
});

describe('hash01', () => {
  it('is deterministic, in [0,1) and spreads values', () => {
    expect(hash01(42, 7)).toBe(hash01(42, 7));
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) {
      const v = hash01(i, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      seen.add(Math.floor(v * 10));
    }
    expect(seen.size).toBe(10);
    expect(hash01(1, 2, 3)).not.toBe(hash01(3, 2, 1));
  });
});

describe('move slide and hop (Move tool)', () => {
  it('the slide eases from 0 to 1, monotonic, symmetric about the middle', () => {
    expect(moveEase(0)).toBe(0);
    expect(moveEase(1)).toBe(1);
    expect(moveEase(0.5)).toBeCloseTo(0.5);
    let previous = 0;
    for (let i = 1; i <= 100; i += 1) {
      const u = i / 100;
      expect(moveEase(u)).toBeGreaterThanOrEqual(previous);
      expect(moveEase(u) + moveEase(1 - u)).toBeCloseTo(1);
      previous = moveEase(u);
    }
  });

  it('the hop starts and lands on the ground and peaks half-way', () => {
    expect(hopArc(0)).toBe(0);
    expect(hopArc(1)).toBe(0);
    expect(hopArc(0.5)).toBe(1);
    expect(hopArc(-0.2)).toBe(0);
    expect(hopArc(1.2)).toBe(0);
    expect(hopArc(0.25)).toBeCloseTo(hopArc(0.75));
  });

  it('a nudge hops low, a long move a little higher, never above 0.35', () => {
    expect(hopHeight(0)).toBeCloseTo(0.1);
    expect(hopHeight(2)).toBeGreaterThan(hopHeight(0.5));
    expect(hopHeight(100)).toBe(0.35);
  });
});
