/**
 * Deterministic seeded RNG (mulberry32). Route ALL gameplay randomness through
 * a seeded generator instead of Math.random so the __THREE_GAME_TEST_HOOKS__
 * seed() hook keeps visual baselines and bot playtests reproducible.
 */
/**
 * A fresh 32-bit seed per page load, for a stream that SHOULD differ between visits: only the
 * town-name suggestions (WP-20), so new players don't all get the same first name. Gameplay and
 * cosmetic streams stay on the fixed seed. The seed() test hook re-seeds such a stream, so tests
 * stay deterministic.
 */
export function entropySeed(): number {
  const buffer = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(buffer);
  return buffer[0] || Date.now() >>> 0;
}

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
