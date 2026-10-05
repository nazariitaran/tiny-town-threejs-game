#!/usr/bin/env node
// Times MediaPipe in the hands-free tracking worker on its own (no game rendering beside it): the real
// worker (src/gesture/tracker.worker.ts) from the dev server, fed MediaPipe's test photos as frames.
// Prints load time, first-frame time and the median per-frame inference for each model and delegate.
// Needs a dev server on PORT and the models in public/assets/mediapipe/ (node scripts/fetch-mediapipe-models.mjs).
// Run: node scripts/gesture-bench.mjs [--frames 30] [--delegates CPU,GPU] [--headed]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const frames = Number(option('frames', '30'));
const delegates = option('delegates', 'CPU,GPU').split(',');
const port = Number(process.env.PORT ?? 5188);
const ASSETS = 'https://storage.googleapis.com/mediapipe-assets';
const CASES = [
  { task: 'gesture', image: `${ASSETS}/pointing_up.jpg` },
  { task: 'face', image: `${ASSETS}/portrait.jpg` },
  { task: 'both', image: `${ASSETS}/portrait.jpg` },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: !args.includes('--headed') });
const page = await browser.newPage();
// Any same-origin document will do; the worker is the game's own, compiled by Vite.
await page.goto(`http://127.0.0.1:${port}/licenses.txt`);
const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const info = gl?.getExtension('WEBGL_debug_renderer_info');
  return gl ? String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'no WebGL2';
});
console.log(`WebGL renderer: ${renderer}`);
const imageBytes = new Map();
for (const { image } of CASES) {
  if (!imageBytes.has(image)) imageBytes.set(image, Buffer.from(await (await fetch(image)).arrayBuffer()).toString('base64'));
}

for (const delegate of delegates) {
  for (const { task, image } of CASES) {
    const result = await page.evaluate(
      async ({ delegate, task, frames, base64 }) => {
        const worker = new Worker('/src/gesture/tracker.worker.ts?worker_file&type=module', { type: 'module' });
        const next = () => new Promise((resolve) => (worker.onmessage = (event) => resolve(event.data)));
        const origin = location.origin;
        let reply = next();
        worker.postMessage({
          type: 'init',
          wasmLoaderPath: `${origin}/node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js`,
          wasmBinaryPath: `${origin}/node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm`,
          gestureModel: task === 'face' ? null : [`${origin}/assets/mediapipe/gesture_recognizer.task`],
          faceModel: task === 'gesture' ? null : [`${origin}/assets/mediapipe/face_landmarker.task`],
          delegate,
          numHands: 2,
        });
        const ready = await reply;
        if (ready.type !== 'ready') {
          worker.terminate();
          return { error: ready.message };
        }
        const blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]);
        const infer = [];
        let first = 0;
        let last = null;
        for (let i = 0; i < frames; i += 1) {
          const bitmap = await createImageBitmap(blob, { resizeWidth: 640, resizeHeight: 480 });
          reply = next();
          const started = performance.now();
          worker.postMessage({ type: 'frame', bitmap, t: i / 30 }, [bitmap]);
          last = await reply;
          if (i === 0) first = performance.now() - started;
          else if (last.type === 'result') infer.push(last.frame.inferMs);
        }
        worker.terminate();
        infer.sort((a, b) => a - b);
        const frame = last?.type === 'result' ? last.frame : null;
        return {
          delegate: ready.delegate,
          loadMs: ready.loadMs,
          firstMs: Math.round(first),
          medianMs: Number(infer[Math.floor(infer.length / 2)]?.toFixed(1)),
          p90Ms: Number(infer[Math.floor(infer.length * 0.9)]?.toFixed(1)),
          found: `${frame?.hands.length ?? 0} hand(s) ${frame?.hands.map((h) => h.gesture).join(',') ?? ''}, face ${frame?.face ? 'yes' : 'no'}`,
        };
      },
      { delegate, task, frames, base64: imageBytes.get(image) },
    );
    console.log(`${delegate.padEnd(3)} ${task.padEnd(7)} ${JSON.stringify(result)}`);
  }
}
await browser.close();
