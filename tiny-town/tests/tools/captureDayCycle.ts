/**
 * Day/night evidence capture (WP-16c): records Auto mode with a short debug day
 * (`?debug&day=N`, an N-second day) over the sample town, as a video plus labelled stills.
 *
 *   PORT=5217 npm run dev            # in another shell
 *   node tests/tools/captureDayCycle.ts [--day 20] [--seconds 21] [--out artifacts/wp-16c/day-cycle] [--mobile]
 *
 * Writes <out>/day-cycle.webm (Playwright recordVideo), <out>/still-<nn>-<phase>-t<t>.png every
 * second, named stills for each phase (dusk.png, night.png, dawn.png, day.png: the first frame
 * well inside that phase) and <out>/timeline.json ({ s, t, phase, night, lightsOn, lamps }).
 * The debug panel is hidden through the real `hideDebugUi` hook; the town comes from
 * setState('sample-town') and the pin that state sets is released with setTimeOfDay(null), so the
 * running Auto clock (started in the morning by Start) drives everything.
 */
import { copyFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, devices } from '@playwright/test';

interface Args {
  url: string;
  day: number;
  seconds: number;
  out: string;
  mobile: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    url: `http://127.0.0.1:${process.env.PORT ?? 5188}`,
    day: 20,
    seconds: 21,
    out: 'artifacts/wp-16c/day-cycle',
    mobile: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const next = () => argv[++i];
    if (argv[i] === '--url') args.url = next();
    else if (argv[i] === '--day') args.day = Number(next());
    else if (argv[i] === '--seconds') args.seconds = Number(next());
    else if (argv[i] === '--out') args.out = next();
    else if (argv[i] === '--mobile') args.mobile = true;
    else throw new Error(`unknown option ${argv[i]}`);
  }
  return args;
}

/** A still counts as "inside" a phase once t is this far past the phase start. */
const PHASE_MID: Record<string, [number, number]> = {
  dawn: [0.03, 0.08],
  day: [0.3, 0.5],
  dusk: [0.69, 0.73],
  night: [0.8, 0.9],
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chromium' });
  const viewport = args.mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 };
  const context = await browser.newContext({
    ...(args.mobile ? devices['Pixel 7'] : {}),
    viewport,
    recordVideo: { dir: args.out, size: viewport },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${args.url}/?debug&day=${args.day}`);
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'title', undefined, { timeout: 20_000 });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__!.hideDebugUi(true));
  await page.locator('#btn-start').click(); // Auto: the clock starts in the morning
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.phase === 'building');
  await page.evaluate(async () => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    await hooks.seed(12345);
    await hooks.setState('sample-town');
    hooks.setTimeOfDay(null); // release the state's afternoon pin: the Auto clock runs again
    hooks.hideDebugUi(true);
  });

  const timeline: Array<{ s: number; t: number; phase: string; night: number; lightsOn: number; lamps: number; calls: number }> = [];
  const named = new Set<string>();
  const start = Date.now();
  for (let i = 0; (Date.now() - start) / 1000 < args.seconds; i += 1) {
    const d = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!);
    const s = Math.round((Date.now() - start) / 100) / 10;
    const row = { s, t: +d.daytime.t.toFixed(4), phase: d.daytime.phase, night: +d.daytime.night.toFixed(3), lightsOn: +d.daytime.lightsOn.toFixed(3), lamps: d.daytime.lamps, calls: d.renderer.calls };
    timeline.push(row);
    const file = path.join(args.out, `still-${String(i).padStart(2, '0')}-${row.phase}-t${row.t.toFixed(3)}.png`);
    await page.screenshot({ path: file });
    const [lo, hi] = PHASE_MID[row.phase];
    if (!named.has(row.phase) && row.t >= lo && row.t <= hi) {
      named.add(row.phase);
      copyFileSync(file, path.join(args.out, `${row.phase}.png`));
    }
    console.log(JSON.stringify(row));
    await page.waitForTimeout(Math.max(0, (i + 1) * 1000 - (Date.now() - start)) || 0);
  }
  writeFileSync(path.join(args.out, 'timeline.json'), JSON.stringify({ args, errors, timeline }, null, 2));
  const video = page.video();
  await context.close();
  if (video) renameSync(await video.path(), path.join(args.out, 'day-cycle.webm'));
  await browser.close();
  console.log(`named stills: ${[...named].join(', ') || 'none'}; console errors: ${errors.length}`);
  if (errors.length) console.log(errors.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
