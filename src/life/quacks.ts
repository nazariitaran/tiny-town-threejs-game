/**
 * When ducks quack (pure): while the view is close to a duck by day, the timer rolls for a quack every
 * few seconds. The game plays the sound.
 */
import type { Duck } from './DuckSim';

/** Seconds between rolls while ducks are in earshot. */
export const QUACK_INTERVAL_S = 6;
/** Seconds to the first roll after ducks come into earshot. */
export const QUACK_FIRST_S = 2;
/** Chance of a quack at each roll. */
export const QUACK_CHANCE = 0.3;
/** A duck is heard within this of the view's ground target (world units). */
export const QUACK_RANGE = 3;
/** ...and only while the camera is no farther than this from its target (the build start pose is beyond it). */
export const QUACK_MAX_VIEW_DISTANCE = 22;
/** Ducks rest above this night level (as in DuckSim) and keep quiet. */
export const QUACK_MAX_NIGHT = 0.6;

/** A duck is within earshot of a view centred on (x, z) from `viewDistance` away. */
export function ducksInEarshot(ducks: readonly Duck[], x: number, z: number, viewDistance: number, night: number): boolean {
  if (viewDistance > QUACK_MAX_VIEW_DISTANCE || night > QUACK_MAX_NIGHT) return false;
  for (const duck of ducks) {
    if (duck.leaving) continue;
    const dx = duck.x - x;
    const dz = duck.z - z;
    if (dx * dx + dz * dz <= QUACK_RANGE * QUACK_RANGE) return true;
  }
  return false;
}

export class QuackTimer {
  private wait = QUACK_FIRST_S;

  constructor(private readonly rng: () => number) {}

  /** Per frame; true when a duck quacks now. Rolls only while `inEarshot`, and starts over when it ends. */
  update(delta: number, inEarshot: boolean): boolean {
    if (!inEarshot) {
      this.wait = QUACK_FIRST_S;
      return false;
    }
    this.wait -= delta;
    if (this.wait > 0) return false;
    this.wait = QUACK_INTERVAL_S;
    return this.rng() < QUACK_CHANCE;
  }
}
