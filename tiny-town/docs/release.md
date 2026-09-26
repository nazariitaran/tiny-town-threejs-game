# Tiny Town — release guide (WP-11)

## Build and deploy
```bash
npm ci
npm run verify                 # typecheck + unit tests + production build → dist/
PORT=5188 npm run preview      # serves dist/ on PORT-1000 (4188) — test THIS, not the dev server
```
`dist/` is a fully static site. Upload everything in `dist/` **except `assets/*.map`** to any static
host (GitHub Pages, Netlify, S3, itch.io). No server logic, no environment variables, no API keys.

- **Base path:** `vite.config.ts` sets `base: './'`, so the same `dist/` works at a domain root or any
  sub-path (e.g. `https://<user>.github.io/<repo>/`). Every runtime URL goes through `assetUrl()`
  (`src/game/config.ts`), which prefixes `import.meta.env.BASE_URL`. New code must do the same:
  never hard-code `"/assets/..."` in a `fetch`, loader or `<img src>`.
  Check: `grep -rn "/assets/" src` — every hit must be a catalog path passed to `assetUrl()`.
- **Sourcemaps:** `sourcemap: 'hidden'` — `.map` files are written for debugging but the JS has no
  `sourceMappingURL`, so browsers never fetch them. Don't deploy them.
- **CSS minify is off** (`cssMinify: false`): lightningcss 1.32 drops `translate:` when the same rule
  sets `transform:` (it de-centred the hint pill in production only). Costs ~1 kB gzip. Re-enable
  once upstream is fixed **and** the visual baselines pass against the preview.
- **Browser support:** WebGL2 browsers (three r184). Tested: Chromium desktop 1280×720 and Pixel 7
  emulation. Real iOS Safari / Android devices were not tested by WP-11.
- **HTTPS** is recommended (audio unlock and `localStorage` saves work on http too).

## Testing the production build
```bash
PORT=5212 npm run build
PORT=5212 npx playwright test -c artifacts/wp-11/playwright.preview.config.ts   # whole e2e suite vs vite preview
```
`artifacts/wp-11/` (gitignored, copied by the integrator) holds the release scripts:
`release-check.mjs` (network/errors/globals/debug gating; run it against a sub-path copy of dist/),
`profile.mjs` (frame time), `gpu-timer.mjs`, `bundle-attribution.mjs`.

## Debug gating and test hooks (policy)
| Surface | Player build behaviour | Policy |
| --- | --- | --- |
| lil-gui tuning panel | only with `?debug` (0 panels without, 6 with) | keep |
| `__THREE_GAME_TEST_HOOKS__` | installed, inert until called | **keep in production**: the canvas inspector, e2e suite and bots run against `vite preview`. Rule: installing the hooks must have no side effects; every hook only runs when called, and `setState` disables autosave so it can never overwrite a player's save. Never add hooks that run on load or change defaults. |
| `__THREE_GAME_DIAGNOSTICS__` | rebuilt every frame | keep (tests read it); see follow-up on per-frame allocation |
| `__THREE_GAME_FX_DIAGNOSTICS__`, `__THREE_GAME_LIFE_DIAGNOSTICS__` | still published | remove: superseded by diagnostics `fx` / `life` |
| console output | none during load → build (0 logs) | keep it that way; `console.error` only on load failure |
| lil-gui code | bundled (29.9 kB min) even without `?debug` | lazy-import it in `DebugTools` |

## Budgets (03-architecture.md) — measured on the production preview
| Metric | Budget | Desktop 1280×720 | Mobile (Pixel 7 emu) |
| --- | --- | --- | --- |
| Draw calls (stress-town) | 150 / 120 | 25 | 25 |
| Triangles (stress-town) | 400k / 250k | 232k | 195k |
| Textures | ≤ 30 | 11–14 | 10–13 |
| Shadow map | 2048 / 1024 | 2048 (high tier) | 1024 (low tier) |
| DPR cap | 2 / 1.5 | 2 | 1.5 (canvas 618×1372 at 412 CSS px) |
| Frame time (stress-town, headless full Chromium, M2 Max) | ≤ 8 ms | 1.36 ms mean (738 fps uncapped) | 1.41 ms |
| Initial download (JS+CSS+font+models+audio+icons) | ≤ 8 MB | 3.14 MB over the network, 3.28 MB in `dist/` (without maps) | same |
| Main JS chunk | code-split if > 900 kB | 830 kB (221 kB gzip) → no split | |

Frame-time method: Chromium with `--disable-gpu-vsync --disable-frame-rate-limit` so frames aren't
capped; mean interval between rAF frames over 4 s after a 1.5 s warm-up = end-to-end frame time.
Also: GPU time per `renderer.render()` via `EXT_disjoint_timer_query_webgl2`, and CPU per frame with
vsync on (0.18 ms). Headless mobile emulation runs on the same laptop GPU, so it proves layout, DPR
and tier settings, not real-phone speed.
