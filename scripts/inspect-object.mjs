#!/usr/bin/env node
/**
 * Stages an object (or a town) in the running game and photographs it the way a player can see it, so a
 * reviewer can judge how it sits on the ground and beside its neighbours.
 *
 *   PORT=5203 npm run dev        (a dev server; the script reads the catalog from /src, so not `vite preview`)
 *   PORT=5203 npm run inspect:object -- --kind cinema [--variant 0|all] [--out artifacts/inspect/cinema] [--scenes a,b]
 *   PORT=5203 npm run inspect:object -- --recipe town.recipe.json [--out DIR]
 *   PORT=5203 npm run inspect:object -- --town saved.tinytown.json [--look x0,z0,x1,z1 ...] [--out DIR]
 *   npm run inspect:object -- --list            (kinds and their scenes; still needs the dev server)
 *
 * One scene of your own (any of these flags with --kind replaces the staged scenes with a single `custom` one):
 *   --ground meadow            the tile under and round the object (field, grass, meadow, pavement, walkway)
 *   --around pavement          a different tile round it than under it
 *   --neighbour east:slide     something touching that side (east, west, north = behind, south = in front); repeat or
 *                              comma-separate; `kind@2` turns it two quarter turns; a car park or roundabout lands on the
 *                              nearest road block, so it may sit one cell off
 *   --edge fence-tall          that hedge or fence on all four sides of the object's lot
 *   --rotation 1  --street  --night  --name playground
 *
 * A sweep (--kind X --sweep) puts every other kind against X's east side, then against its front, one town each, and
 * shoots the seam. It writes sweep-east.png and sweep-south.png (one tile per pairing, flicker flagged) besides the
 * shots; use it to find which pairings deserve a proper look.
 *
 * --kind builds one small town per scene around the plot centre (the object alone, on each tile it may stand
 * on, ringed by tiles, on a street, beside neighbours, at four rotations, at night) and loads it through the
 * `loadTown` test hook. Every scene is shot from six camera poses inside the player's limits (distance >= 6,
 * 30-70 degrees from vertical), cropped to the scene, plus three close shots of where the object meets the
 * ground (front edge, back edge, a corner). Each pose is captured twice, the second panned by a fraction of a
 * pixel: patches that change sharply between the two are z-fighting, counted per shot (`flicker`).
 *
 * A recipe is the hand-written form of a town:
 *   { "name": "plaza",
 *     "ground":  [{ "kind": "pavement", "x0": 20, "z0": 20, "x1": 40, "z1": 34 }],     cells, inclusive; road rects snap out to 2 x 2 blocks
 *     "objects": [{ "kind": "cinema", "x": 35, "z": 28, "rotation": 0, "variant": 0 }], x, z = the footprint's min corner
 *     "edges":   [{ "kind": "hedge", "x": 35, "z": 28, "side": "n" }],
 *     "looks":   [{ "name": "cinema", "x0": 33, "z0": 26, "x1": 42, "z1": 33, "night": false }] }
 *
 * Output in --out: report.json (scenes, shots, flicker counts, what the game dropped while loading),
 * <scene>.png contact sheets, shots/<scene>-<shot>.png at full resolution, flicker/<scene>-<shot>.png for
 * flagged shots (changed pixels in red).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEG = Math.PI / 180;
const FOV = 35 * DEG;
const MIN_DISTANCE = 6;
const MAX_DISTANCE = 60;
const VIEW = { width: 1280, height: 900 };
/** Cells of context kept round the object in every scene. */
const MARGIN = 2;
const T_NIGHT = 0.82;
/** A pixel whose strongest channel moves more than this between the two nudged frames has changed; changed patches (not thin lines) count as flicker. */
const FLICKER_DELTA = 40;
/** Shots with at least this many such pixels are flagged and get a heatmap. */
const FLICKER_FLAG = 40;
const TILE_KINDS = ['pavement', 'grass'];

const SHOTS = [
  { name: 'hero', azimuth: 0.6, polar: 55 },
  { name: 'back', azimuth: 0.6 + Math.PI, polar: 55 },
  { name: 'low-front', azimuth: 0.12, polar: 69 },
  { name: 'low-side', azimuth: Math.PI / 2 + 0.12, polar: 69 },
  { name: 'low-back', azimuth: Math.PI + 0.9, polar: 69 },
  { name: 'top', azimuth: 0, polar: 31 },
];
const NIGHT_SHOTS = SHOTS.filter((shot) => ['hero', 'low-front', 'back'].includes(shot.name));
/** Height of the band a ground-contact detail shot keeps above the ground. */
const DETAIL_HEIGHT = 0.4;
/** Close shots of where the object meets the ground: a stretch of its front and back edges and its south-east corner. */
function contactDetails(ax, az, fw, fd) {
  const mid = Math.floor(ax + fw / 2);
  const span = Math.min(3, Math.ceil(fw / 2) + 1);
  return [
    { name: 'edge-front', azimuth: 0.12, polar: 60, look: { x0: mid - span, z0: az + fd - 2, x1: mid + span - 1, z1: az + fd + 1, height: DETAIL_HEIGHT } },
    { name: 'edge-back', azimuth: Math.PI + 0.12, polar: 60, look: { x0: mid - span, z0: az - 2, x1: mid + span - 1, z1: az + 1, height: DETAIL_HEIGHT } },
    { name: 'corner', azimuth: 0.8, polar: 60, look: { x0: ax + fw - 3, z0: az + fd - 3, x1: ax + fw + 1, z1: az + fd + 1, height: DETAIL_HEIGHT } },
  ];
}

