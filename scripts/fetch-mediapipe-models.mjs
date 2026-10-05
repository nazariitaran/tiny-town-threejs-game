#!/usr/bin/env node
// Downloads the MediaPipe models the hands-free controls use into public/assets/mediapipe/ (gitignored),
// so the game serves them itself instead of fetching them from Google's model bucket at runtime.
// Run: node scripts/fetch-mediapipe-models.mjs [--force]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public/assets/mediapipe');
const base = 'https://storage.googleapis.com/mediapipe-models';
// Pinned versions (float16 / 1); Apache-2.0 per their model cards.
const MODELS = [
  { file: 'gesture_recognizer.task', url: `${base}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`, bytes: 8373440 },
  { file: 'face_landmarker.task', url: `${base}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, bytes: 3758596 },
];
const force = process.argv.includes('--force');

mkdirSync(out, { recursive: true });
for (const model of MODELS) {
  const path = join(out, model.file);
  if (!force && existsSync(path) && readFileSync(path).length === model.bytes) {
    console.log(`${model.file}: present`);
    continue;
  }
  const response = await fetch(model.url);
  if (!response.ok) throw new Error(`${model.url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length !== model.bytes) throw new Error(`${model.file}: ${data.length} bytes, expected ${model.bytes}`);
  writeFileSync(path, data);
  console.log(`${model.file}: ${(data.length / 1e6).toFixed(1)} MB, sha256 ${createHash('sha256').update(data).digest('hex').slice(0, 16)}…`);
}
