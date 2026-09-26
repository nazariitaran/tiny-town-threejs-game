import { describe, expect, it } from 'vitest';
import { E, N, S, W, roadTileFor, rotateMask } from './roadTiles';

describe('road auto-tiling', () => {
  it('rotates masks counter-clockwise (E→N, S→E)', () => {
    expect(rotateMask(E, 1)).toBe(N);
    expect(rotateMask(S, 1)).toBe(E);
    expect(rotateMask(N | S, 1)).toBe(E | W);
    expect(rotateMask(E | S, 4)).toBe(E | S);
  });

  it('maps every one of the 16 masks to a piece', () => {
    for (let mask = 0; mask < 16; mask += 1) {
      const { piece, rotation } = roadTileFor(mask);
      expect(piece).toBeTruthy();
      expect(rotation).toBeGreaterThanOrEqual(0);
    }
  });

  it('picks the expected pieces', () => {
    expect(roadTileFor(0).piece).toBe('single');
    expect(roadTileFor(N | S)).toEqual({ piece: 'straight', rotation: 0 });
    expect(roadTileFor(E | W)).toEqual({ piece: 'straight', rotation: 1 });
    expect(roadTileFor(E | S)).toEqual({ piece: 'corner', rotation: 0 });
    expect(roadTileFor(N | E)).toEqual({ piece: 'corner', rotation: 1 });
    expect(roadTileFor(N | E | S | W).piece).toBe('cross');
    expect(roadTileFor(N | E | W)).toEqual({ piece: 'tee', rotation: 2 });
    expect(roadTileFor(W)).toEqual({ piece: 'end', rotation: 3 });
  });
});
