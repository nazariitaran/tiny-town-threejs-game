#!/usr/bin/env node
// Builds the few "composed" GLBs the game needs that no kit ships as a single
// model. Output goes to public/assets/models/composed/. Re-run after changing
// a recipe:  node scripts/compose-models.mjs
//
//  * merge recipes: copy nodes/meshes/materials from existing Kenney GLBs
//    (source files under assets-src/, CC0) into one GLB, each part wrapped in
//    a node with its own translation / Y-rotation / scale. External textures
//    are embedded, so every composed GLB is self-contained.
//  * primitive recipes: simple flat-shaded low-poly shapes written directly
//    (used for the postbox, which no CC0 kit in this style provides).
//
// Conventions for everything written here (same as the Kenney city kits):
// Y-up, metres-agnostic "city units" where a road tile is 1 x 1, pivot at the
// centre of the footprint with the base on y = 0, front facing -Z.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'assets-src');
const OUT = path.join(root, 'public/assets/models/composed');
const kit = (pack, file) => path.join(SRC, pack, 'Models/GLB format', file);

// ---------------------------------------------------------------- GLB I/O
function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  let off = 12, json, bin = Buffer.alloc(0);
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = Buffer.from(data);
    off += 8 + len;
  }
  return { json, bin, dir: path.dirname(file) };
}
const pad4 = (n) => (n + 3) & ~3;
function writeGlb(file, json, bin) {
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)]);
  const binBuf = Buffer.concat([bin, Buffer.alloc(pad4(bin.length) - bin.length)]);
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const h = Buffer.alloc(12);
  h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, jh, jsonBuf, bh, binBuf]));
}

// ---------------------------------------------------------------- merge
function merge(parts, generator) {
  const out = {
    asset: { version: '2.0', generator },
    scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [],
    textures: [], images: [], samplers: [], accessors: [], bufferViews: [], buffers: [],
  };
  const chunks = []; let binLen = 0;
  const addBin = (data) => {
    const offset = binLen; chunks.push(data); binLen += data.length;
    const padLen = pad4(binLen) - binLen; if (padLen) { chunks.push(Buffer.alloc(padLen)); binLen += padLen; }
    return offset;
  };
  const imageCache = new Map(); // abs path -> image index (dedupe shared colormaps)
  const extUsed = new Set();
  const rootNode = { name: 'root', children: [] };
  out.nodes.push(rootNode);
  out.scenes[0].nodes.push(0);

  for (const part of parts) {
    const g = readGlb(part.file);
    const j = g.json;
    (j.extensionsUsed || []).forEach((e) => extUsed.add(e));
    const bvBase = out.bufferViews.length;
    for (const bv of j.bufferViews || []) {
      const data = g.bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
      const nb = { ...bv, buffer: 0, byteOffset: addBin(data) };
      out.bufferViews.push(nb);
    }
    const accBase = out.accessors.length;
    for (const a of j.accessors || []) out.accessors.push({ ...a, bufferView: a.bufferView === undefined ? undefined : a.bufferView + bvBase });
    const imgMap = [];
    for (const im of j.images || []) {
      if (im.uri && !im.uri.startsWith('data:')) {
        const abs = path.join(g.dir, decodeURIComponent(im.uri));
        if (!imageCache.has(abs)) {
          const bvIndex = out.bufferViews.length;
          const data = fs.readFileSync(abs);
          out.bufferViews.push({ buffer: 0, byteOffset: addBin(data), byteLength: data.length });
          out.images.push({ name: `${path.basename(path.dirname(path.dirname(path.dirname(abs))))}-${path.basename(abs, '.png')}`, mimeType: 'image/png', bufferView: bvIndex });
          imageCache.set(abs, out.images.length - 1);
        }
        imgMap.push(imageCache.get(abs));
      } else {
        out.images.push({ ...im, bufferView: im.bufferView + bvBase });
        imgMap.push(out.images.length - 1);
      }
    }
    const smpBase = out.samplers.length;
    for (const s of j.samplers || []) out.samplers.push({ ...s });
    const texBase = out.textures.length;
    for (const t of j.textures || []) out.textures.push({ ...t, source: imgMap[t.source], sampler: t.sampler === undefined ? undefined : t.sampler + smpBase });
    const remapTex = (ti) => (ti ? { ...ti, index: ti.index + texBase } : ti);
    const matBase = out.materials.length;
    for (const m of j.materials || []) {
      const nm = JSON.parse(JSON.stringify(m));
      if (nm.pbrMetallicRoughness) {
        nm.pbrMetallicRoughness.baseColorTexture = remapTex(nm.pbrMetallicRoughness.baseColorTexture);
        nm.pbrMetallicRoughness.metallicRoughnessTexture = remapTex(nm.pbrMetallicRoughness.metallicRoughnessTexture);
      }
      for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) nm[k] = remapTex(nm[k]);
      out.materials.push(nm);
    }
    const meshBase = out.meshes.length;
    for (const m of j.meshes || []) {
      out.meshes.push({
        ...m,
        primitives: m.primitives.map((p) => ({
          ...p,
          attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, v + accBase])),
          indices: p.indices === undefined ? undefined : p.indices + accBase,
          material: p.material === undefined ? undefined : p.material + matBase,
        })),
      });
    }
    const nodeBase = out.nodes.length + 1; // +1 for the wrapper node
    const deg = part.rotY || 0, r = (deg * Math.PI) / 360;
    const wrapper = {
      name: part.name || path.basename(part.file, '.glb'),
      translation: part.translation || [0, 0, 0],
      rotation: [0, Math.sin(r), 0, Math.cos(r)],
      scale: part.scale ? (Array.isArray(part.scale) ? part.scale : [part.scale, part.scale, part.scale]) : [1, 1, 1],
      children: [],
    };
    out.nodes.push(wrapper);
    rootNode.children.push(out.nodes.length - 1);
    for (const n of j.nodes || []) {
      out.nodes.push({ ...n, mesh: n.mesh === undefined ? undefined : n.mesh + meshBase, children: n.children ? n.children.map((c) => c + nodeBase) : undefined });
    }
    const sc = j.scenes[j.scene ?? 0];
    for (const rn of sc.nodes) wrapper.children.push(rn + nodeBase);
  }
  out.buffers.push({ byteLength: binLen });
  if (extUsed.size) out.extensionsUsed = [...extUsed];
  for (const k of ['textures', 'images', 'samplers', 'materials']) if (!out[k].length) delete out[k];
  return { json: JSON.parse(JSON.stringify(out)), bin: Buffer.concat(chunks) };
}

