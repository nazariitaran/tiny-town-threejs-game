/**
 * CONTRACT FILE — visual model registry: which GLB draws what, and how to normalise it.
 * Source/licence/measurements for every file: docs/assets/models.json + models.md.
 * WP-03 may tune the numeric fields (scale, rotationOffset, offset) — report changes in hand-off.
 */
import type { RoadPiece } from '../render/roadTiles';
import type { EdgeKind, GroundKind, Rotation } from '../town/types';

export interface ModelSpec {
  /** Public URL of the GLB (textures referenced relative to it). */
  url: string;
  /** Uniform scale from native units to world units (CELL_SIZE = 1 world unit). */
  scale: number;
  /** Extra quarter turns (CCW) so the model's front faces +z at rotation 0. */
  rotationOffset: Rotation;
  /** Extra translation after centring, world units [x, y, z]. */
  offset?: readonly [number, number, number];
  /** Foliage that should sway in the wind (gets its own material clone, see fx/windSway.ts). */
  sway?: boolean;
}

const M = (url: string, scale = 1, rotationOffset: Rotation = 0, extra: Partial<ModelSpec> = {}): ModelSpec => ({
  url,
  scale,
  rotationOffset,
  ...extra,
});

// Values from docs/assets/models.json (measured by scripts/inspect-models.mjs).
// Kenney city/industrial models face −Z natively ⇒ rotationOffset 2.
// Road pieces' native connections (straight W+E, corner W+S, tee W+E+S, end E) are turned
// onto the canonical set in render/roadTiles.ts (straight N+S, corner E+S, tee E+S+W, end S).
export const MODELS = {
  'road-straight': M('/assets/models/roads/road-straight.glb', 1, 1),
  'road-corner': M('/assets/models/roads/road-bend-square.glb', 1, 1),
  'road-tee': M('/assets/models/roads/road-intersection.glb', 1, 0),
  'road-cross': M('/assets/models/roads/road-crossroad.glb', 1, 0),
  'road-end': M('/assets/models/roads/road-end-round.glb', 1, 3),
  'road-single': M('/assets/models/roads/road-square.glb', 1, 0),
  'pavement-tile': M('/assets/models/roads/tile-low.glb', 1, 0),
  'tree-a': M('/assets/models/platformer/tree.glb', 0.36, 0, { sway: true }),
  'tree-b': M('/assets/models/platformer/tree-pine.glb', 0.36, 0, { sway: true }),
  'tree-c': M('/assets/models/suburban/tree-large.glb', 1, 0, { sway: true }),
  'tree-c-small': M('/assets/models/suburban/tree-small.glb', 1, 0, { sway: true }),
  // M1 (WP-03): scaled up to fill the 1×1 footprint. Wide models (a, c, c-alt, garage) are width-
  // limited at ~1.01 of a cell; the narrow type-k/-r houses grow more (largest side ≈ 0.9 cell).
  'townhouse-a': M('/assets/models/suburban/building-type-a.glb', 0.78, 2),
  'townhouse-b': M('/assets/models/suburban/building-type-k.glb', 0.88, 2),
  'townhouse-b-alt': M('/assets/models/suburban/building-type-r.glb', 0.87, 2),
  'townhouse-c': M('/assets/models/suburban/building-type-e.glb', 0.78, 2),
  'townhouse-c-alt': M('/assets/models/suburban/building-type-c.glb', 0.78, 2),
  garage: M('/assets/models/composed/garage.glb', 0.78, 2),
  'bus-stop': M('/assets/models/composed/bus-stop.glb', 1, 2),
  // M1/fix2 (WP-03): 2× so it reads as a pillar box at default zoom, not a red dot (0.21 × 0.34 tall).
  postbox: M('/assets/models/composed/postbox.glb', 2, 2),
  // Pole is at the native origin; the arm overhangs −Z. Bounds-centring moved the pole 0.078 off-centre;
  // the offset puts it back mid-cell (WP-03, measured: pole base z -0.101..-0.056 at scale 0.9, i.e.
  // 0.0867 × scale). M1: scale 1.35 (0.91 tall, eave height) so it reads as a lamp at default zoom.
  lamppost: M('/assets/models/roads/light-curved.glb', 1.35, 2, { offset: [0, 0, 0.117] }),
  'fence-tall': M('/assets/models/composed/fence-tall.glb', 1, 0),
  'fence-small': M('/assets/models/composed/fence-small.glb', 1, 0),
  // Scatter pieces for grass/meadow cells (WP-03 task 6).
  'grass-tuft': M('/assets/models/platformer/grass.glb', 0.35, 0, { sway: true }),
  'meadow-flowers': M('/assets/models/platformer/flowers.glb', 0.35, 0, { sway: true }),
  'meadow-flowers-tall': M('/assets/models/platformer/flowers-tall.glb', 0.35, 0, { sway: true }),
  // Walkway composition (WP-03 task 6): a centre hub plus an arm towards each connected neighbour.
  // Arms run along Z natively and are 0.25×0.5 at this scale (hub 0.25²). Stones = garden variant.
  'walkway-hub': M('/assets/models/suburban/path-short.glb', 1.25, 0),
  'walkway-arm': M('/assets/models/suburban/path-long.glb', 1.25, 0),
  'walkway-stones-hub': M('/assets/models/suburban/path-stones-short.glb', 1.25, 0),
  'walkway-stones-arm': M('/assets/models/suburban/path-stones-long.glb', 1.25, 0),
  // Distant decor ring outside the plot (WP-04 task 3); reuse tree-a / tree-b too.
  'decor-bush': M('/assets/models/platformer/plant.glb', 0.45, 0, { sway: true }),
  'decor-rocks': M('/assets/models/platformer/rocks.glb', 0.3, 0),
} as const satisfies Record<string, ModelSpec>;

export type ModelId = keyof typeof MODELS;

export const ROAD_PIECE_MODELS: Readonly<Record<RoadPiece, ModelId>> = {
  straight: 'road-straight',
  corner: 'road-corner',
  tee: 'road-tee',
  cross: 'road-cross',
  end: 'road-end',
  single: 'road-single',
};

/** How non-road ground kinds are drawn: a model tile, or a procedural flat tile. */
export type GroundVisual =
  | { type: 'model'; model: ModelId }
  | { type: 'flat'; color: string; height: number };

export const GROUND_MODELS: Readonly<Record<Exclude<GroundKind, 'field' | 'road'>, GroundVisual>> = {
  // Colours sampled from the Kenney kits (docs/assets/models.md). WP-03: walkway = path hub+arms
  // composition, grass/meadow = flat tile + instanced tuft/flower scatter.
  pavement: { type: 'model', model: 'pavement-tile' },
  // M1 (WP-03): walkway = warm sandstone paving (drawn as a 0.5-wide hub + arms by TownRenderer);
  // lawns pulled from kit teal toward the WP-04 field green (#84c27c), a little deeper.
  walkway: { type: 'flat', color: '#c9b99a', height: 0.016 },
  grass: { type: 'flat', color: '#6cb562', height: 0.016 },
  meadow: { type: 'flat', color: '#5fa959', height: 0.016 },
};

export const EDGE_MODELS: Readonly<Record<EdgeKind, ModelId>> = {
  'fence-tall': 'fence-tall',
  'fence-small': 'fence-small',
};
