// Run with a dev server on PORT (default 5188): xvfb-run -a -s "-screen 0 1920x1080x24 +extension GLX" node docs/failing-tests/probe-texture-origin.mjs
// Which document logs "Couldn't load texture"? Replays audio.spec's beforeEach + the music test's
// reload with every console.error tagged by the emitting document's timeOrigin and phase.
import { chromium } from '@playwright/test';

const base = process.env.URL ?? `http://127.0.0.1:${process.env.PORT ?? 5188}/`;
const runs = Number(process.env.RUNS ?? 5);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  headless: false,
  args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
});
const summary = [];
for (let run = 0; run < runs; run += 1) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    const origin = Math.round(performance.timeOrigin);
    const original = console.error.bind(console);
    console.error = (...args) => original(`[doc ${origin} phase=${window.__THREE_GAME_DIAGNOSTICS__?.phase ?? 'none'}]`, ...args);
  });
  // audio.spec beforeEach
  await page.goto(base);
  await page.evaluate(() => ['tiny-town:settings:v1', 'tiny-town:music:v1'].forEach((k) => localStorage.removeItem(k)));
  await page.reload();
  const beforeEachDoc = await page.evaluate(() => Math.round(performance.timeOrigin));
  // the test body: listener first, then reload
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.reload();
  const testDoc = await page.evaluate(() => Math.round(performance.timeOrigin));
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 90_000 });
  await page.waitForTimeout(500);
  const byDoc = {};
  for (const e of errors) {
    const doc = e.match(/\[doc (\d+)/)?.[1] ?? 'untagged';
    const who = doc === String(beforeEachDoc) ? 'beforeEach document (aborted by the reload)' : doc === String(testDoc) ? 'test document' : `other ${doc}`;
    byDoc[who] = (byDoc[who] ?? 0) + 1;
  }
  const result = { run, errors: errors.length, byDoc, sample: errors[0]?.slice(0, 140) };
  console.log(JSON.stringify(result));
  summary.push(result);
  await page.close();
}
console.log(`runs with texture errors: ${summary.filter((r) => r.errors > 0).length}/${runs}; from the test document: ${summary.reduce((n, r) => n + (r.byDoc['test document'] ?? 0), 0)}`);
await browser.close();
