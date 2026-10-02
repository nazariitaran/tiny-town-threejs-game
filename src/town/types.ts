/**
 * Town data model. Grid conventions:
 *  - The plot is `width × depth` cells. Cell {x, z}: x ∈ [0, width), z ∈ [0, depth).
 *  - +x → world +X (east), +z → world +Z (south, towards the default camera).
 *  - Edges are canonicalised as the NORTH (−z) or WEST (−x) side of a cell.
 *    The east side of (x, z) is {x: x + 1, z, side: 'w'}; the south side is {x, z: z + 1, side: 'n'}.
 *    So x may equal `width` for side 'w' and z may equal `depth` for side 'n' (outer border).
 *  - Rotation r = r quarter turns, counter-clockwise seen from above (= +Y rotation of r·π/2 in three.js).
 *    Rotation 0 means the model's "front" faces +z (south, towards the default camera).
 *  - Multi-cell objects are anchored at their MIN corner cell; footprint w×d swaps for odd rotations.
 *  - Roads come in aligned 2 × 2 blocks (grid.ROAD_BLOCK, min corner at even x, z): every cell of a
 *    block is road, or none is (rules.ts keeps it; parseSave demotes partial blocks to field).
 *  - Road features (ObjectDef.roadFeature: the roundabout, parking lots) are the only objects that
 *    stand on road: they are block-aligned, paint their footprint to road when placed and back to field
 *    when bulldozed, and the renderer draws them instead of the road tiles underneath.
 *  - A kind whose styles differ in size (ObjectDef.footprints) covers the footprint of its variant.
 */

export type GroundKind = 'field' | 'grass' | 'meadow' | 'road' | 'pavement' | 'walkway';

/** Placeable objects, grouped by dock category. Ids name the thing, not a model file. */
export type ObjectKind =
  // Streets
  | 'roundabout'
  | 'parking'
  | 'zebra-crossing'
  | 'traffic-light'
  | 'lamppost'
  | 'bus-stop'
  | 'postbox'
  | 'mailbox'
  // Homes
  | 'cottage'
  | 'townhouse'
  | 'bungalow'
  | 'family-home'
  | 'garage-house'
  | 'big-house'
  // Town
  | 'corner-shop'
  | 'donut-shop'
  | 'supermarket'
  | 'church'
  | 'swimming-pool'
  | 'fountain'
  | 'tiered-fountain'
  // Nature
  | 'oak'
  | 'pine'
  | 'birch'
  | 'bush'
  | 'tulips'
  // Garden
  | 'planter'
  | 'bench'
  | 'long-bench'
  | 'garden-table'
  | 'swing'
  | 'slide'
  | 'barbecue';

export type EdgeKind = 'hedge' | 'fence-low' | 'fence-tall';

export type Rotation = 0 | 1 | 2 | 3;

export interface Cell {
  x: number;
  z: number;
}

export type EdgeSide = 'n' | 'w';

export interface Edge {
  x: number;
  z: number;
  side: EdgeSide;
}

export interface PlacedObject {
  /** Stable id, unique within a town; survives undo/redo and save/load. */
  id: number;
  kind: ObjectKind;
  anchor: Cell;
  rotation: Rotation;
  /** Visual variant index (e.g. colour, tree shape). */
  variant: number;
}

export interface PlacedEdge {
  kind: EdgeKind;
  edge: Edge;
}

/**
 * An applied mutation. Every change carries enough data to be inverted, so
 * undo = apply(invertChanges(changes).reverse()).
 */
export type TownChange =
  | { layer: 'ground'; cell: Cell; before: GroundKind; after: GroundKind }
  | { layer: 'object'; op: 'add' | 'remove'; object: PlacedObject }
  | { layer: 'edge'; op: 'add' | 'remove'; placed: PlacedEdge };

/** What the player asked for at one cell/edge. Produced by ToolController, consumed by TownEditor. */
export type BuildAction =
  | { type: 'paint-ground'; kind: Exclude<GroundKind, 'field'>; cell: Cell }
  /** Absent or out-of-range `variant` → the rules roll one with the seeded RNG. */
  | { type: 'place-object'; kind: ObjectKind; cell: Cell; rotation: Rotation; variant?: number }
  | { type: 'place-edge'; kind: EdgeKind; edge: Edge }
  | { type: 'bulldoze'; cell: Cell; edge: Edge | null }
  /** Re-places object `id` at `cell` and `rotation`, keeping its id and variant. */
  | { type: 'move-object'; id: number; cell: Cell; rotation: Rotation };

export type InvalidReason =
  | 'out-of-bounds'
  | 'occupied'
  | 'blocked-by-road'
  | 'needs-ground'
  | 'nothing-here'
  | 'cannot-move'
  | 'no-change';

export type PlanResult =
  | { ok: true; changes: TownChange[] }
  | { ok: false; reason: InvalidReason; message: string };

export interface TownStats {
  homes: number;
  residents: number;
  /** Shops and civic buildings (Town category). */
  amenities: number;
  trees: number;
  /** Road blocks (a roundabout or car park counts the blocks it covers). */
  roadTiles: number;
  props: number;
  /** Everything on the edge layer: fences and hedges. */
  fences: number;
}

/** Read-only view handed to the renderer, picker and UI. */
export interface TownStateReader {
  readonly width: number;
  readonly depth: number;
  inBounds(cell: Cell): boolean;
  getGround(cell: Cell): GroundKind;
  /** Object whose footprint covers `cell`, if any. */
  getObjectAt(cell: Cell): PlacedObject | undefined;
  getObject(id: number): PlacedObject | undefined;
  getEdge(edge: Edge): PlacedEdge | undefined;
  objects(): Iterable<PlacedObject>;
  edges(): Iterable<PlacedEdge>;
  stats(): TownStats;
}

/** Versioned save format. A format change bumps `version` and needs a SAVE_MIGRATIONS step in serialize.ts. */
export interface SavedTownV4 {
  version: 4;
  width: number;
  depth: number;
  /** Row-major (z * width + x) ground codes, run-length encoded: [[kind, count], ...]. */
  ground: Array<[GroundKind, number]>;
  objects: PlacedObject[];
  edges: PlacedEdge[];
  nextObjectId: number;
  camera?: { targetX: number; targetZ: number; azimuth: number; polar: number; distance: number };
  /** 1–30 characters, sanitised (townName.ts). Absent → DEFAULT_TOWN_NAME. */
  name?: string;
}

export type SavedTown = SavedTownV4;
