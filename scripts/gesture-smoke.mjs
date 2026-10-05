#!/usr/bin/env node
// End-to-end smoke test of the hands-free controls with real MediaPipe tracking and no person: Chromium's
// fake camera plays a video composed from MediaPipe's own test photos (Apache-2.0, downloaded, never
// committed). A first pass measures where each pose's pinch point lands; the second plays a journey,
// checking the game after each step through __THREE_GAME_DIAGNOSTICS__:
//   pinch the Road card → pinch-drag a road on the map → ✌ rotates → 👎 is Esc → a fist drags the map.
// Then head mode: a face sliding across the frame keeps the pointer near the centre (the pointer follows
// the nose inside the face, not the face in the frame), and a held smile rotates.
// Needs a dev server on PORT and ffmpeg. Writes videos, screenshots and report.json to --out.
// Run: node scripts/gesture-smoke.mjs [--out artifacts/gesture-smoke] [--graphics low] [--headed]
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = resolve(option('out', 'artifacts/gesture-smoke'));
const graphics = option('graphics', 'low');
const port = Number(process.env.PORT ?? 5188);
const executablePath = process.env.CHROMIUM_PATH || undefined;
const VIEW = { width: 960, height: 540 };
const FRAME = { width: 640, height: 480 };
const HAND_HEIGHT = 260;
const BACKGROUND = '0xd8d4cc';
/** Seconds of empty frame first: the camera opens and the model loads. */
const LEAD_IN = 12;
/** DEFAULT_HAND_TUNING.region in src/gesture/handInterpreter.ts. */
const REGION = { left: 0.18, right: 0.82, top: 0.12, bottom: 0.72 };

const imageDir = join(out, 'img');
mkdirSync(imageDir, { recursive: true });

// --- Poses ----------------------------------------------------------------------------------------
const ASSETS = 'https://storage.googleapis.com/mediapipe-assets';
for (const file of ['pointing_up.jpg', 'victory.jpg', 'fist.jpg', 'thumb_up.jpg', 'man-woman-okay.jpg', 'portrait.jpg']) {
  const path = join(imageDir, file);
  if (existsSync(path)) continue;
  const response = await fetch(`${ASSETS}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}
const ffmpeg = (...a) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...a]);
const pose = (name, source, filter) => {
  const path = join(imageDir, `${name}.png`);
  ffmpeg('-i', join(imageDir, source), '-vf', `${filter ? `${filter},` : ''}scale=-2:${HAND_HEIGHT}`, path);
  return path;
};
const POSES = {
  point: pose('point', 'pointing_up.jpg'),
  // The man's left hand making an OK sign: thumb and index tips touching, a pinch.
  pinch: pose('pinch', 'man-woman-okay.jpg', 'crop=110:200:222:40'),
  victory: pose('victory', 'victory.jpg'),
  fist: pose('fist', 'fist.jpg'),
  thumbDown: pose('thumb-down', 'thumb_up.jpg', 'hflip,vflip'),
};
// A smiling face, big enough for the short-range face detector.
const FACE = join(imageDir, 'face.png');
ffmpeg('-i', join(imageDir, 'portrait.jpg'), '-vf', 'crop=560:560:130:0,scale=-2:400', FACE);
const size = (path) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], { encoding: 'utf8' }).trim().split(',').map(Number);

// --- Video ----------------------------------------------------------------------------------------
/** A segment: `pose` (or null: empty) with its top-left moving from `from` to `to` (frame px) over `seconds`. */
function buildVideo(name, segments) {
  const parts = [];
  segments.forEach((segment, i) => {
    const part = join(out, `${name}-${i}.mjpeg`);
    const d = segment.seconds;
    const colour = `color=c=${BACKGROUND}:s=${FRAME.width}x${FRAME.height}:r=30:d=${d}`;
    if (!segment.pose) {
      ffmpeg('-f', 'lavfi', '-i', colour, '-f', 'mjpeg', '-q:v', '4', part);
    } else {
      const [x0, y0] = segment.from;
      const [x1, y1] = segment.to ?? segment.from;
      const x = `${x0.toFixed(1)}+(${(x1 - x0).toFixed(1)})*t/${d}`;
      const y = `${y0.toFixed(1)}+(${(y1 - y0).toFixed(1)})*t/${d}`;
      ffmpeg('-f', 'lavfi', '-i', colour, '-loop', '1', '-i', segment.pose, '-filter_complex', `[0][1]overlay=x='${x}':y='${y}':shortest=1`, '-f', 'mjpeg', '-q:v', '4', part);
    }
    parts.push(part);
  });
  const video = join(out, `${name}.mjpeg`);
  writeFileSync(video, Buffer.concat(parts.map((p) => readFileSync(p))));
  return video;
}

/** Where a pose's top-left must be for its pinch point (offset within the image) to put the cursor at screen (sx, sy). */
function placeFor(offset, sx, sy) {
  const u = 1 - (REGION.left + (sx / VIEW.width) * (REGION.right - REGION.left));
  const v = REGION.top + (sy / VIEW.height) * (REGION.bottom - REGION.top);
  return [u * FRAME.width - offset[0], v * FRAME.height - offset[1]];
}

// --- Browser --------------------------------------------------------------------------------------
async function open(video, mode = '') {
  const browser = await chromium.launch({
    executablePath,
    headless: !args.includes('--headed'),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`, '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: VIEW });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/?graphics=${graphics}&gestures${mode ? `=${mode}` : ''}`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__ && document.querySelector('#hf-start'));
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('empty-build'));
  await page.click('#hf-start');
  await page.waitForFunction(() => ['tracking', 'error'].includes(document.querySelector('#hf-root').dataset.status), null, { timeout: 120_000 });
  const status = await page.evaluate(() => document.querySelector('#hf-root').dataset.status);
  if (status !== 'tracking') throw new Error(`tracking did not start: ${await page.textContent('#hf-status')}`);
  return { browser, page, errors };
}

