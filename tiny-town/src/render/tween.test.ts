import { describe, expect, it } from 'vitest';
import { easeOutBack, easeOutBackPeak, easeShrink, hash01 } from './tween';

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
