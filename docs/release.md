# Tiny Town — release guide

Build, deploy, test the production build, debug and test-hook policy, budgets. Config: `vite.config.ts`, `playwright.config.ts`.

## Build and deploy
```bash
npm ci
npm run verify          # local-path check, licences check, typecheck, unit tests, production build → dist/
npm run preview         # serves dist/ on PORT − 1000 (default 4188): test this, not the dev server
```
`dist/` is a fully static site: no server logic, environment variables or API keys. Upload everything in `dist/` **except `assets/*.map`** to any static host (GitHub Pages, Netlify, S3, itch.io). HTTPS is recommended; audio unlock and `localStorage` saves also work on http.

- **Cloudflare.** The live site is a Cloudflare Worker with static assets, built from `main` on push: `npm ci`, `npm run build`, then `npx wrangler deploy`, which uploads `dist/` as configured in `wrangler.jsonc`. `public/.assetsignore` keeps the `.map` files out of the upload. Cloudflare's build runs npm 10, so after a dependency change check that `npx -y npm@10.9.2 ci` accepts the lock file.

- **Base path.** `base: './'`, so the same `dist/` works at a domain root or any sub-path. Every runtime URL goes through `assetUrl()` (`src/game/config.ts`), which prefixes `import.meta.env.BASE_URL`; never hard-code `"/assets/..."` in a `fetch`, loader, `<img src>` or `<audio src>`. Check: every hit of `grep -rn "/assets/" src` is a catalog or constant path passed to `assetUrl()`.
- **Version.** `package.json` `version` is the only source: `define` in `vite.config.ts` turns it into `__APP_VERSION__`, and `VERSION_LABEL` in `src/ui/UiRoot.ts` shows it as `v0.6` on the title screen and under Menu → Help. Bump it and cut the CHANGELOG section together.
- **Chunks.** three.js is its own vendor chunk; `PhotoFrame` is a lazy chunk. `chunkSizeWarningLimit` is 900 kB.
- **Sourcemaps.** `sourcemap: 'hidden'`: `.map` files are written, but the JS has no `sourceMappingURL`. Don't deploy them.
- **CSS.** Minified by lightningcss, which drops `translate:` when the same rule also sets `transform:`. Never combine the two in one rule; run the visual baselines against the preview after CSS changes.
- **Music.** `assets/music/foundation-of-gold.mp3` (4.68 MB) is not part of the initial download: an `<audio>` element streams it once Start or Continue sets its `src`. Hosts must serve `.mp3` as `audio/mpeg` (the common default).
- **Static extras.** `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `og-image.jpg`, `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, `.assetsignore`, `data/default_town_names.json` and `licenses.txt` (the shipped libraries' licence texts, linked from Credits) come from `public/`. After a dependency change run `npm run gen:licenses`; `verify` fails while it is stale.
- **Browsers.** WebGL2 (three r184). Automated coverage is Chromium desktop and Pixel 7 emulation; real iOS Safari and Android need a device check.

## Testing the production build
The e2e suite runs against the dev server by default (`playwright.config.ts` starts `npm run dev`). To run it against `vite preview`, use a local override config, e.g. `artifacts/preview/playwright.preview.config.ts` (gitignored):
```ts
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

const baseURL = `http://127.0.0.1:${Number(process.env.PORT ?? 5188) - 1000}`;
export default defineConfig({
  ...base,
  testDir: '../../tests',
  outputDir: './preview-test-results',
  use: { ...base.use, baseURL },
  webServer: { command: 'npm run preview', url: baseURL, reuseExistingServer: true, timeout: 20_000, cwd: '../..' },
});
```
```bash
PORT=5212 npm run build && PORT=5212 npx playwright test -c artifacts/preview/playwright.preview.config.ts
```
The canvas inspector takes `--url http://127.0.0.1:4188` to inspect the preview.

Release checks, on the preview (desktop and mobile) and on `dist/` copied under a sub-path (e.g. `/tiny-town/`) of a plain static server such as `python3 -m http.server`:
- 0 failed requests, 0 console or page errors, no other console output, no request outside the base path;
- no lil-gui panel without `?debug`; the only globals are `__THREE__`, `__THREE_GAME_TEST_HOOKS__` and `__THREE_GAME_DIAGNOSTICS__`;
- Start → name dialog → building through real input; no music request before Start;
- the whole e2e suite passes against the preview, darwin visual baselines included;
- a real photo and the lazy `PhotoFrame` chunk load through the relative base.

## Debug gating and test hooks
| Surface | Player build | Policy |
| --- | --- | --- |
| lil-gui panels | only with `?debug` | keep |
| lil-gui code | bundled (~30 kB min) | builds no panel without `?debug` |
| `__THREE_GAME_TEST_HOOKS__` | installed, inert until called | keep in production |
| `__THREE_GAME_DIAGNOSTICS__` | a getter, built only when read | keep; tests and the inspector read it |
| other globals | none | don't add any |
| console | silent from load to building | `console.error` only on a load or photo failure; `console.warn` for audio, model or name-list problems |

Test hooks stay in production because the canvas inspector, the e2e suite and the bots run against `vite preview`. Rules:
- installing the hooks has no side effects; every hook acts only when called;
- `setState` turns autosave off, so it never overwrites a player's save;
- never add a hook that runs on load or changes defaults.

## Budgets
Full 64 × 64 town (`stress-town`), production preview, Medium preset, headless full Chromium on the real GPU (M2 Max); desktop 1280 × 720 at DPR 1, mobile Pixel 7 emulation (412 × 915, DPR 2.625).

| Metric | Target desktop / mobile | Latest |
| --- | --- | --- |
| Draw calls | ≤ 150 / ≤ 120 | stress 33 / 33, at night 36 / 36; sample town 85 / 85, at night 89; cars in car parks add none |
| Triangles | ≤ 400k / ≤ 320k | stress 328.3k–332.4k / 328.3k (above the mobile target), at night 324.3k / 324.3k–326.4k; sample town 193.7k (the stadium is 1,724) |
| Textures | ≤ 30 | stress 14, sample town 29 (incl. the glow masks; the stadium's floodlight mask is one) |
| Shadow map | 1 × 2048 (Low 1024) | per preset |
| DPR cap | Low 1, Medium 1.5, High 2 | per preset |
| CPU per rendered frame | ≤ 8 ms | stress 1.39 ms building / 1.94 ms idle; sample town 1.68 / 2.88 ms |
| Frame cap | 60 active / 30 idle (Low 30 / 30) | held |
| Download before the title (JS, CSS, font, models, SFX, icons, name list) | ≤ 8 MB | 5.26 MB; `dist/` without maps or music 5.07 MB |
| Main JS chunk | < 900 kB | 337 kB (107 kB gzip) + three.js 642 kB (162 kB gzip) |

Per preset, stress town: triangles Low 289k–298k, Medium / High 324k–332k (phone / desktop). GPU busy on an M2 Max at 1512 × 982, DPR 2, active / idle: Low 11 / 11 %, Medium 33–35 / 20–21 %, High 44–45 / 26–27 %. On a 1080p DPR-1 screen Low renders about 4× cheaper per frame than Medium (render scale 0.75).

Method:
- **CPU per frame:** rAF callback time (update + render submit) per rendered frame, read with the diagnostics `frame` counter, over 4 s idle and 4 s with the pointer moving. Idle frames cost more because most redraw the sun shadow.
- **Triangles** vary by a few thousand between frames: `renderer.info` counts the shadow pass only on frames that redraw it. Report the range over several runs.
- **GPU busy:** whole-GPU `Device Utilization %` from `ioreg`, median over 8 s, rAF paced at 120 Hz; the machine at rest reads 0–3 %.
- Headless mobile emulation runs on the laptop GPU: it proves layout, DPR and preset settings, not phone speed.
