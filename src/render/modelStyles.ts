/**
 * MODEL_STYLES, used by TownRenderer (tint, atlas warming, non-uniform scale), NightLights (the
 * lamppost's scale) and the catalog size test, so neither needs to import the renderer. Pure data.
 */
import type { ModelId } from '../catalog/models';

/**
 * Per-model look overrides (M1 review). `color` replaces the atlas colour (map dropped): the Kenney
 * roads atlas pavement is periwinkle, the composed tall fence is the same brown as the low one.
 * `scale` is a non-uniform local scale (fences must stay exactly one cell long, so only Y grows).
 */
export interface ModelStyle {
  color?: string;
  /** Warm the atlas's light periwinkle texels (kerb, paving, lane paint) to cream-grey stone. */
  warmAtlas?: boolean;
  scale?: readonly [number, number, number];
}
export const MODEL_STYLES: Readonly<Partial<Record<ModelId, ModelStyle>>> = {
  // WP-12: the tile is scaled 0.5 to one cell; doubling Y keeps its top at the road kerb (y = 0.02).
  'pavement-tile': { warmAtlas: true, scale: [1, 2, 1] },
  'road-straight': { warmAtlas: true },
  'road-corner': { warmAtlas: true },
  'road-tee': { warmAtlas: true },
  'road-cross': { warmAtlas: true },
  'road-end': { warmAtlas: true },
  'road-single': { warmAtlas: true },
  'road-crossing': { warmAtlas: true },
  'road-tee-zebra': { warmAtlas: true },
  'road-cross-zebra': { warmAtlas: true },
  // WP-12: fences are 0.5 long (scale 0.5); Y restores a readable height: ≈ 1.65 m / 0.8 m at toy scale.
  'fence-tall': { color: '#f2eadb', scale: [1, 1.8, 1] },
  'fence-low': { color: '#9a6a42', scale: [1, 1.4, 1] },
  // v0.3: the hedge is 0.5 long; a little longer so neighbouring runs close up at corners.
  hedge: { scale: [1.12, 1, 1] },
  // v0.3: the oak canopy squashed into a low round shrub (the model's offset sinks the trunk).
  bush: { scale: [1, 0.58, 1] },
  // The roundabout is a road tile: same warm stone kerbs as the other road pieces.
  roundabout: { warmAtlas: true },
  // Thin grey hook → darker, slightly stouter iron lamp that reads against the field.
  lamppost: { color: '#46505e', scale: [1.5, 1, 1.15] },
};
