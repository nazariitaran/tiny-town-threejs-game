/**
 * CONTRACT FILE — town data model. Pure data: NO three.js imports anywhere in src/town/.
 *
 * Grid conventions (see docs/design/03-architecture.md §Grid):
 *  - The plot is `width × depth` cells. Cell {x, z}: x ∈ [0, width), z ∈ [0, depth).
 *  - +x → world +X (east), +z → world +Z (south, towards the default camera).
 *  - Edges are canonicalised as the NORTH (−z) or WEST (−x) side of a cell.
 *    The east side of (x, z) is {x: x + 1, z, side: 'w'}; the south side is {x, z: z + 1, side: 'n'}.
 *    So x may equal `width` for side 'w' and z may equal `depth` for side 'n' (outer border).
 *  - Rotation r = r quarter turns, counter-clockwise seen from above (= +Y rotation of r·π/2 in three.js).
 *    Rotation 0 means the model's "front" faces +z (south, towards the default camera).
 *  - Multi-cell objects are anchored at their MIN corner cell; footprint w×d swaps for odd rotations.
 */

export type GroundKind = 'field' | 'grass' | 'meadow' | 'road' | 'pavement' | 'walkway';

export type ObjectKind =
  | 'tree-a'
  | 'tree-b'
  | 'tree-c'
  | 'townhouse-a'
  | 'townhouse-b'
  | 'townhouse-c'
  | 'garage'
  | 'bus-stop'
  | 'postbox'
  | 'lamppost';

export type EdgeKind = 'fence-tall' | 'fence-small';

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
  /** Visual variant index (e.g. colour/tree shape) chosen via the seeded RNG at placement time. */
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
  | { type: 'place-object'; kind: ObjectKind; cell: Cell; rotation: Rotation }
  | { type: 'place-edge'; kind: EdgeKind; edge: Edge }
  | { type: 'bulldoze'; cell: Cell; edge: Edge | null };

export type InvalidReason =
  | 'out-of-bounds'
  | 'occupied'
  | 'blocked-by-road'
  | 'needs-ground'
  | 'edge-occupied'
  | 'nothing-here'
  | 'no-change';

export type PlanResult =
  | { ok: true; changes: TownChange[] }
  | { ok: false; reason: InvalidReason; message: string };

export interface TownStats {
  homes: number;
  residents: number;
  trees: number;
  roadTiles: number;
  props: number;
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

/** Versioned save format. Bump `version` and add a migration in serialize.ts when it changes. */
export interface SavedTownV1 {
  version: 1;
  width: number;
  depth: number;
  /** Row-major (z * width + x) ground codes, run-length encoded: [[kind, count], ...]. */
  ground: Array<[GroundKind, number]>;
  objects: PlacedObject[];
  edges: PlacedEdge[];
  nextObjectId: number;
  camera?: { targetX: number; targetZ: number; azimuth: number; polar: number; distance: number };
}
