#!/usr/bin/env node
/**
 * Builds the PLACEHOLDER pond models into public/assets/models/pond/: the shore pieces, lily pads,
 * reeds, cattails, the floating bird house and the duck. Flat-shaded, one vertex-coloured material
 * each, deterministic. They exist so the game, tests and icons work before the Blender models are
 * made; each file is replaced by its Blender twin at the same path (contract: docs/pond-handover.md).
 *
 *   node scripts/build-pond-placeholders.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/assets/models/pond');

// GLTFExporter writes binary output through FileReader, which Node lacks.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

// Shore: one quarter cell (0.25 × 0.25), origin at its centre, made for the north-west quarter.
const Q = 0.25;
const H = Q / 2;
/** Bank top (a hair above lawn tiles at 0.016) and the water slab top (GROUND_MODELS.pond). */
const BANK_TOP = 0.022;
const WATER_Y = 0.008;
/** Bank profile from the land boundary inward: distance, height. Every shore piece meets its neighbours with it. */
const PROFILE = [
  [0, BANK_TOP],
  [0.028, BANK_TOP],
  [0.042, 0.013],
  [0.07, 0],
];
const COLOURS = {
  // The plot field (world/Terrain.ts), the commonest neighbour, so the bank corners melt into it.
  grass: 0x84c27c,
  sand: 0xd8c596,
  earth: 0x8a6a4a,
  pebble: 0x9aa1a8,
  rock: 0x8d939b,
  pad: 0x4f9a46,
  padLight: 0x6fb85a,
  petal: 0xf4a6c4,
  petalHeart: 0xffe066,
  reed: 0x86b04f,
  reedDark: 0x6c9a43,
  plume: 0xa0806a,
  cattail: 0x6b4a2e,
  wood: 0xa57a52,
  woodDark: 0x7d5a3c,
  wall: 0xeee2c6,
  roof: 0xc8574a,
  hole: 0x3b3a36,
  duckBody: 0x9c8f83,
  duckBreast: 0x8a5a44,
  duckHead: 0x2f7a4a,
  duckRing: 0xf3f1ea,
  duckBill: 0xf2b632,
  duckTail: 0x3b3a36,
};

class Mesher {
  positions = [];
  colours = [];

  /** A triangle, flipped if needed so its normal points along `want` (any non-zero vector). */
  tri(a, b, c, hex, want = [0, 1, 0]) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const area = Math.hypot(...n);
    if (area < 1e-9) return;
    const flip = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0;
    const colour = new THREE.Color().setHex(hex);
    for (const p of flip ? [a, c, b] : [a, b, c]) {
      this.positions.push(...p.map((value) => Math.round(value * 1e5) / 1e5));
      this.colours.push(colour.r, colour.g, colour.b);
    }
  }

  quad(a, b, c, d, hex, want) {
    this.tri(a, b, c, hex, want);
    this.tri(a, c, d, hex, want);
  }

  /** A pyramid-like stone: a ring of `sides` points on y = `y`, an apex `h` above its centre. */
  stone(x, z, y, r, h, sides, hex, turn = 0) {
    const apex = [x, y + h, z];
    for (let i = 0; i < sides; i += 1) {
      const a0 = turn + (i / sides) * Math.PI * 2;
      const a1 = turn + ((i + 1) / sides) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r];
      const p1 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
      const mid = [(p0[0] + p1[0]) / 2 - x, 0.3, (p0[2] + p1[2]) / 2 - z];
      this.tri(p0, p1, apex, hex, mid);
    }
  }

  /** An axis-aligned box from (x0, y0, z0) to (x1, y1, z1), all six faces. */
  box(x0, y0, z0, x1, y1, z1, hex, topHex = hex) {
    const p = (x, y, z) => [x, y, z];
    this.quad(p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1), topHex, [0, 1, 0]);
    this.quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), hex, [0, -1, 0]);
    this.quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), hex, [0, 0, 1]);
    this.quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y1, z0), p(x0, y1, z0), hex, [0, 0, -1]);
    this.quad(p(x1, y0, z0), p(x1, y0, z1), p(x1, y1, z1), p(x1, y1, z0), hex, [1, 0, 0]);
    this.quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), hex, [-1, 0, 0]);
  }

  /** A thin blade from a base point, leaning by (lx, lz), width `w` at the base, pointed tip. */
  blade(x, z, height, w, lx, lz, hex, yaw) {
    const c = Math.cos(yaw) * w / 2;
    const s = Math.sin(yaw) * w / 2;
    this.tri([x - c, 0, z - s], [x + c, 0, z + s], [x + lx, height, z + lz], hex, [-s, 0, c]);
  }

  /** A vertical hexagonal prism (a cattail head, a stem). */
  prism(x, z, y0, y1, r, hex, sides = 6) {
    for (let i = 0; i < sides; i += 1) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r];
      const p1 = [x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r];
      const q0 = [p0[0], y1, p0[2]];
      const q1 = [p1[0], y1, p1[2]];
      const out = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      this.quad(p0, p1, q1, q0, hex, out);
      this.tri([x, y1, z], q0, q1, hex, [0, 1, 0]);
    }
  }

  build(name) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colours, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ name: 'placeholder', vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    return mesh;
  }
}

