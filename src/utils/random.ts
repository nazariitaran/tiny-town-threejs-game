/**
 * A fresh 32-bit seed per page load, only for streams that should differ between visits (town-name
 * suggestions). The seed() test hook re-seeds them, so tests stay deterministic.
 */
export function entropySeed(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(buffer);
  return buffer[0] || Date.now() >>> 0;
}

/** Deterministic mulberry32 RNG; all gameplay randomness uses one so the seed() test hook keeps runs reproducible. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An index into `weights`, chosen with probability proportional to its weight; one draw from `rng`. */
export function pickWeighted(rng: () => number, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}
