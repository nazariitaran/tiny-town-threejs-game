# Tiny Town — release guide

Written by WP-11 (v0.1) and updated for each release since (latest: v0.5, 2026-09-30). The config lives in `vite.config.ts`.

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
- **v0.5 was measured on the production preview** on 2026-09-30, package version 0.5.0, at `e45f664` (the `v0.5` tag), with the WP-11 setup: `vite preview`, headless full Chromium, ANGLE Metal on an M2 Max; desktop 1280 × 720 at DPR 1, mobile Pixel 7 emulation 412 × 915 at DPR 2.625. Both are on **Medium**, the default on every device since WP-25, so the mobile column is no longer a cheaper tier. Evidence (local only): `artifacts/v05-release/` (`release-*.json`, `profile-*.json`, `frame-*.json`, `e2e-preview.txt` and the scripts).
  - **Frame time is measured differently from v0.5 on.** WP-24 caps the loop at 60 fps active / 30 fps idle by skipping rAF callbacks, so `profile.mjs`'s mean rAF interval with vsync off is now the browser's callback rate (~560 Hz), not a frame. `frame-cost.mjs` reports the rAF CPU time per **rendered** frame (diagnostics `frame`), the rendered fps and sun-shadow redraws per second, over 4 s idle and 4 s with the pointer moving. It is CPU time (update + render submit), not GPU time; the GPU side is in the WP-24 + WP-25 tables below.
  - **Triangles vary from frame to frame** by a few thousand since WP-24, because `renderer.info` counts the sun-shadow pass only on frames that redraw it. The rows give the range seen across runs.
- **WP-25 (2026-09-30, not released): phones no longer get a cheaper look of their own.** Up to v0.4 the game guessed from the touch screen and gave phones a hidden cheaper tier (1024 shadow map, a quarter of the decor ring, no environment lighting); the "mobile" columns below were measured on it. Since WP-25 every device starts on the Medium preset (the desktop look), and the player can pick Low or High in Menu → Graphics (`03-architecture.md` §Graphics presets). Dev-server numbers per preset and the open mobile triangle question: `docs/progress.md` "WP-25 as built". The next release must re-measure the mobile column on Medium.
- **v0.4 was measured on the production preview** on 2026-09-28, package version 0.4.0, with the same WP-11 method (`vite preview`, headless full Chromium, ANGLE Metal on an M2 Max). Evidence (local only): `artifacts/v04-release/` (profiles, release checks, the e2e run against the preview, and copies of the v0.3 scripts). Every budget is met.
  - **Phone emulation caveat (v0.4):** Pixel 7 emulation sometimes started without touch, and the game then used the desktop look. Two mobile stress-town profiles came out `quality: high` and were re-run until `low` (canvas 618 × 1372, DPR 1.5). Since WP-25 the look no longer depends on touch (`quality` is the chosen preset), so this check is gone; the flaky emulation still changes the hint text.
- **v0.3 was re-measured on the production preview** on 2026-09-27, package version 0.3.0, with the WP-11 method: `vite preview`, headless full Chromium, real GPU (ANGLE Metal, M2 Max).
- **Evidence** (local only, `artifacts/v03-release/`):
  - frame-time profiles: `profile-*.json`;
  - network / debug-gating checks: `release-*.json`;
  - the e2e run against the preview: `e2e-preview.txt`;
  - the scripts: copies of WP-11's, with `profile.mjs --time=T` added to pin the time of day.
- **Other columns:** v0.2 has only dev-server numbers; the v0.1 column is WP-11's.