const SIDES = ['east', 'west', 'north', 'south'];
/** `side:kind[@rotation]`, e.g. `east:slide` or `south:parking@2`; the side defaults to east. */
function parseNeighbour(text) {
  const [head, kindPart] = text.includes(':') ? text.split(':') : ['east', text];
  const [kind, rotation] = kindPart.split('@');
  if (!SIDES.includes(head)) throw new Error(`--neighbour side must be one of ${SIDES.join(', ')}: ${text}`);
  return { side: head, kind, rotation: Number(rotation ?? 0) };
}

function parseArgs(argv) {
  const args = {
    kind: null, variant: '0', recipe: null, town: null, looks: [], out: null, scenes: null, list: false, port: Number(process.env.PORT ?? 5188),
    ground: null, around: null, neighbours: [], edge: null, rotation: 0, street: false, night: false, sweep: false, name: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`Missing value for ${flag}`);
      return next;
    };
    if (flag === '--kind') args.kind = value();
    else if (flag === '--variant') args.variant = value();
    else if (flag === '--recipe') args.recipe = value();
    else if (flag === '--town') args.town = value();
    else if (flag === '--look') args.looks.push(value().split(',').map(Number));
    else if (flag === '--out') args.out = value();
    else if (flag === '--scenes') args.scenes = value().split(',');
    else if (flag === '--list') args.list = true;
    else if (flag === '--ground') args.ground = value();
    else if (flag === '--around') args.around = value();
    else if (flag === '--neighbour') args.neighbours.push(...value().split(',').map(parseNeighbour));
    else if (flag === '--edge') args.edge = value();
    else if (flag === '--rotation') args.rotation = Number(value());
    else if (flag === '--street') args.street = true;
    else if (flag === '--night') args.night = true;
    else if (flag === '--sweep') args.sweep = true;
    else if (flag === '--name') args.name = value();
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!args.list && [args.kind, args.recipe, args.town].filter(Boolean).length !== 1) throw new Error('Give exactly one of --kind, --recipe, --town (or --list)');
  return args;
}

// ---- catalog facts --------------------------------------------------------------------------------------------

/** Height (native units) of a GLB: its POSITION bounds through the node transforms. */
function glbHeight(file) {
  const buf = fs.readFileSync(file);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  let min = Infinity;
  let max = -Infinity;
  const visit = (index, parent) => {
    const node = json.nodes[index];
    const m = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of json.meshes[node.mesh].primitives) {
        const acc = json.accessors[primitive.attributes.POSITION];
        for (const x of [acc.min[0], acc.max[0]]) for (const y of [acc.min[1], acc.max[1]]) for (const z of [acc.min[2], acc.max[2]]) {
          const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
          min = Math.min(min, wy);
          max = Math.max(max, wy);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, m);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const index of json.scenes[json.scene ?? 0].nodes) visit(index, identity);
  return max - min;
}
function nodeMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + w * z) * sx, 2 * (x * z - w * y) * sx, 0,
    2 * (x * y - w * z) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + w * x) * sy, 0,
    2 * (x * z + w * y) * sz, 2 * (y * z - w * x) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) for (let k = 0; k < 4; k += 1) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

class Catalog {
  constructor(data) {
    Object.assign(this, data);
    this.heights = new Map();
  }
  def(kind) {
    const def = this.objects[kind];
    if (!def) throw new Error(`Unknown object kind: ${kind}. Kinds: ${Object.keys(this.objects).join(', ')}`);
    return def;
  }
  footprint(kind, variant = 0, rotation = 0) {
    const def = this.def(kind);
    const [w, d] = def.footprints?.[variant] ?? def.footprint;
    return rotation % 2 === 1 ? [d, w] : [w, d];
  }
  /** Drawn height of a kind's model, world units. */
  height(kind, variant = 0) {
    const def = this.def(kind);
    const model = def.models[variant % def.models.length];
    if (!this.heights.has(model)) {
      const spec = this.models[model];
      const style = this.styles[model]?.scale?.[1] ?? 1;
      this.heights.set(model, glbHeight(path.join(root, 'public', spec.url)) * spec.scale * style * (def.height ?? 1));
    }
    return this.heights.get(model);
  }
}

// ---- recipes --------------------------------------------------------------------------------------------------

const rect = (kind, x0, z0, x1, z1) => ({ kind, x0, z0, x1, z1 });
const evenDown = (n) => 2 * Math.floor(n / 2);
/** Road rects grow outwards to whole 2 x 2 blocks; the game turns a partial block back into field. */
const snapRoad = (r) => ({ ...r, x0: evenDown(r.x0), z0: evenDown(r.z0), x1: evenDown(r.x1) + 1, z1: evenDown(r.z1) + 1 });

/** A recipe as a SavedTown. Later ground rects paint over earlier ones; a road feature paves its own footprint. */
function recipeToSave(recipe, catalog) {
  const { width, depth } = catalog.plot;
  const cells = new Array(width * depth).fill('field');
  const paint = (r) => {
    const { kind, x0, z0, x1, z1 } = r.kind === 'road' ? snapRoad(r) : r;
    for (let z = Math.max(0, z0); z <= Math.min(depth - 1, z1); z += 1) for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x += 1) cells[z * width + x] = kind;
  };
  for (const r of recipe.ground ?? []) paint(r);
  const objects = (recipe.objects ?? []).map((o, i) => ({ id: i + 1, kind: o.kind, anchor: { x: o.x, z: o.z }, rotation: o.rotation ?? 0, variant: o.variant ?? 0 }));
  for (const o of objects) {
    if (!catalog.def(o.kind).roadFeature) continue;
    const [w, d] = catalog.footprint(o.kind, o.variant, o.rotation);
    paint(rect('road', o.anchor.x, o.anchor.z, o.anchor.x + w - 1, o.anchor.z + d - 1));
  }
  const ground = [];
  for (const kind of cells) {
    const last = ground[ground.length - 1];
    if (last && last[0] === kind) last[1] += 1;
    else ground.push([kind, 1]);
  }
  const edges = (recipe.edges ?? []).map((e) => ({ kind: e.kind, edge: { x: e.x, z: e.z, side: e.side } }));
  return { version: 4, width, depth, ground, objects, edges, nextObjectId: objects.length + 1, name: 'Inspection' };
}

