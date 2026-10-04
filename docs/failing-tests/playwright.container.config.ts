import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

// The e2e suite in a GPU-less Linux container (e.g. a cloud agent session). See REPORT.md.
//  - PW_CHROMIUM: the installed Chromium, when it differs from the build @playwright/test expects.
//  - LLVMPIPE=1: headed Chromium on Mesa llvmpipe; run under `xvfb-run -a -s "-screen 0 1920x1080x24 +extension GLX"`.
//    About 3x faster than headless SwiftShader, but the real X cursor and window can disturb
//    hover and viewport tests (interaction.spec.ts:411, variants.spec.ts:176).
//  - SLOW: multiplies the test and expect timeouts (default 1 = the repo's own values).
const executablePath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const slow = Number(process.env.SLOW ?? 1);
const llvmpipe = process.env.LLVMPIPE === '1';
const args = llvmpipe ? ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] : [];

export default defineConfig({
  ...base,
  testDir: '../../tests',
  outputDir: '../../artifacts/failing-tests/test-results',
  timeout: (base.timeout ?? 30_000) * slow,
  expect: { ...base.expect, timeout: (base.expect?.timeout ?? 5_000) * slow },
  projects: base.projects!.map((p) => ({
    ...p,
    use: {
      ...p.use,
      headless: llvmpipe ? false : p.use?.headless,
      launchOptions: { ...(p.use?.launchOptions ?? {}), executablePath, args: [...(p.use?.launchOptions?.args ?? []), ...args] },
    },
  })),
  webServer: { ...(base.webServer as object), cwd: '../..', timeout: 60_000 },
});