/** Colour of the bank between profile rows i and i + 1. */
const rowColour = (i) => (i === 0 ? COLOURS.grass : COLOURS.sand);

/** Sweeps the bank profile along `rows(d)`: a function from a profile distance to a polyline of points. */
function sweep(m, rows) {
  for (let i = 0; i + 1 < PROFILE.length; i += 1) {
    const [d0, y0] = PROFILE[i];
    const [d1, y1] = PROFILE[i + 1];
    const a = rows(d0);
    const b = rows(d1);
    for (let k = 0; k + 1 < a.length; k += 1) {
      m.quad([a[k][0], y0, a[k][1]], [a[k + 1][0], y0, a[k + 1][1]], [b[k + 1][0], y1, b[k + 1][1]], [b[k][0], y1, b[k][1]], rowColour(i), [0, 1, 0]);
    }
  }
}

/** Earth wall on the cell boundary from y = 0 to the bank top, facing out of the pond. */
function wall(m, from, to, out) {
  m.quad([from[0], 0, from[1]], [to[0], 0, to[1]], [to[0], BANK_TOP, to[1]], [from[0], BANK_TOP, from[1]], COLOURS.earth, [out[0], 0, out[1]]);
}

/** Straight bank along the north side; `bump(t)` pushes the waterline south mid-piece (0 at both ends). */
function edgePiece(name, segments, bump, extras) {
  const m = new Mesher();
  const t = Array.from({ length: segments + 1 }, (_, i) => i / segments);
  sweep(m, (d) => t.map((u) => [-H + u * Q, -H + d + (d > 0 ? bump(u) : 0)]));
  wall(m, [-H, -H], [H, -H], [0, -1]);
  extras?.(m);
  return m.build(name);
}

/** Rounded convex corner: land north and west, waterline a quarter circle round the cell centre (+H, +H). */
function outerPiece(name, extras) {
  const m = new Mesher();
  const steps = 6;
  const arc = (d) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const a = Math.PI + (i / steps) * (Math.PI / 2);
      const r = Q - d;
      return [H + Math.cos(a) * r, H + Math.sin(a) * r];
    });
  sweep(m, arc);
  const rim = arc(0);
  for (let i = 0; i + 1 < rim.length; i += 1) {
    m.tri([-H, BANK_TOP, -H], [rim[i][0], BANK_TOP, rim[i][1]], [rim[i + 1][0], BANK_TOP, rim[i + 1][1]], COLOURS.grass, [0, 1, 0]);
  }
  wall(m, [-H, -H], [H, -H], [0, -1]);
  wall(m, [-H, -H], [-H, H], [-1, 0]);
  extras?.(m);
  return m.build(name);
}