/** The staged scenes for one kind and style: each is a recipe with one look. */
function scenesFor(kind, variant, catalog) {
  const def = catalog.def(kind);
  const [fw, fd] = catalog.footprint(kind, variant, 0);
  const allowed = new Set(def.allowedGround);
  const centre = catalog.plot.width / 2;
  // The object's front (+z at rotation 0) lies on an even row, so a road can run right along it.
  const roadZ = evenDown(centre + fd / 2 + 1);
  const ax = def.roadFeature || def.roadMarking ? evenDown(centre - fw / 2) : Math.floor(centre - fw / 2);
  const az = roadZ - fd;
  const self = (rotation = 0, x = ax, z = az) => ({ kind, x, z, rotation, variant });
  const pad = (x0 = ax, z0 = az, w = fw, d = fd) => ({ x0: x0 - MARGIN, z0: z0 - MARGIN, x1: x0 + w - 1 + MARGIN, z1: z0 + d - 1 + MARGIN });
  const padOf = (tile, p = pad()) => rect(tile, p.x0, p.z0, p.x1, p.z1);
  const height = catalog.height(kind, variant);
  const needsRoad = def.requiresAdjacent === 'road';
  const street = (p = pad()) => rect('road', p.x0, roadZ, p.x1, roadZ + 1);
  const withStreet = (p) => ({ ...p, z1: Math.max(p.z1, roadZ + 1 + MARGIN) });
  // The ground a neighbour scene stands on: the most built-up tile this kind allows.
  const base = allowed.has('pavement') ? 'pavement' : allowed.has('grass') ? 'grass' : 'field';
  const scenes = [];
  const add = (name, note, recipe, look = pad(), extra = {}) => {
    const ground = [...(recipe.ground ?? [])];
    let focus = look;
    if (needsRoad && !ground.some((g) => g.kind === 'road')) {
      ground.push(street(look));
      focus = withStreet(look);
    }
    scenes.push({ name, note, recipe: { ...recipe, ground }, look: { ...focus, height: extra.height ?? height }, night: extra.night ?? false, details: extra.night || extra.details === false ? [] : contactDetails(ax, az, fw, fd) });
  };

  if (def.roadMarking) {
    const along = rect('road', ax - 6, az, ax + fw + 5, az + 1);
    const across = rect('road', ax, az - 6, ax + 1, az + 7);
    add('straight', 'on a straight road', { ground: [along], objects: [self()] }, pad(ax - 2, az, fw + 4, fd));
    add('cross', 'on a crossroads', { ground: [along, across], objects: [self()] }, pad(ax - 2, az - 2, fw + 4, fd + 4));
    add('night', 'on a straight road at night', { ground: [along], objects: [self()] }, pad(ax - 2, az, fw + 4, fd), { night: true });
    return scenes;
  }

  if (allowed.size === 1 && allowed.has('pond')) {
    const cell = rect('pond', ax, az, ax + fw - 1, az + fd - 1);
    add('in-pond', 'open water all round it', { ground: [padOf('pond')], objects: [self()] });
    add('one-cell', 'a pond of its own footprint, banks all round', { ground: [cell], objects: [self()] });
    add('by-bank', 'against the north bank of a pond', { ground: [rect('pond', ax - MARGIN, az, ax + fw - 1 + MARGIN, az + fd - 1 + MARGIN)], objects: [self()] });
    add('night', 'open water at night', { ground: [padOf('pond')], objects: [self()] }, pad(), { night: true });
    return scenes;
  }

  add('alone', def.roadFeature ? 'on the bare field' : 'on the bare field, nothing round it', { objects: [self()] });
  if (!def.roadFeature) {
    for (const tile of TILE_KINDS) {
      if (allowed.has(tile)) add(`on-${tile}`, `${tile} under it and round it`, { ground: [padOf(tile)], objects: [self()] });
    }
  }
  for (const tile of TILE_KINDS) {
    if (!def.roadFeature && !allowed.has('field')) continue;
    add(`ring-${tile}`, `${tile} round it, ${def.roadFeature ? 'its own road' : 'bare field'} under it`, {
      ground: [padOf(tile), ...(def.roadFeature ? [] : [rect('field', ax, az, ax + fw - 1, az + fd - 1)])],
      objects: [self()],
    });
  }
  if (!needsRoad) {
    const p = withStreet(pad());
    add('street', `a road along its front, ${base} round it`, { ground: [padOf(base, p), street(p)], objects: [self()] }, p);
  }
  {
    // A twin lot to the east, a cottage to the west, a hedge along the back and a low fence along the front.
    const cottage = catalog.footprint('cottage');
    const objects = [self(), self(0, ax + fw, az)];
    const edges = [];
    let x0 = ax;
    if (!def.roadFeature) {
      objects.push({ kind: 'cottage', x: ax - cottage[0], z: az + fd - cottage[1], rotation: 0, variant: 0 });
      x0 = ax - cottage[0];
      for (let x = ax; x < ax + fw; x += 1) {
        edges.push({ kind: 'hedge', x, z: az, side: 'n' });
        if (!needsRoad) edges.push({ kind: 'fence-low', x, z: az + fd, side: 'n' });
      }
    }
    const z0 = Math.min(az, az + fd - cottage[1]);
    const p = pad(x0, z0, ax + 2 * fw - x0, az + fd - z0);
    const cottageGround = base === 'grass' || base === 'pavement' || base === 'field' ? base : 'field';
    add('neighbours', 'the same thing next door (east), a cottage (west), a hedge behind and a low fence in front', {
      ground: cottageGround === 'field' ? [] : [padOf(cottageGround, p)],
      objects,
      edges,
    }, p, { height: Math.max(height, catalog.height('cottage')) });
  }
  const jittered = def.group === 'tree' || def.group === 'plant';
  if (!needsRoad && !jittered) {
    // Four copies, turned 0-3 quarter turns, west to east.
    const objects = [];
    let x = ax - Math.ceil(1.5 * (Math.max(fw, fd) + 2));
    if (def.roadFeature) x = evenDown(x);
    const start = x;
    for (let rotation = 0; rotation < 4; rotation += 1) {
      const [w] = catalog.footprint(kind, variant, rotation);
      objects.push(self(rotation, x, az));
      x += w + 2;
      if (def.roadFeature) x = evenDown(x + 1);
    }
    const p = pad(start, az, x - 2 - start, Math.max(fw, fd));
    if (p.x0 >= 0 && p.x1 < catalog.plot.width) {
      add('rotations', `turned 0, 1, 2 and 3 quarter turns (west to east), on ${def.roadFeature ? 'field' : base}`, {
        ground: def.roadFeature || base === 'field' ? [] : [padOf(base, p)],
        objects,
      }, p, { details: false });
    }
  }
  {
    const p = needsRoad ? pad() : withStreet(pad());
    add('night', `at night, ${base} round it${needsRoad ? '' : ' and a road along its front'}`, {
      ground: [...(base === 'field' ? [] : [padOf(base, p)]), ...(needsRoad ? [] : [street(p)])],
      objects: [self()],
    }, p, { night: true });
  }
  return scenes;
}

