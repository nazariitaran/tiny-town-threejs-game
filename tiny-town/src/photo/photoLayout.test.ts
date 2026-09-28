import { describe, expect, it } from 'vitest';
import {
  PHOTO_LONG_EDGE,
  PHOTO_MAX_EDGE,
  photoCaption,
  photoFileName,
  photoFrameLayout,
  photoPixelRatio,
  photoSkyGlyph,
} from './photoLayout';

describe('photoPixelRatio', () => {
  it('raises the ratio until the long edge reaches PHOTO_LONG_EDGE', () => {
    // Pixel 7 portrait at the low-tier ratio 1.5: 915 css px long → 2400 / 915.
    const r = photoPixelRatio(412, 915, 1.5, 16384);
    expect(Math.round(915 * r)).toBe(PHOTO_LONG_EDGE);
  });

  it('never goes below the screen ratio (a retina desktop is already sharp enough)', () => {
    expect(photoPixelRatio(1280, 720, 2, 16384)).toBe(2);
    expect(photoPixelRatio(2560, 1440, 1, 16384)).toBe(1);
  });

  it('caps both edges at the GPU limit and at PHOTO_MAX_EDGE', () => {
    expect(1280 * photoPixelRatio(1280, 720, 1, 2048)).toBeLessThanOrEqual(2048);
    expect(1920 * photoPixelRatio(1920, 1080, 3, 16384)).toBeLessThanOrEqual(PHOTO_MAX_EDGE);
    // Even below the screen ratio when the GPU cannot do more.
    expect(photoPixelRatio(1920, 1080, 2, 2048)).toBeCloseTo(2048 / 1920);
  });

  it('survives a zero-size canvas', () => {
    expect(Number.isFinite(photoPixelRatio(0, 0, 1, 4096))).toBe(true);
  });
});

describe('photoFrameLayout', () => {
  for (const [w, h] of [
    [2560, 1440],
    [1070, 2400],
    [1600, 1600],
  ]) {
    it(`frames a ${w} × ${h} capture as a Polaroid`, () => {
      const l = photoFrameLayout(w, h);
      const s = Math.min(w, h);
      // The capture is placed 1:1, with equal borders left, right and top.
      expect(l.photo).toEqual({ x: l.photo.x, y: l.photo.x, width: w, height: h });
      expect(l.width - l.photo.width - l.photo.x).toBe(l.photo.x);
      // Deep bottom strip, about 4× the side border.
      const bottom = l.height - l.photo.y - l.photo.height;
      expect(bottom / l.photo.x).toBeGreaterThan(3.5);
      expect(bottom).toBeCloseTo(s * 0.2, -1);
      // The caption sits inside the strip, title above the date line, nothing past the card.
      const stripTop = l.photo.y + l.photo.height;
      expect(l.title.baseline - l.title.fontPx * 0.74).toBeGreaterThan(stripTop);
      expect(l.line.baseline).toBeGreaterThan(l.title.baseline);
      expect(l.line.baseline + l.line.fontPx * 0.3).toBeLessThan(l.height);
      expect(l.badge.y).toBeGreaterThan(stripTop);
      expect(l.badge.x + l.badge.width).toBeLessThan(l.title.x);
      expect(l.sky.x + l.sky.width).toBe(l.photo.x + l.photo.width);
      expect(l.sky.y + l.sky.height).toBeLessThan(l.height);
    });
  }

  it('scales the caption with the short edge (desktop and phone look alike)', () => {
    const wide = photoFrameLayout(2560, 1440);
    const tall = photoFrameLayout(1440, 2560);
    expect(wide.title.fontPx).toBe(tall.title.fontPx);
    expect(wide.height - wide.photo.height).toBe(tall.height - tall.photo.height);
  });
});

describe('photoCaption', () => {
  const date = new Date(2026, 8, 28, 14, 32);

  it('names the town and the date only: no stats, no time-of-day words (the icon says it)', () => {
    expect(photoCaption(date, 'en-GB')).toEqual({ title: 'Tiny Town', line: '28 Sept 2026' });
    expect(photoCaption(date, 'en-US').line).toBe('Sep 28, 2026');
  });

  it('shows the moon only at night', () => {
    expect(photoSkyGlyph('night')).toBe('moon');
    expect(photoSkyGlyph('dusk')).toBe('sun');
    expect(photoSkyGlyph('day')).toBe('sun');
  });
});

describe('photoFileName', () => {
  it('is tiny-town-<date>-<hhmm>.jpg in local time, zero-padded', () => {
    expect(photoFileName(new Date(2026, 8, 28, 14, 32))).toBe('tiny-town-2026-09-28-1432.jpg');
    expect(photoFileName(new Date(2027, 0, 5, 7, 3))).toBe('tiny-town-2027-01-05-0703.jpg');
  });
});