/** Waits until the fake camera has played `seconds` of the video. */
const videoAt = (page, seconds) =>
  page.waitForFunction((s) => document.querySelector('.hf-video').currentTime >= s, seconds, { timeout: 180_000, polling: 100 });
const panel = (page) => page.evaluate(() => ({ ...document.querySelector('#hf-root').dataset }));
const game = (page) =>
  page.evaluate(() => {
    const d = window.__THREE_GAME_DIAGNOSTICS__;
    return { tool: d.tool, rotation: d.rotation, roadTiles: d.town.roadTiles, hover: d.hover, camera: d.camera };
  });

// --- Pass 1: where does each pose's pinch point land? ---------------------------------------------
const centred = (path) => {
  const [w, h] = size(path);
  return [(FRAME.width - w) / 2, (FRAME.height - h) / 2];
};
const CALIBRATE = ['point', 'pinch'];
const calibrationVideo = buildVideo('calibrate', [
  { pose: null, seconds: LEAD_IN },
  ...CALIBRATE.map((name) => ({ pose: POSES[name], from: centred(POSES[name]), seconds: 5 })),
]);
const offsets = {};
const layout = {};
{
  const { browser, page } = await open(calibrationVideo);
  layout.road = await page.evaluate(() => {
    const r = document.querySelector('[data-tool="road"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const cell = (x, z) => page.evaluate(([cx, cz]) => window.__THREE_GAME_TEST_HOOKS__.cellToClient(cx, cz), [x, z]);
  layout.a = await cell(30, 24);
  layout.b = await cell(46, 24);
  let t = LEAD_IN;
  for (const name of CALIBRATE) {
    t += 5;
    await videoAt(page, t - 0.3);
    const { x, y, present } = await panel(page);
    if (present !== 'true') throw new Error(`calibration: no hand found for ${name}`);
    const u = 1 - (REGION.left + (Number(x) / VIEW.width) * (REGION.right - REGION.left));
    const v = REGION.top + (Number(y) / VIEW.height) * (REGION.bottom - REGION.top);
    const [left, top] = centred(POSES[name]);
    offsets[name] = [u * FRAME.width - left, v * FRAME.height - top];
  }
  await browser.close();
}
console.log('pinch-point offsets (px in the pose image):', JSON.stringify(offsets));
console.log('targets (CSS px):', JSON.stringify(layout));

// --- Pass 2: the journey --------------------------------------------------------------------------
const at = (name, target) => placeFor(offsets[name] ?? offsets.point, target.x, target.y);
const fistFrom = [FRAME.width / 2 + 40, FRAME.height / 2 - HAND_HEIGHT / 2];
const STEPS = [
  { name: 'lead-in', pose: null, seconds: LEAD_IN },
  { name: 'hover Road card', pose: 'point', at: layout.road, seconds: 3.5 },
  { name: 'pinch on Road card', pose: 'pinch', at: layout.road, seconds: 2.5 },
  { name: 'release on Road card', pose: 'point', at: layout.road, seconds: 3, check: (g) => g.tool === 'road' },
  { name: 'move to the map', pose: 'point', at: layout.road, to: layout.a, seconds: 3 },
  { name: 'hover A', pose: 'point', at: layout.a, seconds: 2.5 },
  { name: 'pinch at A', pose: 'pinch', at: layout.a, seconds: 2.5, check: (g) => g.roadTiles >= 1 },
  { name: 'drag A → B', pose: 'pinch', at: layout.a, to: layout.b, seconds: 5 },
  { name: 'hold at B', pose: 'pinch', at: layout.b, seconds: 1.5 },
  { name: 'release at B', pose: 'point', at: layout.b, seconds: 3, check: (g, first) => g.roadTiles >= 6 && g.roadTiles > first.roadTiles },
  { name: '✌ rotates', pose: 'victory', at: layout.b, seconds: 3.5, check: (g) => g.rotation !== 0 },
  { name: '👎 is Esc', pose: 'thumbDown', at: layout.b, seconds: 3.5, check: (g) => g.tool === null },
  { name: 'fist drags the map', pose: 'fist', from: fistFrom, toFrame: [fistFrom[0] - 140, fistFrom[1]], seconds: 5, check: (g, first) => Math.hypot(g.camera.targetX - first.camera.targetX, g.camera.targetZ - first.camera.targetZ) > 0.5 },
  { name: 'hand gone', pose: null, seconds: 3 },
];
const journeyVideo = buildVideo(
  'journey',
  STEPS.map((step) =>
    !step.pose
      ? { pose: null, seconds: step.seconds }
      : step.from
      ? { pose: POSES[step.pose], from: step.from, to: step.toFrame, seconds: step.seconds }
      : { pose: POSES[step.pose], from: at(step.pose, step.at), to: step.to ? at(step.pose, step.to) : undefined, seconds: step.seconds },
  ),
);

const { browser, page, errors } = await open(journeyVideo);
const first = await game(page);
const results = [];
let t = 0;
for (const [i, step] of STEPS.entries()) {
  t += step.seconds;
  await videoAt(page, t - 0.2);
  const state = await game(page);
  const hands = await panel(page);
  const ok = step.check ? step.check(state, first) : null;
  results.push({ step: step.name, ok, tool: state.tool, rotation: state.rotation, roadTiles: state.roadTiles, cursor: [Number(hands.x), Number(hands.y)], label: hands.label, pressed: hands.pressed, grab: hands.grab });
  console.log(`${ok === null ? '·' : ok ? '✓' : '✗'} ${step.name.padEnd(24)} tool=${state.tool} rot=${state.rotation} roads=${state.roadTiles} cursor=${hands.x},${hands.y} ${hands.label}`);
  if (step.check || i === 1) await page.screenshot({ path: join(out, `step-${String(i).padStart(2, '0')}.png`) });
}
const stats = await panel(page);
await browser.close();

// --- Pass 3: head mode ----------------------------------------------------------------------------
const [faceWidth] = size(FACE);
const faceLeft = (FRAME.width - faceWidth) / 2;
const HEAD_STEPS = [
  { name: 'lead-in', seconds: LEAD_IN, video: { pose: null, seconds: LEAD_IN } },
  { name: 'face centred (calibrates)', seconds: 3, video: { pose: FACE, from: [faceLeft, 40], seconds: 3 } },
  { name: 'face slides 140 px', seconds: 5, video: { pose: FACE, from: [faceLeft, 40], to: [faceLeft - 140, 40], seconds: 5 } },
];
const headVideo = buildVideo('head', HEAD_STEPS.map((step) => step.video));
const head = await open(headVideo, 'head');
const headStart = await game(head.page);
const headResults = [];
let headT = 0;
const centre = { x: VIEW.width / 2, y: VIEW.height / 2 };
for (const step of HEAD_STEPS) {
  headT += step.seconds;
  // Sample through the step: how far does the pointer stray from the centre?
  let worst = 0;
  let present = false;
  while ((await head.page.evaluate(() => document.querySelector('.hf-video').currentTime)) < headT - 0.2) {
    const p = await panel(head.page);
    if (p.present === 'true' && step.name !== 'lead-in') {
      present = true;
      worst = Math.max(worst, Math.hypot(Number(p.x) - centre.x, Number(p.y) - centre.y));
    }
    await head.page.waitForTimeout(150);
  }
  const state = await game(head.page);
  const p = await panel(head.page);
  const strayPct = (worst / VIEW.width) * 100;
  const ok = step.name === 'lead-in' ? null : present && strayPct < 10;
  headResults.push({ step: step.name, ok, present, worstStrayPx: Math.round(worst), strayPctOfWidth: Number(strayPct.toFixed(1)), rotation: state.rotation, label: p.label });
  console.log(`${ok === null ? '·' : ok ? '✓' : '✗'} head: ${step.name.padEnd(26)} found=${present} worst stray=${Math.round(worst)} px (${strayPct.toFixed(1)} % of width) rot=${state.rotation} ${p.label}`);
}
const smileOk = (await game(head.page)).rotation !== headStart.rotation;
headResults.push({ step: 'held smile rotates', ok: smileOk });
console.log(`${smileOk ? '✓' : '✗'} head: held smile rotates`);
await head.page.screenshot({ path: join(out, 'head.png') });
const headStats = await panel(head.page);
await head.browser.close();

const report = {
  date: new Date().toISOString(),
  graphics,
  viewport: VIEW,
  offsets,
  layout,
  steps: results,
  tracking: { delegate: stats.delegate, loadMs: Number(stats.loadMs), inferMs: Number(stats.inferMs), fps: Number(stats.fps), frames: Number(stats.frames), dropped: Number(stats.dropped), models: stats.models },
  counts: { domClicks: Number(stats.domClicks), canvasPresses: Number(stats.canvasPresses), commands: Number(stats.commands) },
  head: { steps: headResults, tracking: { delegate: headStats.delegate, loadMs: Number(headStats.loadMs), inferMs: Number(headStats.inferMs), fps: Number(headStats.fps) } },
  pageErrors: [...errors, ...head.errors],
};
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
const failed = [...results, ...headResults].filter((r) => r.ok === false);
console.log(`tracking (hands): ${stats.delegate}, ${stats.inferMs} ms a frame, ${stats.fps} results/s · (head): ${headStats.inferMs} ms, ${headStats.fps} results/s · page errors: ${report.pageErrors.length}`);
console.log(failed.length ? `FAILED: ${failed.map((r) => r.step).join(', ')}` : 'all checks passed');
process.exit(failed.length || report.pageErrors.length ? 1 : 0);