/** Where `kind` (footprint w × d, as turned) stands so it touches `side` of the lot at (ax, az, fw, fd). */
function besideLot(catalog, neighbour, ax, az, fw, fd) {
  const def = catalog.def(neighbour.kind);
  const [w, d] = catalog.footprint(neighbour.kind, 0, neighbour.rotation);
  let x = neighbour.side === 'east' ? ax + fw : neighbour.side === 'west' ? ax - w : ax;
  let z = neighbour.side === 'south' ? az + fd : neighbour.side === 'north' ? az - d : az + fd - d;
  if (def.roadFeature || def.roadMarking) {
    // Road pieces live on the 2 × 2 block grid: move away from the lot, never into it.
    x = neighbour.side === 'east' ? x + (x % 2) : evenDown(x);
    z = neighbour.side === 'south' ? z + (z % 2) : evenDown(z);
  }
  return { kind: neighbour.kind, x, z, rotation: neighbour.rotation, variant: 0, w, d };
}

const boundsOf = (boxes) => ({
  x0: Math.min(...boxes.map((b) => b.x)) - MARGIN,
  z0: Math.min(...boxes.map((b) => b.z)) - MARGIN,
  x1: Math.max(...boxes.map((b) => b.x + b.w - 1)) + MARGIN,
  z1: Math.max(...boxes.map((b) => b.z + b.d - 1)) + MARGIN,
});

/** The subject's anchor at the plot centre, its front on an even row (a road can run along it). */
function centred(kind, variant, rotation, catalog) {
  const def = catalog.def(kind);
  const [fw, fd] = catalog.footprint(kind, variant, rotation);
  const centre = catalog.plot.width / 2;
  const roadZ = evenDown(centre + fd / 2 + 1);
  const ax = def.roadFeature || def.roadMarking ? evenDown(centre - fw / 2) : Math.floor(centre - fw / 2);
  return { def, fw, fd, ax, az: roadZ - fd, roadZ };
}

/** One scene from the --ground / --around / --neighbour / --edge / --rotation / --street / --night flags. */
function customScene(args, variant, catalog) {
  const { def, fw, fd, ax, az, roadZ } = centred(args.kind, variant, args.rotation, catalog);
  const under = args.ground ?? 'field';
  const around = args.around ?? under;
  const neighbours = args.neighbours.map((n) => besideLot(catalog, n, ax, az, fw, fd));
  const subject = { kind: args.kind, x: ax, z: az, rotation: args.rotation, variant, w: fw, d: fd };
  let look = boundsOf([subject, ...neighbours]);
  const ground = [];
  if (around !== 'field') ground.push(rect(around, look.x0, look.z0, look.x1, look.z1));
  if (under !== around && !def.roadFeature) ground.push(rect(under, ax, az, ax + fw - 1, az + fd - 1));
  const wantsStreet = args.street || def.requiresAdjacent === 'road' || neighbours.some((n) => catalog.def(n.kind).requiresAdjacent === 'road');
  if (wantsStreet) {
    const south = neighbours.filter((n) => n.side === 'south');
    const z = south.length ? evenDown(Math.max(...south.map((n) => n.z + n.d)) + 1) : roadZ;
    ground.push(rect('road', look.x0, z, look.x1, z + 1));
    look = { ...look, z1: Math.max(look.z1, z + 1 + MARGIN) };
  }
  const edges = [];
  if (args.edge) {
    for (let x = ax; x < ax + fw; x += 1) edges.push({ kind: args.edge, x, z: az, side: 'n' }, { kind: args.edge, x, z: az + fd, side: 'n' });
    for (let z = az; z < az + fd; z += 1) edges.push({ kind: args.edge, x: ax, z, side: 'w' }, { kind: args.edge, x: ax + fw, z, side: 'w' });
  }
  const parts = [
    `${under} under it`,
    around !== under ? `${around} round it` : '',
    ...args.neighbours.map((n) => `${n.kind} to the ${n.side}`),
    args.edge ? `${args.edge} on all four sides` : '',
    args.rotation ? `turned ${args.rotation} quarter turn(s)` : '',
    wantsStreet ? 'a road in front' : '',
    args.night ? 'at night' : '',
  ].filter(Boolean);
  const height = Math.max(catalog.height(args.kind, variant), ...neighbours.map((n) => catalog.height(n.kind)));
  return {
    name: args.name ?? 'custom',
    note: parts.join(', '),
    recipe: { ground, objects: [subject, ...neighbours].map(({ w, d, ...object }) => object), edges },
    look: { ...look, height },
    night: args.night,
    details: args.night ? [] : contactDetails(ax, az, fw, fd),
  };
}