// ---------------------------------------------------------------- primitives
// Minimal flat-shaded mesh builder -> glTF (no textures, one material per part).
function primitiveGlb(shapes, generator) {
  const json = { asset: { version: '2.0', generator }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'root', children: [] }], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = []; let binLen = 0;
  const add = (typed, target) => {
    const data = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const off = binLen; chunks.push(data); binLen += data.length;
    const p = pad4(binLen) - binLen; if (p) { chunks.push(Buffer.alloc(p)); binLen += p; }
    json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: data.length, target });
    return json.bufferViews.length - 1;
  };
  const matIndex = new Map();
  for (const s of shapes) {
    const key = s.color.join(',');
    if (!matIndex.has(key)) {
      json.materials.push({ name: s.material || `mat${json.materials.length}`, pbrMetallicRoughness: { baseColorFactor: [...s.color.map((c) => Math.pow(c / 255, 2.2)), 1], metallicFactor: 0, roughnessFactor: 0.8 } });
      matIndex.set(key, json.materials.length - 1);
    }
    // un-indexed flat triangles
    const pos = [], nor = [];
    for (const [a, b, c] of s.tris) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n) || 1; n = n.map((x) => x / l);
      pos.push(...a, ...b, ...c); nor.push(...n, ...n, ...n);
    }
    const P = new Float32Array(pos), N = new Float32Array(nor);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i + k]); max[k] = Math.max(max[k], P[i + k]); }
    json.accessors.push({ bufferView: add(P, 34962), componentType: 5126, count: P.length / 3, type: 'VEC3', min, max });
    json.accessors.push({ bufferView: add(N, 34962), componentType: 5126, count: N.length / 3, type: 'VEC3' });
    json.meshes.push({ name: s.name, primitives: [{ attributes: { POSITION: json.accessors.length - 2, NORMAL: json.accessors.length - 1 }, material: matIndex.get(key) }] });
    json.nodes.push({ name: s.name, mesh: json.meshes.length - 1 });
    json.nodes[0].children.push(json.nodes.length - 1);
  }
  json.buffers.push({ byteLength: binLen });
  return { json, bin: Buffer.concat(chunks) };
}
// Shape helpers (triangles wound counter-clockwise seen from outside).
function cylinder(r, y0, y1, seg, { cz = 0, cx = 0, top = true, bottom = true } = {}) {
  const t = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (a, y) => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
    t.push([p(a0, y0), p(a1, y0), p(a1, y1)], [p(a0, y0), p(a1, y1), p(a0, y1)]);
    if (top) t.push([[cx, y1, cz], p(a0, y1), p(a1, y1)]);
    if (bottom) t.push([[cx, y0, cz], p(a1, y0), p(a0, y0)]);
  }
  return t;
}
function dome(r, y0, h, seg, rings) {
  const t = [];
  const pt = (a, k) => { const phi = (k / rings) * (Math.PI / 2); return [Math.sin(a) * r * Math.cos(phi), y0 + Math.sin(phi) * h, Math.cos(a) * r * Math.cos(phi)]; };
  for (let k = 0; k < rings; k++) for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    if (k === rings - 1) t.push([pt(a0, k), pt(a1, k), [0, y0 + h, 0]]);
    else t.push([pt(a0, k), pt(a1, k), pt(a1, k + 1)], [pt(a0, k), pt(a1, k + 1), pt(a0, k + 1)]);
  }
  return t;
}
function box(x0, x1, y0, y1, z0, z1) {
  const v = (x, y, z) => [x, y, z];
  const q = (a, b, c, d) => [[a, b, c], [a, c, d]];
  return [
    ...q(v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)), // +z
    ...q(v(x1, y0, z0), v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0)), // -z
    ...q(v(x1, y0, z1), v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1)), // +x
    ...q(v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0)), // -x
    ...q(v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0), v(x0, y1, z0)), // +y
    ...q(v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)), // -y
  ];
}

