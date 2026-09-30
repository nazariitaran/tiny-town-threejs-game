import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPHICS, GRAPHICS_PRESETS, GRAPHICS_PROFILES, isGraphicsPreset, needsReload } from './graphics';

describe('graphics presets (WP-25)', () => {
  it('Medium is the default and keeps the pre-WP-25 desktop look', () => {
    expect(DEFAULT_GRAPHICS).toBe('medium');
    expect(GRAPHICS_PROFILES.medium).toMatchObject({ maxDpr: 1.5, antialias: true, material: 'standard', shadowMapSize: 2048, decorFraction: 1, skyOctaves: 5, lampHalos: true });
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