/** The most built-up ground both kinds may stand on. */
function sharedGround(a, b) {
  for (const tile of ['pavement', 'grass']) if (a.allowedGround.includes(tile) && b.allowedGround.includes(tile)) return tile;
  return 'field';
}

/** Every other kind against the subject's east side and its front; two views of the seam each. */
function sweepScenes(kind, variant, catalog) {
  const { def, fw, fd, ax, az, roadZ } = centred(kind, variant, 0, catalog);
  const subject = { kind, x: ax, z: az, rotation: 0, variant, w: fw, d: fd };
  const scenes = [];
  for (const side of ['east', 'south']) {
    for (const other of Object.keys(catalog.objects)) {
      const otherDef = catalog.def(other);
      if (otherDef.roadMarking || def.roadMarking) continue;
      const neighbour = besideLot(catalog, { side, kind: other, rotation: 0 }, ax, az, fw, fd);
      const tile = def.roadFeature || otherDef.roadFeature ? 'field' : sharedGround(def, otherDef);
      const look = boundsOf([subject, neighbour]);
      const ground = tile === 'field' ? [] : [rect(tile, look.x0, look.z0, look.x1, look.z1)];
      if (def.requiresAdjacent === 'road' || otherDef.requiresAdjacent === 'road') {
        const z = side === 'south' ? evenDown(neighbour.z + neighbour.d + 1) : roadZ;
        ground.push(rect('road', look.x0, z, look.x1, z + 1));
      }
      // A band across the shared boundary, seen along it.
      const reach = 2;
      const seam = side === 'east'
        ? { x0: ax + fw - reach, x1: ax + fw + reach - 1, z0: Math.max(az, az + fd - 4), z1: az + fd }
        : { x0: Math.max(ax, ax + Math.floor(fw / 2) - 2), x1: Math.min(ax + fw - 1, ax + Math.floor(fw / 2) + 2), z0: az + fd - reach, z1: az + fd + reach - 1 };
      const low = Math.min(1.2, Math.max(catalog.height(kind, variant), catalog.height(other)));
      scenes.push({
        name: `sweep-${side}-${other}`,
        note: `${other} against its ${side === 'east' ? 'east side' : 'front'}, on ${tile}`,
        recipe: { ground, objects: [subject, neighbour].map(({ w, d, ...object }) => object) },
        look: { ...look, height: Math.max(catalog.height(kind, variant), catalog.height(other)) },
        night: false,
        sweep: { side, other },
        views: [
          { name: 'seam', azimuth: side === 'east' ? 0.06 : Math.PI / 2 + 0.06, polar: 55, look: { ...seam, height: low } },
          { name: 'top', azimuth: 0, polar: 31, look: { ...look, height: Math.max(catalog.height(kind, variant), catalog.height(other)) } },
        ],
      });
    }
  }
  return scenes;
}

/** Scenes of a hand-written recipe: one per look (default: everything that isn't bare field). */
function recipeScenes(recipe, catalog, looksArg) {
  const save = recipe.version ? recipe : null;
  const looks = looksArg.length
    ? looksArg.map(([x0, z0, x1, z1], i) => ({ name: `look-${i + 1}`, x0, z0, x1, z1 }))
    : recipe.looks?.length
      ? recipe.looks
      : [{ name: 'all', ...contentBounds(save ?? recipeToSave(recipe, catalog), catalog) }];
  const objects = save ? save.objects.map((o) => ({ kind: o.kind, x: o.anchor.x, z: o.anchor.z, rotation: o.rotation, variant: o.variant })) : (recipe.objects ?? []);
  return looks.map((look, i) => {
    const inside = objects.filter((o) => o.x <= look.x1 && o.z <= look.z1 && o.x + 14 >= look.x0 && o.z + 14 >= look.z0);
    const height = look.height ?? Math.max(0.3, ...inside.map((o) => (catalog.objects[o.kind] ? catalog.height(o.kind, o.variant ?? 0) : 0)));
    return { name: look.name ?? `look-${i + 1}`, note: look.note ?? '', recipe, save, look: { ...look, height }, night: look.night ?? false };
  });
}

