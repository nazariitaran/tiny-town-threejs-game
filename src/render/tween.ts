/** 0 → overshoot → 1. The peak overshoot is 4·c1³ / (27·(c1+1)²), so c1 = 1.5 peaks at 1.08. */
export function easeOutBack(u: number, c1 = 1.5): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const x = u - 1;
  return 1 + (c1 + 1) * x * x * x + c1 * x * x;
}

export function easeOutBackPeak(c1: number): number {
  return 1 + (4 * c1 * c1 * c1) / (27 * (c1 + 1) * (c1 + 1));
}

/** Shrink-out: 1 → 0, slow start, fast finish. */
export function easeShrink(u: number): number {
  if (u <= 0) return 1;
  if (u >= 1) return 0;
  return 1 - u * u;
}

/** Cubic ease-in-out for the move tool's slide. */
export function moveEase(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

/** Parabola: 0 at both ends, 1 half-way. */
export function hopArc(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  return 4 * u * (1 - u);
}

/** Hop height in world units for a move of `distance` units. */
export function hopHeight(distance: number): number {
  return Math.min(0.35, 0.1 + 0.04 * Math.max(0, distance));
}

/** Stable hash of up to three integers → [0, 1): cosmetic jitter that survives reloads without consuming RNG draws. */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
