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
  /** Uniform scale from native units to world units (WP-12: CELL_SIZE = 0.5, a road tile = 1). */
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
  // Roads: one tile = one aligned 2 × 2 cell road block (ROAD_TILE_SIZE = 1 world unit), lanes ≈ 0.37.
  'road-straight': M('/assets/models/roads/road-straight.glb', 1, 1),
  'road-corner': M('/assets/models/roads/road-bend-square.glb', 1, 1),
  'road-tee': M('/assets/models/roads/road-intersection.glb', 1, 0),
  'road-cross': M('/assets/models/roads/road-crossroad.glb', 1, 0),
  'road-end': M('/assets/models/roads/road-end-round.glb', 1, 3),
  'road-single': M('/assets/models/roads/road-square.glb', 1, 0),
  // WP-12: one pavement tile per 0.5 cell (TownRenderer doubles its height so the kerb stays 0.02).
  'pavement-tile': M('/assets/models/roads/tile-low.glb', 0.5, 0),
  // WP-12 proportions (toy scale 1 unit ≈ 8 m): trees ≈ cottage height (~0.88), below townhouse ridges.
  'tree-a': M('/assets/models/platformer/tree.glb', 0.45, 0, { sway: true }),
  'tree-b': M('/assets/models/platformer/tree-pine.glb', 0.45, 0, { sway: true }),
  'tree-c': M('/assets/models/suburban/tree-large.glb', 1.15, 0, { sway: true }),
  'tree-c-small': M('/assets/models/suburban/tree-small.glb', 1.15, 0, { sway: true }),
  // WP-12: houses at the kit's native scale on 3×3 (cottage, family home) / 2×3 (townhouse) cells,
  // nudged 0.15 back (−z at rotation 0) so a front yard reads between the door and the street.
  'townhouse-a': M('/assets/models/suburban/building-type-a.glb', 1, 2, { offset: [0, 0, -0.15] }),
  'townhouse-b': M('/assets/models/suburban/building-type-k.glb', 1, 2, { offset: [0, 0, -0.15] }),
  'townhouse-b-alt': M('/assets/models/suburban/building-type-r.glb', 1, 2, { offset: [0, 0, -0.15] }),
  'townhouse-c': M('/assets/models/suburban/building-type-e.glb', 1, 2, { offset: [0, 0, -0.15] }),
  'townhouse-c-alt': M('/assets/models/suburban/building-type-c.glb', 1, 2, { offset: [0, 0, -0.15] }),
  // WP-12: single garage on 1×2 cells (0.49 × 0.41 × 0.62), lower than the eaves.
  garage: M('/assets/models/composed/garage.glb', 0.48, 2),
  // WP-12: 2×1 cells (0.76 × 0.34 × 0.37).
  'bus-stop': M('/assets/models/composed/bus-stop.glb', 0.8, 2),
  // WP-12: ≈ car height (0.15 × 0.24), ~1.2× real so it still reads as a pillar box.
  postbox: M('/assets/models/composed/postbox.glb', 1.4, 2),
  // Pole is at the native origin; the arm overhangs −Z. Bounds-centring moves the pole 0.0867 × scale
  // off-centre; the offset puts it back mid-cell. WP-12: scale 1 (0.675 tall, arm 0.2): taller than
  // the garage and the bus-stop bench, below the eaves.
  lamppost: M('/assets/models/roads/light-curved.glb', 1, 2, { offset: [0, 0, 0.087] }),
  // WP-12: fences are one cell (0.5) long; TownRenderer's MODEL_STYLES restores their height.
  'fence-tall': M('/assets/models/composed/fence-tall.glb', 0.5, 0),
  'fence-small': M('/assets/models/composed/fence-small.glb', 0.5, 0),
  // Scatter pieces for grass/meadow cells (WP-03 task 6). WP-12: one clump per 0.5 cell.
  'grass-tuft': M('/assets/models/platformer/grass.glb', 0.35, 0, { sway: true }),
  'meadow-flowers': M('/assets/models/platformer/flowers.glb', 0.35, 0, { sway: true }),
  'meadow-flowers-tall': M('/assets/models/platformer/flowers-tall.glb', 0.35, 0, { sway: true }),
  // Walkway kit pieces (the ghost preview uses the hub; TownRenderer draws walkways procedurally).
  // At 1.25 the hub is 0.25² = the WP-12 walkway width (0.5 · CELL_SIZE).
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
