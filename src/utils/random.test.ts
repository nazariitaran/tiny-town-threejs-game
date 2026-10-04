import { describe, expect, it } from 'vitest';
import { createSeededRandom, pickWeighted } from './random';

const POSTBOX = [60, 7, 5, 16, 2, 8, 2];

describe('pickWeighted', () => {
  it('walks the cumulative weights: each index owns its slice of [0, 1)', () => {
    const at = (value: number) => pickWeighted(() => value, POSTBOX);
    expect([0, 0.599, 0.6, 0.669, 0.67, 0.719, 0.72, 0.879, 0.88, 0.899, 0.9, 0.979, 0.98, 0.999999].map(at)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });

  it('draws once, and follows the weights over many seeded draws', () => {
    let draws = 0;
    const rng = createSeededRandom(7);
    const counted = () => {
      draws += 1;
      return rng();
    };
    const counts = POSTBOX.map(() => 0);
    for (let i = 0; i < 20000; i += 1) counts[pickWeighted(counted, POSTBOX)] += 1;
    expect(draws).toBe(20000);
    counts.forEach((count, i) => expect(count / 200, `index ${i}`).toBeGreaterThan(POSTBOX[i] - 1.5));
    counts.forEach((count, i) => expect(count / 200, `index ${i}`).toBeLessThan(POSTBOX[i] + 1.5));
  });
});
