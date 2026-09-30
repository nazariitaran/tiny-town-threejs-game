/**
 * CONTRACT FILE — graphics presets (WP-25). Owned by the integrator.
 *
 * The player picks Low / Medium / High in Menu → Graphics; the choice is saved in the settings
 * (`GameSettings.graphics`) and every device starts on Medium (the look before WP-25 on desktop).
 * Measurements behind the table: `~/Desktop/tiny-town-graphics-settings/REPORT.md` (2026-09-27) and
 * the WP-24 frame-budget work (`docs/progress.md`). Most fields apply at once; `antialias` and
 * `material` are fixed when the WebGL context and the models are created, so changing them needs
 * a page reload (`needsReload`).
 */

export type GraphicsPreset = 'low' | 'medium' | 'high';

/** Menu order. */
export const GRAPHICS_PRESETS: readonly GraphicsPreset[] = ['low', 'medium', 'high'];

export const DEFAULT_GRAPHICS: GraphicsPreset = 'medium';

export interface GraphicsProfile {
  /** Device-pixel-ratio cap (live). */
  maxDpr: number;
  /** MSAA on the WebGL context (reload). */
  antialias: boolean;
  /** Lit material family for models, lawns, terrain, cars, birds (reload). Lambert keeps the flat Kenney look at ~⅔ the cost. */
  material: 'standard' | 'lambert';
  /** Sun shadow-map size (live). Shadows stay on at every level (drawn on demand since WP-24). */
  shadowMapSize: 1024 | 2048;
  /** Share of the background (decor ring) trees drawn, spread evenly around the ring (live). */
  decorFraction: number;
  /** fbm octaves in the sky's clouds (live; 5 = the full look). */
  skyOctaves: number;
  /** Frame caps (live): while interacting / when idle. See core/FrameBudget.ts. */
  activeFps: number;
  idleFps: number;
  /** Camera-facing glow halos on street lamps at night (live). */
  lampHalos: boolean;
}

export const GRAPHICS_PROFILES: Readonly<Record<GraphicsPreset, Readonly<GraphicsProfile>>> = {
  high: { maxDpr: 2, antialias: true, material: 'standard', shadowMapSize: 2048, decorFraction: 1, skyOctaves: 5, activeFps: 60, idleFps: 30, lampHalos: true },
  medium: { maxDpr: 1.5, antialias: true, material: 'standard', shadowMapSize: 2048, decorFraction: 1, skyOctaves: 5, activeFps: 60, idleFps: 30, lampHalos: true },
  low: { maxDpr: 1, antialias: false, material: 'lambert', shadowMapSize: 1024, decorFraction: 0.6, skyOctaves: 3, activeFps: 30, idleFps: 30, lampHalos: false },
};

export function isGraphicsPreset(value: unknown): value is GraphicsPreset {
  return value === 'low' || value === 'medium' || value === 'high';
}

/** True when going from the preset the page booted with to `next` needs a reload to take full effect. */
export function needsReload(booted: GraphicsPreset, next: GraphicsPreset): boolean {
  const a = GRAPHICS_PROFILES[booted];
  const b = GRAPHICS_PROFILES[next];
  return a.antialias !== b.antialias || a.material !== b.material;
}

/** Menu copy (UI). */
export const GRAPHICS_UI: Readonly<Record<GraphicsPreset, { label: string; description: string }>> = {
  low: { label: 'Low', description: 'Fastest. Softer picture, for older laptops and saving battery.' },
  medium: { label: 'Medium', description: 'Balanced. Recommended for most devices.' },
  high: { label: 'High', description: 'Sharpest picture on high-resolution screens. Uses more power.' },
};