// ---------------------------------------------------------------- recipes
const GEN = 'tiny-town scripts/compose-models.mjs';
const recipes = {
  // Bus shelter: Kenney commercial canopy + holiday-kit park bench + roads-kit
  // street-sign pole. Open side / bench faces -Z (the kerb), like the city kits.
  'bus-stop': () => merge([
    { file: kit('city-kit-commercial', 'detail-overhang-wide.glb'), name: 'canopy', translation: [0, 0, 0.135], rotY: 180, scale: 0.9 },
    { file: kit('holiday-kit', 'bench.glb'), name: 'bench', translation: [0, 0, 0.1], rotY: 0, scale: 0.26 },
    { file: kit('city-kit-roads', 'road-sign-street.glb'), name: 'sign', translation: [0.34, 0, -0.12], rotY: 180, scale: 0.9 },
  ], GEN),
  // Tall fence edge piece: two suburban-kit fence panels -> 1 cell long along X, centred,
  // slightly lowered (0.23 tall) so it reads as a garden privacy fence next to 0.75-scaled houses.
  'fence-tall': () => merge([
    { file: kit('city-kit-suburban', 'fence.glb'), name: 'panel-a', translation: [-0.25, 0, 0], scale: [1.0526, 0.85, 1.0526] },
    { file: kit('city-kit-suburban', 'fence.glb'), name: 'panel-b', translation: [0.25, 0, 0], scale: [1.0526, 0.85, 1.0526] },
  ], GEN),
  // Small fence edge piece: fantasy-town fence (native: runs along Z on the +X cell edge),
  // rotated to run along X, re-centred on z = 0 and squashed to garden-fence height.
  'fence-small': () => merge([
    { file: kit('fantasy-town-kit', 'fence.glb'), name: 'fence', translation: [0, 0, 0.4625], rotY: 90, scale: [1, 0.37, 1] },
  ], GEN),
  'fence-small-gate': () => merge([
    { file: kit('fantasy-town-kit', 'fence-gate.glb'), name: 'gate', translation: [0, 0, 0.4625], rotY: 90, scale: [1, 0.37, 1] },
  ], GEN),
  // Garage: industrial-kit building-j re-centred (native pivot is off-centre); native scale kept.
  garage: () => merge([
    { file: kit('city-kit-industrial', 'building-j.glb'), name: 'garage', translation: [0.4353, 0, -0.274] },
  ], GEN),
  // Postbox: red pillar box built from primitives (no CC0 match in the Kenney style).
  postbox: () => {
    const red = [214, 58, 52], dark = [52, 55, 72], black = [36, 38, 50], gold = [240, 190, 70];
    return primitiveGlb([
      { name: 'plinth', material: 'plinth', color: dark, tris: cylinder(0.052, 0, 0.012, 12) },
      { name: 'body', material: 'red', color: red, tris: cylinder(0.045, 0.012, 0.13, 12, { top: false }) },
      { name: 'cap-rim', material: 'red', color: red, tris: cylinder(0.05, 0.13, 0.142, 12) },
      { name: 'cap', material: 'red', color: red, tris: dome(0.047, 0.142, 0.03, 12, 3) },
      { name: 'slot', material: 'slot', color: black, tris: box(-0.022, 0.022, 0.108, 0.118, -0.0475, -0.04) },
      { name: 'plate', material: 'plate', color: gold, tris: box(-0.014, 0.014, 0.07, 0.092, -0.0465, -0.042) },
    ], GEN);
  },
};

const only = process.argv.slice(2);
for (const [name, build] of Object.entries(recipes)) {
  if (only.length && !only.includes(name)) continue;
  const { json, bin } = build();
  const file = path.join(OUT, `${name}.glb`);
  writeGlb(file, json, bin);
  console.log(`wrote ${path.relative(root, file)} (${fs.statSync(file).size} bytes)`);
}
