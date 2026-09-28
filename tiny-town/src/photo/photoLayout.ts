/**
 * Town photo maths (WP-19): capture pixel ratio, Polaroid frame layout, caption and file name.
 * Pure (no DOM, no three.js) so it runs in Node tests; PhotoFrame.ts draws what this lays out.
 */
import type { DayPhase } from '../world/dayCycle';

/** Wanted long edge of the captured 3D view, in device pixels (the frame adds a border around it). */
export const PHOTO_LONG_EDGE = 2400;
/** Never render the capture larger than this on either edge, whatever the GPU allows. */
export const PHOTO_MAX_EDGE = 4096;
export const PHOTO_MIME = 'image/jpeg';
export const PHOTO_JPEG_QUALITY = 0.92;

/**
 * Pixel ratio for the one-frame photo render: at least the screen's own ratio, raised until the long
 * edge reaches PHOTO_LONG_EDGE, and capped so neither edge exceeds `maxEdge` (the GPU's renderbuffer /
 * viewport limit) or PHOTO_MAX_EDGE.
 */
export function photoPixelRatio(cssWidth: number, cssHeight: number, screenRatio: number, maxEdge: number): number {
  const long = Math.max(1, cssWidth, cssHeight);
  const cap = Math.min(maxEdge, PHOTO_MAX_EDGE) / long;
  return Math.min(Math.max(screenRatio, PHOTO_LONG_EDGE / long), cap);
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything PhotoFrame draws, in pixels of the final image. */
export interface PhotoFrameLayout {
  /** The whole card = the saved image. */
  width: number;
  height: number;
  /** Where the captured view goes (its own size, never scaled). */
  photo: Rect;
  /** Hairline around the photo. */
  lineWidth: number;
  /** Brand badge (brick square with the house glyph), left of the title. */
  badge: Rect;
  title: { x: number; baseline: number; fontPx: number };
  line: { x: number; baseline: number; fontPx: number };
  /** Sun / moon glyph, right-aligned in the bottom strip. */
  sky: Rect;
}

/**
 * A Polaroid around a `photoWidth × photoHeight` capture. Proportions follow the short edge, so a
 * landscape desktop shot and a portrait phone shot get the same look: a thin border on three sides
 * and a deep bottom strip holding the caption.
 */
export function photoFrameLayout(photoWidth: number, photoHeight: number): PhotoFrameLayout {
  const w = Math.max(1, Math.round(photoWidth));
  const h = Math.max(1, Math.round(photoHeight));
  const s = Math.min(w, h);
  const border = Math.round(s * 0.05);
  const bottom = Math.round(s * 0.2);
  const titlePx = Math.round(s * 0.064);
  const linePx = Math.round(s * 0.036);
  const gap = Math.round(s * 0.014);

  // Caption block (title cap height + gap + line) centred in the bottom strip.
  const stripTop = border + h;
  const blockHeight = titlePx * 0.74 + gap + linePx * 0.95;
  const titleBaseline = Math.round(stripTop + (bottom - blockHeight) / 2 + titlePx * 0.74);
  const lineBaseline = Math.round(titleBaseline + gap + linePx * 0.95);

  const badgeSize = Math.round(titlePx * 1.05);
  const badge = { x: border, y: Math.round(titleBaseline - titlePx * 0.74 / 2 - badgeSize / 2), width: badgeSize, height: badgeSize };
  const textX = border + badgeSize + Math.round(titlePx * 0.32);
  const skySize = Math.round(titlePx * 1.15);

  return {
    width: w + 2 * border,
    height: h + border + bottom,
    photo: { x: border, y: border, width: w, height: h },
    lineWidth: Math.max(1, Math.round(s / 700)),
    badge,
    title: { x: textX, baseline: titleBaseline, fontPx: titlePx },
    line: { x: textX, baseline: lineBaseline, fontPx: linePx },
    sky: { x: border + w - skySize, y: Math.round(stripTop + (bottom - skySize) / 2), width: skySize, height: skySize },
  };
}

/** Caption words for each part of the day. */
export const PHOTO_PHASE_LABEL: Readonly<Record<DayPhase, string>> = {
  dawn: 'Sunrise',
  day: 'Daytime',
  dusk: 'Sunset',
  night: 'Night',
};

/** Which sky glyph the frame shows: a moon at night, a sun otherwise. */
export const photoSkyGlyph = (phase: DayPhase): 'sun' | 'moon' => (phase === 'night' ? 'moon' : 'sun');

/** "Tiny Town" plus "28 Sep 2026 · Night" (date in the player's locale unless one is given). */
export function photoCaption(date: Date, phase: DayPhase, locale?: string): { title: string; line: string } {
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  return { title: 'Tiny Town', line: `${day} · ${PHOTO_PHASE_LABEL[phase]}` };
}

/** `tiny-town-2026-09-28-1432.jpg`, local time. */
export function photoFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `tiny-town-${day}-${pad(date.getHours())}${pad(date.getMinutes())}.jpg`;
}
