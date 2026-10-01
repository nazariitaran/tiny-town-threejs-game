/**
 * Graphics presets, picked in Menu → Graphics and saved in the settings. "Live" fields apply at once;
 * `antialias` and `material` are fixed when the WebGL context and the models are created, so they need a reload.
 */

export type GraphicsPreset = 'low' | 'medium' | 'high';

/** Menu order. */
export const GRAPHICS_PRESETS: readonly GraphicsPreset[] = ['low', 'medium', 'high'];

export const DEFAULT_GRAPHICS: GraphicsPreset = 'medium';

export interface GraphicsProfile {
  /** Device-pixel-ratio cap (live). */
  maxDpr: number;
  /**
   * Share of the screen's pixel density to render at, before the cap (live). Below 1 on Low so it draws
   * fewer pixels on DPR-1 screens, where the cap alone changes nothing; the browser upscales the canvas.
   */
  renderScale: number;
  /** MSAA on the WebGL context (reload). */
  antialias: boolean;
  /** Lit material family for models, lawns, terrain, cars, birds (reload). Lambert keeps the flat Kenney look at ~⅔ the cost. */
  material: 'standard' | 'lambert';
  /** Sun shadow-map size (live). */
  shadowMapSize: 1024 | 2048;
  /** Share of the background (decor ring) trees drawn, spread evenly around the ring (live). */
  decorFraction: number;
  /** fbm octaves in the sky's clouds (live; 5 = the full look). */
  skyOctaves: number;
  /** Frame caps (live): while interacting / when idle. */
  activeFps: number;
  idleFps: number;
  /** Camera-facing glow halos on street lamps at night (live). */
  lampHalos: boolean;
}

export const GRAPHICS_PROFILES: Readonly<Record<GraphicsPreset, Readonly<GraphicsProfile>>> = {
  high: { maxDpr: 2, renderScale: 1, antialias: true, material: 'standard', shadowMapSize: 2048, decorFraction: 1, skyOctaves: 5, activeFps: 60, idleFps: 30, lampHalos: true },
  medium: { maxDpr: 1.5, renderScale: 1, antialias: true, material: 'standard', shadowMapSize: 2048, decorFraction: 1, skyOctaves: 5, activeFps: 60, idleFps: 30, lampHalos: true },
  low: { maxDpr: 1, renderScale: 0.75, antialias: false, material: 'lambert', shadowMapSize: 1024, decorFraction: 0.6, skyOctaves: 3, activeFps: 30, idleFps: 30, lampHalos: false },
};

/** Canvas pixel ratio: `deviceRatio` (window.devicePixelRatio) × renderScale, capped at maxDpr. */
export function effectivePixelRatio(deviceRatio: number, profile: Readonly<Pick<GraphicsProfile, 'maxDpr' | 'renderScale'>>): number {
  const device = deviceRatio > 0 && Number.isFinite(deviceRatio) ? deviceRatio : 1;
  return Math.min(device * profile.renderScale, profile.maxDpr);
}

export function isGraphicsPreset(value: unknown): value is GraphicsPreset {
  return value === 'low' || value === 'medium' || value === 'high';
}

/** True when going from the preset the page booted with to `next` needs a reload to take full effect. */
export function needsReload(booted: GraphicsPreset, next: GraphicsPreset): boolean {
  const a = GRAPHICS_PROFILES[booted];
  const b = GRAPHICS_PROFILES[next];
  return a.antialias !== b.antialias || a.material !== b.material;
}

export const GRAPHICS_UI: Readonly<Record<GraphicsPreset, { label: string; description: string }>> = {
  low: { label: 'Low', description: 'Fastest. Softer picture, for older laptops and saving battery.' },
  medium: { label: 'Medium', description: 'Balanced. Recommended for most devices.' },
  high: { label: 'High', description: 'Sharpest picture on high-resolution screens. Uses more power.' },
};
