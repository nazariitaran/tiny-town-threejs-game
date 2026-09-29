/**
 * Town photo maths (WP-19): capture pixel ratio, Polaroid frame layout, caption and file name.
 * Pure (no DOM, no three.js) so it runs in Node tests; PhotoFrame.ts draws what this lays out.
 * WP-20: the caption's title is the player's town name, fitted to the strip (fitCaptionTitle).
 */
import { DEFAULT_TOWN_NAME, townNameSlug } from '../town/townName';
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
  /** `maxWidth`: room for the title between the badge and the sun / moon (WP-20: long town names). */
  title: { x: number; baseline: number; fontPx: number; maxWidth: number };
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
  const skyX = border + w - skySize;

  return {
    width: w + 2 * border,
    height: h + border + bottom,
    photo: { x: border, y: border, width: w, height: h },
    lineWidth: Math.max(1, Math.round(s / 700)),
    badge,
    title: { x: textX, baseline: titleBaseline, fontPx: titlePx, maxWidth: Math.max(1, skyX - Math.round(titlePx * 0.5) - textX) },
    line: { x: textX, baseline: lineBaseline, fontPx: linePx },
    sky: { x: skyX, y: Math.round(stripTop + (bottom - skySize) / 2), width: skySize, height: skySize },
  };
}

/** Which sky glyph the frame shows: a moon at night, a sun otherwise. */
export const photoSkyGlyph = (phase: DayPhase): 'sun' | 'moon' => (phase === 'night' ? 'moon' : 'sun');

/**
 * The town's name over "28 Sep 2026" (date in the player's locale unless one is given). No words for
 * the time of day: the frame's sun / moon says it (owner decision).
 */
export function photoCaption(townName: string, date: Date, locale?: string): { title: string; line: string } {
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  return { title: townName || DEFAULT_TOWN_NAME, line: day };
}

/** A long title shrinks to this share of its size before it is cut with an ellipsis. */
export const MIN_TITLE_SCALE = 0.6;

/**
 * Fit the caption title into `maxWidth` px (WP-20): full size if it fits; else a smaller font, down to
 * MIN_TITLE_SCALE; else that size with the end cut and an ellipsis. `measure(text, fontPx)` is the
 * text width in px (a canvas measureText in PhotoFrame; widths scale with the font size).
 */
export function fitCaptionTitle(
  text: string,
  maxWidth: number,
  fontPx: number,
  measure: (text: string, fontPx: number) => number,
): { text: string; fontPx: number } {
  const width = measure(text, fontPx);
  if (width <= maxWidth) return { text, fontPx };
  const minPx = Math.max(1, Math.floor(fontPx * MIN_TITLE_SCALE));
  const scaled = Math.floor((fontPx * maxWidth) / width);
  if (scaled >= minPx && measure(text, scaled) <= maxWidth) return { text, fontPx: scaled };
  const chars = Array.from(text);
  for (let keep = chars.length - 1; keep > 0; keep -= 1) {
    const cut = `${chars.slice(0, keep).join('').trimEnd()}…`;
    if (measure(cut, minPx) <= maxWidth) return { text: cut, fontPx: minPx };
  }
  return { text: '…', fontPx: minPx };
}

/** `puddleton-2026-09-28-1432.jpg`, local time; `tiny-town-…` when the name has no usable letters. */
export function photoFileName(date: Date, townName: string = DEFAULT_TOWN_NAME): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const slug = townNameSlug(townName) || townNameSlug(DEFAULT_TOWN_NAME);
  return `${slug}-${day}-${pad(date.getHours())}${pad(date.getMinutes())}.jpg`;
}