function contentBounds(save, catalog) {
  const { width, depth } = catalog.plot;
  let x0 = width, z0 = depth, x1 = -1, z1 = -1, i = 0;
  for (const [kind, count] of save.ground) {
    for (let n = 0; n < count; n += 1, i += 1) {
      if (kind === 'field') continue;
      const x = i % width, z = Math.floor(i / width);
      x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z);
    }
  }
  for (const o of save.objects) {
    const [w, d] = catalog.objects[o.kind] ? catalog.footprint(o.kind, o.variant, o.rotation) : [1, 1];
    x0 = Math.min(x0, o.anchor.x); z0 = Math.min(z0, o.anchor.z); x1 = Math.max(x1, o.anchor.x + w - 1); z1 = Math.max(z1, o.anchor.z + d - 1);
  }
  if (x1 < 0) return { x0: width / 2 - 4, z0: depth / 2 - 4, x1: width / 2 + 3, z1: depth / 2 + 3 };
  return { x0: x0 - 1, z0: z0 - 1, x1: x1 + 1, z1: z1 + 1 };
}

// ---- the browser side -----------------------------------------------------------------------------------------

async function openGame(browser, url, scale) {
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: scale });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 30_000 });
  // Only the canvas: the dock and top bar would cover the low shots.
  await page.addStyleTag({ content: '#ui-root { visibility: hidden !important; }' });
  await page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await hooks.setReducedMotion(true);
    await frames();
    await hooks.setPausedForScreenshot(true);
    await hooks.hideDebugUi(true);
  });
  return { page, errors, context };
}

async function readCatalog(page) {
  const data = await page.evaluate(async () => {
    const [objects, models, styles, config] = await Promise.all([
      import('/src/catalog/objects.ts'),
      import('/src/catalog/models.ts'),
      import('/src/render/modelStyles.ts'),
      import('/src/game/config.ts'),
    ]);
    return {
      objects: JSON.parse(JSON.stringify(objects.OBJECTS)),
      models: JSON.parse(JSON.stringify(models.MODELS)),
      styles: JSON.parse(JSON.stringify(styles.MODEL_STYLES)),
      plot: { width: config.PLOT_WIDTH, depth: config.PLOT_DEPTH, cell: config.CELL_SIZE },
    };
  });
  return new Catalog(data);
}

const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** Fraction of a CSS pixel the nudged frame is panned by. */
const NUDGE_PX = 0.2;
/**
 * The same camera position turned a hair to the side: the picture shifts by NUDGE_PX everywhere, near or far
 * (no parallax), so silhouettes change by a thin line while fighting surfaces swap whole patches.
 */
function panned(targetX, targetZ, azimuth, polar, distance) {
  const shift = NUDGE_PX / (VIEW.height / (2 * distance * Math.tan(FOV / 2)));
  const x = distance * Math.sin(polar) * Math.sin(azimuth) - shift * Math.cos(azimuth);
  const y = distance * Math.cos(polar);
  const z = distance * Math.sin(polar) * Math.cos(azimuth) + shift * Math.sin(azimuth);
  const d = Math.hypot(x, y, z);
  return { targetX: targetX + shift * Math.cos(azimuth), targetZ: targetZ - shift * Math.sin(azimuth), azimuth: Math.atan2(x, z), polar: Math.acos(y / d), distance: d };
}

/** Poses the camera on a look and returns the clip (CSS pixels) that holds it, pulling back until it fits. */
async function frame(page, look, shot, catalog, nudge = false, fixedDistance = null) {
  const { width, cell } = catalog.plot;
  const half = width / 2;
  const centreX = ((look.x0 + look.x1 + 1) / 2 - half) * cell;
  const centreZ = ((look.z0 + look.z1 + 1) / 2 - catalog.plot.depth / 2) * cell;
  const polar = shot.polar * DEG;
  let distance = fixedDistance ?? MIN_DISTANCE;
  let clip = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const pose = nudge ? panned(centreX, centreZ, shot.azimuth, polar, distance) : { targetX: centreX, targetZ: centreZ, azimuth: shot.azimuth, polar, distance };
    const corners = await page.evaluate(
      ([p, l]) => {
        const hooks = window.__THREE_GAME_TEST_HOOKS__;
        hooks.setCameraPose(p);
        return [[l.x0 - 0.5, l.z0 - 0.5], [l.x1 + 0.5, l.z0 - 0.5], [l.x0 - 0.5, l.z1 + 0.5], [l.x1 + 0.5, l.z1 + 0.5]].map(([x, z]) => hooks.cellToClient(x, z));
      },
      [pose, look],
    );
    // Height shows as roughly height × sin(polar) × pixels per unit at the target's depth.
    const rise = look.height * Math.sin(polar) * (VIEW.height / (2 * distance * Math.tan(FOV / 2))) * 1.15;
    const pad = 14;
    const x0 = Math.min(...corners.map((c) => c.x)) - pad;
    const x1 = Math.max(...corners.map((c) => c.x)) + pad;
    const y0 = Math.min(...corners.map((c) => c.y)) - rise - pad;
    const y1 = Math.max(...corners.map((c) => c.y)) + pad;
    clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0, distance };
    const over = Math.max((x1 - x0) / VIEW.width, (y1 - y0) / VIEW.height);
    if (fixedDistance !== null || over <= 1 || distance >= MAX_DISTANCE) break;
    distance = Math.min(MAX_DISTANCE, distance * over * 1.04);
  }
  // Centre an oversized clip on the view, then keep it inside.
  const w = Math.min(VIEW.width, Math.ceil(clip.width));
  const h = Math.min(VIEW.height, Math.ceil(clip.height));
  const x = Math.max(0, Math.min(VIEW.width - w, Math.floor(clip.x)));
  const y = Math.max(0, Math.min(VIEW.height - h, Math.floor(clip.y)));
  return { clip: { x, y, width: w, height: h }, distance: clip.distance };
}

