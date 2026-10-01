/** Town photo maths: capture pixel ratio, Polaroid layout, caption and file name. Pure, for Node tests. */
import { DEFAULT_TOWN_NAME, townFileStem } from '../town/townName';
import type { DayPhase } from '../world/dayCycle';

/** Target long edge of the captured view, in device pixels, before the frame's border. */
export const PHOTO_LONG_EDGE = 2400;
/** Max capture edge, whatever the GPU allows. */
export const PHOTO_MAX_EDGE = 4096;
export const PHOTO_MIME = 'image/jpeg';
export const PHOTO_JPEG_QUALITY = 0.92;

/**
 * Pixel ratio for the photo render: at least the screen's ratio, raised until the long edge reaches
 * PHOTO_LONG_EDGE, capped so neither edge exceeds `maxEdge` (the GPU limit) or PHOTO_MAX_EDGE.
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
  width: number;
  height: number;
  /** The captured view, unscaled. */
  photo: Rect;
  /** Hairline around the photo. */
  lineWidth: number;
  badge: Rect;
  /** `maxWidth`: room for the title between the badge and the sun / moon. */
  title: { x: number; baseline: number; fontPx: number; maxWidth: number };
  line: { x: number; baseline: number; fontPx: number };
  /** Sun / moon glyph. */
  sky: Rect;
}

/** A Polaroid around the capture; proportions follow the short edge, so landscape and portrait shots match. */
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

export const photoSkyGlyph = (phase: DayPhase): 'sun' | 'moon' => (phase === 'night' ? 'moon' : 'sun');

/** The town's name over "28 Sep 2026" (in the player's locale unless one is given). */
export function photoCaption(townName: string, date: Date, locale?: string): { title: string; line: string } {
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  return { title: townName || DEFAULT_TOWN_NAME, line: day };
}

/** A long title shrinks to this share of its size before it is cut with an ellipsis. */
export const MIN_TITLE_SCALE = 0.6;

/**
 * Fits the title into `maxWidth` px: full size, else a smaller font down to MIN_TITLE_SCALE, else that
 * size cut with an ellipsis. `measure` returns the width in px and must scale with the font size.
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
  return `${townFileStem(townName, date)}.jpg`;
}
