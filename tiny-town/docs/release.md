# Tiny Town — release guide

Written by WP-11 (v0.1) and updated for v0.2 (2026-09-27). The config lives in `vite.config.ts`.

## Build and deploy
```bash
npm ci
npm run verify                 # typecheck + unit tests + production build → dist/
PORT=5188 npm run preview      # serves dist/ on PORT-1000 (4188) — test THIS, not the dev server
```
`dist/` is a fully static site with no server logic, environment variables or API keys. Upload everything in `dist/` **except `assets/*.map`** to any static host (GitHub Pages, Netlify, S3, itch.io).

- **Base path.** `vite.config.ts` sets `base: './'`, so the same `dist/` works at a domain root or any sub-path (e.g. `https://<user>.github.io/<repo>/`).
  - Every runtime URL goes through `assetUrl()` (`src/game/config.ts`), which prefixes `import.meta.env.BASE_URL`. New code must do the same: never hard-code `"/assets/..."` in a `fetch`, loader, `<img src>` or `<audio src>`.
  - Check with `grep -rn "/assets/" src`: every hit must be a catalog or constant path that is passed to `assetUrl()`.
- **Sourcemaps.** `sourcemap: 'hidden'` writes `.map` files for debugging, but the JS has no `sourceMappingURL`, so browsers never fetch them. Don't deploy them.
- **CSS minify is ON** (Vite's default lightningcss).
  - WP-11 turned it off because lightningcss 1.32 drops `translate:` when the same rule also sets `transform:`, which de-centred the hint pill in production only.
  - WP-06 fix2 made `.ui-hint` transform-free, and minify was re-enabled in `f813b04`.
  - **Rule:** never combine `translate:` and `transform:` in one CSS rule. Run the visual baselines against the preview after CSS changes.
- **Music.** `dist/assets/music/foundation-of-gold.mp3` (4.68 MB) ships with the build.
  - It is **not** part of the initial download: an `<audio>` element streams it, and its `src` is set on the first Start/Continue.
  - Hosts must serve `.mp3` as `audio/mpeg`, which is the default everywhere common.
- **Browser support.** WebGL2 browsers (three r184).
  - Tested: Chromium desktop 1280×720 and Pixel 7 emulation, plus the inspector's 390×844 mobile mode.
  - Real iOS Safari and Android devices have not been tested.
- **HTTPS** is recommended, although audio unlock and `localStorage` saves also work on http.

## Testing the production build
```bash
PORT=5212 npm run build
PORT=5212 npx playwright test -c artifacts/wp-11/playwright.preview.config.ts   # whole e2e suite vs vite preview
```
`artifacts/` is **gitignored**. The WP-11 release scripts exist only in the main checkout's `artifacts/wp-11/`, and a fresh clone or worktree doesn't have them:
- `release-check.mjs` checks network, errors, globals and debug gating; run it against a sub-path copy of `dist/`;
- `profile.mjs` measures frame time;
- `gpu-timer.mjs`;
- `bundle-attribution.mjs`.

If they're missing, re-create them from the methods described below.

## Debug gating and test hooks (policy)
| Surface | Player build behaviour | Policy |
| --- | --- | --- |
| lil-gui tuning panel | only with `?debug` | keep |
| `__THREE_GAME_TEST_HOOKS__` | installed, inert until called | **keep in production** (see below) |
| `__THREE_GAME_DIAGNOSTICS__` | rebuilt every frame (includes `save`, `fx`, `life`, `audio.music`) | keep, because tests read it. Follow-up: reuse one object instead of allocating per frame |
| Other diagnostics globals | none | The `__THREE_GAME_FX_DIAGNOSTICS__` / `__THREE_GAME_LIFE_DIAGNOSTICS__` shims were removed in `bc1ae5b`; don't add new globals |
| console output | none during load → build (0 logs) | keep it that way; `console.error` only on load failure, one `console.warn` per audio failure |
| lil-gui code | bundled (≈ 30 kB min) even without `?debug` | follow-up: lazy-import it in `DebugTools` |

Test hooks stay in production because the canvas inspector, the e2e suite and the bots run against `vite preview`. The rules:
- Installing the hooks must have no side effects. Every hook runs only when called.
- `setState` disables autosave, so it can never overwrite a player's save.
- Never add hooks that run on load or change defaults.

## Budgets (targets in `docs/design/03-architecture.md`)
Numbers are labelled with their version and source.
- **v0.3 was re-measured on the production preview** on 2026-09-27, package version 0.3.0, with the WP-11 method: `vite preview`, headless full Chromium, real GPU (ANGLE Metal, M2 Max).
- **Evidence** (local only, `artifacts/v03-release/`):
  - frame-time profiles: `profile-*.json`;
  - network / debug-gating checks: `release-*.json`;
  - the e2e run against the preview: `e2e-preview.txt`;
  - the scripts: copies of WP-11's, with `profile.mjs --time=T` added to pin the time of day.
- **Other columns:** v0.2 has only dev-server numbers; the v0.1 column is WP-11's.

| Metric | Budget (desktop / mobile) | v0.1 — WP-11, production preview, 2026-09-26 (desktop / Pixel 7 emu) | v0.2 — 2026-09-27 | **v0.3 — production preview, 2026-09-27** (desktop / Pixel 7 emu) |
| --- | --- | --- | --- | --- |
| Draw calls (stress-town) | 150 / 120 | 25 / 25 | 30 / 30 (WP-12 inspector, dev server) | Day 32 / 32; night (t 0.82) 35 / 34 |
| Triangles (stress-town) | 400k / 320k (250k before the 64 × 64 plot) | 232k / 195k | 311k / 243.5k (same run; mobile headroom ~6.5k) | Day 306.1k / 237.0k (mobile headroom ~13k); night 300.0k / 232.9k (3 cars instead of 6) |
| Draw calls / triangles (sample-town; night-town) | — | — | — | Day 56 / 56, 182.8k / 117.9k; night-town 60 / 59, 176.8k / 111.8k |
| Textures | ≤ 30 | 11–14 / 10–13 | 11 / 10 (stress-town, same run) | Stress-town 14 / 13. Sample-town 28 / 27 (the composed models' own textures plus the 4 glow masks) |
| Shadow map | 2048 / 1024 | 2048 (high tier) / 1024 (low tier) | unchanged | unchanged (quality high / low; mobile canvas 618×1372) |
| DPR cap | 2 / 1.5 | 2 / 1.5 (canvas 618×1372 at 412 CSS px) | unchanged | unchanged |
| Frame time (stress-town, headless full Chromium, M2 Max, uncapped) | ≤ 8 ms | 1.36 ms mean (738 fps uncapped) / 1.41 ms | not re-measured | Day 1.38 ms mean (p95 2.7) / 1.39 ms. Night 1.37 / 1.38 ms. Sample-town 1.49 / 1.45 ms; night-town 1.50 / 1.47 ms |
| Initial download before the title (network) | ≤ 8 MB | 3.14 MB over the network; 3.28 MB in `dist/` without maps | 3.29 MB in `dist/` without maps **and without the 4.68 MB music file**, which streams after Start. WP-13 measured on the dev server: 2.38 MB before Start with no music requests | **4.70 MB** over the network before the title (170 requests, 0.3–0.37 s to the title); 4.98 MB after Start with every dock category opened. The music streams after Start and is not counted. `dist/` without maps or music: 4.94 MB (models 3.59, JS/CSS/HTML 0.91, icons 0.26, fonts 0.14, SFX 0.05) |
| Main JS chunk | code-split if > 900 kB | 830 kB (221 kB gzip) → no split | 843 kB (225 kB gzip) → no split | **887 kB** (240 kB gzip) → no split yet, but only 13 kB under the threshold |

**64 × 64 plot (2026-09-28, dev server, full Chromium on the real GPU; mobile = Pixel 7 emulation, low tier).** Stress town: day 31 calls / 362.4k triangles desktop, 31 / 291.3k mobile; night (t 0.82) 34 / 356.5k and 33 / 289.3k. The town itself is ~236k (100 homes on the bigger plot). The mobile triangle budget was raised to 320k for the bigger plot (owner decision). Not yet re-measured on the production preview.

**v0.3 release checks (production preview and a sub-path static host, 2026-09-27).**
- **Network:** 0 failed requests, 0 console or page errors, and no request outside the base path. This holds both on `vite preview` and with `dist/` served from `/tiny-town/` by a plain static server.
- **Debug gating:** no lil-gui without `?debug`; with `?debug` the panel appears. The globals are `__THREE__`, `__THREE_GAME_TEST_HOOKS__` and `__THREE_GAME_DIAGNOSTICS__`, as the policy above allows.
- **Start:** Start gets to `building` through real input, and music is requested only after Start.
- **e2e against the preview:** the whole suite through `artifacts/v03-release/playwright.preview.config.ts`: 114 tests, 100 passed, 14 skipped by design, 0 failed (6.0 min).
- **CPU profile (stress-town, desktop):** time goes to native GL calls, `multiDrawElementsWEBGL` 25.5%, then `bindTexture` 11.5%. The picture is the same as v0.1.

**Frame-time method (v0.1).**
- Chromium runs with `--disable-gpu-vsync --disable-frame-rate-limit`, so frames aren't capped.
- End-to-end frame time is the mean interval between rAF frames over 4 s, after a 1.5 s warm-up.
- Also measured: GPU time per `renderer.render()` via `EXT_disjoint_timer_query_webgl2`, and CPU per frame with vsync on (0.18 ms).

Headless mobile emulation runs on the same laptop GPU, so it proves layout, DPR and tier settings, not real-phone speed.
