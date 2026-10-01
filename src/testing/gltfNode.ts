/**
 * Test-only (Vitest, Node): loads the real GLBs under public/ through three's GLTFLoader, with the
 * browser shims it needs for external textures: `self`, `fetch` for file: URLs and a
 * `createImageBitmap` that only reads a PNG's size.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const PUBLIC_DIR = path.resolve(__dirname, '../../public');

/** Absolute path of a public asset URL such as `/assets/models/x.glb`. */
export const publicPath = (url: string): string => path.join(PUBLIC_DIR, url.replace(/^\//, ''));

let shimmed = false;

function installShims(): void {
  if (shimmed) return;
  shimmed = true;
  (globalThis as { self?: unknown }).self ??= globalThis;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith('file:')) return realFetch(url, init);
    const file = new URL(u).pathname;
    return fs.existsSync(file) ? new Response(fs.readFileSync(file)) : new Response(null, { status: 404 });
  }) as typeof fetch;
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async (blob: Blob) => {
    const bytes = Buffer.from(await blob.arrayBuffer());
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), close() {} };
  };
}

/** A loader for public asset URLs (`/assets/...`), in native model space. */
export async function createGlbLoader(): Promise<(url: string) => Promise<GLTF>> {
  installShims();
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  return (url) => {
    const file = publicPath(url);
    const data = fs.readFileSync(file);
    return loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), `file://${path.dirname(file)}/`);
  };
}
