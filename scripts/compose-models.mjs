#!/usr/bin/env node
// Builds the composed GLBs in public/assets/models/composed/ from the source models in assets-src/.
// Run: node scripts/compose-models.mjs
//
//  * merge recipes copy parts of existing GLBs into one self-contained GLB (textures embedded),
//    each part under a node with its own translation / Y-rotation / scale;
//  * primitive recipes write simple flat-shaded shapes directly;
//  * Poly Pizza recipes rescale one model to game units and give it flat materials
//    (metalness 0, roughness 1), so it doesn't render dark next to the kits.
//
// Conventions (same as the Kenney city kits): Y-up, a road tile is 1 x 1, pivot at the centre of the
// footprint with the base on y = 0, front facing -Z.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'assets-src');
const OUT = path.join(root, 'public/assets/models/composed');
const kit = (pack, file) => path.join(SRC, pack, 'Models/GLB format', file);
// The Nature Kit keeps its GLBs in "GLTF format" (flat colours, no textures).
const natureKit = (file) => path.join(SRC, 'nature-kit', 'Models/GLTF format', file);
const poly = (file) => path.join(SRC, 'polypizza', file);

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

/** Many Poly Pizza exports ship metallicFactor 0.4, which renders almost black without an environment map. */
function flatMaterials(glb) {
  for (const m of glb.json.materials || []) {
    const pbr = (m.pbrMetallicRoughness ||= {});
    pbr.metallicFactor = 0;
    pbr.roughnessFactor = 1;
    delete pbr.metallicRoughnessTexture;
  }
  return glb;
}

/** sRGB hex ('#rrggbb') → linear glTF baseColorFactor. */
const linearFactor = (hex) => [0, 2, 4].map((i) => Math.pow(parseInt(hex.slice(1 + i, 3 + i), 16) / 255, 2.2)).concat(1);

/**
 * Replace the base colour of named materials (sRGB hex). A recoloured material loses its base-colour
 * texture, so it renders as one flat colour.
 */
function recolor(glb, colors) {
  for (const m of glb.json.materials || []) {
    const hex = colors[m.name];
    if (!hex) continue;
    const pbr = (m.pbrMetallicRoughness ||= {});
    pbr.baseColorFactor = linearFactor(hex);
    delete pbr.baseColorTexture;
  }
  return pruneTextures(glb);
}

/** Move every vertex of the named material that lies below `below` up to `to` (source units), e.g. a water surface. */
function liftVertices(glb, material, below, to) {
  const j = glb.json;
  const index = j.materials.findIndex((m) => m.name === material);
  const done = new Set();
  for (const mesh of j.meshes) for (const p of mesh.primitives) {
    if (p.material !== index || done.has(p.attributes.POSITION)) continue;
    done.add(p.attributes.POSITION);
    const acc = j.accessors[p.attributes.POSITION];
    const view = j.bufferViews[acc.bufferView];
    const start = (view.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = view.byteStride || 12;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < acc.count; i++) {
      const at = start + i * stride + 4;
      if (glb.bin.readFloatLE(at) < below) glb.bin.writeFloatLE(to, at);
      const y = glb.bin.readFloatLE(at);
      min = Math.min(min, y); max = Math.max(max, y);
    }
    acc.min[1] = min; acc.max[1] = max;
  }
  return glb;
}

/** Drop every primitive drawn with one of the named materials (e.g. a model's own ground slab). */
function dropMaterials(glb, names) {
  const j = glb.json;
  const drop = new Set((j.materials || []).flatMap((m, i) => (names.includes(m.name) ? [i] : [])));
  for (const mesh of j.meshes) mesh.primitives = mesh.primitives.filter((p) => !drop.has(p.material));
  const empty = new Set(j.meshes.flatMap((m, i) => (m.primitives.length ? [] : [i])));
  for (const n of j.nodes) if (n.mesh !== undefined && empty.has(n.mesh)) delete n.mesh;
  return glb;
}

/** Remove textures and images no material references any more (their bytes stay in the buffer). */
function pruneTextures(glb) {
  const j = glb.json;
  const used = new Set();
  const visit = (ti) => ti && used.add(ti.index);
  for (const m of j.materials || []) {
    visit(m.pbrMetallicRoughness?.baseColorTexture);
    visit(m.pbrMetallicRoughness?.metallicRoughnessTexture);
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) visit(m[k]);
  }
  if (!j.textures || used.size === j.textures.length) return glb;
  const texMap = new Map();
  const textures = [];
  j.textures.forEach((t, i) => { if (used.has(i)) { texMap.set(i, textures.length); textures.push(t); } });
  const remap = (ti) => (ti ? { ...ti, index: texMap.get(ti.index) } : ti);
  for (const m of j.materials || []) {
    const pbr = m.pbrMetallicRoughness;
    if (pbr?.baseColorTexture) pbr.baseColorTexture = remap(pbr.baseColorTexture);
    if (pbr?.metallicRoughnessTexture) pbr.metallicRoughnessTexture = remap(pbr.metallicRoughnessTexture);
    for (const k of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) if (m[k]) m[k] = remap(m[k]);
  }
  const imgUsed = new Set(textures.map((t) => t.source));
  const imgMap = new Map();
  const images = [];
  (j.images || []).forEach((im, i) => { if (imgUsed.has(i)) { imgMap.set(i, images.length); images.push(im); } });
  for (const t of textures) t.source = imgMap.get(t.source);
  if (textures.length) { j.textures = textures; j.images = images; } else { delete j.textures; delete j.images; delete j.samplers; }
  return glb;
}

