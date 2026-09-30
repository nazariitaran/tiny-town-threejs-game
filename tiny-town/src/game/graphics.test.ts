import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPHICS, effectivePixelRatio, GRAPHICS_PRESETS, GRAPHICS_PROFILES, isGraphicsPreset, needsReload } from './graphics';

describe('graphics presets (WP-25)', () => {
  it('Medium is the default and keeps the pre-WP-25 desktop look', () => {
    expect(DEFAULT_GRAPHICS).toBe('medium');
    expect(GRAPHICS_PROFILES.medium).toMatchObject({ maxDpr: 1.5, antialias: true, material: 'standard', shadowMapSize: 2048, decorFraction: 1, skyOctaves: 5, lampHalos: true });
  });

  it('effective pixel ratio: Low renders below the screen density on DPR-1 screens; Medium/High follow the cap', () => {
    const { low, medium, high } = GRAPHICS_PROFILES;
    // 1080p laptop / 4K monitor at 100% scaling: the DPR cap alone would change nothing.
    expect(effectivePixelRatio(1, low)).toBe(0.75);
    expect(effectivePixelRatio(1, medium)).toBe(1);
    expect(effectivePixelRatio(1, high)).toBe(1);
    // Windows 125% / 150% scaling.
    expect(effectivePixelRatio(1.25, low)).toBeCloseTo(0.9375, 6);
    expect(effectivePixelRatio(1.5, low)).toBe(1);
    expect(effectivePixelRatio(1.5, medium)).toBe(1.5);
    // Retina (DPR 2) and a phone (2.625): the caps, as before WP-25's render scale.
    expect(effectivePixelRatio(2, low)).toBe(1);
    expect(effectivePixelRatio(2, medium)).toBe(1.5);
    expect(effectivePixelRatio(2, high)).toBe(2);
    expect(effectivePixelRatio(2.625, low)).toBe(1);
    // A missing / broken devicePixelRatio counts as 1.
    expect(effectivePixelRatio(0, low)).toBe(0.75);
    expect(effectivePixelRatio(Number.NaN, medium)).toBe(1);
  });

  it('validates presets', () => {
    for (const preset of GRAPHICS_PRESETS) expect(isGraphicsPreset(preset)).toBe(true);
    for (const bad of ['ultra', 'Low', '', null, undefined, 1, {}]) expect(isGraphicsPreset(bad)).toBe(false);
  });

  it('needsReload only when MSAA or the material family differ', () => {
    expect(needsReload('medium', 'high')).toBe(false);
    expect(needsReload('high', 'medium')).toBe(false);
    expect(needsReload('medium', 'low')).toBe(true);
    expect(needsReload('low', 'medium')).toBe(true);
    expect(needsReload('low', 'high')).toBe(true);
    expect(needsReload('high', 'low')).toBe(true);
    for (const preset of GRAPHICS_PRESETS) expect(needsReload(preset, preset)).toBe(false);
  });
});
