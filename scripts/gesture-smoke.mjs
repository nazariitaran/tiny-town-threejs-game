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
// Needs a dev server on PORT and ffmpeg. Writes videos, screenshots and report.json to --out.
// Run: node scripts/gesture-smoke.mjs [--out artifacts/gesture-smoke] [--graphics low] [--headed] [--only hands|head|eyes|pointer]
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

const only = option('only', null);
const hands = !only || only === 'hands' ? await handPasses() : null;
const head = !only || only === 'head' ? await headPass() : null;
const eyes = !only || only === 'eyes' ? await eyePass() : null;
const pointer = !only || only === 'pointer' ? await pointerPass() : null;

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
  pageErrors: [...(hands?.errors ?? []), ...(head?.errors ?? []), ...(eyes?.errors ?? []), ...(pointer?.errors ?? [])],
};
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
const failed = [...(hands?.results ?? []), ...(head?.results ?? []), ...(eyes?.results ?? []), ...(pointer?.results ?? [])].filter((r) => r.ok === false);
const rate = (name, stats) => (stats ? `(${name}): ${stats.delegate}, ${stats.inferMs} ms a frame, ${stats.fps} results/s` : null);
console.log(`tracking ${[rate('hands', hands?.stats), rate('head', head?.stats), rate('eyes', eyes?.stats), rate('pointer', pointer?.stats)].filter(Boolean).join(' · ')} · page errors: ${report.pageErrors.length}`);
console.log(failed.length ? `FAILED: ${failed.map((r) => r.step).join(', ')}` : 'all checks passed');
process.exit(failed.length || report.pageErrors.length ? 1 : 0);
