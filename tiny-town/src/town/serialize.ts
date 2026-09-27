/**
 * Save format: TownState ⇄ SavedTown (= SavedTownV2, town/types.ts), validation and migration.
 * PURE (no three.js, no DOM). WP-02 owns this file; tested in serialize.test.ts.
 *
 *   serializeTown(state, camera?)  → SavedTown   (deterministic: objects by id, edges by key)
 *   parseSave(unknown | string)    → SavedTown | Error   (never throws)
 *
 * parseSave never trusts its input (it usually comes from localStorage):
 *  - rejects (returns Error) non-objects, bad JSON, missing/unknown/newer `version`, bad
 *    width/depth, and non-array ground/objects/edges;
 *  - migrates older versions through SAVE_MIGRATIONS (keyed on the version they upgrade FROM);
 *  - clamps to the plot size (cells/objects/edges outside it are dropped, a smaller save is
 *    padded with field), maps unknown ground kinds to field, and drops unknown object/fence
 *    kinds, malformed entries, duplicate ids, overlapping objects, objects on ground they are
 *    not allowed on, duplicate edges and fences between two road cells;
 *  - demotes road cells of partial 2 × 2 road blocks to field (roads come in aligned blocks);
 *  - repairs nextObjectId (≥ highest id + 1) and drops a malformed camera pose.
 * v1 → v2 (WP-12, 24 × 24 one-unit cells → 48 × 48 half-unit cells): see migrateV1toV2.
 * The result is always loadable by TownEditor.load without throwing.
 */
import { PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { OBJECTS } from '../catalog/objects';
import { cellKey, edgeCells, edgeInBounds, edgeKey, footprintCells, ROAD_BLOCK, rotatedFootprint } from './grid';
import type { Cell, EdgeKind, GroundKind, ObjectKind, PlacedEdge, PlacedObject, Rotation, SavedTown, TownStateReader } from './types';

export const CURRENT_SAVE_VERSION = 2;

export type RawSave = Record<string, unknown>;

export type CameraPose = NonNullable<SavedTown['camera']>;

/** Anything serializeTown can read (TownState satisfies it). */
export interface SerializableTown extends TownStateReader {
  readonly nextObjectId: number;
}

const GROUND_KINDS: readonly GroundKind[] = ['field', 'grass', 'meadow', 'road', 'pavement', 'walkway'];
const EDGE_KINDS: readonly EdgeKind[] = ['fence-tall', 'fence-small'];
/** Guard against absurd dimensions in foreign data (the real plot is 48×48). */
const MAX_SAVE_DIMENSION = 512;

/**
 * Migration hook: SAVE_MIGRATIONS[v] upgrades a raw save of version v to version v + 1.
 * Migrations receive already-JSON-parsed, still-unvalidated objects; parseSave validates after.
 */
export const SAVE_MIGRATIONS: Readonly<Record<number, (raw: RawSave) => RawSave>> = {
  1: migrateV1toV2,
};

/** v1 → v2 scale factor: each v1 cell (x, z) becomes the cells 2x..2x+1 × 2z..2z+1. */
const V1_SPLIT = 2;

/**
 * v1 (24 × 24 one-unit cells, every object 1×1) → v2 (48 × 48 half-unit cells). Deterministic.
 *  - Ground is copied to all 4 sub-cells (so every v1 road cell is a valid 2 × 2 road block).
 *  - Each edge becomes 2 half-edges. Camera (world units), ids, variants, nextObjectId are kept.
 *  - Objects that fit the 2 × 2 area (trees, props, garage, bus stop) sit flush to its FRONT side
 *    (rotation 0 = +z, 1 = +x, 2 = −z, 3 = −x) and at its min side across.
 *  - Houses (larger than the area) are placed last, in id order, flush to the same front: first as
 *    their own kind (3-wide houses try both sideways options), then as a 2×3 townhouse, then as a
 *    townhouse turned a quarter either way (3 × 2: fits dense 1-deep v1 rows), else dropped.
 * Unreadable parts are passed through or skipped; parseSave's validation has the last word.
 */
function migrateV1toV2(raw: RawSave): RawSave {
  const { width, depth } = raw;
  const malformed =
    !isInt(width) || !isInt(depth) || width < 1 || depth < 1 || width > MAX_SAVE_DIMENSION / V1_SPLIT || depth > MAX_SAVE_DIMENSION / V1_SPLIT ||
    !Array.isArray(raw.ground) || !Array.isArray(raw.objects) || !Array.isArray(raw.edges) ||
    raw.ground.some((run) => !Array.isArray(run) || run.length !== 2 || !isInt(run[1]) || run[1] < 0);
  // Leave broken saves as they are (only the version moves on), so parseSave rejects them with the
  // same message as a broken v2 save.
  if (malformed) return { ...raw, version: 2 };
  const w2 = width * V1_SPLIT;
  const d2 = depth * V1_SPLIT;

  // Ground ×4.
  const oldGround = decodeRawGround(raw.ground as unknown[], width * depth);
  const ground: GroundKind[] = new Array<GroundKind>(w2 * d2);
  for (let z = 0; z < d2; z += 1) {
    for (let x = 0; x < w2; x += 1) ground[z * w2 + x] = oldGround[Math.floor(z / V1_SPLIT) * width + Math.floor(x / V1_SPLIT)];
  }
  const groundAt = (c: Cell): GroundKind => ground[c.z * w2 + c.x];

  // Edges → half-edges.
  const edges: PlacedEdge[] = [];
  for (const entry of raw.edges as unknown[]) {
    const placed = parseEdge(entry);
    if (!placed) continue;
    const { x, z, side } = placed.edge;
    for (let k = 0; k < V1_SPLIT; k += 1) {
      const edge = side === 'n' ? { x: x * V1_SPLIT + k, z: z * V1_SPLIT, side } : { x: x * V1_SPLIT, z: z * V1_SPLIT + k, side };
      edges.push({ kind: placed.kind, edge });
    }
  }

  // Objects.
  const parsed = (raw.objects as unknown[]).map(parseObject).filter((o): o is PlacedObject => o !== null);
  parsed.sort((a, b) => a.id - b.id);
  const occupied = new Set<string>();
  const ids = new Set<number>();
  const placed: PlacedObject[] = [];
  const tryPlace = (object: PlacedObject, kind: ObjectKind, rotation: Rotation, anchor: Cell): boolean => {
    const def = OBJECTS[kind];
    const cells = footprintCells(anchor, def.footprint, rotation);
    const fits = cells.every((c) => c.x >= 0 && c.z >= 0 && c.x < w2 && c.z < d2 && !occupied.has(cellKey(c)) && def.allowedGround.includes(groundAt(c)));
    if (!fits) return false;
    for (const c of cells) occupied.add(cellKey(c));
    ids.add(object.id);
    const variant = object.variant < def.variants ? object.variant : 0;
    placed.push({ id: object.id, kind, anchor, rotation, variant });
    return true;
  };
  const isHouse = (o: PlacedObject) => OBJECTS[o.kind].statGroup === 'home';
  for (const object of parsed) {
    if (isHouse(object) || ids.has(object.id)) continue;
    const options = migratedAnchors(object, object.kind, object.rotation);
    if (options.length > 0) tryPlace(object, object.kind, object.rotation, options[0]);
  }
  for (const object of parsed) {
    if (!isHouse(object) || ids.has(object.id)) continue;
    if (migratedAnchors(object, object.kind, object.rotation).some((anchor) => tryPlace(object, object.kind, object.rotation, anchor))) continue;
    // Substitute a (narrower) 2×3 townhouse at the same front.
    if (object.kind !== 'townhouse-b' && migratedAnchors(object, 'townhouse-b', object.rotation).some((anchor) => tryPlace(object, 'townhouse-b', object.rotation, anchor))) continue;
    // Dense 1-deep v1 rows (houses between two pavements) only have room for a townhouse turned
    // sideways (3 wide × 2 deep); otherwise the house is dropped.
    for (const turn of [1, 3] as const) {
      const rotation = ((object.rotation + turn) % 4) as Rotation;
      if (migratedAnchors(object, 'townhouse-b', rotation).some((anchor) => tryPlace(object, 'townhouse-b', rotation, anchor))) break;
    }
  }
  placed.sort((a, b) => a.id - b.id);

  return { ...raw, version: 2, width: w2, depth: d2, ground: encodeGround(ground), objects: placed, edges };
}

/**
 * Candidate v2 anchors for a v1 object at (x, z) as `kind`: flush to the front side of its 2 × 2
 * area; across the facing axis at the area's min side, or (when wider than the area) overhanging
 * one side, then the other.
 */
function migratedAnchors(object: PlacedObject, kind: ObjectKind, rotation: Rotation): Cell[] {
  const [w, d] = rotatedFootprint(OBJECTS[kind].footprint, rotation);
  const ax = object.anchor.x * V1_SPLIT;
  const az = object.anchor.z * V1_SPLIT;
  // Along the facing axis: flush to the front edge of the area.
  const frontZ = rotation === 0 ? az + V1_SPLIT - d : az;
  const frontX = rotation === 1 ? ax + V1_SPLIT - w : ax;
  // Across it: the area's min side, or overhang when wider than the area (both ways).
  const across = (start: number, size: number): number[] => (size <= V1_SPLIT ? [start] : [start, start - (size - V1_SPLIT)]);
  if (rotation % 2 === 0) return across(ax, w).map((x) => ({ x, z: frontZ }));
  return across(az, d).map((z) => ({ x: frontX, z }));
}

/** RLE decode of structurally checked, unvalidated ground (unknown kinds → field, padded with field). */
function decodeRawGround(runs: unknown[], total: number): GroundKind[] {
  const out: GroundKind[] = [];
  for (const run of runs) {
    const [kind, count] = run as [unknown, number];
    const safeKind: GroundKind = typeof kind === 'string' && (GROUND_KINDS as readonly string[]).includes(kind) ? (kind as GroundKind) : 'field';
    for (let i = 0; i < count && out.length < total; i += 1) out.push(safeKind);
  }
  while (out.length < total) out.push('field');
  return out;
}

// ---------------------------------------------------------------------------------------------
// serialize

export function serializeTown(state: SerializableTown, camera?: CameraPose): SavedTown {
  const ground: Array<[GroundKind, number]> = [];
  for (let z = 0; z < state.depth; z += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const kind = state.getGround({ x, z });
      const last = ground[ground.length - 1];
      if (last && last[0] === kind) last[1] += 1;
      else ground.push([kind, 1]);
    }
  }
  const objects = [...state.objects()]
    .map((o): PlacedObject => ({ id: o.id, kind: o.kind, anchor: { x: o.anchor.x, z: o.anchor.z }, rotation: o.rotation, variant: o.variant }))
    .sort((a, b) => a.id - b.id);
  const edges = [...state.edges()]
    .map((e): PlacedEdge => ({ kind: e.kind, edge: { x: e.edge.x, z: e.edge.z, side: e.edge.side } }))
    .sort(compareEdges);
  const save: SavedTown = {
    version: 2,
    width: state.width,
    depth: state.depth,
    ground,
    objects,
    edges,
    nextObjectId: state.nextObjectId,
  };
  if (camera) save.camera = { ...camera };
  return save;
}

