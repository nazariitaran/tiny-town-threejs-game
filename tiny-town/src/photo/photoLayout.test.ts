import { describe, expect, it } from 'vitest';
import {
  PHOTO_LONG_EDGE,
  PHOTO_MAX_EDGE,
  fitCaptionTitle,
  MIN_TITLE_SCALE,
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
    expect(photoCaption('Puddleton', date, 'en-GB')).toEqual({ title: 'Puddleton', line: '28 Sept 2026' });
    expect(photoCaption('Puddleton', date, 'en-US').line).toBe('Sep 28, 2026');
    expect(photoCaption('', date, 'en-GB').title).toBe('Tiny Town');
  });

  it('shows the moon only at night', () => {
    expect(photoSkyGlyph('night')).toBe('moon');
    expect(photoSkyGlyph('dusk')).toBe('sun');
    expect(photoSkyGlyph('day')).toBe('sun');
  });
});

describe('fitCaptionTitle', () => {
  // A monospace stand-in for canvas measureText: every character is 0.5 em wide.
  const measure = (text: string, px: number) => Array.from(text).length * px * 0.5;

  it('keeps a title that fits at full size', () => {
    expect(fitCaptionTitle('Puddleton', 1000, 100, measure)).toEqual({ text: 'Puddleton', fontPx: 100 });
  });

  it('shrinks a longer title just enough, down to MIN_TITLE_SCALE', () => {
    // 30 chars × 50 px = 1500 px at 100 px → 1200 px wide needs 80 px.
    const fit = fitCaptionTitle('a'.repeat(30), 1200, 100, measure);
    expect(fit).toEqual({ text: 'a'.repeat(30), fontPx: 80 });
    expect(measure(fit.text, fit.fontPx)).toBeLessThanOrEqual(1200);
  });

  it('cuts with an ellipsis at the smallest size when shrinking is not enough', () => {
    const fit = fitCaptionTitle('Bobbington on Wobble Downs Xyz', 450, 100, measure);
    expect(fit.fontPx).toBe(100 * MIN_TITLE_SCALE);
    expect(fit.text.endsWith('…')).toBe(true);
    expect(measure(fit.text, fit.fontPx)).toBeLessThanOrEqual(450);
    expect(fit.text).toBe('Bobbington on…');
  });

  it('every layout leaves the title room between the badge and the sky glyph', () => {
    for (const [w, h] of [[2400, 1275], [1080, 2400], [640, 640]] as const) {
      const l = photoFrameLayout(w, h);
      expect(l.title.x).toBeGreaterThan(l.badge.x + l.badge.width);
      expect(l.title.x + l.title.maxWidth).toBeLessThan(l.sky.x);
    }
  });
});

describe('photoFileName', () => {
  it('is <town>-<date>-<hhmm>.jpg in local time, zero-padded', () => {
    expect(photoFileName(new Date(2026, 8, 28, 14, 32), 'Puddleton')).toBe('puddleton-2026-09-28-1432.jpg');
    expect(photoFileName(new Date(2027, 0, 5, 7, 3), 'Bobbington-on-Wobble')).toBe('bobbington-on-wobble-2027-01-05-0703.jpg');
  });

  it('falls back to tiny-town when there is no name or no usable letter in it', () => {
    expect(photoFileName(new Date(2026, 8, 28, 14, 32))).toBe('tiny-town-2026-09-28-1432.jpg');
    expect(photoFileName(new Date(2026, 8, 28, 14, 32), '東京')).toBe('tiny-town-2026-09-28-1432.jpg');
  });
});
