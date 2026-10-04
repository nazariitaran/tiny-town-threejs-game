// Run with a dev server on PORT (default 5188): HEADED=1 xvfb-run -a -s "-screen 0 1920x1080x24 +extension GLX" node docs/failing-tests/probe-hover.mjs
// interaction.spec.ts:411 replay: where does the pointer land, and what does diagnostics.hover say?
// HEADED=1 runs headed (xvfb + llvmpipe, as in the failing runs); otherwise headless (SwiftShader).
import { chromium } from '@playwright/test';

const headed = process.env.HEADED === '1';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: !headed,
  args: headed ? ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] : [],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
await page.goto(process.env.URL ?? `http://127.0.0.1:${process.env.PORT ?? 5188}/`);
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 120_000 });
await page.locator('#btn-start').click();
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'building' || !document.getElementById('ui-town-name')?.hidden);
if (await page.locator('#ui-town-name').isVisible()) await page.locator('#btn-town-name-ok').click();
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'building');
await page.locator('#cat-homes').click();
await page.locator('#tool-townhouse').click();
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.tool === 'townhouse');

const frames = (n) => page.evaluate((k) => new Promise((r) => { const step = (i) => (i === 0 ? r() : requestAnimationFrame(() => step(i - 1))); step(k); }), n);
const read = () => page.evaluate(() => {
  const d = window.__THREE_GAME_DIAGNOSTICS__;
  const c = document.getElementById('game-canvas').getBoundingClientRect();
  const h = window.__THREE_GAME_TEST_HOOKS__;
  return {
    hover: d.hover, camera: d.camera, canvas: { rect: [c.x, c.y, c.width, c.height], ...d.canvas },
    inner: [innerWidth, innerHeight], outer: [outerWidth, outerHeight], dpr: devicePixelRatio,
    cell_24_20: h.cellToClient(24, 20), cell_53_28: h.cellToClient(53, 28),
  };
});

// The test's pointer: grid point (24.5, 20.75), bilinear between cell centres (helpers.gridPoint).
const target = await page.evaluate(() => {
  const at = (a, b) => window.__THREE_GAME_TEST_HOOKS__.cellToClient(a, b);
  const [p00, p10, p01, p11] = [at(24, 20), at(25, 20), at(24, 21), at(25, 21)];
  const lerp = (a, b, t) => a + (b - a) * t;
  return { x: lerp(lerp(p00.x, p10.x, 0), lerp(p01.x, p11.x, 0), 0.25), y: lerp(lerp(p00.y, p10.y, 0), lerp(p01.y, p11.y, 0), 0.25) };
});
const events = [];
await page.exposeFunction('__probeLog', (e) => events.push(e));
await page.evaluate(() => {
  window.addEventListener('pointermove', (e) => window.__probeLog({ ev: 'pointermove', x: e.clientX, y: e.clientY }), true);
  window.addEventListener('resize', () => window.__probeLog({ ev: 'resize', inner: [innerWidth, innerHeight] }), true);
});
await page.mouse.move(target.x, target.y, { steps: 3 });
await frames(6);
const afterMove = await read();
await page.waitForTimeout(200);
await page.screenshot({ path: 'artifacts/failing-tests/probe-hover-full.png' });
const afterShot1 = await read();
await page.screenshot({ path: 'artifacts/failing-tests/probe-hover-crop.png', clip: { x: target.x - 160, y: target.y - 120, width: 320, height: 200 } });
await frames(6);
const afterShot2 = await read();
const brief = (r) => ({ hover: r.hover, inner: r.inner, canvas: r.canvas, cell_24_20: r.cell_24_20 });
console.log(JSON.stringify({ mode: headed ? 'headed+xvfb' : 'headless', target, events, afterMove: brief(afterMove), afterFullShot: brief(afterShot1), afterClipShot: brief(afterShot2) }));
await browser.close();
