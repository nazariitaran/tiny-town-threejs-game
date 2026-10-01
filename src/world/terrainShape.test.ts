import { describe, expect, it } from 'vitest';
import {
  MEADOW_BASE_Y,
  PLOT_HALF_X,
  PLOT_HALF_Z,
  distanceToPlot,
  fbm,
  terrainHeight,
  valueNoise,
} from './terrainShape';

describe('terrainShape', () => {
  it('is deterministic', () => {
    expect(valueNoise(3.3, -7.1, 5)).toBe(valueNoise(3.3, -7.1, 5));
    expect(terrainHeight(40, -55)).toBe(terrainHeight(40, -55));
  });

  it('keeps noise in [0, 1]', () => {
    for (let i = 0; i < 500; i += 1) {
      const n = fbm(i * 0.37 - 50, i * 0.91 - 80);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it('never undulates inside or right next to the plot', () => {
    for (let x = -PLOT_HALF_X - 1.5; x <= PLOT_HALF_X + 1.5; x += 0.5) {
      for (let z = -PLOT_HALF_Z - 1.5; z <= PLOT_HALF_Z + 1.5; z += 0.5) {
        if (distanceToPlot(x, z) <= 1.5) expect(terrainHeight(x, z)).toBeCloseTo(MEADOW_BASE_Y, 6);
      }
    }
  });

  it('undulates gently beyond the plot and rises into distant hills', () => {
    const samples: number[] = [];
    for (let a = 0; a < Math.PI * 2; a += 0.1) samples.push(terrainHeight(Math.cos(a) * 30, Math.sin(a) * 30));
    const spread = Math.max(...samples) - Math.min(...samples);
    expect(spread).toBeGreaterThan(0.2);
    expect(spread).toBeLessThan(3);
    let far = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.1) far = Math.max(far, terrainHeight(Math.cos(a) * 300, Math.sin(a) * 300));
    expect(far).toBeGreaterThan(10);
  });

  it('measures distance to the plot rectangle', () => {
    expect(distanceToPlot(0, 0)).toBe(0);
    expect(distanceToPlot(PLOT_HALF_X + 3, 0)).toBeCloseTo(3);
    expect(distanceToPlot(PLOT_HALF_X + 3, PLOT_HALF_Z + 4)).toBeCloseTo(5);
  });
});