function compareEdges(a: PlacedEdge, b: PlacedEdge): number {
  return a.edge.z - b.edge.z || a.edge.x - b.edge.x || (a.edge.side < b.edge.side ? -1 : a.edge.side > b.edge.side ? 1 : 0);
}

/** Expand RLE ground to a row-major array (width × depth). Assumes a validated save. */
export function decodeGround(save: Pick<SavedTown, 'ground' | 'width' | 'depth'>): GroundKind[] {
  const total = save.width * save.depth;
  const out: GroundKind[] = [];
  for (const [kind, count] of save.ground) {
    for (let i = 0; i < count && out.length < total; i += 1) out.push(kind);
  }
  while (out.length < total) out.push('field');
  return out;
}

// ---------------------------------------------------------------------------------------------
// parse + validate

export interface ParseOptions {
  /** Plot the save is clamped to. Default PLOT_WIDTH × PLOT_DEPTH. */
  width?: number;
  depth?: number;
  /** Migration table override (tests). Default SAVE_MIGRATIONS. */
  migrations?: Readonly<Record<number, (raw: RawSave) => RawSave>>;
}

const isRecord = (v: unknown): v is RawSave => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate (and migrate) untrusted save data. Never throws; returns an Error describing the first fatal problem. */
export function parseSave(input: unknown, options: ParseOptions = {}): SavedTown | Error {
  try {
    return parseSaveUnsafe(input, options);
  } catch (error) {
    // Defensive: nothing below should throw, but a hostile object (getters, proxies) might.
    return new Error(`Unreadable save: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseSaveUnsafe(input: unknown, options: ParseOptions): SavedTown | Error {
  const plotW = options.width ?? PLOT_WIDTH;
  const plotD = options.depth ?? PLOT_DEPTH;

  let data: unknown = input;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return new Error('Save is not valid JSON');
    }
  }
  if (!isRecord(data)) return new Error('Save is not an object');

  // ---- version + migrations
  let raw: RawSave = data;
  const migrations = options.migrations ?? SAVE_MIGRATIONS;
  // Version 0 is accepted only if a migration from it exists (pre-release / hand-made saves).
  if (!isInt(raw.version) || raw.version < 0) return new Error('Save has no valid version');
  if (raw.version > CURRENT_SAVE_VERSION) return new Error(`Save version ${raw.version} is newer than supported (${CURRENT_SAVE_VERSION})`);
  while ((raw.version as number) < CURRENT_SAVE_VERSION) {
    const from = raw.version as number;
    const migrate = migrations[from];
    if (!migrate) return new Error(`No migration from save version ${from}`);
    raw = migrate(raw);
    if (!isRecord(raw) || raw.version !== from + 1) return new Error(`Migration from save version ${from} failed`);
  }

  // ---- dimensions
  const { width, depth } = raw;
  if (!isInt(width) || !isInt(depth) || width < 1 || depth < 1 || width > MAX_SAVE_DIMENSION || depth > MAX_SAVE_DIMENSION) {
    return new Error('Save has invalid width/depth');
  }

  // ---- ground (RLE over the SAVE's dimensions, re-gridded onto the plot)
  if (!Array.isArray(raw.ground)) return new Error('Save ground is not a list');
  const saveTotal = width * depth;
  const saveGround: GroundKind[] = [];
  for (const run of raw.ground) {
    if (!Array.isArray(run) || run.length !== 2) return new Error('Save ground has a malformed run');
    const [kind, count] = run as [unknown, unknown];
    if (!isInt(count) || count < 0) return new Error('Save ground has a malformed run length');
    const safeKind: GroundKind = typeof kind === 'string' && (GROUND_KINDS as readonly string[]).includes(kind) ? (kind as GroundKind) : 'field';
    const n = Math.min(count, saveTotal - saveGround.length);
    for (let i = 0; i < n; i += 1) saveGround.push(safeKind);
  }
  while (saveGround.length < saveTotal) saveGround.push('field');

  const plotGround: GroundKind[] = new Array<GroundKind>(plotW * plotD).fill('field');
  for (let z = 0; z < Math.min(depth, plotD); z += 1) {
    for (let x = 0; x < Math.min(width, plotW); x += 1) plotGround[z * plotW + x] = saveGround[z * width + x];
  }
  // Roads come in aligned 2 × 2 blocks: a partial block (hand-edited or clipped save) is demoted to field.
  for (let bz = 0; bz < plotD; bz += ROAD_BLOCK) {
    for (let bx = 0; bx < plotW; bx += ROAD_BLOCK) {
      let roads = 0;
      let cells = 0;
      for (let z = bz; z < Math.min(bz + ROAD_BLOCK, plotD); z += 1) {
        for (let x = bx; x < Math.min(bx + ROAD_BLOCK, plotW); x += 1) {
          cells += 1;
          if (plotGround[z * plotW + x] === 'road') roads += 1;
        }
      }
      if (roads === 0 || (roads === cells && cells === ROAD_BLOCK * ROAD_BLOCK)) continue;
      for (let z = bz; z < Math.min(bz + ROAD_BLOCK, plotD); z += 1) {
        for (let x = bx; x < Math.min(bx + ROAD_BLOCK, plotW); x += 1) if (plotGround[z * plotW + x] === 'road') plotGround[z * plotW + x] = 'field';
      }
    }
  }
  const groundAt = (x: number, z: number): GroundKind => (x >= 0 && z >= 0 && x < plotW && z < plotD ? plotGround[z * plotW + x] : 'field');

  // ---- objects
  if (!Array.isArray(raw.objects)) return new Error('Save objects is not a list');
  const objects: PlacedObject[] = [];
  const ids = new Set<number>();
  const occupied = new Set<string>();
  for (const entry of raw.objects) {
    const object = parseObject(entry);
    if (!object || ids.has(object.id)) continue;
    const def = OBJECTS[object.kind];
    const cells = footprintCells(object.anchor, def.footprint, object.rotation);
    const fits = cells.every(
      (c) => c.x >= 0 && c.z >= 0 && c.x < plotW && c.z < plotD && !occupied.has(cellKey(c)) && def.allowedGround.includes(groundAt(c.x, c.z)),
    );
    if (!fits) continue;
    ids.add(object.id);
    for (const c of cells) occupied.add(cellKey(c));
    objects.push(object);
  }
  objects.sort((a, b) => a.id - b.id);

  // ---- edges
  if (!Array.isArray(raw.edges)) return new Error('Save edges is not a list');
  const edges: PlacedEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const entry of raw.edges) {
    const placed = parseEdge(entry);
    if (!placed || !edgeInBounds(placed.edge, plotW, plotD)) continue;
    const key = edgeKey(placed.edge);
    if (edgeKeys.has(key)) continue;
    const [a, b] = edgeCells(placed.edge);
    // groundAt() is 'field' outside the plot, so border edges never count as between roads.
    if (groundAt(a.x, a.z) === 'road' && groundAt(b.x, b.z) === 'road') continue;
    edgeKeys.add(key);
    edges.push(placed);
  }
  edges.sort(compareEdges);

  // ---- id counter
  let nextObjectId = isInt(raw.nextObjectId) && raw.nextObjectId >= 1 ? raw.nextObjectId : 1;
  for (const o of objects) nextObjectId = Math.max(nextObjectId, o.id + 1);

  const save: SavedTown = {
    version: 2,
    width: plotW,
    depth: plotD,
    ground: encodeGround(plotGround),
    objects,
    edges,
    nextObjectId,
  };
  const camera = parseCamera(raw.camera);
  if (camera) save.camera = camera;
  return save;
}

function encodeGround(cells: readonly GroundKind[]): Array<[GroundKind, number]> {
  const out: Array<[GroundKind, number]> = [];
  for (const kind of cells) {
    const last = out[out.length - 1];
    if (last && last[0] === kind) last[1] += 1;
    else out.push([kind, 1]);
  }
  return out;
}

function parseObject(entry: unknown): PlacedObject | null {
  if (!isRecord(entry)) return null;
  const { id, kind, anchor, rotation, variant } = entry;
  if (!isInt(id) || id < 1) return null;
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(OBJECTS, kind)) return null;
  if (!isRecord(anchor) || !isInt(anchor.x) || !isInt(anchor.z)) return null;
  if (!isInt(rotation) || rotation < 0 || rotation > 3) return null;
  const def = OBJECTS[kind as ObjectKind];
  // An out-of-range variant (e.g. the catalog lost a model) falls back to the first one.
  const safeVariant = isInt(variant) && variant >= 0 && variant < def.variants ? variant : 0;
  return { id, kind: kind as ObjectKind, anchor: { x: anchor.x, z: anchor.z }, rotation: rotation as Rotation, variant: safeVariant };
}

function parseEdge(entry: unknown): PlacedEdge | null {
  if (!isRecord(entry)) return null;
  const { kind, edge } = entry;
  if (typeof kind !== 'string' || !(EDGE_KINDS as readonly string[]).includes(kind)) return null;
  if (!isRecord(edge) || !isInt(edge.x) || !isInt(edge.z) || (edge.side !== 'n' && edge.side !== 'w')) return null;
  return { kind: kind as EdgeKind, edge: { x: edge.x, z: edge.z, side: edge.side } };
}

function parseCamera(value: unknown): CameraPose | undefined {
  if (!isRecord(value)) return undefined;
  const { targetX, targetZ, azimuth, polar, distance } = value;
  if (![targetX, targetZ, azimuth, polar, distance].every(isFiniteNumber)) return undefined;
  if ((distance as number) <= 0) return undefined;
  return { targetX: targetX as number, targetZ: targetZ as number, azimuth: azimuth as number, polar: polar as number, distance: distance as number };
}
