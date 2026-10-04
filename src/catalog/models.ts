import type { RoadPiece } from '../town/roadTiles';
import type { EdgeKind, GroundKind, Rotation } from '../town/types';

export interface ModelSpec {
  /** Public URL of the GLB (textures referenced relative to it). */
  url: string;
  /** Uniform scale from native units to world units (a road tile = 1). */
  scale: number;
  /** Extra quarter turns (CCW) so the model's front faces +z at rotation 0. */
  rotationOffset: Rotation;
  /** Extra translation after centring, world units [x, y, z]. */
  offset?: readonly [number, number, number];
  /** Foliage that sways in the wind (gets its own material clone). */
  sway?: boolean;
  /**
   * Night light source: the model gets a private material clone per (atlas, kind) with a swatch
   * glow mask as its emissiveMap. Never set on shared road pieces.
   */
  glow?: GlowKind;
  /** Poster slots: meshes named in `slots` (atlas cells in row-major order, 2 columns) share one material textured from the atlas. */
  posters?: { url: string; slots: readonly string[] };
}

/** What lights up at night. */
export type GlowKind = 'windows' | 'lamp' | 'traffic' | 'floodlight';

const M = (url: string, scale = 1, rotationOffset: Rotation = 0, extra: Partial<ModelSpec> = {}): ModelSpec => ({
  url,
  scale,
  rotationOffset,
  ...extra,
});

/** Homes, the supermarket and the church: ×4/3 the kit's native size, so a building fills its lot. */
const HOME_SCALE = 4 / 3;