/** A blank page that diffs the nudged pair and lays out the contact sheets. */
async function openDarkroom(browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.setContent('<!doctype html><html><body style="margin:0;background:#1d1f24"></body></html>');
  return page;
}

async function flicker(darkroom, first, second) {
  return darkroom.evaluate(
    async ([a, b, delta]) => {
      const load = (b64) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = `data:image/png;base64,${b64}`;
      });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const canvas = document.createElement('canvas');
      canvas.width = ia.width;
      canvas.height = ia.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(ia, 0, 0);
      const da = ctx.getImageData(0, 0, ia.width, ia.height);
      ctx.drawImage(ib, 0, 0);
      const db = ctx.getImageData(0, 0, ia.width, ia.height);
      const out = ctx.createImageData(ia.width, ia.height);
      const w = ia.width;
      const changed = new Uint8Array(w * ia.height);
      for (let i = 0; i < da.data.length; i += 4) {
        const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
        const grey = (da.data[i] + da.data[i + 1] + da.data[i + 2]) / 3;
        out.data[i] = out.data[i + 1] = out.data[i + 2] = 90 + grey * 0.5;
        out.data[i + 3] = 255;
        if (d > delta) changed[i / 4] = 1;
      }
      // A silhouette that moved by a fraction of a pixel changes a line one or two pixels wide; z-fighting
      // changes patches. Only pixels whose four neighbours changed too are counted.
      let pixels = 0;
      const hits = [];
      for (let p = w; p < changed.length - w; p += 1) {
        if (changed[p] && changed[p - 1] && changed[p + 1] && changed[p - w] && changed[p + w]) {
          pixels += 1;
          hits.push(p);
        }
      }
      // Red marks, grown a little so single pixels show on a contact sheet.
      for (const p of hits) {
        const px = p % ia.width;
        const py = Math.floor(p / ia.width);
        for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
          const x = px + dx;
          const y = py + dy;
          if (x < 0 || y < 0 || x >= ia.width || y >= ia.height) continue;
          const o = (y * ia.width + x) * 4;
          out.data[o] = 255;
          out.data[o + 1] = 30;
          out.data[o + 2] = 30;
        }
      }
      ctx.putImageData(out, 0, 0);
      return { pixels, heatmap: pixels > 0 ? canvas.toDataURL('image/png').split(',')[1] : null };
    },
    [first.toString('base64'), second.toString('base64'), FLICKER_DELTA],
  );
}

async function contactSheet(darkroom, title, tiles, file, columns = 3, cell = 780) {
  await darkroom.evaluate(
    ([heading, items, columns, cell]) => {
      document.body.innerHTML = `
        <div id="sheet" style="display:inline-block;padding:14px;font:15px/1.3 -apple-system,Helvetica,Arial,sans-serif;color:#f1f1f1">
          <div style="font-size:19px;font-weight:600;margin:0 0 10px 2px">${heading}</div>
          <div style="display:grid;grid-template-columns:repeat(${Math.min(columns, items.length)},${cell}px);gap:10px">
            ${items.map((t) => `
              <div style="background:#2a2d34;border:2px solid ${t.flag ? '#ff4d4d' : '#2a2d34'}">
                <div style="padding:5px 8px">${t.caption}</div>
                <div style="height:${Math.round(cell * 0.72)}px;display:flex;align-items:center;justify-content:center;background:#111">
                  <img src="data:image/png;base64,${t.image}" style="max-width:100%;max-height:100%">
                </div>
              </div>`).join('')}
          </div>
        </div>`;
    },
    [title, tiles, columns, cell],
  );
  await darkroom.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
  await darkroom.locator('#sheet').screenshot({ path: file });
}