/**
 * The Nature Kit's materials have metallicFactor 1 and sRGB colour factors stored as if linear. This zeroes
 * metalness, converts the factors to linear and remaps the kit's teal leaves to the Platformer greens.
 */
const NATURE_GREENS = { grass: '#4fae5c', leafsGreen: '#4fae5c', leafsDark: '#3d9a55' };
function natureMaterials(glb) {
  for (const m of glb.json.materials || []) {
    const pbr = (m.pbrMetallicRoughness ||= {});
    const f = pbr.baseColorFactor || [1, 1, 1, 1];
    pbr.baseColorFactor = NATURE_GREENS[m.name] ? linearFactor(NATURE_GREENS[m.name]) : [...f.slice(0, 3).map((c) => Math.pow(c, 2.2)), f[3] ?? 1];
    pbr.metallicFactor = 0;
    pbr.roughnessFactor = 1;
  }
  return glb;
}

// Flat-shaded, untextured glTF from triangle lists.
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
// Triangles are wound counter-clockwise seen from outside.
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

const GEN = 'tiny-town scripts/compose-models.mjs';
const recipes = {
  // Bus shelter: the open side faces -Z (the kerb).
  'bus-stop': () => merge([
    { file: kit('city-kit-commercial', 'detail-overhang-wide.glb'), name: 'canopy', translation: [0, 0, 0.135], rotY: 180, scale: 0.9 },
    { file: kit('holiday-kit', 'bench.glb'), name: 'bench', translation: [0, 0, 0.1], rotY: 0, scale: 0.26 },
    { file: kit('city-kit-roads', 'road-sign-street.glb'), name: 'sign', translation: [0.34, 0, -0.12], rotY: 180, scale: 0.9 },
  ], GEN),
  // Two fence panels, 1 cell long along X, lowered to 0.23 so it reads as a garden fence next to the houses.
  'fence-tall': () => merge([
    { file: kit('city-kit-suburban', 'fence.glb'), name: 'panel-a', translation: [-0.25, 0, 0], scale: [1.0526, 0.85, 1.0526] },
    { file: kit('city-kit-suburban', 'fence.glb'), name: 'panel-b', translation: [0.25, 0, 0], scale: [1.0526, 0.85, 1.0526] },
  ], GEN),
  // The native fence runs along Z on the +X cell edge; turned to run along X and re-centred on z = 0.
  'fence-small': () => merge([
    { file: kit('fantasy-town-kit', 'fence.glb'), name: 'fence', translation: [0, 0, 0.4625], rotY: 90, scale: [1, 0.37, 1] },
  ], GEN),
  // Built from primitives: no CC0 kit has a postbox in this style.
  postbox: () => {
    const red = [214, 58, 52], dark = [52, 55, 72], black = [36, 38, 50], gold = [240, 190, 70];
    // The plinth stands clear of a pavement tile (0.02 world; the catalog scales the postbox by 1.4).
    const plinth = 0.02;
    return primitiveGlb([
      { name: 'plinth', material: 'plinth', color: dark, tris: cylinder(0.052, 0, plinth, 12) },
      { name: 'body', material: 'red', color: red, tris: cylinder(0.045, plinth, 0.13, 12, { top: false }) },
      { name: 'cap-rim', material: 'red', color: red, tris: cylinder(0.05, 0.13, 0.142, 12) },
      { name: 'cap', material: 'red', color: red, tris: dome(0.047, 0.142, 0.03, 12, 3) },
      { name: 'slot', material: 'slot', color: black, tris: box(-0.022, 0.022, 0.108, 0.118, -0.0475, -0.04) },
      { name: 'plate', material: 'plate', color: gold, tris: box(-0.014, 0.014, 0.07, 0.092, -0.0465, -0.042) },
    ], GEN);
  },
  // A stretched fountain basin, since the modular pool pieces leave gaps in the water.
  // Native 4 x 3 units; the catalog scales it by 0.5 onto 4 x 3 cells. The terrace faces -Z: a paved strip
  // (0.04 native, a pavement tile's height in the game) the parasols stand on, so the model fills its whole lot.
  'swimming-pool': () => merge([
    { file: kit('fantasy-town-kit', 'fountain-square.glb'), name: 'basin', translation: [0, 0, 0.5], scale: [2, 0.4, 1] },
    { file: kit('fantasy-town-kit', 'road.glb'), name: 'terrace', translation: [0, 0, -1], scale: [4, 1.6, 1] },
    { file: kit('city-kit-commercial', 'detail-parasol-a.glb'), name: 'parasol-a', translation: [-1.1, 0.04, -1.05], scale: 1.6 },
    { file: kit('city-kit-commercial', 'detail-parasol-b.glb'), name: 'parasol-b', translation: [1.1, 0.04, -1.05], scale: 1.6 },
  ], GEN),
  // As shipped, 2 x 2 units.
  fountain: () => merge([{ file: kit('fantasy-town-kit', 'fountain-round-detail.glb'), name: 'fountain' }], GEN),
  // Poly Pizza models: scale maps source units straight to world units (the catalog uses scale 1); rotY turns
  // the front to -Z, except for the church and corner shop, whose +Z front the catalog's rotationOffset handles.
  // "Church" by Poly by Google (CC-BY 3.0): 1.75 tall, 0.78 x 1.42 base.
  church: () => flatMaterials(merge([{ file: poly('church-steeple-salmon.glb'), name: 'church', scale: 0.01265, rotY: 0 }], GEN)),
  // "Building" by Kay Lousberg (CC0): KayKit corner shop, 0.92 x 0.76 x 0.92.
  'corner-shop': () => flatMaterials(merge([{ file: poly('corner-shop-awning.glb'), name: 'shop', scale: 0.46, rotY: 0 }], GEN)),
  // "Grill" by Zsky (CC-BY 3.0): kettle barbecue, 0.20 tall.
  barbecue: () => flatMaterials(merge([{ file: poly('bbq-kettle-red.glb'), name: 'grill', scale: 0.157 }], GEN)),
  // "Swing set" by Poly by Google (CC-BY 3.0): 0.42 tall, frame turned to run along X (0.56 long).
  swing: () => flatMaterials(merge([{ file: poly('swing-set-wood.glb'), name: 'swing', scale: 0.00367, rotY: 90 }], GEN)),
  // "Donut Store" by J-Toastie (CC-BY 3.0), remodelled by hand as one flat-coloured mesh with no ground slab
  // (scripts/data/donut-shop-optimised.glb, already at game scale).
  'donut-shop': () => flatMaterials(merge([{ file: path.join(root, 'scripts/data/donut-shop-optimised.glb'), name: 'donut-shop' }], GEN)),
  // "Fountain" by Poly by Google (CC-BY 3.0): the near-black stone and olive water are recoloured to match the Kenney fountain.
  // The source's lower basin holds its water on the basin floor; it is lifted to 0.08 (0.745 source units), under the 0.12 rim.
  'tiered-fountain': () => flatMaterials(recolor(liftVertices(merge([{ file: poly('fountain-tiered.glb'), name: 'fountain', scale: 0.107 }], GEN), 'lambert5SG', 1, 0.745), {
    lambert3SG: '#d8d2cc', lambert4SG: '#b9b1ab', lambert5SG: '#6fb6dc',
  })),
  // "Slide" by sirkitree (CC-BY 3.0): runs along X like the swing frame, about as tall as the swing.
  slide: () => flatMaterials(merge([{ file: poly('slide-red.glb'), name: 'slide', scale: 2.2 }], GEN)),
  // "Mailbox" by CreativeTrio (CC0): a kerbside mailbox on a post (small palette texture kept).
  mailbox: () => flatMaterials(merge([{ file: poly('mailbox-post.glb'), name: 'mailbox', scale: 0.36 }], GEN)),
  // Three Nature Kit flowers in one 0.5-unit cell, one GLB per shape (the object's variants); ×0.7 keeps them under the bush.
  ...Object.fromEntries(['A', 'B', 'C'].map((shape, v) => [`tulips-${shape.toLowerCase()}`, () => natureMaterials(merge([
    { file: natureKit(`flower_red${shape}.glb`), name: 'red', translation: [-0.07, 0, -0.055], rotY: 20 + 40 * v, scale: 0.7 },
    { file: natureKit(`flower_yellow${shape}.glb`), name: 'yellow', translation: [0.075, 0, -0.035], rotY: 140 + 40 * v, scale: 0.7 },
    { file: natureKit(`flower_purple${shape}.glb`), name: 'purple', translation: [-0.005, 0, 0.075], rotY: 260 + 40 * v, scale: 0.7 },
  ], GEN))])),
};

const only = process.argv.slice(2);
for (const [name, build] of Object.entries(recipes)) {
  if (only.length && !only.includes(name)) continue;
  const { json, bin } = build();
  const file = path.join(OUT, `${name}.glb`);
  writeGlb(file, json, bin);
  console.log(`wrote ${path.relative(root, file)} (${fs.statSync(file).size} bytes)`);
}
