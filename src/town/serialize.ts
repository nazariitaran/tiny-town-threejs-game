/**
 * Save format: TownState ⇄ SavedTown. serializeTown is deterministic (objects by id, edges by key).
 *
 * parseSave treats its input as untrusted and never throws: it returns an Error for an unreadable or
 * newer save, migrates older versions through SAVE_MIGRATIONS (keyed on the version they upgrade
 * FROM), and repairs or drops anything that breaks a placement rule, so the result always loads.
 */
import { PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { OBJECTS, placedFootprint } from '../catalog/objects';
import { cellKey, edgeCells, edgeInBounds, edgeKey, footprintCells, ROAD_BLOCK } from './grid';
import { isFeatureCorner } from './roadTiles';
import { sanitizeTownName } from './townName';
import type { EdgeKind, GroundKind, ObjectKind, PlacedEdge, PlacedObject, Rotation, SavedTown, TownStateReader } from './types';

export const CURRENT_SAVE_VERSION = 4;

export type RawSave = Record<string, unknown>;

export type CameraPose = NonNullable<SavedTown['camera']>;

export interface SerializableTown extends TownStateReader {
  readonly nextObjectId: number;
}

const GROUND_KINDS: readonly GroundKind[] = ['field', 'grass', 'meadow', 'road', 'pavement', 'walkway'];
const EDGE_KINDS: readonly EdgeKind[] = ['hedge', 'fence-low', 'fence-tall'];
/** Guard against absurd dimensions in foreign data (the real plot is 64×64). */
const MAX_SAVE_DIMENSION = 512;

/**
 * SAVE_MIGRATIONS[v] upgrades a raw save of version v to version v + 1. Migrations receive
 * JSON-parsed, still-unvalidated objects; parseSave validates after.
 */
export const SAVE_MIGRATIONS: Readonly<Record<number, (raw: RawSave) => RawSave>> = {};

export function serializeTown(state: SerializableTown, camera?: CameraPose, name?: string): SavedTown {
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
    version: 4,
    width: state.width,
    depth: state.depth,
    ground,
    objects,
    edges,
    nextObjectId: state.nextObjectId,
  };
  if (camera) save.camera = { ...camera };
  const cleanName = name === undefined ? '' : sanitizeTownName(name);
  if (cleanName) save.name = cleanName;
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

  let raw: RawSave = data;
  const migrations = options.migrations ?? SAVE_MIGRATIONS;
  // Version 0 is accepted only if a migration from it exists.
  if (!isInt(raw.version) || raw.version < 0) return new Error('Save has no valid version');
  if (raw.version > CURRENT_SAVE_VERSION) return new Error(`Save version ${raw.version} is newer than supported (${CURRENT_SAVE_VERSION})`);
  while ((raw.version as number) < CURRENT_SAVE_VERSION) {
    const from = raw.version as number;
    const migrate = migrations[from];
    if (!migrate) return new Error(`No migration from save version ${from}`);
    raw = migrate(raw);
    if (!isRecord(raw) || raw.version !== from + 1) return new Error(`Migration from save version ${from} failed`);
  }

  const { width, depth } = raw;
  if (!isInt(width) || !isInt(depth) || width < 1 || depth < 1 || width > MAX_SAVE_DIMENSION || depth > MAX_SAVE_DIMENSION) {
    return new Error('Save has invalid width/depth');
  }

  // Ground is RLE over the SAVE's dimensions, re-gridded onto the plot.
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

  // A smaller save is centred, so it keeps its world position (the plot is centred on the origin)
  // and its road blocks stay aligned.
  const centreOffset = (plot: number, size: number): number =>
    size < plot ? Math.floor((plot - size) / 2 / ROAD_BLOCK) * ROAD_BLOCK : 0;
  const ox = centreOffset(plotW, width);
  const oz = centreOffset(plotD, depth);
  const plotGround: GroundKind[] = new Array<GroundKind>(plotW * plotD).fill('field');
  for (let z = 0; z < Math.min(depth, plotD); z += 1) {
    for (let x = 0; x < Math.min(width, plotW); x += 1) plotGround[(z + oz) * plotW + x + ox] = saveGround[z * width + x];
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

  if (!Array.isArray(raw.objects)) return new Error('Save objects is not a list');
  const objects: PlacedObject[] = [];
  const ids = new Set<number>();
  const occupied = new Set<string>();
  for (const entry of raw.objects) {
    const object = parseObject(entry, ox, oz);
    if (!object || ids.has(object.id)) continue;
    const def = OBJECTS[object.kind];
    if ((def.roadFeature || def.roadMarking) && (object.anchor.x % ROAD_BLOCK !== 0 || object.anchor.z % ROAD_BLOCK !== 0)) continue;
    const cells = footprintCells(object.anchor, placedFootprint(object), object.rotation);
    // A road feature stands on road, or pavement in its corner blocks; everything else on its allowed ground.
    const fits = cells.every((c) => {
      const ground = groundAt(c.x, c.z);
      const groundOk = def.roadFeature ? ground === 'road' || (ground === 'pavement' && isFeatureCorner(object, c)) : def.allowedGround.includes(ground);
      return c.x >= 0 && c.z >= 0 && c.x < plotW && c.z < plotD && !occupied.has(cellKey(c)) && groundOk;
    });
    if (!fits) continue;
    ids.add(object.id);
    for (const c of cells) occupied.add(cellKey(c));
    objects.push(object);
  }
  objects.sort((a, b) => a.id - b.id);

  if (!Array.isArray(raw.edges)) return new Error('Save edges is not a list');
  const edges: PlacedEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const entry of raw.edges) {
    const placed = parseEdge(entry, ox, oz);
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

  let nextObjectId = isInt(raw.nextObjectId) && raw.nextObjectId >= 1 ? raw.nextObjectId : 1;
  for (const o of objects) nextObjectId = Math.max(nextObjectId, o.id + 1);

  const save: SavedTown = {
    version: 4,
    width: plotW,
    depth: plotD,
    ground: encodeGround(plotGround),
    objects,
    edges,
    nextObjectId,
  };
  const camera = parseCamera(raw.camera);
  if (camera) save.camera = camera;
  const name = typeof raw.name === 'string' ? sanitizeTownName(raw.name) : '';
  if (name) save.name = name;
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

function parseObject(entry: unknown, ox: number, oz: number): PlacedObject | null {
  if (!isRecord(entry)) return null;
  const { id, kind, anchor, rotation, variant } = entry;
  if (!isInt(id) || id < 1) return null;
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(OBJECTS, kind)) return null;
  if (!isRecord(anchor) || !isInt(anchor.x) || !isInt(anchor.z)) return null;
  if (!isInt(rotation) || rotation < 0 || rotation > 3) return null;
  const def = OBJECTS[kind as ObjectKind];
  // An out-of-range variant (e.g. the catalog lost a model) falls back to the first one.
  const safeVariant = isInt(variant) && variant >= 0 && variant < def.variants ? variant : 0;
  return { id, kind: kind as ObjectKind, anchor: { x: anchor.x + ox, z: anchor.z + oz }, rotation: rotation as Rotation, variant: safeVariant };
}

function parseEdge(entry: unknown, ox: number, oz: number): PlacedEdge | null {
  if (!isRecord(entry)) return null;
  const { kind, edge } = entry;
  if (typeof kind !== 'string' || !(EDGE_KINDS as readonly string[]).includes(kind)) return null;
  if (!isRecord(edge) || !isInt(edge.x) || !isInt(edge.z) || (edge.side !== 'n' && edge.side !== 'w')) return null;
  return { kind: kind as EdgeKind, edge: { x: edge.x + ox, z: edge.z + oz, side: edge.side } };
}

function parseCamera(value: unknown): CameraPose | undefined {
  if (!isRecord(value)) return undefined;
  const { targetX, targetZ, azimuth, polar, distance } = value;
  if (![targetX, targetZ, azimuth, polar, distance].every(isFiniteNumber)) return undefined;
  if ((distance as number) <= 0) return undefined;
  return { targetX: targetX as number, targetZ: targetZ as number, azimuth: azimuth as number, polar: polar as number, distance: distance as number };
}
