// Run with a dev server on PORT (default 5188): HEADED=1 xvfb-run -a -s "-screen 0 1920x1080x24 +extension GLX" node docs/failing-tests/probe-hint-race.mjs
// ui.spec.ts:347 at 1280x720 (DPR 2): time each step between the tool click (hint shown for 3.5 s,
// wall clock) and the hint assertion, and compare the 64x64 scan with the old 48x48 one.
import { chromium } from '@playwright/test';

const headed = process.env.HEADED === '1';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: !headed,
  args: headed ? ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] : [],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(process.env.URL ?? `http://127.0.0.1:${process.env.PORT ?? 5188}/`);
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 120_000 });
await page.locator('#btn-start').click();
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'building' || !document.getElementById('ui-town-name')?.hidden);
if (await page.locator('#ui-town-name').isVisible()) await page.locator('#btn-town-name-ok').click();
await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'building');
await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('stress-town'));
await page.locator('#cat-homes').click();

const scan = (n) =>
  page.evaluate((size) => {
    const t0 = performance.now();
    const dockTop = document.querySelector('#ui-dock').getBoundingClientRect().top;
    let best = null;
    for (let z = 0; z < size; z += 1)
      for (let x = 0; x < size; x += 1) {
        const p = window.__THREE_GAME_TEST_HOOKS__.cellToClient(x, z);
        if (p.y > dockTop - 24 || document.elementFromPoint(p.x, p.y)?.id !== 'game-canvas') continue;
        if (!best || p.y > best.py) best = { x, z, px: p.x, py: p.y };
      }
    return { best, ms: performance.now() - t0 };
  }, n);
const hintVisible = () => page.evaluate(() => document.getElementById('ui-hint').classList.contains('is-visible'));
const invalid = () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.invalidCount);

const t0 = Date.now();
const lap = {};
await page.locator('#tool-family-home').click();
lap.toolClick = Date.now() - t0;
await page.waitForTimeout(300);
const s64 = await scan(64);
lap.scan64 = Date.now() - t0;
const before = await invalid();
let taps = 0;
for (let i = 0; i < 3 && (await invalid()) === before; i += 1) {
  await page.mouse.click(s64.best.px, s64.best.py);
  taps += 1;
  await page.waitForTimeout(450);
}
lap.taps = Date.now() - t0;
await page.locator('#ui-tooltip').waitFor({ state: 'visible' });
lap.tooltipVisible = Date.now() - t0;
const visibleAtCheck = await hintVisible();
lap.hintCheck = Date.now() - t0;
const s48 = await scan(48);
console.log(JSON.stringify({
  mode: headed ? 'headed+xvfb' : 'headless',
  hintWindowMs: 3500,
  msFromToolClick: lap,
  hintVisibleAtCheck: visibleAtCheck,
  scanMs: { '64x64 (now)': Math.round(s64.ms), '48x48 (before d1ef2ae)': Math.round(s48.ms) },
  tapsNeeded: taps,
}));
await browser.close();
