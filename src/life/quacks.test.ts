import { describe, expect, it } from 'vitest';
import type { Duck } from './DuckSim';
import { createSeededRandom } from '../utils/random';
import { ducksInEarshot, QUACK_CHANCE, QUACK_FIRST_S, QUACK_INTERVAL_S, QUACK_MAX_NIGHT, QUACK_MAX_VIEW_DISTANCE, QUACK_RANGE, QuackTimer } from './quacks';

const duck = (x: number, z: number, leaving = false): Duck => ({ x, z, leaving }) as Duck;

describe('ducksInEarshot', () => {
  it('needs a duck near the view, a close camera and daylight', () => {
    const ducks = [duck(1, 1)];
    expect(ducksInEarshot(ducks, 1, 1 + QUACK_RANGE - 0.01, 10, 0)).toBe(true);
    expect(ducksInEarshot(ducks, 1, 1 + QUACK_RANGE + 0.01, 10, 0)).toBe(false);
    expect(ducksInEarshot(ducks, 1, 1, QUACK_MAX_VIEW_DISTANCE + 0.1, 0)).toBe(false);
    expect(ducksInEarshot(ducks, 1, 1, 10, QUACK_MAX_NIGHT + 0.01)).toBe(false);
    expect(ducksInEarshot([], 1, 1, 10, 0)).toBe(false);
    expect(ducksInEarshot([duck(1, 1, true)], 1, 1, 10, 0)).toBe(false);
  });
});

describe('QuackTimer', () => {
  it('rolls first after a short wait, then once per interval, and only in earshot', () => {
    let rolls = 0;
    const timer = new QuackTimer(() => {
      rolls += 1;
      return 0;
    });
    expect(timer.update(QUACK_FIRST_S - 0.1, true)).toBe(false);
    expect(timer.update(0.2, true)).toBe(true);
    expect(timer.update(QUACK_INTERVAL_S - 0.1, true)).toBe(false);
    expect(timer.update(0.2, true)).toBe(true);
    expect(rolls).toBe(2);
    // Out of earshot nothing rolls, and the short wait starts over.
    expect(timer.update(100, false)).toBe(false);
    expect(rolls).toBe(2);
    expect(timer.update(QUACK_FIRST_S + 0.1, true)).toBe(true);
  });

  it('quacks at about the stated chance per roll', () => {
    const timer = new QuackTimer(createSeededRandom(7));
    timer.update(QUACK_FIRST_S, true);
    let quacks = 0;
    const rolls = 4000;
    for (let i = 0; i < rolls; i += 1) if (timer.update(QUACK_INTERVAL_S, true)) quacks += 1;
    expect(quacks / rolls).toBeGreaterThan(QUACK_CHANCE - 0.03);
    expect(quacks / rolls).toBeLessThan(QUACK_CHANCE + 0.03);
  });
});