/** Concave notch: pond north and west, land only on the diagonal; the bank rounds the corner point. */
function innerPiece(name) {
  const m = new Mesher();
  const steps = 4;
  sweep(m, (d) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const a = (i / steps) * (Math.PI / 2);
      return [-H + Math.cos(a) * d, -H + Math.sin(a) * d];
    }),
  );
  return m.build(name);
}

/** Flat pads (notched octagons) in the water; `flowers` adds a water lily on some of them. */
function lilyPads(name, pads, flowers = []) {
  const m = new Mesher();
  const THICK = 0.004;
  for (const [x, z, r, turn, hex] of pads) {
    const sides = 9;
    for (let i = 0; i < sides; i += 1) {
      if (i === 0) continue; // the notch
      const a0 = turn + (i / sides) * Math.PI * 2;
      const a1 = turn + ((i + 1) / sides) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, THICK, z + Math.sin(a0) * r];
      const p1 = [x + Math.cos(a1) * r, THICK, z + Math.sin(a1) * r];
      m.tri([x, THICK, z], p0, p1, hex, [0, 1, 0]);
      m.quad([p0[0], 0, p0[2]], [p1[0], 0, p1[2]], p1, p0, COLOURS.reedDark, [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]);
    }
  }
  for (const [x, z] of flowers) {
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      const tip = [x + Math.cos(a) * 0.026, THICK + 0.022, z + Math.sin(a) * 0.026];
      const side = 0.011;
      m.tri([x + Math.cos(a + 1.2) * side, THICK, z + Math.sin(a + 1.2) * side], [x + Math.cos(a - 1.2) * side, THICK, z + Math.sin(a - 1.2) * side], tip, COLOURS.petal, [Math.cos(a), 0.6, Math.sin(a)]);
    }
    m.stone(x, z, THICK, 0.008, 0.016, 5, COLOURS.petalHeart);
  }
  return m.build(name);
}

