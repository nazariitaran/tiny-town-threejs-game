#!/usr/bin/env node
// End-to-end smoke test of the hands-free controls with real MediaPipe tracking and no person: Chromium's
// fake camera plays a video composed from MediaPipe's own test photos (Apache-2.0, downloaded, never
// committed). A first pass measures where each pose's pinch point lands; the second plays a journey,
// checking the game after each step through __THREE_GAME_DIAGNOSTICS__:
//   pinch the Road card → pinch-drag a road on the map → ✌ rotates → 👎 is Esc → a fist drags the map.
// Then head mode: a face sliding across the frame keeps the pointer near the centre (the pointer follows
// the nose inside the face, not the face in the frame), and a held smile rotates (Classic bindings).
// Then blinks and winks (Low effort bindings) on the same portrait with its eyelids painted shut: the eye
// test, a slow blink clicks, wink left drags, wink right is Esc, a long blink pauses and resumes.
// Then the pointer sources: the portrait warped in perspective (one side nearer, as a turned or tilted
// head) moves the pointer the same way with the nose and with the head angle; and the Fit wizard
// completes on the warped portraits (nose source).
// Then Palms: a fist points with its palm while another hand clicks by moving up: dwell picks Road, a lift
// places a block, a held lift drags a road, the pointer stays put while the other hand lifts, and a dwell
// on the camera pad turns the camera.
// Needs a dev server on PORT and ffmpeg. Writes videos, screenshots and report.json to --out.
// Run: node scripts/gesture-smoke.mjs [--out artifacts/gesture-smoke] [--graphics low] [--headed] [--only hands|head|eyes|pointer|palms]
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
const pose = (name, source, filter, height = HAND_HEIGHT) => {
  const path = join(imageDir, `${name}.png`);
  ffmpeg('-i', join(imageDir, source), '-vf', `${filter ? `${filter},` : ''}scale=-2:${height}`, path);
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
/**
 * A segment: `pose` (or null: empty) with its top-left moving from `from` to `to` (frame px) over `seconds`;
 * or `layers`, several such poses at once (later ones drawn over earlier ones).
 */
function buildVideo(name, segments) {
  const parts = [];
  segments.forEach((segment, i) => {
    const part = join(out, `${name}-${i}.mjpeg`);
    const d = segment.seconds;
    const colour = `color=c=${BACKGROUND}:s=${FRAME.width}x${FRAME.height}:r=30:d=${d}`;
    const layers = segment.layers ?? (segment.pose ? [segment] : []);
    if (layers.length === 0) {
      ffmpeg('-f', 'lavfi', '-i', colour, '-f', 'mjpeg', '-q:v', '4', part);
    } else {
      const inputs = layers.flatMap((layer) => ['-loop', '1', '-i', layer.pose]);
      const chain = layers.map((layer, j) => {
        const [x0, y0] = layer.from;
        const [x1, y1] = layer.to ?? layer.from;
        const x = `${x0.toFixed(1)}+(${(x1 - x0).toFixed(1)})*t/${d}`;
        const y = `${y0.toFixed(1)}+(${(y1 - y0).toFixed(1)})*t/${d}`;
        return `[${j === 0 ? '0' : `v${j}`}][${j + 1}]overlay=x='${x}':y='${y}':shortest=1${j === layers.length - 1 ? '' : `[v${j + 1}]`}`;
      });
      ffmpeg('-f', 'lavfi', '-i', colour, ...inputs, '-filter_complex', chain.join(';'), '-f', 'mjpeg', '-q:v', '4', part);
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
async function open(video, mode = '', before = null) {
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
  if (before) await before(page);
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

async function handPasses() {
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
  return { results, stats, offsets, layout, errors };
}

async function headPass() {
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
  // Classic bindings: a held smile rotates.
  await head.page.click('#hf-preset-classic');
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
  return { results: headResults, stats: headStats, errors: head.errors };
}

// --- Pass 4: blinks and winks ---------------------------------------------------------------------
// MediaPipe's test photos have no closed eyes, so the eyelids are painted over (a skin-coloured patch and
// a lash line) on the portrait, with its smile covered too. Crude, but the Face Landmarker reads them as
// shut. The eye test runs first (its levels and the wink checks), then Low effort's bindings are played.
async function eyePass() {
  const crop = 'crop=300:300:250:30,scale=600:600';
  const lid = (x) => `drawbox=x=${x}:y=266:w=100:h=42:color=0xc88569:t=fill,drawbox=x=${x + 6}:y=289:w=88:h=3:color=0x3a2418:t=fill`;
  const mouth = 'drawbox=x=198:y=412:w=220:h=80:color=0xc07f63:t=fill,drawbox=x=250:y=450:w=120:h=3:color=0x5a3020:t=fill';
  // Image-right is the subject's left eye. The right wink is the left one mirrored: the patch on the
  // other eye reads weaker, and a mirror keeps the two winks alike.
  const eyeImage = (name, lids, flip = false) => {
    const path = join(imageDir, `eyes-${name}.png`);
    ffmpeg('-i', join(imageDir, 'portrait.jpg'), '-vf', [crop, ...lids, mouth, 'scale=-2:470', ...(flip ? ['hflip'] : [])].join(','), path);
    return path;
  };
  const EYES = { open: eyeImage('open', []), shut: eyeImage('shut', [lid(186), lid(345)]), left: eyeImage('wink-left', [lid(345)]), right: eyeImage('wink-right', [lid(345)], true) };
  const [w] = size(EYES.open);
  const at = [(FRAME.width - w) / 2, 5];
  const STEPS = [
    { name: 'lead-in', image: null, seconds: LEAD_IN },
    { name: 'face (centres)', image: 'open', seconds: 3 },
    { name: 'eye test: eyes open', image: 'open', seconds: 3, before: ['#hf-eye-test summary', '#hf-eye-test-start'] },
    { name: 'eye test: eyes shut', image: 'shut', seconds: 2, check: (p) => p.eyeTest === 'idle' && /open your eyes/i.test(p.eyeTestText) },
    { name: 'open', image: 'open', seconds: 2 },
    { name: 'eye test: left wink', image: 'left', seconds: 2, before: ['#hf-wink-test-left'], check: (p) => /Left wink works/.test(p.eyeTestText) },
    { name: 'open', image: 'open', seconds: 2 },
    { name: 'eye test: right wink', image: 'right', seconds: 2, before: ['#hf-wink-test-right'], check: (p) => /Right wink works/.test(p.eyeTestText) },
    { name: 'open (winks bindable)', image: 'open', seconds: 2, check: (p) => p.eyes === 'live' },
    { name: 'slow blink clicks', image: 'shut', seconds: 0.7, mark: true },
    { name: 'open', image: 'open', seconds: 1.5, check: (p, first) => Number(p.taps) === Number(first.taps) + 1 },
    { name: 'wink left: drag on', image: 'left', seconds: 0.6 },
    { name: 'open (dragging)', image: 'open', seconds: 1.5, check: (p) => p.pressed === 'true' },
    { name: 'wink right: Esc ends it', image: 'right', seconds: 0.6, mark: true },
    { name: 'open', image: 'open', seconds: 1.5, check: (p, first) => p.pressed === 'false' && Number(p.commands) > Number(first.commands) },
    { name: 'long blink pauses', image: 'shut', seconds: 2.2, check: (p) => p.paused === 'true' },
    { name: 'open (paused)', image: 'open', seconds: 1.5, check: (p) => p.paused === 'true' },
    { name: 'long blink resumes', image: 'shut', seconds: 2.2 },
    { name: 'open (resumed)', image: 'open', seconds: 1.5, check: (p) => p.paused === 'false' },
  ];
  const video = buildVideo('eyes', STEPS.map((step) => (step.image ? { pose: EYES[step.image], from: at, seconds: step.seconds } : { pose: null, seconds: step.seconds })));
  const run = await open(video, 'head');
  const { page } = run;
  const eyePanel = async () => ({ ...(await panel(page)), eyeTestText: await page.textContent('#hf-eye-test-text') });
  let first = null;
  const results = [];
  let t = 0;
  for (const step of STEPS) {
    if (step.before) for (const selector of step.before) await page.click(selector);
    if (step.mark) first = await eyePanel();
    t += step.seconds;
    await videoAt(page, t - 0.15);
    const p = await eyePanel();
    const ok = step.check ? step.check(p, first ?? p) : null;
    results.push({ step: step.name, ok, label: p.label, pressed: p.pressed, paused: p.paused, taps: Number(p.taps), commands: Number(p.commands), eyes: p.eyes, eyeLevels: p.eyeLevels, eyeTest: p.eyeTestText });
    console.log(`${ok === null ? '·' : ok ? '✓' : '✗'} eyes: ${step.name.padEnd(26)} ${p.label} · taps=${p.taps} pressed=${p.pressed} paused=${p.paused} eyes=${p.eyes} L/R=${p.eyeLevels} · ${p.eyeTestText}`);
  }
  await page.screenshot({ path: join(out, 'eyes.png') });
  const stats = await panel(page);
  await run.browser.close();
  return { results, stats, errors: run.errors };
}

// --- Pass 5: pointer sources and the fit ---------------------------------------------------------
// A planar photo warped in perspective reads to the Face Landmarker as a turned head: the side made
// nearer (taller) is the side the face turns away from. Image-right nearer = a turn to the subject's
// right = towards screen right in the mirror; top nearer = a tilt down.
async function pointerPass() {
  const k = 60;
  const warp = (name, filter) => {
    const path = join(imageDir, `warp-${name}.png`);
    ffmpeg('-i', join(imageDir, 'portrait.jpg'), '-vf', ['crop=560:560:130:0,scale=400:400', filter].filter(Boolean).join(','), path);
    return path;
  };
  const W = {
    centre: warp('centre', ''),
    right: warp('right', `perspective=0:${k}:400:0:0:${400 - k}:400:400:sense=destination`),
    left: warp('left', `perspective=0:0:400:${k}:0:400:400:${400 - k}:sense=destination`),
    down: warp('down', `perspective=0:0:400:0:${k}:400:${400 - k}:400:sense=destination`),
    up: warp('up', `perspective=${k}:0:${400 - k}:0:0:400:400:400:sense=destination`),
  };
  const at = [120, 40];
  const STEPS = [
    { name: 'lead-in', image: null, seconds: LEAD_IN },
    { name: 'centre (calibrates)', image: 'centre', seconds: 3 },
    { name: 'turned right', image: 'right', seconds: 3, sample: 'right' },
    { name: 'turned left', image: 'left', seconds: 3, sample: 'left' },
    { name: 'tilted down', image: 'down', seconds: 3, sample: 'down' },
    { name: 'tilted up', image: 'up', seconds: 3, sample: 'up' },
    { name: 'fit: centre', image: 'centre', seconds: 3, fit: true },
    { name: 'fit: left', image: 'left', seconds: 3 },
    { name: 'fit: right', image: 'right', seconds: 3 },
    { name: 'fit: up', image: 'up', seconds: 3 },
    { name: 'fit: down', image: 'down', seconds: 3 },
    { name: 'fit done', image: 'centre', seconds: 2, fitCheck: true },
  ];
  const video = buildVideo('pointer', STEPS.map((step) => (step.image ? { pose: W[step.image], from: at, seconds: step.seconds } : { pose: null, seconds: step.seconds })));
  const results = [];
  const errors = [];
  const positions = {};
  let stats = null;
  for (const source of ['nose', 'angle']) {
    // Fresh settings each run: the nose run fits, the angle run must start unfitted.
    const run = await open(video, 'head', async (page) => {
      await page.click('#hf-pointer summary');
      if (source === 'angle') await page.click('#hf-pointer-source');
    });
    const { page } = run;
    const label = await page.textContent('#hf-pointer-source');
    positions[source] = {};
    let t = 0;
    for (const step of STEPS) {
      if (step.fit && source === 'nose') await page.click('#hf-fit-start');
      t += step.seconds;
      await videoAt(page, t - 0.2);
      const p = await panel(page);
      if (step.sample) positions[source][step.sample] = { x: Number(p.x), y: Number(p.y), unit: p.unit };
      if (step.fitCheck && source === 'nose') {
        const text = await page.textContent('#hf-fit-text');
        const ok = p.fitted === 'true' && p.fit === 'idle';
        results.push({ step: 'fit wizard completes (nose)', ok, text, summary: await page.textContent('#hf-fit-summary') });
        console.log(`${ok ? '✓' : '✗'} pointer: fit wizard completes (nose)  ${text} · ${await page.textContent('#hf-fit-summary')}`);
      }
      if (step.sample || step.fitCheck) console.log(`· pointer (${label}): ${step.name.padEnd(20)} cursor=${p.x},${p.y} unit=${p.unit} fit=${p.fit} ${p.label}`);
    }
    if (source === 'nose') await page.screenshot({ path: join(out, 'pointer-fit.png') });
    stats = await panel(page);
    errors.push(...run.errors);
    await run.browser.close();
  }
  for (const source of ['nose', 'angle']) {
    const q = positions[source];
    const okX = q.right.x > q.left.x;
    const okY = q.down.y > q.up.y;
    results.push({ step: `${source}: right of left, down below up`, ok: okX && okY, positions: q });
    console.log(`${okX && okY ? '✓' : '✗'} pointer (${source}): turned right x=${q.right.x} > left x=${q.left.x} · tilted down y=${q.down.y} > up y=${q.up.y}`);
  }
  return { results, stats, positions, errors };
}

// --- Pass 6: Palms ---------------------------------------------------------------------------------
// Two hands, no finger gestures: the fist (the player's right hand, on image-left) points with its palm
// and the other hand (pointing_up, mirrored into a left hand) clicks by moving up. A first run measures
// how far the cursor moves per image px of the fist and how big the other hand's palm is; the journey is
// built from that: rest both hands → dwell picks Road → lift at A places a block → lift held while the fist
// moves A → B drags a road, lowering releases → dwell on the camera pad turns the camera.
const PALM_HEIGHT = 200;

async function palmsPass() {
  const POINT = pose('palm-point', 'fist.jpg', 'crop=190:354:90:0', PALM_HEIGHT);
  const CLICK = pose('palm-click', 'pointing_up.jpg', 'crop=170:376:70:0,hflip', PALM_HEIGHT);
  const [pointW] = size(POINT);
  const [clickW] = size(CLICK);
  const P0 = [200 - pointW / 2, 150];
  const C0 = [460 - clickW / 2, 170];
  const shift = (p, dx, dy) => [p[0] + dx, p[1] + dy];
  const both = (seconds, point, click) => ({ seconds, layers: [{ pose: CLICK, ...click }, { pose: POINT, ...point }] });
  const centre = { x: VIEW.width / 2, y: VIEW.height / 2 };

  /** Samples #hf-root until the video reaches `until` (s). */
  const sample = async (page, until) => {
    const samples = [];
    while ((await page.evaluate(() => document.querySelector('.hf-video').currentTime)) < until) {
      samples.push(await panel(page));
      await page.waitForTimeout(100);
    }
    return samples;
  };
  const bothSeen = (samples) => samples.filter((s) => s.pointerHand === 'true' && s.clickHand === 'true').length / Math.max(1, samples.length);

  // --- Calibration: cursor per image px of the fist, and the other hand's palm size --------------------
  const PROBE = { x: 45, y: 35, lift: 20 };
  const probes = [
    { name: 'rest', point: [0, 0], click: [0, 0] },
    { name: 'click probe', point: [0, 0], click: [0, -PROBE.lift] },
    { name: 'rest again', point: [0, 0], click: [0, 0] },
    { name: 'image-left', point: [-PROBE.x, 0], click: [0, 0] },
    { name: 'image-right', point: [PROBE.x, 0], click: [0, 0] },
    { name: 'image-up', point: [0, -PROBE.y], click: [0, 0] },
    { name: 'image-down', point: [0, PROBE.y], click: [0, 0] },
  ];
  const segments = [{ pose: null, seconds: LEAD_IN }];
  let previous = probes[0];
  for (const probe of probes) {
    segments.push(both(0.5, { from: shift(P0, ...previous.point), to: shift(P0, ...probe.point) }, { from: shift(C0, ...previous.click), to: shift(C0, ...probe.click) }));
    segments.push(both(3, { from: shift(P0, ...probe.point) }, { from: shift(C0, ...probe.click) }));
    previous = probe;
  }
  const calibration = {};
  const layout = {};
  {
    const { browser, page } = await open(buildVideo('palms-calibrate', segments), 'palms');
    layout.road = await page.evaluate(() => {
      const r = document.querySelector('[data-tool="road"]').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    layout.orbit = await page.evaluate(() => {
      const r = document.querySelector('#btn-cam-orbit-left').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width };
    });
    const cell = (x, z) => page.evaluate(([cx, cz]) => window.__THREE_GAME_TEST_HOOKS__.cellToClient(cx, cz), [x, z]);
    // Clear of the hands-free panel and the camera pad's View and Aim groups.
    layout.a = await cell(14, 36);
    layout.b = await cell(30, 36);
    let t = LEAD_IN;
    for (const probe of probes) {
      t += 3.5;
      const samples = await sample(page, t - 0.3);
      const p = await panel(page);
      calibration[probe.name] = { x: Number(p.x), y: Number(p.y), liftLevel: Number(p.liftLevel), rest: p.rest, both: Number(bothSeen(samples).toFixed(2)) };
      console.log(`· palms calibration: ${probe.name.padEnd(12)} cursor=${p.x},${p.y} lift=${p.liftLevel} rest=${p.rest} both hands seen ${Math.round(bothSeen(samples) * 100)} % ${p.label}`);
    }
    await page.screenshot({ path: join(out, 'palms-calibrate.png') });
    await browser.close();
  }
  const rest = calibration.rest;
  const gain = {
    left: (calibration['image-right'].x - rest.x) / PROBE.x,
    right: (calibration['image-left'].x - rest.x) / -PROBE.x,
    up: (calibration['image-up'].y - rest.y) / -PROBE.y,
    down: (calibration['image-down'].y - rest.y) / PROBE.y,
  };
  // Unfitted, a palm size of offset moves the cursor 1/3 of the width across and 0.45 of the height down.
  const palmPx = {
    left: (VIEW.width / 3) / Math.abs(gain.left),
    right: (VIEW.width / 3) / Math.abs(gain.right),
    up: (VIEW.height * 0.45) / Math.abs(gain.up),
    down: (VIEW.height * 0.45) / Math.abs(gain.down),
  };
  // The lift level is the move up over the 0.75 palm-size threshold.
  const clickPalmPx = PROBE.lift / (calibration['click probe'].liftLevel * 0.75);
  const lift = Math.round(1.4 * clickPalmPx);
  console.log('palms: cursor px per image px', JSON.stringify(gain), '· implied fist palm px', JSON.stringify(palmPx), `· other hand palm ${clickPalmPx.toFixed(0)} px → lift ${lift} px`);
  console.log('palms: targets (CSS px):', JSON.stringify(layout));
  for (const g of Object.values(gain)) if (!(Math.abs(g) > 0.1)) throw new Error(`palms calibration: the cursor did not follow the fist (${JSON.stringify(calibration)})`);
  if (!Number.isFinite(clickPalmPx) || clickPalmPx <= 0) throw new Error(`palms calibration: the other hand's lift did not register (${JSON.stringify(calibration['click probe'])})`);

  /** Where the fist's top-left goes for the cursor to land on `target`. */
  const at = (target) => {
    const dx = target.x - rest.x;
    const dy = target.y - rest.y;
    return shift(P0, dx / (dx >= 0 ? gain.right : gain.left), dy / (dy >= 0 ? gain.down : gain.up));
  };
  const up = shift(C0, 0, -lift);
  const STEPS = [
    { name: 'lead-in', seconds: LEAD_IN, video: { pose: null, seconds: LEAD_IN } },
    { name: 'both hands at rest', seconds: 4, video: both(4, { from: P0 }, { from: C0 }), check: (g, p) => p.present === 'true' && p.pointerHand === 'true' && p.clickHand === 'true' && p.rest === 'ready' },
    { name: 'camera pad shows', seconds: 0.5, video: both(0.5, { from: P0 }, { from: C0 }), check: (g, p, s) => s.pad },
    { name: 'to the Road card', seconds: 1.5, video: both(1.5, { from: P0, to: at(layout.road) }, { from: C0 }) },
    { name: 'dwell on the Road card', seconds: 3, target: layout.road, video: both(3, { from: at(layout.road) }, { from: C0 }), check: (g) => g.tool === 'road' },
    { name: 'to A', seconds: 2, video: both(2, { from: at(layout.road), to: at(layout.a) }, { from: C0 }) },
    { name: 'hover A', seconds: 2, target: layout.a, mark: true, video: both(2, { from: at(layout.a) }, { from: C0 }), check: (g, p, s) => s.onMap },
    { name: 'other hand lifts at A', seconds: 2.5, target: layout.a, still: true, video: both(2.5, { from: at(layout.a) }, { from: C0, to: up }), check: (g, p) => g.roadTiles >= 1 && p.pressed === 'true' },
    { name: 'held lift: drag A → B', seconds: 4, video: both(4, { from: at(layout.a), to: at(layout.b) }, { from: up }) },
    { name: 'hold at B', seconds: 1, target: layout.b, video: both(1, { from: at(layout.b) }, { from: up }), check: (g, p, s) => s.onMap },
    { name: 'other hand lowers', seconds: 2, video: both(2, { from: at(layout.b) }, { from: up, to: C0 }), check: (g, p, s, first) => p.pressed === 'false' && g.roadTiles >= 6 && Number(p.canvasPresses) === Number(first.canvasPresses) + 1 },
    { name: 'to the camera pad', seconds: 2, video: both(2, { from: at(layout.b), to: at(layout.orbit) }, { from: C0 }) },
    { name: 'dwell on Rotate left', seconds: 3.5, target: layout.orbit, camera: true, video: both(3.5, { from: at(layout.orbit) }, { from: C0 }), check: (g, p, s, first) => Math.abs(g.camera.azimuth - first.camera.azimuth) > 0.05 },
    { name: 'hands gone', seconds: 2, video: { pose: null, seconds: 2 } },
  ];
  const { browser, page, errors } = await open(buildVideo('palms', STEPS.map((step) => step.video)), 'palms');
  const results = [];
  let first = null;
  let t = 0;
  let allSamples = [];
  for (const [i, step] of STEPS.entries()) {
    if (step.mark) first = { ...(await panel(page)), ...(await game(page)) };
    if (step.camera) first = { ...first, camera: (await game(page)).camera };
    const before = await panel(page);
    t += step.seconds;
    const samples = await sample(page, t - 0.2);
    if (step.name !== 'lead-in' && step.name !== 'hands gone') allSamples = allSamples.concat(samples);
    const g = await game(page);
    const p = await panel(page);
    const pad = await page.evaluate(() => {
      const el = document.querySelector('#ui-camera-pad');
      const r = el?.getBoundingClientRect();
      return !!el && !el.hidden && r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    });
    // Nothing on screen covers the target: the press lands on the map itself.
    const onMap = step.target ? await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', step.target) : null;
    const ok = step.check ? step.check(g, p, { pad, onMap }, first ?? before) : null;
    const cursor = [Number(p.x), Number(p.y)];
    const result = { step: step.name, ok, tool: g.tool, roadTiles: g.roadTiles, cursor, pressed: p.pressed, rest: p.rest, pointerHand: p.pointerHand, clickHand: p.clickHand, liftLevel: Number(p.liftLevel), canvasPresses: Number(p.canvasPresses), azimuth: Number(g.camera.azimuth.toFixed(3)), pad, onMap, label: p.label, bothSeen: Number(bothSeen(samples).toFixed(2)) };
    if (step.target) {
      result.target = [Math.round(step.target.x), Math.round(step.target.y)];
      result.missPx = Math.round(Math.hypot(cursor[0] - step.target.x, cursor[1] - step.target.y));
    }
    let extra = '';
    if (step.still) {
      // The other hand lifting must not move the pointer.
      const from = [Number(before.x), Number(before.y)];
      const worst = Math.max(0, ...samples.filter((s) => s.present === 'true').map((s) => Math.hypot(Number(s.x) - from[0], Number(s.y) - from[1])));
      result.stillWorstPx = Math.round(worst);
      result.stillWorstPct = Number(((worst / VIEW.width) * 100).toFixed(1));
      extra = ` · pointer moved ≤ ${result.stillWorstPx} px (${result.stillWorstPct} % of width) while the other hand lifted`;
    }
    results.push(result);
    console.log(`${ok === null ? '·' : ok ? '✓' : '✗'} palms: ${step.name.padEnd(24)} tool=${g.tool} roads=${g.roadTiles} cursor=${p.x},${p.y}${result.target ? ` target=${result.target} (miss ${result.missPx} px)${onMap ? ' on the map' : ''}` : ''} pressed=${p.pressed} rest=${p.rest} lift=${p.liftLevel} presses=${p.canvasPresses} az=${result.azimuth} pad=${pad} both=${Math.round(result.bothSeen * 100)} % ${p.label}${extra}`);
    if (step.still) {
      const ok = result.stillWorstPct < 3;
      results.push({ step: 'pointer stays put while the other hand lifts', ok, worstPx: result.stillWorstPx, worstPct: result.stillWorstPct });
      console.log(`${ok ? '✓' : '✗'} palms: pointer stays put while the other hand lifts (worst ${result.stillWorstPx} px, ${result.stillWorstPct} % of width; < 3 %)`);
    }
    if (step.check || i === 3) await page.screenshot({ path: join(out, `palms-${String(i).padStart(2, '0')}.png`) });
  }
  const stats = await panel(page);
  await browser.close();
  const seen = Number(bothSeen(allSamples).toFixed(2));
  console.log(`· palms: both hands seen in ${Math.round(seen * 100)} % of ${allSamples.length} samples while in view`);
  return { results, stats, calibration, gain, palmPx, clickPalmPx: Number(clickPalmPx.toFixed(1)), lift, layout, bothSeen: seen, errors };
}

const only = option('only', null);
const hands = !only || only === 'hands' ? await handPasses() : null;
const head = !only || only === 'head' ? await headPass() : null;
const eyes = !only || only === 'eyes' ? await eyePass() : null;
const pointer = !only || only === 'pointer' ? await pointerPass() : null;
const palms = !only || only === 'palms' ? await palmsPass() : null;

const tracking = (stats) => stats && { delegate: stats.delegate, loadMs: Number(stats.loadMs), inferMs: Number(stats.inferMs), fps: Number(stats.fps), frames: Number(stats.frames), dropped: Number(stats.dropped), models: stats.models };
const report = {
  date: new Date().toISOString(),
  graphics,
  viewport: VIEW,
  offsets: hands?.offsets,
  layout: hands?.layout,
  steps: hands?.results ?? [],
  tracking: tracking(hands?.stats),
  counts: hands && { domClicks: Number(hands.stats.domClicks), canvasPresses: Number(hands.stats.canvasPresses), commands: Number(hands.stats.commands) },
  head: head && { steps: head.results, tracking: tracking(head.stats) },
  eyes: eyes && { steps: eyes.results, tracking: tracking(eyes.stats) },
  pointer: pointer && { steps: pointer.results, positions: pointer.positions, tracking: tracking(pointer.stats) },
  palms: palms && { steps: palms.results, calibration: palms.calibration, gain: palms.gain, palmPx: palms.palmPx, clickPalmPx: palms.clickPalmPx, lift: palms.lift, layout: palms.layout, bothSeen: palms.bothSeen, tracking: tracking(palms.stats) },
  pageErrors: [...(hands?.errors ?? []), ...(head?.errors ?? []), ...(eyes?.errors ?? []), ...(pointer?.errors ?? []), ...(palms?.errors ?? [])],
};
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
const failed = [...(hands?.results ?? []), ...(head?.results ?? []), ...(eyes?.results ?? []), ...(pointer?.results ?? []), ...(palms?.results ?? [])].filter((r) => r.ok === false);
const rate = (name, stats) => (stats ? `(${name}): ${stats.delegate}, ${stats.inferMs} ms a frame, ${stats.fps} results/s` : null);
console.log(`tracking ${[rate('hands', hands?.stats), rate('head', head?.stats), rate('eyes', eyes?.stats), rate('pointer', pointer?.stats), rate('palms', palms?.stats)].filter(Boolean).join(' · ')} · page errors: ${report.pageErrors.length}`);
console.log(failed.length ? `FAILED: ${failed.map((r) => r.step).join(', ')}` : 'all checks passed');
process.exit(failed.length || report.pageErrors.length ? 1 : 0);
