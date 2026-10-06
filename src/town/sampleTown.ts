/**
 * Deterministic demo layouts for the 'sample-town' / 'active-play' test states (screenshots, perf
 * baselines). They use only real BuildActions through the editor, so they also exercise the rules;
 * buildSampleTown must use every placing tool with ZERO rejections (sampleTown.test.ts asserts it).
 * Builders apply their actions as one silent batch: one town:changed, one undo entry, no build:* events.
 */
import type { ToolId } from '../catalog/tools';
import type { BatchItem, TownEditor } from './TownEditor';
import { ROAD_BLOCK, roadBlockAnchor } from './grid';
import type { BuildAction, Cell, EdgeKind, ObjectKind, Rotation } from './types';

export interface DemoTownResult {
  applied: number;
  /** Human-readable description of each rejected action (empty for a correct layout). */
  rejected: string[];
}

/** The sample town and the asset gallery are laid out on this many cells. */
const DEMO_LAYOUT_SIZE = 48;

/** Shift that centres the demo layouts on the plot, in whole road blocks so roads stay aligned. */
export function demoOffset(plotSize: number): number {
  return Math.max(0, Math.floor((plotSize - DEMO_LAYOUT_SIZE) / 2 / ROAD_BLOCK) * ROAD_BLOCK);
}

function shiftAction(action: BuildAction, dx: number, dz: number): BuildAction {
  if (dx === 0 && dz === 0) return action;
  if (action.type === 'place-edge') return { ...action, edge: { ...action.edge, x: action.edge.x + dx, z: action.edge.z + dz } };
  return { ...action, cell: { x: action.cell.x + dx, z: action.cell.z + dz } };
}

/** Collects actions, then applies them as one silent batch. `centred`: shift a 48 × 48 layout to the plot centre. */
function demoBuilder(editor: TownEditor, describe: (item: BatchItem) => string, centred = false) {
  const items: BatchItem[] = [];
  const dx = centred ? demoOffset(editor.state.width) : 0;
  const dz = centred ? demoOffset(editor.state.depth) : 0;
  return {
    run: (toolId: ToolId, action: BuildAction): void => {
      items.push({ toolId, action: shiftAction(action, dx, dz) });
    },
    commit: (): DemoTownResult => {
      const result = editor.applyBatch(items, { silent: true });
      return { applied: result.applied, rejected: result.rejected.map((r) => `${describe(r.item)}: ${r.message || r.reason}`) };
    },
  };
}