// Kenney city/industrial models face −Z natively ⇒ rotationOffset 2.
// Road pieces' native connections (straight W+E, corner W+S, tee W+E+S, end E) are turned
// onto the canonical set in town/roadTiles.ts (straight N+S, corner E+S, tee E+S+W, end S).
export const MODELS = {
  // Roads: one tile = one aligned 2 × 2 cell road block (1 world unit), lanes ≈ 0.37.
  'road-straight': M('/assets/models/roads/road-straight.glb', 1, 1),
  'road-corner': M('/assets/models/roads/road-bend-square.glb', 1, 1),
  // Junctions use the "-line" pieces so centre lines meet; the plain ones leave a blank patch in the middle.
  'road-tee': M('/assets/models/roads/road-intersection-line.glb', 1, 0),
  'road-cross': M('/assets/models/roads/road-crossroad-line.glb', 1, 0),
  // Zebra crossing variants (ZEBRA_PIECE_MODELS).
  'road-crossing': M('/assets/models/roads/road-crossing.glb', 1, 1),
  'road-tee-zebra': M('/assets/models/roads/road-intersection-path.glb', 1, 0),
  'road-cross-zebra': M('/assets/models/roads/road-crossroad-path.glb', 1, 0),
  'road-end': M('/assets/models/roads/road-end-round.glb', 1, 3),
  'road-single': M('/assets/models/roads/road-square.glb', 1, 0),
  // One pavement tile per cell; TownRenderer doubles its height so the kerb stays 0.02.
  'pavement-tile': M('/assets/models/roads/tile-low.glb', 0.5, 0),
  // 3 × 3 road tiles (6 × 6 cells); arms at the middle of each side. Symmetric.
  roundabout: M('/assets/models/roads/road-roundabout.glb', 1, 0),
  // The pavement that fills one grass wedge (the north-west corner block, origin at the block centre); turned per corner.
  'roundabout-corner': M('/assets/models/roads/roundabout-corner.glb', 1, 0),
  // Parking lots (scripts/build-parking.py): whole road blocks, the entrance facing +Z natively.
  'parking-small': M('/assets/models/parking/parking-small.glb', 1, 0),
  'parking-medium': M('/assets/models/parking/parking-medium.glb', 1, 0),
  'parking-large': M('/assets/models/parking/parking-large.glb', 1, 0),
  // Car-park joints (ROAD_JOINT_MODELS): a road piece without its centre line on the sides that join a
  // lot (letters = those sides at rotation 0); each keeps its Kenney base's native turn.
  'road-joint-straight-n': M('/assets/models/parking/road-joint-straight-n.glb', 1, 1),
  'road-joint-straight-ns': M('/assets/models/parking/road-joint-straight-ns.glb', 1, 1),
  'road-joint-corner-e': M('/assets/models/parking/road-joint-corner-e.glb', 1, 1),
  'road-joint-corner-s': M('/assets/models/parking/road-joint-corner-s.glb', 1, 1),
  'road-joint-corner-es': M('/assets/models/parking/road-joint-corner-es.glb', 1, 1),
  'road-joint-tee-e': M('/assets/models/parking/road-joint-tee-e.glb', 1, 0),
  'road-joint-tee-s': M('/assets/models/parking/road-joint-tee-s.glb', 1, 0),
  'road-joint-tee-es': M('/assets/models/parking/road-joint-tee-es.glb', 1, 0),
  'road-joint-tee-w': M('/assets/models/parking/road-joint-tee-w.glb', 1, 0),
  'road-joint-tee-ew': M('/assets/models/parking/road-joint-tee-ew.glb', 1, 0),
  'road-joint-tee-sw': M('/assets/models/parking/road-joint-tee-sw.glb', 1, 0),
  'road-joint-tee-esw': M('/assets/models/parking/road-joint-tee-esw.glb', 1, 0),
  'road-joint-cross-n': M('/assets/models/parking/road-joint-cross-n.glb', 1, 0),
  'road-joint-cross-ne': M('/assets/models/parking/road-joint-cross-ne.glb', 1, 0),
  'road-joint-cross-ns': M('/assets/models/parking/road-joint-cross-ns.glb', 1, 0),
  'road-joint-cross-nes': M('/assets/models/parking/road-joint-cross-nes.glb', 1, 0),
  'road-joint-cross-nesw': M('/assets/models/parking/road-joint-cross-nesw.glb', 1, 0),
  'road-joint-end-s': M('/assets/models/parking/road-joint-end-s.glb', 1, 3),
  'road-joint-zebra-straight-n': M('/assets/models/parking/road-joint-zebra-straight-n.glb', 1, 1),
  'road-joint-zebra-straight-ns': M('/assets/models/parking/road-joint-zebra-straight-ns.glb', 1, 1),
  // The lamps face −X natively (not −Z like the rest of the kit), so one quarter turn puts them on +z.
  'traffic-light': M('/assets/models/roads/traffic-light.glb', 1, 1, { glow: 'traffic' }),
  // Its arm overhangs −X after the turn; like the lamppost, the offset puts the pole back mid-cell.
  'traffic-light-hanging': M('/assets/models/roads/traffic-light-hanging.glb', 1, 1, { offset: [-0.103, 0, 0], glow: 'traffic' }),
  // The pole is at the native origin and the arm overhangs −Z. Bounds-centring moves the pole
  // 0.0867 × scale off-centre; the offset puts it back mid-cell.
  lamppost: M('/assets/models/roads/light-curved.glb', 1, 2, { offset: [0, 0, 0.087], glow: 'lamp' }),
  'bus-stop': M('/assets/models/composed/bus-stop.glb', 0.8, 2),
  // ~1.2× real size so it still reads as a pillar box.
  // The pillar box with a royal cypher (scripts/build-postbox-cyphers.py), in the order of ObjectDef.variantWeights; the front faces −Z natively.
  postbox: M('/assets/models/postbox/postbox-eiir.glb', 1.4, 2),
  'postbox-vr': M('/assets/models/postbox/postbox-vr.glb', 1.4, 2),
  'postbox-evii': M('/assets/models/postbox/postbox-evii.glb', 1.4, 2),
  'postbox-gr': M('/assets/models/postbox/postbox-gr.glb', 1.4, 2),
  'postbox-eviii': M('/assets/models/postbox/postbox-eviii.glb', 1.4, 2),
  'postbox-gvir': M('/assets/models/postbox/postbox-gvir.glb', 1.4, 2),
  'postbox-ciiir': M('/assets/models/postbox/postbox-ciiir.glb', 1.4, 2),
  // The door end faces +Z natively.
  mailbox: M('/assets/models/composed/mailbox.glb', 1, 0),
  // Homes are nudged back (−z at rotation 0) so a front yard reads between the door and the street.
  cottage: M('/assets/models/suburban/building-type-a.glb', HOME_SCALE, 2, { offset: [0, 0, -0.2], glow: 'windows' }),
  townhouse: M('/assets/models/suburban/building-type-k.glb', HOME_SCALE, 2, { offset: [0, 0, -0.2], glow: 'windows' }),
  'townhouse-alt': M('/assets/models/suburban/building-type-r.glb', HOME_SCALE, 2, { offset: [0, 0, -0.2], glow: 'windows' }),
  // The L-shaped type-m is 1.90 deep, so it gets no nudge.
  bungalow: M('/assets/models/suburban/building-type-i.glb', HOME_SCALE, 2, { offset: [0, 0, -0.2], glow: 'windows' }),
  'bungalow-l': M('/assets/models/suburban/building-type-m.glb', HOME_SCALE, 2, { glow: 'windows' }),
  'family-home': M('/assets/models/suburban/building-type-e.glb', HOME_SCALE, 2, { offset: [0, 0, -0.2], glow: 'windows' }),
  'garage-house-c': M('/assets/models/suburban/building-type-c.glb', HOME_SCALE, 2, { offset: [0, 0, -0.2], glow: 'windows' }),
  'garage-house-o': M('/assets/models/suburban/building-type-o.glb', HOME_SCALE, 2, { offset: [0, 0, -0.2], glow: 'windows' }),
  'garage-house-s': M('/assets/models/suburban/building-type-s.glb', HOME_SCALE, 2, { offset: [0, 0, -0.2], glow: 'windows' }),
  'garage-house-u': M('/assets/models/suburban/building-type-u.glb', HOME_SCALE, 2, { offset: [0, 0, -0.2], glow: 'windows' }),
  // type-n is 1.84 deep, so only a small nudge.
  'big-house-d': M('/assets/models/suburban/building-type-d.glb', HOME_SCALE, 2, { offset: [0, 0, -0.2], glow: 'windows' }),
  'big-house-n': M('/assets/models/suburban/building-type-n.glb', HOME_SCALE, 2, { offset: [0, 0, -0.05], glow: 'windows' }),
  // The shop front faces +Z natively, unlike the Kenney kits.
  'corner-shop': M('/assets/models/composed/corner-shop.glb', 1.4, 0),
  // The front (awning) faces −Z natively.
  'donut-shop': M('/assets/models/composed/donut-shop.glb', 1, 2),
  supermarket: M('/assets/models/commercial/building-e.glb', HOME_SCALE, 2),
  // Tower and door face +Z natively.
  church: M('/assets/models/composed/church.glb', HOME_SCALE, 0),
  // Built to game units by scripts/build-stadium.py; the gate faces +Z natively.
  stadium: M('/assets/models/stadium/stadium.glb', 1, 0, { glow: 'floodlight' }),
  // Built to game units by scripts/build-cinema.py; the facade faces +Z natively.
  cinema: M('/assets/models/cinema/cinema.glb', 1, 0, {
    posters: { url: '/assets/posters/cinema-posters.webp', slots: ['poster-1', 'poster-2', 'poster-3', 'poster-4'] },
  }),
  // Composed from Fantasy Town fountain modules and parasols.
  'swimming-pool': M('/assets/models/composed/swimming-pool.glb', 0.5, 2),
  fountain: M('/assets/models/composed/fountain.glb', 0.45, 0),
  'tiered-fountain': M('/assets/models/composed/tiered-fountain.glb', 1, 0),
  // Trees ≈ cottage height (~0.88), except the oak: a big round tree whose crown fills its 2 × 2 cell lot.
  oak: M('/assets/models/platformer/tree.glb', 0.9, 0, { sway: true }),
  pine: M('/assets/models/platformer/tree-pine.glb', 0.45, 0, { sway: true }),
  birch: M('/assets/models/suburban/tree-large.glb', 1.15, 0, { sway: true }),
  'birch-small': M('/assets/models/suburban/tree-small.glb', 1.15, 0, { sway: true }),
  // The oak's canopy, sunk so the trunk is hidden and squashed by MODEL_STYLES (the platformer plant
  // reads as birds from above).
  bush: M('/assets/models/platformer/tree.glb', 0.3, 0, { sway: true, offset: [0, -0.26, 0] }),
  // Recoloured by compose-models.mjs (natureMaterials); one model per flower shape.
  'tulips-a': M('/assets/models/composed/tulips-a.glb', 1, 0, { sway: true }),
  'tulips-b': M('/assets/models/composed/tulips-b.glb', 1, 0, { sway: true }),
  'tulips-c': M('/assets/models/composed/tulips-c.glb', 1, 0, { sway: true }),
  planter: M('/assets/models/suburban/planter.glb', 1, 2),
  // The seat faces +Z natively.
  bench: M('/assets/models/holiday/bench.glb', 0.3, 0),
  // Both run along Z natively; a quarter turn lays them along X like the park bench.
  'long-bench': M('/assets/models/fantasy-town/stall-bench.glb', 0.5, 1),
  'garden-table': M('/assets/models/fantasy-town/stall.glb', 0.5, 1),
  swing: M('/assets/models/composed/swing.glb', 0.87, 0),
  slide: M('/assets/models/composed/slide.glb', 1, 0),
  barbecue: M('/assets/models/composed/barbecue.glb', 1, 0),
  // Edge pieces are 1 native unit along X (one cell at scale 0.5); MODEL_STYLES restores fence height.
  hedge: M('/assets/models/platformer/hedge.glb', 0.5, 0),
  'fence-tall': M('/assets/models/composed/fence-tall.glb', 0.5, 0),
  'fence-low': M('/assets/models/composed/fence-small.glb', 0.5, 0),
  // Scatter for grass/meadow cells, one clump per cell.
  'grass-tuft': M('/assets/models/platformer/grass.glb', 0.35, 0, { sway: true }),
  'meadow-flowers': M('/assets/models/platformer/flowers.glb', 0.35, 0, { sway: true }),
  'meadow-flowers-tall': M('/assets/models/platformer/flowers-tall.glb', 0.35, 0, { sway: true }),
  // The ghost preview uses the hub; TownRenderer draws walkways procedurally.
  // At 1.25 the hub is 0.25², the walkway width (0.5 · CELL_SIZE).
  'walkway-hub': M('/assets/models/suburban/path-short.glb', 1.25, 0),
  'walkway-arm': M('/assets/models/suburban/path-long.glb', 1.25, 0),
  'walkway-stones-hub': M('/assets/models/suburban/path-stones-short.glb', 1.25, 0),
  'walkway-stones-arm': M('/assets/models/suburban/path-stones-long.glb', 1.25, 0),
  // Distant decor ring outside the plot; it also reuses oak / pine.
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

/**
 * A road block under a Zebra crossing (ObjectDef.roadMarking) draws these instead of
 * ROAD_PIECE_MODELS; other pieces (corner, end, single) have no zebra and draw plain.
 */
export const ZEBRA_PIECE_MODELS: Readonly<Partial<Record<RoadPiece, ModelId>>> = {
  straight: 'road-crossing',
  tee: 'road-tee-zebra',
  cross: 'road-cross-zebra',
};

/**
 * A road block joining a car park (ObjectDef.plainJoin) draws these instead of ROAD_PIECE_MODELS,
 * keyed by the piece's lot sides at rotation 0 (N=1, E=2, S=4, W=8) as roadJointFor returns them.
 */
export const ROAD_JOINT_MODELS: Readonly<Partial<Record<RoadPiece, Readonly<Record<number, ModelId>>>>> = {
  straight: { 1: 'road-joint-straight-n', 5: 'road-joint-straight-ns' },
  corner: { 2: 'road-joint-corner-e', 4: 'road-joint-corner-s', 6: 'road-joint-corner-es' },
  tee: { 2: 'road-joint-tee-e', 4: 'road-joint-tee-s', 6: 'road-joint-tee-es', 8: 'road-joint-tee-w', 10: 'road-joint-tee-ew', 12: 'road-joint-tee-sw', 14: 'road-joint-tee-esw' },
  cross: { 1: 'road-joint-cross-n', 3: 'road-joint-cross-ne', 5: 'road-joint-cross-ns', 7: 'road-joint-cross-nes', 15: 'road-joint-cross-nesw' },
  end: { 4: 'road-joint-end-s' },
};

/** The zebra straight beside a car park; the zebra tee and cross have no centre lines to remove. */
export const ZEBRA_JOINT_MODELS: Readonly<Partial<Record<RoadPiece, Readonly<Record<number, ModelId>>>>> = {
  straight: { 1: 'road-joint-zebra-straight-n', 5: 'road-joint-zebra-straight-ns' },
};

/** How non-road ground kinds are drawn: a model tile, or a procedural flat tile. */
export type GroundVisual =
  | { type: 'model'; model: ModelId }
  | { type: 'flat'; color: string; height: number };

export const GROUND_MODELS: Readonly<Record<Exclude<GroundKind, 'field' | 'road'>, GroundVisual>> = {
  // Colours sampled from the Kenney kits; grass/meadow also get an instanced tuft/flower scatter.
  pavement: { type: 'model', model: 'pavement-tile' },
  // Drawn as a 0.5-wide hub + arms by TownRenderer.
  walkway: { type: 'flat', color: '#c9b99a', height: 0.016 },
  grass: { type: 'flat', color: '#6cb562', height: 0.016 },
  // Same lawn as grass; only the flower scatter differs.
  meadow: { type: 'flat', color: '#6cb562', height: 0.016 },
};

export const EDGE_MODELS: Readonly<Record<EdgeKind, ModelId>> = {
  hedge: 'hedge',
  'fence-low': 'fence-low',
  'fence-tall': 'fence-tall',
};