/** Deterministic pseudo-random sequence for the clumps. */
function sequence(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function reeds(name, count, plumes, seed) {
  const m = new Mesher();
  const rand = sequence(seed);
  for (let i = 0; i < count; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = 0.03 + rand() * 0.11;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const height = 0.2 + rand() * 0.12;
    const lean = 0.02 + rand() * 0.03;
    const tipX = Math.cos(a) * lean;
    const tipZ = Math.sin(a) * lean;
    m.blade(x, z, height, 0.016, tipX, tipZ, i % 3 === 0 ? COLOURS.reedDark : COLOURS.reed, a + Math.PI / 2);
    if (i < plumes) m.stone(x + tipX * 0.9, z + tipZ * 0.9, height * 0.86, 0.012, 0.05, 4, COLOURS.plume, a);
  }
  return m.build(name);
}

function cattails(name, stems, blades, seed) {
  const m = new Mesher();
  const rand = sequence(seed);
  for (let i = 0; i < stems; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = 0.02 + rand() * 0.09;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const height = 0.24 + rand() * 0.09;
    m.prism(x, z, 0, height, 0.004, COLOURS.reedDark, 4);
    m.prism(x, z, height - 0.075, height - 0.02, 0.013, COLOURS.cattail, 6);
    m.prism(x, z, height - 0.02, height + 0.012, 0.003, COLOURS.reedDark, 4);
  }
  for (let i = 0; i < blades; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = 0.03 + rand() * 0.1;
    m.blade(Math.cos(a) * r, Math.sin(a) * r, 0.16 + rand() * 0.1, 0.018, Math.cos(a) * 0.05, Math.sin(a) * 0.05, COLOURS.reed, a + Math.PI / 2);
  }
  return m.build(name);
}

/** A raft with a little nest box on a post; the hole faces +Z. */
function birdHouse() {
  const m = new Mesher();
  const R = 0.14;
  const RAFT = 0.03;
  m.box(-R, 0, -R, R, RAFT, R, COLOURS.woodDark, COLOURS.wood);
  for (const s of [-1, 0, 1]) m.box(-R, RAFT, s * 0.08 - 0.012, R, RAFT + 0.004, s * 0.08 + 0.012, COLOURS.woodDark);
  const top = RAFT + 0.12;
  m.box(-0.012, RAFT, -0.012, 0.012, top, 0.012, COLOURS.woodDark);
  const W = 0.055;
  const D = 0.05;
  const walls = 0.075;
  m.box(-W, top, -D, W, top + walls, D, COLOURS.wall);
  // Gable roof along X, overhanging.
  const eave = top + walls;
  const ridge = eave + 0.045;
  const o = 0.015;
  m.quad([-W - o, eave - 0.008, -D - o], [W + o, eave - 0.008, -D - o], [W + o, ridge, 0], [-W - o, ridge, 0], COLOURS.roof, [0, 1, -1]);
  m.quad([-W - o, eave - 0.008, D + o], [W + o, eave - 0.008, D + o], [W + o, ridge, 0], [-W - o, ridge, 0], COLOURS.roof, [0, 1, 1]);
  for (const s of [-1, 1]) m.tri([s * W, eave, -D], [s * W, eave, D], [s * W, ridge - 0.004, 0], COLOURS.wall, [s, 0, 0]);
  m.box(-0.017, top + 0.025, D, 0.017, top + 0.055, D + 0.003, COLOURS.hole);
  m.box(-0.003, top + 0.012, D, 0.003, top + 0.016, D + 0.03, COLOURS.woodDark);
  return m.build('bird-house');
}

/** A mallard drake ~0.13 long, bill towards +Z, waterline at y ≈ 0.012. */
function duck() {
  const m = new Mesher();
  // Body: rings along z (tail → breast), each an elliptical hexagon.
  const rings = [
    [-0.062, 0.006, 0.004, 0.034],
    [-0.042, 0.026, 0.02, 0.028],
    [-0.005, 0.034, 0.024, 0.024],
    [0.03, 0.03, 0.022, 0.026],
    [0.05, 0.016, 0.014, 0.03],
  ];
  const sides = 6;
  const ringPoints = rings.map(([z, rx, ry, cy]) =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 + Math.PI / 2;
      return [Math.cos(a) * rx, cy + Math.sin(a) * ry, z];
    }),
  );
  for (let r = 0; r + 1 < ringPoints.length; r += 1) {
    for (let i = 0; i < sides; i += 1) {
      const a = ringPoints[r][i];
      const b = ringPoints[r][(i + 1) % sides];
      const c = ringPoints[r + 1][(i + 1) % sides];
      const d = ringPoints[r + 1][i];
      const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - 0.024, 0];
      const hex = r === ringPoints.length - 2 ? COLOURS.duckBreast : r === 0 ? COLOURS.duckTail : COLOURS.duckBody;
      m.quad(a, b, c, d, hex, mid);
    }
  }
  const tail = [0, 0.04, -0.075];
  for (let i = 0; i < sides; i += 1) m.tri(ringPoints[0][i], ringPoints[0][(i + 1) % sides], tail, COLOURS.duckTail, [0, 0, -1]);
  const front = [0, 0.03, 0.06];
  for (let i = 0; i < sides; i += 1) m.tri(ringPoints[4][i], ringPoints[4][(i + 1) % sides], front, COLOURS.duckBreast, [0, 0, 1]);
  // Neck ring and head.
  m.prism(0, 0.042, 0.04, 0.058, 0.011, COLOURS.duckRing, 6);
  const head = [0, 0.074, 0.048];
  const hr = 0.019;
  const pts = [
    [head[0] + hr, head[1], head[2]],
    [head[0] - hr, head[1], head[2]],
    [head[0], head[1] + hr, head[2]],
    [head[0], head[1] - hr, head[2]],
    [head[0], head[1], head[2] + hr * 1.1],
    [head[0], head[1], head[2] - hr],
  ];
  for (const sx of [0, 1]) for (const sy of [2, 3]) for (const sz of [4, 5]) {
    const out = [pts[sx][0] - head[0], pts[sy][1] - head[1], pts[sz][2] - head[2]];
    m.tri(pts[sx], pts[sy], pts[sz], COLOURS.duckHead, out);
  }
  // Bill.
  const bill = [0, 0.068, 0.092];
  const b0 = [-0.008, 0.072, 0.062];
  const b1 = [0.008, 0.072, 0.062];
  const b2 = [0, 0.062, 0.062];
  m.tri(b0, b1, bill, COLOURS.duckBill, [0, 1, 0.3]);
  m.tri(b1, b2, bill, COLOURS.duckBill, [1, -1, 0.3]);
  m.tri(b2, b0, bill, COLOURS.duckBill, [-1, -1, 0.3]);
  return m.build('duck');
}

