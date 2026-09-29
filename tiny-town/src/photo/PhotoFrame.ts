/**
 * Draws the Polaroid around a captured view and encodes it (WP-19). Layout comes from
 * photoLayout.ts; colours and glyphs match the UI (cream panel, ink, brick brand badge,
 * the time-of-day sun / moon), so the photo looks like part of the game. The title is the
 * player's town name (WP-20), shrunk or cut to fit the strip.
 */
import { GLYPHS } from '../ui/glyphs';
import type { DayPhase } from '../world/dayCycle';
import { fitCaptionTitle, PHOTO_JPEG_QUALITY, PHOTO_MIME, photoCaption, photoFrameLayout, photoSkyGlyph, type Rect } from './photoLayout';

const PAPER_TOP = '#fffbf3';
const PAPER_BOTTOM = '#fbf1df';
const INK = '#3b3a36';
const INK_SOFT = '#6f685c';
const BRICK = '#e0674f';
const HAIRLINE = 'rgba(60, 40, 20, 0.16)';
const SKY_COLOUR: Record<'sun' | 'moon', string> = { sun: '#e7a92c', moon: '#5b6cb8' };
const FONT_STACK = "'Nunito Variable', 'Nunito', ui-rounded, system-ui, -apple-system, 'Segoe UI', sans-serif";

export interface FramedPhoto {
  blob: Blob;
  width: number;
  height: number;
}

/** A UI glyph (24 × 24, stroked in currentColor) as an image in `colour`, `size` px square. */
async function glyphImage(svg: string, colour: string, size: number, strokeWidth?: number): Promise<HTMLImageElement> {
  let markup = svg
    .replace('class="ui-glyph" ', '')
    .replace('width="24" height="24"', `width="${size}" height="${size}"`)
    .replaceAll('currentColor', colour);
  if (strokeWidth) markup = markup.replace('stroke-width="2"', `stroke-width="${strokeWidth}"`);
  markup = markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  const image = new Image(size, size);
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await image.decode();
  return image;
}

function roundedRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, radius);
}

async function loadFonts(fonts: string[]): Promise<void> {
  if (!document.fonts) return;
  try {
    await Promise.all(fonts.map((font) => document.fonts.load(font)));
  } catch {
    // The system rounded sans in FONT_STACK is fine.
  }
}

function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The photo could not be encoded'))), PHOTO_MIME, PHOTO_JPEG_QUALITY);
  });
}

export async function framePhoto(shot: HTMLCanvasElement, phase: DayPhase, date: Date, townName: string): Promise<FramedPhoto> {
  const layout = photoFrameLayout(shot.width, shot.height);
  const caption = photoCaption(townName, date);
  const titleFontAt = (px: number) => `800 ${px}px ${FONT_STACK}`;
  const titleFont = titleFontAt(layout.title.fontPx);
  const lineFont = `700 ${layout.line.fontPx}px ${FONT_STACK}`;
  const sky = photoSkyGlyph(phase);
  const [house, skyImage] = await Promise.all([
    glyphImage(GLYPHS.homes, '#ffffff', Math.round(layout.badge.width * 0.66), 2.6),
    glyphImage(sky === 'sun' ? GLYPHS.timeDay : GLYPHS.timeNight, SKY_COLOUR[sky], layout.sky.width, 2.2),
    loadFonts([titleFont, lineFont]),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas for the photo');

  // Paper: cream, a touch warmer towards the caption.
  const paper = ctx.createLinearGradient(0, 0, 0, layout.height);
  paper.addColorStop(0, PAPER_TOP);
  paper.addColorStop(1, PAPER_BOTTOM);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, layout.width, layout.height);

  // The view, 1:1, with a hairline so bright skies don't melt into the paper.
  const p = layout.photo;
  ctx.drawImage(shot, p.x, p.y);
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = layout.lineWidth;
  ctx.strokeRect(p.x - layout.lineWidth / 2, p.y - layout.lineWidth / 2, p.width + layout.lineWidth, p.height + layout.lineWidth);

  // Brand badge: the top bar's brick square with the white house.
  const b = layout.badge;
  ctx.fillStyle = BRICK;
  roundedRect(ctx, b, b.width * 0.28);
  ctx.fill();
  ctx.drawImage(house, b.x + (b.width - house.width) / 2, b.y + (b.height - house.height) / 2);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  const title = fitCaptionTitle(caption.title, layout.title.maxWidth, layout.title.fontPx, (text, px) => {
    ctx.font = titleFontAt(px);
    return ctx.measureText(text).width;
  });
  ctx.font = titleFontAt(title.fontPx);
  ctx.fillText(title.text, layout.title.x, layout.title.baseline);
  ctx.fillStyle = INK_SOFT;
  ctx.font = lineFont;
  ctx.fillText(caption.line, layout.line.x, layout.line.baseline);

  ctx.drawImage(skyImage, layout.sky.x, layout.sky.y);

  const blob = await encode(canvas);
  return { blob, width: layout.width, height: layout.height };
}
