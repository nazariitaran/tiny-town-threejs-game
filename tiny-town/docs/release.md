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
Numbers are labelled with their version and source. **Neither v0.2 nor v0.3 has been re-profiled on the production preview.** The v0.3 column is the working tree before release (evidence, local only: `artifacts/v03/stress-desk4/`, `artifacts/v03/stress-mobile4/`). Before the next release, re-run the v0.1 method with a fresh run id.

| Metric | Budget (desktop / mobile) | v0.1 — WP-11, production preview, 2026-09-26 (desktop / Pixel 7 emu) | v0.2 — 2026-09-27 | v0.3 working tree — 2026-09-27 (not released) |
| --- | --- | --- | --- | --- |
| Draw calls (stress-town) | 150 / 120 | 25 / 25 | 30 / 30 (WP-12 inspector, dev server) | 32 / 32 (dev-server inspector) |
| Triangles (stress-town) | 400k / 250k | 232k / 195k | 311k / 243.5k (same run; mobile headroom ~6.5k) | 306.1k / 239.1k (same run; mobile headroom ~10.9k) |
| Textures | ≤ 30 | 11–14 / 10–13 | 11 / 10 (stress-town, same run) | 11 / 10 (same run) |
| Shadow map | 2048 / 1024 | 2048 (high tier) / 1024 (low tier) | unchanged | unchanged |
| DPR cap | 2 / 1.5 | 2 / 1.5 (canvas 618×1372 at 412 CSS px) | unchanged | unchanged |
| Frame time (stress-town, headless full Chromium, M2 Max) | ≤ 8 ms | 1.36 ms mean (738 fps uncapped) / 1.41 ms | not re-measured | not measured |
| Initial download (JS+CSS+font+models+SFX+icons) | ≤ 8 MB | 3.14 MB over the network; 3.28 MB in `dist/` without maps | 3.29 MB in `dist/` without maps **and without the 4.68 MB music file**, which streams after Start. WP-13 measured on the dev server: 2.38 MB before Start with no music requests | not measured (on disk: models 3.58 MB, icons 259 KB) |
| Main JS chunk | code-split if > 900 kB | 830 kB (221 kB gzip) → no split | 843 kB (225 kB gzip) → no split | not measured |

**Frame-time method (v0.1).**
- Chromium runs with `--disable-gpu-vsync --disable-frame-rate-limit`, so frames aren't capped.
- End-to-end frame time is the mean interval between rAF frames over 4 s, after a 1.5 s warm-up.
- Also measured: GPU time per `renderer.render()` via `EXT_disjoint_timer_query_webgl2`, and CPU per frame with vsync on (0.18 ms).

Headless mobile emulation runs on the same laptop GPU, so it proves layout, DPR and tier settings, not real-phone speed.