const MODELS = {
  'pond-edge-a': () => edgePiece('pond-edge-a', 1, () => 0),
  'pond-edge-b': () =>
    edgePiece('pond-edge-b', 1, () => 0, (m) => {
      m.stone(-0.06, -H + 0.05, WATER_Y - 0.002, 0.014, 0.012, 5, COLOURS.pebble, 0.3);
      m.stone(0.035, -H + 0.056, WATER_Y - 0.002, 0.011, 0.01, 5, COLOURS.pebble, 1.1);
      m.stone(0.07, -H + 0.046, WATER_Y - 0.002, 0.008, 0.008, 4, COLOURS.rock, 0.5);
    }),
  'pond-edge-c': () => edgePiece('pond-edge-c', 6, (u) => 0.03 * Math.sin(Math.PI * u) ** 2),
  'pond-outer-a': () => outerPiece('pond-outer-a'),
  'pond-outer-b': () => outerPiece('pond-outer-b', (m) => m.stone(-0.07, -0.07, BANK_TOP - 0.002, 0.028, 0.032, 6, COLOURS.rock, 0.4)),
  'pond-inner': () => innerPiece('pond-inner'),
  'lily-pads-a': () =>
    lilyPads('lily-pads-a', [
      [-0.07, -0.05, 0.055, 0.4, COLOURS.pad],
      [0.08, 0.02, 0.048, 2.2, COLOURS.padLight],
      [-0.02, 0.1, 0.04, 4.1, COLOURS.pad],
    ]),
  'lily-pads-b': () =>
    lilyPads('lily-pads-b', [
      [-0.1, -0.09, 0.045, 1.0, COLOURS.padLight],
      [0.01, -0.1, 0.038, 3.0, COLOURS.pad],
      [0.11, -0.03, 0.05, 5.1, COLOURS.pad],
      [-0.06, 0.06, 0.055, 2.6, COLOURS.pad],
      [0.07, 0.11, 0.042, 0.2, COLOURS.padLight],
    ]),
  'lily-pads-c': () =>
    lilyPads(
      'lily-pads-c',
      [
        [-0.06, -0.04, 0.058, 1.7, COLOURS.pad],
        [0.08, -0.06, 0.045, 3.6, COLOURS.padLight],
        [0.03, 0.09, 0.05, 5.5, COLOURS.pad],
      ],
      [[-0.06, -0.04]],
    ),
  'reeds-a': () => reeds('reeds-a', 9, 0, 7),
  'reeds-b': () => reeds('reeds-b', 12, 4, 19),
  'cattails-a': () => cattails('cattails-a', 4, 5, 3),
  'cattails-b': () => cattails('cattails-b', 7, 7, 11),
  'bird-house': birdHouse,
  duck,
};

const exporter = new GLTFExporter();
fs.mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(MODELS)) {
  const mesh = make();
  const scene = new THREE.Scene();
  scene.add(mesh);
  const glb = await exporter.parseAsync(scene, { binary: true });
  const file = path.join(OUT, `${name}.glb`);
  fs.writeFileSync(file, Buffer.from(glb));
  console.log(`${name.padEnd(14)} ${String(mesh.geometry.getAttribute('position').count / 3).padStart(4)} triangles  ${fs.statSync(file).size} bytes`);
}