/** Queue road on every block of the inclusive cell rectangle (one paint per 2 × 2 block, skipping road). */
function roadRect(run: (toolId: ToolId, action: BuildAction) => void, x0: number, z0: number, x1: number, z1: number): void {
  const seen = new Set<string>();
  for (let z = z0; z <= z1; z += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const anchor = roadBlockAnchor({ x, z });
      const key = `${anchor.x},${anchor.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      run('road', { type: 'paint-ground', kind: 'road', cell: anchor });
    }
  }
}

/**
 * The sample town, in 48 × 48 layout coordinates shifted by demoOffset(): a main street (rows 24–25)
 * and a side street (columns 22–23) meeting at a roundabout (cells 20–25 × 22–27), with a car park on
 * the side street, homes, a civic corner, the stadium, the cinema, gardens and trees. Uses every placing tool.
 */
export function buildSampleTown(editor: TownEditor): DemoTownResult {
  const { run, commit } = demoBuilder(editor, (item) => `${item.toolId}@${JSON.stringify(item.action)}`, true);
  const paint = (kind: 'pavement' | 'walkway' | 'grass' | 'meadow' | 'pond', x0: number, z0: number, x1: number, z1: number) => {
    for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) run(kind, { type: 'paint-ground', kind, cell: { x, z } });
  };
  const place = (kind: ObjectKind, x: number, z: number, rotation: Rotation = 0, variant?: number) =>
    run(kind, variant === undefined ? { type: 'place-object', kind, cell: { x, z }, rotation } : { type: 'place-object', kind, cell: { x, z }, rotation, variant });
  const edgeRun = (kind: EdgeKind, side: 'n' | 'w', from: Cell, length: number) => {
    for (let i = 0; i < length; i += 1) {
      const edge = side === 'n' ? { x: from.x + i, z: from.z, side } : { x: from.x, z: from.z + i, side };
      run(kind, { type: 'place-edge', kind, edge });
    }
  };

  // Streets: main street (east–west) and a side street (north–south), one paint per block; the
  // roundabout then sits on their crossing (it paints the rest of its 3 × 3 blocks itself).
  roadRect(run, 4, 24, 43, 25);
  roadRect(run, 22, 8, 23, 23);
  roadRect(run, 22, 26, 23, 41);
  paint('pavement', 4, 23, 19, 23);
  paint('pavement', 26, 23, 43, 23);
  paint('pavement', 4, 26, 19, 26);
  paint('pavement', 26, 26, 43, 26);
  place('roundabout', 20, 22);
  place('traffic-light', 19, 23);
  place('traffic-light', 26, 26, 2);
  for (const x of [9, 14, 31, 37]) place('lamppost', x, 23);
  place('postbox', 36, 23, 0, 0);
  place('bus-stop', 16, 26, 2);
  place('zebra-crossing', 12, 24); // across the main street, between the west lampposts
  // A large car park east of the side street, its entrance facing west onto it (rotation 3).
  place('parking', 24, 14, 3, 2);

  // Nature and garden ground.
  paint('grass', 6, 13, 19, 22);
  paint('grass', 26, 27, 43, 34);
  paint('meadow', 6, 32, 17, 41);
  paint('walkway', 10, 27, 10, 37);

  // Homes north of the main street face south (+z, rotation 0), rows 19–22.
  place('family-home', 5, 19);
  place('townhouse', 10, 19);
  place('bungalow', 15, 19);
  place('cottage', 27, 19);
  place('mailbox', 31, 22);
  place('garage-house', 32, 19);
  place('big-house', 38, 19);
  // The civic corner south-east of the roundabout faces north (rotation 2): shops, church, a townhouse.
  place('corner-shop', 26, 27, 2);
  place('supermarket', 30, 27, 2);
  place('church', 36, 27, 2);
  place('townhouse', 40, 27, 2);
  // The stadium south of the shops, its gate facing west onto the side street across a paved forecourt.
  paint('pavement', 24, 32, 24, 45);
  place('stadium', 25, 32, 3);
  place('cinema', 37, 33);
  // West of the side street: the donut shop faces the street (east), the tiered fountain below it.
  place('donut-shop', 19, 28, 1);
  place('tiered-fountain', 18, 33);
  // South-west: a cottage by the garden path, a fountain with a bench, the pool in the meadow.
  place('cottage', 5, 27, 2);
  place('fountain', 12, 28);
  place('bench', 11, 30, 3);
  place('swimming-pool', 13, 33, 2);

  // Back garden behind the north-west homes (rows 13–18): low fence to the north, hedge to the west.
  edgeRun('fence-low', 'n', { x: 6, z: 13 }, 14);
  edgeRun('hedge', 'w', { x: 6, z: 13 }, 6);
  place('bench', 8, 15);
  place('barbecue', 11, 15);
  place('swing', 13, 15);
  place('planter', 17, 15);
  place('bush', 7, 17);
  place('bush', 19, 17);
  // A table between two long benches, a slide and a row of tulips along the fence.
  place('long-bench', 10, 16);
  place('garden-table', 10, 17);
  place('long-bench', 10, 18);
  place('slide', 14, 17);
  for (const x of [15, 16, 17]) place('tulips', x, 13);
  // Trees and a tall-fence run along the east edge of the south-east lawn.
  place('oak', 6, 10);
  place('pine', 12, 8);
  place('birch', 16, 11);
  place('oak', 38, 10);
  place('pine', 39, 38);
  edgeRun('fence-tall', 'w', { x: 44, z: 27 }, 8);
  // A pond north-east of the car park (rows of cells, irregular so every shore piece shows), with plants and a bird house.
  for (const [z, x0, x1] of SAMPLE_POND_ROWS) paint('pond', x0, z, x1, z);
  place('lily-pads', 33, 13);
  place('lily-pads', 35, 12);
  place('lily-pads', 34, 15);
  place('reeds', 31, 13);
  place('reeds', 32, 11);
  place('cattails', 37, 14);
  place('cattails', 36, 15);
  place('bird-house', 35, 14);

  return commit();
}

/** The sample town's pond: [z, first x, last x] per row of cells (32 cells). */
const SAMPLE_POND_ROWS: ReadonlyArray<readonly [number, number, number]> = [
  [11, 32, 35],
  [12, 31, 36],
  [13, 31, 37],
  [14, 31, 37],
  [15, 32, 36],
  [16, 33, 35],
];

/** The asset gallery's pond: 7 × 5 cells east of the road masks, with one corner cell left dry (an inner corner). */
export const GALLERY_POND = { x0: 35, z0: 15, x1: 41, z1: 19, dry: { x: 35, z: 15 } } as const;

/** Asset gallery: centre road block of each of the 16 masks, as a cell (block coords (1 + 4c, 1 + 4r)). */
export function galleryMaskBlock(mask: number): { x: number; z: number } {
  return { x: ROAD_BLOCK * (1 + (mask % 6) * 4), z: ROAD_BLOCK * (1 + Math.floor(mask / 6) * 4) };
}

/** Where each object kind stands in the asset gallery (rotation 0), as its anchor cell [, style]. */
export const GALLERY_OBJECTS: ReadonlyArray<readonly [ObjectKind, number, number, number?]> = [
  // Row 1 (z 22–27): the big pieces, one free cell between neighbours.
  ['roundabout', 0, 22], ['supermarket', 7, 22], ['swimming-pool', 13, 22], ['big-house', 18, 22],
  ['church', 24, 22], ['cottage', 28, 22], ['family-home', 33, 22], ['garage-house', 38, 22],
  ['bungalow', 43, 22],
  // Row 2 (z 26–29): small things; the bus stop and traffic light stand behind a stub of road; then
  // the townhouse, mailbox and corner shop at the east end.
  ['fountain', 7, 26], ['swing', 10, 26], ['bench', 13, 26], ['barbecue', 15, 26], ['planter', 17, 26],
  ['postbox', 19, 26, 0], ['lamppost', 21, 26], ['oak', 23, 26], ['pine', 25, 26], ['birch', 27, 26],
  ['bush', 29, 26], ['bus-stop', 32, 28], ['traffic-light', 35, 28],
  ['townhouse', 37, 26], ['mailbox', 41, 26], ['corner-shop', 43, 26],
  // Row 3 (z 31–33).
  ['tiered-fountain', 7, 31], ['donut-shop', 11, 31], ['tulips', 15, 31], ['long-bench', 17, 31],
  ['garden-table', 19, 31], ['slide', 21, 31],
  // The zebra crossing marks the road cluster of mask 5 (a north–south straight, galleryMaskBlock(5)).
  ['zebra-crossing', 42, 2],
  // Row 4 (z 34–39): the three car parks, entrances on the road along rows 40–41.
  ['parking', 2, 38, 0], ['parking', 8, 36, 1], ['parking', 14, 34, 2],
  // In the pond (GALLERY_POND).
  ['lily-pads', 37, 17], ['reeds', 39, 16], ['cattails', 40, 18], ['bird-house', 38, 18],
  // South-east (x 24–37, z 31–41): the stadium.
  ['stadium', 24, 31],
  // East of the stadium: the cinema.
  ['cinema', 39, 31],
];

/** The road the gallery's car parks open onto (block anchors along rows 40–41). */
const GALLERY_PARKING_ROAD: readonly number[] = [2, 4, 6, 8, 10, 12, 14, 16];

/**
 * Every road connection mask (16) as isolated little clusters of road blocks (4-block spacing so arms
 * never touch), plus every object kind at rotation 0 (front should face the default camera, i.e. +z),
 * ground kinds and every edge kind, for visual verification of tiling/orientation/proportions.
 * Layout (cells, 48 × 48, shifted by demoOffset() like the sample town): mask centres at block coords
 * (1 + 4c, 1 + 4r), mask = r * 6 + c; objects per GALLERY_OBJECTS on rows 22–39 (the car parks on a
 * road along rows 40–41); ground swatches + edge runs on rows 42–43.
 */
export function buildAssetGallery(editor: TownEditor): DemoTownResult {
  const { run, commit } = demoBuilder(editor, (item) => item.toolId, true);
  const road = (x: number, z: number) => run('road', { type: 'paint-ground', kind: 'road', cell: { x, z } });
  for (let mask = 0; mask < 16; mask += 1) {
    const { x: cx, z: cz } = galleryMaskBlock(mask);
    road(cx, cz);
    if (mask & 1) road(cx, cz - ROAD_BLOCK);
    if (mask & 2) road(cx + ROAD_BLOCK, cz);
    if (mask & 4) road(cx, cz + ROAD_BLOCK);
    if (mask & 8) road(cx - ROAD_BLOCK, cz);
  }
  road(32, 26);
  road(34, 26);
  for (const x of GALLERY_PARKING_ROAD) road(x, 40);
  const { x0, z0, x1, z1, dry } = GALLERY_POND;
  for (let z = z0; z <= z1; z += 1) {
    for (let x = x0; x <= x1; x += 1) if (x !== dry.x || z !== dry.z) run('pond', { type: 'paint-ground', kind: 'pond', cell: { x, z } });
  }
  for (const [kind, x, z, variant] of GALLERY_OBJECTS) {
    run(kind, variant === undefined ? { type: 'place-object', kind, cell: { x, z }, rotation: 0 } : { type: 'place-object', kind, cell: { x, z }, rotation: 0, variant });
  }
  const swatches = ['pavement', 'walkway', 'grass', 'meadow'] as const;
  swatches.forEach((kind, k) => {
    for (let z = 42; z <= 43; z += 1) for (let dx = 0; dx < 4; dx += 1) run(kind, { type: 'paint-ground', kind, cell: { x: 2 + k * 6 + dx, z } });
  });
  const edges = ['hedge', 'fence-low', 'fence-tall'] as const;
  edges.forEach((kind, k) => {
    for (let x = 26 + k * 6; x < 32 + k * 6; x += 1) run(kind, { type: 'place-edge', kind, edge: { x, z: 42, side: 'n' } });
  });
  return commit();
}

/**
 * A dense, fully built plot for performance budgets. Deterministic: a 12 × 12 cell repeat of road rows
 * and columns, pavements, and two rows of 4-deep lots facing opposite ways. Suburban homes
 * (800–1 330 triangles), not family homes (1 731), keep it inside the mobile budget.
 */
export function buildStressTown(editor: TownEditor): DemoTownResult {
  const { run, commit } = demoBuilder(editor, (item) => item.toolId);
  const { width, depth } = editor.state;
  const PERIOD_X = 12;
  const PERIOD_Z = 12;
  const LOT_DEPTH = 4;
  const isRoadColumn = (x: number) => x % PERIOD_X < ROAD_BLOCK;
  // Birch and pine (42 / 204 triangles; an oak is 408) keep the plot inside the mobile budget.
  const trees = ['birch', 'pine', 'birch', 'birch'] as const;
  const place = (kind: ObjectKind, x: number, z: number, rotation: Rotation, variant?: number) =>
    run(kind, variant === undefined ? { type: 'place-object', kind, cell: { x, z }, rotation } : { type: 'place-object', kind, cell: { x, z }, rotation, variant });
  const tree = (x: number, z: number) => place(trees[(x + z) % trees.length], x, z, 0);
  // Roads: one paint per block.
  for (let z = 0; z < depth; z += ROAD_BLOCK) {
    for (let x = 0; x < width; x += ROAD_BLOCK) {
      if (z % PERIOD_Z === 0 || isRoadColumn(x)) run('road', { type: 'paint-ground', kind: 'road', cell: { x, z } });
    }
  }
  for (let z0 = 0; z0 + PERIOD_Z <= depth; z0 += PERIOD_Z) {
    // Whole lot blocks only (64 × 64: the last road column at x 60 leaves a 2-cell strip of field).
    for (let x0 = ROAD_BLOCK; x0 + PERIOD_X - ROAD_BLOCK <= width; x0 += PERIOD_X) {
      const x1 = x0 + PERIOD_X - ROAD_BLOCK - 1; // last lot column
      // Pavement below this road row, and above the next one.
      for (const z of [z0 + 2, z0 + PERIOD_Z - 1]) {
        for (let x = x0; x <= x1; x += 1) run('pavement', { type: 'paint-ground', kind: 'pavement', cell: { x, z } });
        place('lamppost', x0 + 4, z, 0);
        if (z === z0 + 2) place('postbox', x0 + 9, z, 0, 0);
      }
      // Two lot rows: z0+3..z0+6 face north (rotation 2), z0+7..z0+10 face south (rotation 0).
      for (const [top, rotation] of [[z0 + 3, 2], [z0 + 3 + LOT_DEPTH, 0]] as const) {
        if (rotation === 2) {
          place('cottage', x0, top, rotation);
          place('garage-house', x0 + 4, top, rotation);
        } else {
          place('townhouse', x0, top, rotation);
          for (let dz = 0; dz < LOT_DEPTH; dz += 1) tree(x0 + 3, top + dz);
          place('garage-house', x0 + 4, top, rotation);
        }
        // A mailbox on the street side, three trees behind it, and a column of trees at the end.
        const mailboxZ = rotation === 2 ? top : top + 3;
        place('mailbox', x0 + 8, mailboxZ, rotation);
        for (const dz of rotation === 2 ? [1, 2, 3] : [0, 1, 2]) tree(x0 + 8, top + dz);
        for (let dz = 0; dz < LOT_DEPTH; dz += 1) tree(x0 + 9, top + dz);
      }
    }
  }
  for (let x = 0; x < width; x += 1) run('fence-low', { type: 'place-edge', kind: 'fence-low', edge: { x, z: 0, side: 'n' } });
  return commit();
}
