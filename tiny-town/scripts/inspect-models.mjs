#!/usr/bin/env node
// Inspect GLB/glTF models without a browser.
//
// For every model it reports: native AABB (POSITION accessor min/max pushed
// through the node hierarchy's TRS/matrix transforms), size, pivot hints,
// triangle / mesh / material counts, external image + buffer URIs (and whether
// they exist on disk relative to the model), and file size.
//
// Usage:
//   node scripts/inspect-models.mjs                      # all of public/assets/models
//   node scripts/inspect-models.mjs path/to/dir a.glb    # specific files / dirs
//   node scripts/inspect-models.mjs --json out.json      # also write JSON report
//   node scripts/inspect-models.mjs --quiet              # only print problems
//   node scripts/inspect-models.mjs --three              # also load every model with three.js
//                                                        # GLTFLoader (Node shims; textures are fetched
//                                                        # from disk and their PNG size is checked)
//
// Exit code is 1 if any model fails to parse, references a missing file, or
// (with --three) fails to load in GLTFLoader.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
let jsonOut = null;
let quiet = false;
let withThree = false;
const inputs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') jsonOut = args[++i];
  else if (args[i] === '--quiet') quiet = true;
  else if (args[i] === '--three') withThree = true;
  else inputs.push(args[i]);
}
if (inputs.length === 0) inputs.push(path.join(projectRoot, 'public/assets/models'));

function collect(p, out) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(p).sort()) collect(path.join(p, e), out);
  } else if (/\.(glb|gltf)$/i.test(p)) out.push(p);
  return out;
}

// ---------- minimal mat4 (column-major, like glTF) ----------
const I = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const apply = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`unsupported GLB version ${version}`);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

function inspect(file) {
  const buf = fs.readFileSync(file);
  const isGlb = /\.glb$/i.test(file);
  const { json, bin } = isGlb ? parseGlb(buf) : { json: JSON.parse(buf.toString('utf8')), bin: null };
  const dir = path.dirname(file);
  const problems = [];

  const images = (json.images || []).map((im) => {
    if (im.uri && !im.uri.startsWith('data:')) {
      const p = path.join(dir, decodeURIComponent(im.uri));
      const exists = fs.existsSync(p);
      if (!exists) problems.push(`missing image ${im.uri}`);
      return { uri: im.uri, exists };
    }
    return { uri: im.uri ? '(data-uri)' : `(embedded bufferView ${im.bufferView})`, exists: true };
  });
  const buffers = (json.buffers || []).map((b, i) => {
    if (b.uri && !b.uri.startsWith('data:')) {
      const p = path.join(dir, decodeURIComponent(b.uri));
      const exists = fs.existsSync(p);
      if (!exists) problems.push(`missing buffer ${b.uri}`);
      return { uri: b.uri, exists };
    }
    if (!b.uri && i === 0 && isGlb && !bin) problems.push('GLB references BIN chunk but none present');
    return { uri: b.uri ? '(data-uri)' : '(GLB BIN chunk)', exists: true };
  });

  // Bounds + triangles by walking the scene graph.
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  const meshUse = new Set();
  const visit = (ni, parent) => {
    const n = json.nodes[ni];
    const local = n.matrix ? n.matrix.slice() : trs(n.translation, n.rotation, n.scale);
    const world = mul(parent, local);
    if (n.mesh !== undefined) {
      meshUse.add(n.mesh);
      for (const prim of json.meshes[n.mesh].primitives) {
        const acc = json.accessors[prim.attributes.POSITION];
        if (acc.min && acc.max) {
          for (let c = 0; c < 8; c++) {
            const corner = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]];
            const w = apply(world, corner);
            for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); }
          }
        } else problems.push('POSITION accessor without min/max');
        const mode = prim.mode ?? 4;
        const count = prim.indices !== undefined ? json.accessors[prim.indices].count : acc.count;
        if (mode === 4) triangles += count / 3;
        else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
      }
    }
    for (const c of n.children || []) visit(c, world);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  for (const r of scene?.nodes || []) visit(r, I());

  const r3 = (v) => Math.round(v * 1000) / 1000;
  const size = { x: r3(max[0] - min[0]), y: r3(max[1] - min[1]), z: r3(max[2] - min[2]) };
  const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const eps = 0.02;
  const horiz =
    Math.abs(centre[0]) < eps * Math.max(1, size.x) && Math.abs(centre[2]) < eps * Math.max(1, size.z)
      ? 'centre'
      : Math.abs(min[0]) < eps && Math.abs(min[2]) < eps
        ? 'corner(min x,z)'
        : `offset(cx=${r3(centre[0])},cz=${r3(centre[2])})`;
  const vert = Math.abs(min[1]) < eps ? 'bottom' : `y0=${r3(min[1])}`;

  return {
    file: path.relative(projectRoot, file),
    fileBytes: buf.length,
    min: min.map(r3), max: max.map(r3), size,
    pivot: `${horiz}-${vert}`,
    triangles: Math.round(triangles),
    meshes: meshUse.size, materials: (json.materials || []).length,
    images, buffers, problems,
  };
}