// ---- main -----------------------------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = `http://127.0.0.1:${args.port}/`;
  const browser = await chromium.launch({ channel: 'chromium' });
  try {
    // Small things are shot at three device pixels per CSS pixel: the camera cannot come closer than MIN_DISTANCE.
    let game = await openGame(browser, url, 2);
    const catalog = await readCatalog(game.page);

    if (args.list) {
      for (const kind of Object.keys(catalog.objects)) console.log(`${kind}: ${scenesFor(kind, 0, catalog).map((s) => s.name).join(', ')}`);
      return;
    }

    let scenes;
    let label;
    if (args.kind) {
      const def = catalog.def(args.kind);
      const variants = args.variant === 'all' ? def.models.map((_, i) => i) : [Number(args.variant)];
      const custom = args.ground || args.around || args.neighbours.length || args.edge || args.rotation || args.street || args.night;
      const build = (variant) => (args.sweep ? sweepScenes(args.kind, variant, catalog) : custom ? [customScene(args, variant, catalog)] : scenesFor(args.kind, variant, catalog));
      scenes = variants.flatMap((variant) => build(variant).map((scene) => ({ ...scene, name: variants.length > 1 ? `v${variant}-${scene.name}` : scene.name, variant })));
      label = args.kind;
      const [fw, fd] = catalog.footprint(args.kind, variants[0]);
      if (Math.max(fw, fd) <= 3) {
        await game.context.close();
        game = await openGame(browser, url, 3);
      }
    } else {
      const file = args.recipe ?? args.town;
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      // A downloaded town file wraps the save in `town`.
      const recipe = args.town && raw.town ? raw.town : raw;
      scenes = recipeScenes(recipe, catalog, args.looks);
      label = recipe.name ?? path.basename(file).replace(/\..*$/, '');
    }
    if (args.scenes) {
      const unknown = args.scenes.filter((name) => !scenes.some((scene) => scene.name === name));
      if (unknown.length) throw new Error(`Unknown scene(s): ${unknown.join(', ')}. Scenes: ${scenes.map((s) => s.name).join(', ')}`);
      scenes = scenes.filter((scene) => args.scenes.includes(scene.name));
    }

    const out = path.resolve(root, args.out ?? `artifacts/inspect/${label}`);
    fs.mkdirSync(path.join(out, 'shots'), { recursive: true });
    fs.mkdirSync(path.join(out, 'flicker'), { recursive: true });
    const darkroom = await openDarkroom(browser);
    const report = { subject: label, url, generated: new Date().toISOString(), flickerDelta: FLICKER_DELTA, flickerFlag: FLICKER_FLAG, scenes: [], warnings: [], errors: [] };
    let loadedSave = null;
    const sweepTiles = { east: [], south: [] };

    for (const scene of scenes) {
      const save = scene.save ?? recipeToSave(scene.recipe, catalog);
      if (save !== loadedSave) {
        const loaded = await game.page.evaluate((town) => window.__THREE_GAME_TEST_HOOKS__.loadTown(town), save);
        loadedSave = save;
        scene.loaded = loaded;
        if (loaded.objects !== save.objects.length || loaded.edges !== save.edges.length) {
          report.warnings.push(`${scene.name}: the game kept ${loaded.objects}/${save.objects.length} objects and ${loaded.edges}/${save.edges.length} edges; the rest broke a placement rule and were dropped`);
        }
      }
      await game.page.evaluate(([t, night]) => {
        const hooks = window.__THREE_GAME_TEST_HOOKS__;
        hooks.setTimeOfDay(t);
        hooks.setMatchNight(night);
        hooks.setReducedMotion(true);
      }, [scene.night ? T_NIGHT : 0.55, scene.night]);

      const tiles = [];
      const entry = { name: scene.name, note: scene.note, night: scene.night, look: scene.look, sheet: `${scene.name}.png`, shots: [] };
      const shots = scene.views ?? [...(scene.night ? NIGHT_SHOTS : SHOTS).map((shot) => ({ ...shot, look: scene.look })), ...(scene.details ?? [])];
      for (const shot of shots) {
        const { clip, distance } = await frame(game.page, shot.look, shot, catalog);
        await settle(game.page);
        const first = await game.page.screenshot({ clip });
        await frame(game.page, shot.look, shot, catalog, true, distance);
        await settle(game.page);
        const second = await game.page.screenshot({ clip });
        const diff = await flicker(darkroom, first, second);
        const flagged = diff.pixels >= FLICKER_FLAG;
        const file = `shots/${scene.name}-${shot.name}.png`;
        fs.writeFileSync(path.join(out, file), first);
        const record = { name: shot.name, file, distance: Number(distance.toFixed(2)), polar: shot.polar, azimuth: Number(shot.azimuth.toFixed(3)), flicker: diff.pixels, flagged };
        if (flagged) {
          record.heatmap = `flicker/${scene.name}-${shot.name}.png`;
          fs.writeFileSync(path.join(out, record.heatmap), Buffer.from(diff.heatmap, 'base64'));
        }
        entry.shots.push(record);
        tiles.push({ image: first.toString('base64'), flag: flagged, caption: `${shot.name} · ${shot.polar}° from vertical · distance ${distance.toFixed(1)}${flagged ? ` · FLICKER ${diff.pixels} px` : ''}` });
      }
      if (scene.sweep) {
        // One tile per pairing on the sweep sheets below, not a sheet each.
        delete entry.sheet;
        const seam = entry.shots[0];
        const dropped = scene.loaded && scene.loaded.objects !== 2;
        sweepTiles[scene.sweep.side].push({ image: tiles[0].image, flag: seam.flagged || entry.shots.some((s) => s.flagged), caption: `${scene.sweep.other}${dropped ? ' · DROPPED' : ''}${entry.shots.some((s) => s.flagged) ? ` · FLICKER ${Math.max(...entry.shots.map((s) => s.flicker))} px` : ''}` });
      } else {
        await contactSheet(darkroom, `${label} · ${scene.name}${scene.note ? `: ${scene.note}` : ''}`, tiles, path.join(out, entry.sheet));
      }
      report.scenes.push(entry);
      const flags = entry.shots.filter((s) => s.flagged).map((s) => `${s.name} ${s.flicker}px`);
      if (!scene.sweep || flags.length) console.log(`${scene.name}: ${entry.sheet ?? ''}${flags.length ? `   FLICKER: ${flags.join(', ')}` : ''}`);
    }
    for (const [side, tiles] of Object.entries(sweepTiles)) {
      if (!tiles.length) continue;
      const sheet = `sweep-${side}.png`;
      await contactSheet(darkroom, `${label} · every kind against its ${side === 'east' ? 'east side' : 'front'} (the seam, seen along it)`, tiles, path.join(out, sheet), 6, 390);
      report.sweepSheets = [...(report.sweepSheets ?? []), sheet];
      console.log(`sweep ${side}: ${sheet} (${tiles.length} pairings, ${tiles.filter((t) => t.flag).length} flagged)`);
    }
    report.errors = game.errors;
    fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    for (const warning of report.warnings) console.log(`warning: ${warning}`);
    for (const error of report.errors) console.log(`browser error: ${error}`);
    console.log(`wrote ${path.relative(root, out)}/report.json (${report.scenes.length} scene(s))`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