| Metric | Budget (desktop / mobile) | v0.1 — WP-11, production preview, 2026-09-26 (desktop / Pixel 7 emu) | v0.2 — 2026-09-27 | **v0.3 — production preview, 2026-09-27** (desktop / Pixel 7 emu) | **v0.4 — production preview, 2026-09-28** (desktop / Pixel 7 emu; 64 × 64 plot) | **v0.5 — production preview, 2026-09-30** (desktop / Pixel 7 emu; both Medium) |
| --- | --- | --- | --- | --- | --- | --- |
| Draw calls (stress-town) | 150 / 120 | 25 / 25 | 30 / 30 (WP-12 inspector, dev server) | Day 32 / 32; night (t 0.82) 35 / 34 | Day 31 / 31; night (t 0.82) 34 / 33 | Day 31–33 / 31; night (t 0.82) 34–36 / 34 |
| Triangles (stress-town) | 400k / 320k (250k before the 64 × 64 plot) | 232k / 195k | 311k / 243.5k (same run; mobile headroom ~6.5k) | Day 306.1k / 237.0k (mobile headroom ~13k); night 300.0k / 232.9k (3 cars instead of 6) | Day 358.2k / 293.2k (mobile headroom ~27k under 320k); night 354.3k / 289.2k | Day 328.3k–332.4k / 328.3k: **mobile over the 320k budget by ~8k** (open owner decision, `docs/progress.md` WP-25; WP-25 measured 324.1k at 412 × 839); night 324.3k / 324.3k–326.4k |
| Draw calls / triangles (sample-town; night-town) | — | — | — | Day 56 / 56, 182.8k / 117.9k; night-town 60 / 59, 176.8k / 111.8k | Sample-town 57 / 57, 186.3k / 121.4k; night-town 61 / 60, 180.3k / 115.3k | Sample-town 86–88 / 86, 191.7k / 191.7k; night-town 90 / 90, 185.6k / 185.6k (WP-23's pieces; phones now draw the desktop scene) |
| Textures | ≤ 30 | 11–14 / 10–13 | 11 / 10 (stress-town, same run) | Stress-town 14 / 13. Sample-town 28 / 27 (the composed models' own textures plus the 4 glow masks) | Stress-town 14 / 13. Sample-town 27 / 26 | Stress-town 14 / 14. Sample-town 28 / 28 |
| Shadow map | 2048 / 1024 (2048 on every device since WP-25's Medium) | 2048 (desktop) / 1024 (phones, pre-WP-25 tier) | unchanged | unchanged (desktop / phone tier; mobile canvas 618×1372) | unchanged (desktop / phone tier; mobile canvas 618×1372) | 2048 / 2048 (Medium on both; Low 1024) |
| DPR cap | 2 / 1.5 | 2 / 1.5 (canvas 618×1372 at 412 CSS px) | unchanged | unchanged | unchanged | Medium 1.5 / 1.5 (Low 1, High 2): canvas 1280 × 720 at DPR 1 / 618 × 1372 at DPR 1.5 |
| Frame time (stress-town, headless full Chromium, M2 Max, uncapped) | ≤ 8 ms | 1.36 ms mean (738 fps uncapped) / 1.41 ms | not re-measured | Day 1.38 ms mean (p95 2.7) / 1.39 ms. Night 1.37 / 1.38 ms. Sample-town 1.49 / 1.45 ms; night-town 1.50 / 1.47 ms | Day 1.46 ms mean (p95 2.9) / 1.45 ms. Night 1.51 / 1.47 ms. Sample-town 1.56 / 1.51 ms; night-town 1.56 / 1.52 ms | **New method** (`frame-cost.mjs`, CPU ms per rendered frame, see above). Stress town building (60 fps): 1.39 / 1.41 ms, idle (30 fps): 1.94 / 1.87 ms; night 1.33 / 1.41 ms building, 2.00 / 1.92 ms idle; sample-town 1.68 / 1.90 ms building, 2.88 / 3.10 ms idle. Idle frames cost more because most of them redraw the sun shadow (~21 redraws/s at 30 fps vs ~25/s at 60 fps). The caps held: 60 / 30 fps rendered |
| Initial download before the title (network) | ≤ 8 MB | 3.14 MB over the network; 3.28 MB in `dist/` without maps | 3.29 MB in `dist/` without maps **and without the 4.68 MB music file**, which streams after Start. WP-13 measured on the dev server: 2.38 MB before Start with no music requests | **4.70 MB** over the network before the title (170 requests, 0.3–0.37 s to the title); 4.98 MB after Start with every dock category opened. The music streams after Start and is not counted. `dist/` without maps or music: 4.94 MB (models 3.59, JS/CSS/HTML 0.91, icons 0.26, fonts 0.14, SFX 0.05) | **4.78 MB** over the network before the title (177 requests, 0.33–0.39 s to the title); 5.06 MB after Start with every dock category opened. Music not counted (streams after Start). `dist/` without maps or music: 4.99 MB | **5.26 MB** over the network before the title (195 requests, 0.31–0.36 s to the title); 5.56 MB after Start with every dock category opened. Growth since v0.4: models +0.40 MB (8 more GLBs, WP-23), icons +0.05 MB, the town-name list 9 kB (WP-20). Music not counted. `dist/` without maps or music: 5.07 MB |
| Main JS chunk | code-split if > 900 kB | 830 kB (221 kB gzip) → no split | 843 kB (225 kB gzip) → no split | **887 kB** (240 kB gzip) → no split yet, but only 13 kB under the threshold | **898.66 kB** (243.9 kB gzip) plus the lazy `PhotoFrame` chunk (2.08 kB) → no split yet, but only 1.3 kB under the threshold: **split before adding more** (lazy `lil-gui` ≈ 30 kB) | **298.3 kB** (94.0 kB gzip) + the `three` vendor chunk 641.7 kB (162.0 kB gzip; split in WP-20) + the lazy `PhotoFrame` 2.2 kB → far under the threshold |

**WP-24 + WP-25 on the production preview (2026-09-30, branch `wp-24-frame-budget` at `7ef8ed4`, not released) vs `main` (`f37725d`, the v0.4 code plus WP-20–23).**
- **Method:** `npm run build` + `vite preview` for each build.
  - Headless full Chromium on the real GPU (ANGLE Metal, M2 Max), viewport 1512 × 982 at DPR 2 (the owner's MacBook Pro 14"), vsync off.
  - rAF paced at 120 Hz to emulate a ProMotion display; stress town, the Auto clock running.
  - Whole-GPU `Device Utilization %` from `ioreg`: the median over 8 s, 2 rounds.
    - *Active:* the pointer moves every 250 ms.
    - *Idle:* no input for over 4 s.
  - The machine at rest reads 0–3%.
- **Evidence** (local only): `artifacts/wp-25/prod/` has the scripts and the raw `gpu-main.jsonl`, `gpu-branch.jsonl` and `tris-branch.jsonl`.

| Build / preset | Canvas | Renders (active / idle) | GPU active | GPU idle | Draw calls | Triangles |
| --- | --- | --- | --- | --- | --- | --- |
| `main` (before WP-24) | 3024 × 1964 | 120 / 120 fps | 59–69% | 64–73% | 33 | 332.3k |
| Low | 1512 × 982, no MSAA, Lambert | 30 / 30 fps | 10% | 10% | 33 | 297.5k |
| **Medium** (default) | 2268 × 1473 | 60 / 30 fps | **32–35%** | **18–20%** | 33 | 332.3k |
| High | 3024 × 1964 | 60 / 30 fps | 42–45% | 24% | 33 | 332.3k |

- **Phone** (Pixel 7 emulation, 412 × 839 CSS px at DPR 2.625), stress town / sample town triangles:
  - Medium: 324.1k / 191.4k, canvas 618 × 1258;
  - Low: 289.3k / 156.7k, canvas 412 × 839;
  - High: 324.1k / 191.4k, canvas 824 × 1678.

  Medium and High are over the 320k mobile budget by 4.1k; that is an open owner decision (`docs/progress.md` WP-25).
- **Bundle:**
  - main chunk 297.9 kB (93.9 kB gzip), up from 284.4 kB (90.1 kB gzip) on `main`;
  - the three.js chunk is unchanged at 641.7 kB;
  - `dist/` without maps or music is 5.07 MB, up from 5.05 MB.
- **Errors:** 0 console or page errors in every run on both builds.
- **Car shadows at 30 Hz (2026-09-30, re-measured the same way):**
  - The table above was measured with car shadows at 15 Hz. At 15 Hz the shadow visibly lagged and caught up in steps, so the owner chose 30 Hz.
  - New numbers, building / idle: Low 11% / 11%, **Medium 33–35% / 20–21%**, High 44–45% / 26–27%.
  - While building that is within the noise; idle is about 1–3 points higher, because at 30 fps the car shadow now redraws every frame.
  - Raw results: `artifacts/wp-25/prod/gpu-branch-30hz.jsonl`.

**The 1080p laptop case (2026-09-30, production preview, branch at `15bbf0a` vs `main` `f37725d`).**
- **Setup:** a 1920 × 970 viewport at DPR 1 (a 1920 × 1080 screen at 100% scaling), a 60 Hz display emulated.
- **Two GPUs:**
  - the M2 Max, which confirms the canvas sizes and the caps;
  - SwiftShader (software rendering). It stands in for a weak laptop GPU, far slower than any real one, so only the ratios count.
- **Render cost** = `renderer.render` plus `gl.finish()`, as the median ms per frame.
- **Evidence:** `artifacts/wp-25/p1080/`.

| Build / preset | Canvas | M2 Max fps (active / idle) | SwiftShader ms/frame, sample town | SwiftShader ms/frame, stress town |
| --- | --- | --- | --- | --- |
| `main` (before) | 1920 × 970 | 60 / 60 | 315 | 632 |
| Low (render scale 0.75, no MSAA, Lambert) | **1440 × 727** | 30 / 30 | **74** | **159** |
| Medium | 1920 × 970 | 60 / 30 | 312 | 608 |
| High | 1920 × 970 | 60 / 30 | 310 | 606 |

- **Low is ~4× cheaper per frame** than Medium on a 1080p screen, thanks to the render scale.
- **Medium and High are identical on DPR-1 screens:** both caps are above 1.
- **Medium costs the same per frame as `main`.** On a 60 Hz laptop the gain is the 30 fps idle cap and fewer shadow redraws, not a cheaper frame.
- 0 errors in every run.

**64 × 64 plot (2026-09-28, dev server; superseded by the v0.4 production-preview column above, full Chromium on the real GPU; mobile = Pixel 7 emulation on the pre-WP-25 phone tier).** Stress town: day 31 calls / 362.4k triangles desktop, 31 / 291.3k mobile; night (t 0.82) 34 / 356.5k and 33 / 289.3k. The town itself is ~236k (100 homes on the bigger plot). The mobile triangle budget was raised to 320k for the bigger plot (owner decision). Not yet re-measured on the production preview.

**v0.5 release checks (production preview and a sub-path static host, 2026-09-30).**
- **Network:** 0 failed requests, 0 console or page errors, no other console output, and no request outside the base path, both on `vite preview` (desktop and mobile) and with `dist/` served from `/tiny-town/` by `python3 -m http.server`.
- **Debug gating:** no lil-gui panel without `?debug`; 22 panels with it (20 in v0.4; new: WP-22's Birds and WP-24's Performance). Globals: `__THREE__`, `__THREE_GAME_TEST_HOOKS__`, `__THREE_GAME_DIAGNOSTICS__`.
- **Start:** Start → the name dialog (WP-20) → `building` through real input on every target (`release-check.mjs` now accepts the suggested name).
- **Profiles:** 0 errors in all 14 runs (`profile-*.json`, `frame-*.json`).
- **e2e against the preview:** the whole suite through `artifacts/v05-release/playwright.preview.config.ts`: 198 tests, 176 passed, 22 skipped by design, 0 failed (12.2 min), the darwin visual baselines included; both bot playtests with 0 console or page errors (they place WP-23's new items too).

**v0.4 release checks (production preview and a sub-path static host, 2026-09-28).**
- **Network:** 0 failed requests, 0 console or page errors, no other console output, and no request outside the base path, both on `vite preview` (desktop and mobile) and with `dist/` served from `/tiny-town/` by a plain static server (`python3 -m http.server`).
- **Debug gating:** no lil-gui panel without `?debug`; 20 panels with it. Globals: `__THREE__`, `__THREE_GAME_TEST_HOOKS__`, `__THREE_GAME_DIAGNOSTICS__`.
- **Start:** Start reaches `building` through real input; the music is not part of the 4.78 MB before the title.
- **Town photo:** a real photo on the v0.4 preview: 2536 × 1688 JPEG, 355 KB, 75 ms from the click to ready, no console errors; the lazy `PhotoFrame` chunk loads through the relative base (WP-19).
- **e2e against the preview:** the whole suite through `artifacts/v04-release/playwright.preview.config.ts`: 134 tests, 116 passed, 18 skipped by design, 0 failed (7.5 min); both bot playtests with 0 console or page errors.

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

Headless mobile emulation runs on the same laptop GPU, so it proves layout, DPR and preset settings, not real-phone speed.