const files = inputs.flatMap((p) => collect(path.resolve(p), []));
const results = [];
let failed = 0;
for (const f of files) {
  try {
    const r = inspect(f);
    results.push(r);
    if (r.problems.length) failed++;
    if (!quiet || r.problems.length) {
      const imgs = r.images.map((i) => i.uri + (i.exists ? '' : ' [MISSING]')).join(', ') || '-';
      console.log(
        `${r.problems.length ? 'FAIL' : 'ok  '} ${r.file}\n     size ${r.size.x} x ${r.size.y} x ${r.size.z}  min[${r.min}] max[${r.max}]  pivot ${r.pivot}\n` +
          `     tris ${r.triangles}  meshes ${r.meshes}  materials ${r.materials}  bytes ${r.fileBytes}  images: ${imgs}` +
          (r.problems.length ? `\n     PROBLEMS: ${r.problems.join('; ')}` : ''),
      );
    }
  } catch (e) {
    failed++;
    results.push({ file: path.relative(projectRoot, f), error: String(e.message || e) });
    console.log(`FAIL ${path.relative(projectRoot, f)}: ${e.message || e}`);
  }
}
// ---------- optional: real three.js GLTFLoader pass ----------
async function threeLoad(files) {
  // Minimal browser shims so GLTFLoader runs in Node.
  globalThis.self ??= globalThis;
  globalThis.ProgressEvent ??= class ProgressEvent extends Event { constructor(t, o = {}) { super(t); Object.assign(this, o); } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith('file:')) {
      const p = fileURLToPath(u);
      if (!fs.existsSync(p)) return new Response(null, { status: 404, statusText: 'Not Found' });
      return new Response(fs.readFileSync(p), { status: 200 });
    }
    return realFetch(url, init);
  };
  globalThis.createImageBitmap = async (blob) => {
    const b = Buffer.from(await blob.arrayBuffer());
    const isPng = b.length > 24 && b.readUInt32BE(0) === 0x89504e47;
    if (!isPng) throw new Error('image is not a PNG');
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), close() {} };
  };
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const out = new Map();
  for (const f of files) {
    try {
      const data = fs.readFileSync(f);
      const dirUrl = new URL('.', new URL('file://' + f)).href;
      const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), dirUrl);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      let meshes = 0, maps = 0;
      gltf.scene.traverse((o) => { if (o.isMesh) { meshes++; for (const m of [].concat(o.material)) if (m.map?.image?.width) maps++; } });
      const s = box.getSize(new THREE.Vector3());
      out.set(f, { ok: true, meshes, texturedMaterials: maps, size: [s.x, s.y, s.z].map((v) => Math.round(v * 1000) / 1000) });
    } catch (e) {
      out.set(f, { ok: false, error: String(e.message || e) });
    }
  }
  return out;
}
if (withThree) {
  const tl = await threeLoad(files.filter((f) => /\.glb$/i.test(f)));
  let bad = 0;
  for (const [f, r] of tl) {
    const rel = path.relative(projectRoot, f);
    const res = results.find((x) => x.file === rel);
    if (res) res.three = r;
    if (r.ok && res?.images?.length && r.texturedMaterials === 0) { r.ok = false; r.error = 'GLB references images but no texture loaded'; }
    if (!r.ok) { bad++; console.log(`FAIL three.js GLTFLoader ${rel}: ${r.error}`); }
    else if (!quiet) console.log(`ok   three.js GLTFLoader ${rel}: ${r.meshes} mesh(es), ${r.texturedMaterials} textured material(s), size ${r.size.join(' x ')}`);
  }
  console.log(`three.js GLTFLoader: ${tl.size - bad}/${tl.size} loaded`);
  failed += bad;
}

const total = results.reduce((s, r) => s + (r.fileBytes || 0), 0);
console.log(`\n${results.length} model(s), ${failed} with problems, ${(total / 1024).toFixed(1)} KiB of model files`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
