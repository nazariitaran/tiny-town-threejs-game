import { ROAD_JOINT_MODELS, ZEBRA_JOINT_MODELS, type ModelId } from '../catalog/models';

/** Per-model look overrides. `color` replaces the atlas colour (the map is dropped); `scale` is a non-uniform local scale. */
export interface ModelStyle {
  color?: string;
  /** Warm the atlas's light periwinkle texels (kerb, paving, lane paint) to cream-grey stone. */
  warmAtlas?: boolean;
  scale?: readonly [number, number, number];
}
export const MODEL_STYLES: Readonly<Partial<Record<ModelId, ModelStyle>>> = {
  // Doubling Y keeps the tile's top at the road kerb (y = 0.02).
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
  // Fences stay one cell long; Y restores a readable height.
  'fence-tall': { color: '#f2eadb', scale: [1, 1.8, 1] },
  'fence-low': { color: '#9a6a42', scale: [1, 1.4, 1] },
  // A little longer so neighbouring runs close up at corners.
  hedge: { scale: [1.12, 1, 1] },
  // The oak canopy squashed into a low shrub (the model's offset sinks the trunk).
  bush: { scale: [1, 0.58, 1] },
  // Same warm stone kerbs as the road pieces.
  roundabout: { warmAtlas: true },
  'parking-small': { warmAtlas: true },
  'parking-medium': { warmAtlas: true },
  'parking-large': { warmAtlas: true },
  // The car-park joints are road pieces too.
  ...Object.fromEntries(
    [ROAD_JOINT_MODELS, ZEBRA_JOINT_MODELS].flatMap((table) => Object.values(table).flatMap((byLots) => Object.values(byLots))).map((id) => [id, { warmAtlas: true }]),
  ),
  // Darker and stouter so the lamp reads against the field.
  lamppost: { color: '#46505e', scale: [1.5, 1, 1.15] },
};
