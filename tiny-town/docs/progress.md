# Tiny Town — progress (integrator-maintained)

Only the integrator (WP-01) edits this file. Workers report in their hand-off. This is the recovery point: after any interruption, re-read it together with `docs/HANDOVER.md`.

## Current state (2026-09-28)
- **Version: v0.4 cut on `main`** (2026-09-28, package 0.4.0, tag `v0.4`; not deployed). v0.4 = everything after `v0.3`:
  - **WP-17**: bigger homes and town buildings, smaller swing, only homes glow at night, save v4;
  - **the 64 × 64 plot** (`545c86c`), with the night-grid colours, plain junction centre lines, the Zebra crossing tool and right-click deselect;
  - **WP-18**: music resumes where it left off;
  - **tall trees**: taller pine, big 2 × 2 oak;
  - **WP-19**: the town photo.
  - Gates on `main` after the WP-19 merge (`0b83a88`): `npm run verify` green (23 files, 442 unit tests, build OK); `npm run test:e2e` 134 tests, 116 passed, 18 skipped by design, 0 failed (7.5 min). Production-preview measurements and release checks: `docs/release.md` (v0.4 column).
- **v0.3** (tag `v0.3`). v0.3 = WP-15 (new building blocks, `ea54bb5`) + WP-16 (day/night, integration branch `v0.3-day-night`, owner-approved and merged into `main` 2026-09-27). v0.2's integration commit is `30fe85b`.
- **v0.1** is the M3 "v1" build at `3f9c6cf`. v0.2 adds three owner requests on top:
  - **WP-12**: 48 × 48 grid of 0.5-unit cells, roads as 2 × 2 blocks, multi-cell houses, save v2 with a v1 → v2 migration.
  - **WP-13**: streamed background music with settings.
  - **WP-14**: the stats pill is gone; the top bar is one row.
- **Gates on `main` (2026-09-27):**
  - `npm run verify` is green: 19 test files, 294 unit tests, build OK.
  - `npm run test:e2e`: 82 tests, of which 70 pass and 12 are skipped by design (desktop-only or mobile-only).
  - The 6 visual baselines (darwin) were regenerated after WP-12 (`30fe85b`).
- **WP-15 gates on `main` (`ea54bb5`, 2026-09-27 WP-16 preflight):**
  - `npm run verify` is green: 18 files, 336 unit tests, build OK.
  - `npm run test:e2e`: 70 passed, 12 skipped, 4 failed in one full run (19 min). The failures were browser-launch/test timeouts, texture-load errors under load, and a music-time check. All 4 passed when re-run in isolation (twice).
- **WP-16 day/night is complete:** the owner approved it on 2026-09-27 and `v0.3-day-night` is merged into `main`. See "WP-16 as built" below.
  - Gates on the branch after all merges (2026-09-27): `npm run verify` green (21 files, 387 unit tests, build OK); `npm run test:e2e` green: 114 tests, 100 passed, 14 skipped by design, 0 failed (6.1 min).
  - Worktrees `wp-16a/b/c` removed after their evidence was copied to `artifacts/wp-16a/`, `wp-16b/`, `wp-16c/`.
- **WP-17 is merged into `main`** (owner-approved; integration branch `building-sizes`; part of v0.4): bigger buildings, smaller swing, dark shops at night. See "WP-17 as built".
- **Tall trees are merged into `main`** (owner-approved, no version tag; built on the branch `tall-trees`): pine ×2 taller (still 1 × 1), birch unchanged, and the oak now a big 2 × 2 tree at natural proportions (fixed per species, no player control). See "Tall trees as built".
- **WP-19 Town photo is merged into `main`** (owner-approved 2026-09-28, after two amendments; built on the branch `wp-19-photo`, branched from `691dfd8`): a top-bar camera / `P` saves the current view as a Polaroid JPEG, via a preview with Download. See "WP-19 as built".
- **WP-20 Name your town is merged into `main`** (owner-approved 2026-09-29 after one amendment: no note under the dialog heading; built on the branch `wp-20-town-name` from `ac820b8`); no version label (owner). See "WP-20 as built".
- **WP-21 Town file is merged into `main`** (owner-approved 2026-09-29 with all planning decisions, including the save-format migration promise; built on the branch `wp-21-town-file` from `c7e9a40`). See "WP-21 as built".
- **Where current facts live:**
  - grid, rules, save, modules, diagnostics and budgets: `docs/design/03-architecture.md`;
  - asset scales and footprints: `docs/assets/models.md`;
  - release and measured budgets: `docs/release.md`.
- **Local evidence:** `artifacts/` is gitignored. Evidence cited below exists only in the main checkout.

## Work packages
The SHA is the merge commit on `main`; the WP's own commit is in brackets. Every worktree has been removed and every WP branch merged and deleted.

| WP | Title | Status | Merge (commit) | Notes |
| --- | --- | --- | --- | --- |
| Wave 0 | Scaffold | ✅ | `3c3abd1`, `9a4e084` | walking skeleton, contracts, assets, swarm docs, PORT env |
| M0 | Preflight | ✅ | `bf77054` | first real-browser run: verify, e2e, inspector m0; no blockers |
| WP-02 | Town logic & persistence | ✅ | `43f59e4` (`13479ad`) | rule table, History cap 200, serialize/parseSave, SaveStore, silent applyBatch |
| WP-03 | Rendering | ✅ | `1c3e9d2`; fix1 `4db704c`; fix2 `bf206eb` (`7ef0d3d`) | instanced pools, pop-in, road tiles; fix2 re-rendered the tool icons in-game (`scripts/render-icons.mjs`) |
| WP-04 | World & look | ✅ | `9d2ec05`; fix1 `e3ff916` | sky, light, diorama terrain, decor ring, shader grid, hedgerow frame |
| WP-05 | Interaction | ✅ | `025d271`; fix-ups `161a498`, `4a633c9`, `c5a6ce9`, `0c00b69` | camera, tools, ghost, touch; aspect-aware framing (`framing.ts`); visible valid ghost |
| WP-06 | UI | ✅ | `8541064`; fix1 `9f7e769`; fix2 `923ed19` | dock, top bar, overlays, mobile; fix2 made the hint centring transform-free so CSS minify could return |
| WP-07 | Audio polish | ✅ | `4f96d99`; fix-ups `bd6eeba`, `f948df8` | SFX rebuilt, metal prop clink, stroke pitch rise; shims removed |
| WP-08 | Feel & VFX | ✅ | `3702808`; fix1 `f10f881` | pooled dust/sparkle/poof, wind sway; fix1 soft billboard dust, ≤ 3 FX draw calls |
| WP-09a | QA harness | ✅ | `b2d3124` | smoke + real-input build-flow specs, `tests/helpers.ts` |
| WP-09b | Baselines + bot | ✅ | `52ef019`, `13c7810` | seeded bot playtest; 6 darwin baselines; a missing baseline fails |
| WP-10 | Ambient life | ✅ | `5cc59ba`; wired `142cd95` | ≤ 6 cars (BatchedMesh, +1 main +1 shadow call); dusk toggle not built |
| WP-11 | Release | ✅ | `2c7e2e9` | relative base, hidden sourcemaps, test-hook policy, measured budgets (`docs/release.md`) |
| M1 / M2 / M3 | Checkpoints | ✅ | `66ff92c` / `cc915cb` / `3f9c6cf` | `docs/checkpoints/m1.md`, `m2.md`, `m3.md` (historical) |
| WP-14 | Remove stats pill | ✅ | `d0aa182` (`8d91b1b`) | `StatsHud` deleted; one-row top bar (48 px row desktop / 52 px phones); hint 10 px under it |
| WP-13 | Background music | ✅ | `1fab73f` (`e76d1a8`) | `src/audio/MusicPlayer.ts`; streamed after Start; music on/off + volume; −3 dB menu duck |
| WP-12 | Scale & grid density | ✅ | `fbbef2a` (plan `2f6446d`, docs `cf4123b`) | see "WP-12 as built" below |
| WP-15 | New building blocks & categories (v0.3) | ✅ | `ea54bb5` (`27add32`) | see "WP-15 as built" below |
| WP-18 | Music resumes where it left off | ✅ merged to `main` (owner-approved 2026-09-28) | `40822f8` (`98c7ca8`) | `src/audio/musicPosition.ts`; saved on hide / `pagehide` / every 15 s; seek on `loadedmetadata`; 5 s end guard |
| WP-19 | Town photo | ✅ merged to `main` (owner-approved 2026-09-28) | merge on `main` (`c62376e`, `841536f`, `0c35597`, `92435c1`) | `src/photo/**`; camera button / `P` → menu phase → one frame at long edge 2400 px → Polaroid JPEG → preview (Download) |
| WP-22 | Birds over the town | 🔍 built on `wp-22-birds`, awaiting owner review | branch `wp-22-birds` | `src/life/FlockSim.ts` (pure) + `BirdSystem.ts`; a flock every 45–110 s (none at night), 4 species, procedural 18-tri bird, flapping shadows; `spawnFlock` hook, `?debug&flock=N` |
| WP-21 | Download and open a town file | ✅ merged to `main` (owner-approved 2026-09-29) | merge on `main` (`941988c`) | `src/persistence/townFile.ts`; top-bar folder (> 440 px) / Menu → Town file (phones) / title link; `.tinytown.json`; confirm before replacing; saved at once |
| WP-20 | Name your town | ✅ merged to `main` (owner-approved 2026-09-29) | merge on `main` (`be8c752` + amendment) | `src/town/townName.ts`; name dialog before every new town, rename from the top-left pill / menu; saved in `SavedTownV4.name`; photo caption + file name; three.js vendor chunk |
| WP-16 | Day/night cycle (v0.3) | ✅ merged to `main` (owner-approved) | contract `7aefe67`, `af576a1`; 16a `42f0590` (`a4965c9`); 16b `a849f35` (`d6f97e3`); 16c `1a0c360` (`eb2c2d8`) | see "WP-16 as built" below |

**Integrator (WP-01) commits worth knowing:**

| Commit | Change |
| --- | --- |
| `8b07141` | Wave-1 contract requests + SaveStore wiring |
| `d52bc36` | Dropped the `tests/*.template.ts` exclude; the templates are gone |
| `13ed451` | Diagnostics `hover` carries `valid`/`reason` |
| `2c7b5f8` | Diagnostics `fx` |
| `142cd95` | Diagnostics `life` |
| `bc1ae5b` | Removed the `__THREE_GAME_FX_DIAGNOSTICS__` / `__THREE_GAME_LIFE_DIAGNOSTICS__` shim globals |
| `8f6db9d` | Inspector `--mobile` = the full 390 × 844 viewport |
| `f813b04` | CSS minification back on |
| `51d074d` | Baselines after WP-14; owner-supplied asset rule |
| `30fe85b` | Post-WP-12 integration: `SavedTown` rename in SaveStore (the deprecated `SavedTownV1` alias removed), phone top inset 76, tool icons re-rendered, baselines regenerated |

### WP-12 as built (vs `docs/plans/wp-12-scale.md`)
The plan was approved and implemented. The as-built facts are in `03-architecture.md` §Grid / §Placement rules / §Save format and in `models.md` §Grid and scale. Where the build differs from the plan:

**Migration** (historical: v0.3 deleted the v1 → v2 migration, see WP-15)
- One fallback was added: a house that fits neither as its own kind nor as a 2×3 townhouse tries a townhouse **turned a quarter** either way (3 × 2 fits dense 1-deep v1 rows) before it is dropped.
- A malformed v1 save only has its version bumped, so `parseSave` rejects it with the normal message.
- Results: v0.1 sample town, 0 drops; v0.1 stress town, 36 of 56 homes kept (120 → 100 objects).

**Stress town**
- Trimmed to fit the mobile budget: birch and pine instead of oak, open-field lots and fewer props.
- The decor ring's low-tier share went from 0.6 to 0.25 (`DecorRing.LOW_TIER_SHARE`).
- Measured by the WP-12 inspector (dev server, 2026-09-27): 30 draw calls and 311k triangles on desktop; 30 calls and 243.5k triangles on mobile, against a 250k budget.

**Framing**
- The phone side inset went from −150 to −260 (`framing.ts`; the plan listed this as optional).
- Measured cell pitch: 12.6 px desktop, 10.6 px mobile.
- The integrator then set the narrow top inset to 76 for the one-row top bar.

**Road tile position**
- Each road tile is drawn once per block at the block **centre** (`roadBlockCentreWorld`). The plan said "min corner".

**Icons**
- `IconStudio` frames cells and road blocks using `CELL_SIZE`. The integrator re-rendered the tool icons after the merge.

**Timing**
- WP-12 was merged after WP-13/14 (`9a8379f` merged main into the WP-12 branch).

### WP-22 as built (branch `wp-22-birds`; vs `docs/plans/wp-22-birds.md`)
Current facts: `03-architecture.md` §Birds. Owner request 2026-09-29 (birds only; squirrels dropped after the analysis).
- **As planned**, with these details settled while building:
  - Two flocks in the air fly different height lanes (low 2.8–3.0, high 3.3–3.5), so crossing flocks never fly through each other. A unit test caught two same-height flocks overlapping.
  - Formation spacing is checked on the ground plane, and the wander scales with the bird's size (a 0.8-size starling came too close with a fixed wander).
  - Species sizes went up about 15 % after the first look (pigeon 1.15, starling 1, goose 1.5, gull 1.45 × a 0.36 wingspan): at the default camera the starlings were specks.
  - `instanceColor` is created up front, so the bird shader is built once.
- **Checked** (dev server, full Chromium; `artifacts/wp-22/`, scripts `look.mjs`, `look-title-dusk.mjs`, `measure.mjs`):
  - each species over the sample town at the default camera and close up (`<species>-default.png`, `<species>-close-*.png`);
  - geese over the title screen; starlings at dusk;
  - shadows flap and glide over the grass and roofs.
- **Measured** (stress town, dev server, 2 flocks = 16 birds in the air):
  - desktop: 31 → **32 calls**, 362,404 → 362,692 triangles (**+288** = 16 × 18);
  - Pixel 7 emulation (low tier): 31 → 32 calls. Triangles move by ±4k from the cars driving in and out of view (287.2k–291.3k with no birds), so the birds' +288 is inside that noise.
  - Frame time was vsync-bound (8.33 ms at 120 Hz) with or without birds; the uncapped figure wasn't measured.
- **Gates** (branch, 2026-09-29):
  - `npm run verify` green: 26 files, **496 unit tests** (19 new in `src/life/birds.test.ts`), build OK; main chunk 281.9 kB.
  - `npm run test:e2e`: 164 tests, 143 passed, 20 skipped by design, 1 failed. The failure was `birds.spec.ts`'s crossing test, killed by a Vite reload: a source file was edited while that test ran, and the draw calls read 6 on the reloaded page. Re-run on its own with `--repeat-each=2`: 20 passed, 4 skipped. **All 8 visual baselines passed unchanged.** Logs: `artifacts/wp-22/e2e-full.log`, `e2e-birds-repeat.log`.
- **Not verified here:** real phones, and a production-preview measurement.

### WP-21 as built (branch `wp-21-town-file`; vs `docs/plans/wp-21-town-file.md`)
Current facts: `03-architecture.md` §Save format ("Town files"); UI in `02-interaction-and-ui.md` (top bar, the Town file and Town file confirm states, the menu row, the title link).
- **As planned.** Details settled while building:
  - the panel's Download reads "Download this town" (a 30-character name doesn't fit a phone button);
  - the title link goes straight to the file picker; a bad file opens the panel there, without Download;
  - `photo/savePhoto.ts` became `utils/download.ts` (`downloadBlob`), shared by the photo and the town file.
- **Checked** (dev server and production preview, full Chromium; `artifacts/wp-21/`):
  - desktop and Pixel 7: the panel, a download, a new empty town, then opening the file back through the confirm gives the same stats and name, and the save is written (`desktop-*`, `phone-*`);
  - production preview: the sample town downloaded in one browser profile opens identically in a fresh profile through the title link, with no console errors or warnings.
- **Gates** (branch, 2026-09-29):
  - `npm run verify` green: 25 files, 477 unit tests (8 new for the file: round trip, bare save, not a town, wrong app/kind, newer/older, size limit, smaller plot, bad date, file name); main chunk 271.3 kB.
  - `npm run test:e2e`: 152 tests, 131 passed, 18 skipped by design, 3 failed:
    - `town-name.spec.ts`'s 30-character top-bar test counted the hidden Town file button on phones; it now counts visible buttons;
    - the mobile title baseline changed (expected);
    - `audio.spec.ts:370` on mobile: a burst of GLTF "Couldn't load texture" errors under load, the flake seen before. Re-run in isolation, it and the name spec passed 28 / 28 (`--repeat-each=2`).
    
    `tests/town-file.spec.ts` (6 tests) passed. Log: `artifacts/wp-21/e2e-full.log`.
  - Baselines regenerated (masked diff vs the old files, threshold 0, 12 px pad):
    - desktop sample-town, asset-gallery and night-town: 3.5–4k px changed inside the top bar, **0 outside**;
    - title desktop / mobile: ~7.9k px inside the new link row; 4 / 3 scattered px outside, the title's WebGL noise (the same 4 px showed on an unchanged title in WP-20).
    
    Phone top-bar baselines are unchanged (the button is hidden there). All 8 pass afterwards. Old files and diffs: `artifacts/wp-21/baselines-before/`, `masked-diff/`.
- **Not verified here:** the file picker and download on real iOS (Files) and Android devices.

### WP-20 as built (branch `wp-20-town-name`; vs `docs/plans/wp-20-town-name.md`)
Current facts: `03-architecture.md` §Save format (town name, name suggestions) and §Town photo; UI in `02-interaction-and-ui.md` (top bar, menu, the Name your town state).
- **As planned**, with these details settled while building:
  - **Phones:** in one row, the six 44 px actions (291 px) leave the name 16–53 px at 375–412 px wide (measured). So 400–440 px shows the name at 0.95 rem with an ellipsis (~7 characters at 412 px), and **below 400 px the pill stays the icon-only badge** (a rename button). The **menu's heading is now the town's name** (was "Menu") on every device, so phones always show it in full somewhere. *Open for the owner:* a phone layout that shows more of the name would need a second row or fewer top-bar actions.
  - **Bundle split:** the feature took the main chunk from 898.21 kB to 905.42 kB (over the 900 kB warning limit). Instead of the lazy `lil-gui` import (8 synchronous `debug.folder()` callers, ~30 kB), `vite.config.ts` now puts three.js in its own vendor chunk (Rolldown `codeSplitting.groups`): **main 264.0 kB (84.1 kB gzip) + `three` 641.7 kB (162.0 kB gzip)** + the lazy `PhotoFrame` 2.2 kB. The download is the same; `index.html` modulepreloads the vendor chunk.
  - The names list (12 KB) is fetched at load, not bundled.
  - The menu's New town and Rename town share a row; the name dialog's primary button reads "Start building" (new) or "Save" (rename).
  - **Owner amendment after review** (2026-09-29): the note under the heading ("Up to 30 characters. You can rename it any time from the top bar.") was removed; the counter shows the limit.
- **Measured / checked** (dev server and production preview, full Chromium; `artifacts/wp-20/`):
  - the dialog on desktop and at 360 / 375 / 390 / 412 px (`desktop-*`, `phone-*`), the menu at 360 px, and a 29-character name on the photo card (desktop: full size; Pixel 7 portrait: shrunk to fit), `e2e-*-bobbington-on-wobble-downs-xy-*.jpg`;
  - production preview (`vite preview`, 1280 × 720): the `three` chunk, `data/default_town_names.json` and the lazy `PhotoFrame` chunk all load (200) through the relative base; a named town's photo downloads as `marmalade-mills-2026-09-29-1749.jpg`; no console errors or warnings.
- **Gates** (branch, 2026-09-29):
  - `npm run verify` green: 24 files, 469 unit tests (27 new: name rules, list parsing incl. the shipped JSON, pick, slug, editor name/rename/load, save name parse, rename autosave, caption fit, file name), build OK with no chunk warning.
  - `npm run test:e2e`: 146 tests, 127 passed, 18 skipped by design, 1 failed: the mobile `sample-town` baseline (expected, see below). `tests/town-name.spec.ts` (12 tests, desktop + mobile) also passed `--repeat-each=2` (24 / 24). Log: `artifacts/wp-20/e2e-full.log`.
  - Baselines: the three phone top-bar baselines (sample-town, asset-gallery, night-town) were regenerated one at a time; the masked diff (top bar + 12 px pad, threshold 0) finds **0 px changed outside the top bar** in each (4.2–4.7k px inside it). The **committed mobile `sample-town` baseline had been captured in the flaky no-touch state** (the "click the map" hint and high-tier hedges; see Open issues), so it was checked against a correct touch-state capture instead of the old file. Desktop baselines are unchanged (a strict pixel compare finds 1 anti-aliased pixel in the house badge; not committed). All 8 baselines pass afterwards. Old baselines and diff images: `artifacts/wp-20/baselines-before/`, `masked-diff/`.
- **Not verified here:** real iOS / Android (the on-screen keyboard over the dialog, autocapitalisation).

### WP-19 as built (branch `wp-19-photo`, merged; vs `docs/PLAN.md` WP-19)
Current facts: `03-architecture.md` §Town photo; UI in `02-interaction-and-ui.md` (top bar, `P`, the Photo state).
- **As planned**, with these details settled while building:
  - The preview reuses the **menu phase** with a new `photo` modal view (the same pattern `?` uses for help), so no new `GamePhase`. The side effects are the menu's: the clock pauses and the music ducks −3 dB while the preview is up.
  - The caption reads "Tiny Town" / "28 Sep 2026" with a sun or, at night, a moon. The date uses the player's locale.
  - **Owner amendments after review** (2026-09-28): the Share button is gone (Download only), and the caption lost its time-of-day word ("· Night"), because the icon tells it.
  - The file is the straight card; the tilt and the washi tape exist only in the preview.
  - The top bar holds six actions (camera left of the time button) with no CSS change: it stays one row at 360 px.
- **Measured** (dev server, full Chromium, M-series laptop; `artifacts/wp-19/`):
  - desktop 1280 × 720: capture ratio 1.875, JPEG 2536 × 1688, 355 KB by day / 226 KB at night, 86 / 63 ms from the click to `photo:ready`;
  - Pixel 7 emulation (412 × 915): ratio 2.62, JPEG 1188 × 2670, 290 KB, 78 ms;
  - the ghost test: the on-screen block difference with vs without a supermarket ghost is 120.7; between the two photos it is 0.00;
  - production preview (`vite preview`, 1280 × 720): 2536 × 1688, 355 KB, 71 ms; the lazy `PhotoFrame` chunk loads through the relative base.
- **Bundle:** the main chunk went from 890.92 kB (`main`, `691dfd8`) to 900.11 kB, over the 900 kB warning limit. `PhotoFrame` is now loaded on the first photo (a 2.08 kB chunk), leaving the main chunk at **899.47 kB** (898.21 kB after the Share button was removed). It's under the limit, but with no headroom; most of the photo cost is UI markup, glyphs and CSS, which must be in the main chunk. **The next feature needs a split first**; the lazy `lil-gui` import (about 30 kB) is the known one.
- **Gates** (branch, 2026-09-28):
  - `npm run verify` green: 23 files, 440 unit tests, build OK.
  - `npm run test:e2e`: 134 tests, 116 passed, 18 skipped by design, 0 failed (7.9 min). That run predates the lazy import; after it, `tests/photo.spec.ts` was re-run: 6 passed, 4 skipped. Earlier, `--repeat-each=3` gave 18 / 18.
  - Baselines: the six with a top bar (sample-town, asset-gallery and night-town × desktop and mobile) were regenerated. The masked diff (`tests/tools/maskedDiff.ts`, threshold 0, 12 px pad around the top bar) finds **0 px changed outside the top bar** in all six. `title` is unchanged. Old baselines and diff images: `artifacts/wp-19/baselines-before/`, `masked-diff/`.
- **Evidence:** `artifacts/wp-19/`: `desktop-*`, `night-*`, `mobile-*` (the before-shot, developing, preview and the saved JPEG), `e2e-*` downloads and previews, and `e2e-full.log`.
- **Not verified here:** what Download does on a real iPhone (Files) and Android phone, and long-press "Save to Photos" on the iOS preview, need a device check.

### WP-17 as built (branch `building-sizes`; vs `docs/plans/wp-17-building-sizes.md`)
- **Merges:** plan + contract `3a950d1` → 17b (shop lights) → 17a (scale & layouts) → 17c (QA).
- **Footprints:**
  - cottage / bungalow / family home / suburban: 4×4;
  - townhouse: 3×4;
  - big house and supermarket: 5×4;
  - church: 3×4;
  - corner shop: 3×3.
- **Models:** `HOME_SCALE = 4/3` for homes, the supermarket and the church. The front-yard nudge is now −0.2 (big-house-n −0.05). The corner shop is ×1.4 (so it stays below the two-storey homes). The swing is ×0.87, about 13% smaller.
- **Save v4, no migration:** v3 saves start a fresh town, as in v0.3.
- **Night:** only homes glow. The supermarket glow was removed and the church mask kind deleted; the corner shop never glowed. One texture fewer at night.
- **Layouts:**
  - Sample town re-laid out: every tool used, zero rejections, same stats (fences 27 → 28).
  - Asset gallery on rows 22–29.
  - Stress town is a 12×12 repeat with 64 homes.
- **Measured (inspector, dev server):**
  - stress-town 31 / 31 calls, 273.7k / 206.7k triangles (mobile headroom ~43k, was ~11k); at night 34 / 33 calls;
  - sample-town 56 calls, 183.3k / 118.3k triangles;
  - night-town 60 / 59 calls;
  - textures 27 / 26.
- **Tests:**
  - 398 unit tests, with new footprint, parity, edge, rotation, v4 and glow-set tests.
  - e2e re-mapped. New helpers `clickFootprint` / `footprintOf` aim clicks off the cell-corner rounding boundary of even footprints. A new real-input test places all 9 grown kinds (ghost = placed lot, overlap refused).
  - Baselines regenerated: sample-town, asset-gallery and night-town. `title` is unchanged.
- **Proportions (17c's honest read):**
  - A 4×4 home is about 4 car lengths wide.
  - A lamppost reaches about the ground-floor eaves.
  - Garden props (swing, bench, barbecue) look toy-small next to the houses.
  - If the owner wants it smaller, the cheapest lever is the model scale (×1.2 instead of ×1.33) with the same footprints.
- **Evidence:** `artifacts/wp-17a/`, `wp-17b/`, `wp-17c/` (`look/`, `placement/`, `baselines-before/`).

### WP-16 as built (v0.3, branch `v0.3-day-night`; vs `docs/plans/wp-16-day-night.md`)
Current facts: `03-architecture.md` §Day/night, `02-interaction-and-ui.md` (time button, `T`, grid at night, brand badge ≤ 440 px), `models.md` (cars face +Z).
- **Merges** (integration branch): contract `7aefe67` + `af576a1` → 16a `42f0590` → church glow `9348eaf` → reduced-motion snap `2224422` → 16b a849f35 → 16c 1a0c360.
- **Deviations from the plan:**
  - **16a night keyframe:** moon `#8aa2ff` ×0.95, hemisphere `#3c54b4`/`#1c2444` ×0.85, fog `#22325a`, env **0**; plus night fog near/far blending to 10/170. The plan's values read teal and too flat.
  - **16a other keyframes:** midday key ×3.1; extra keyframes at pre-dawn, sunrise, sunset and blue hour.
  - **Traffic lenses:** lit with `night` only (no day glow, to protect the baselines). All three lenses glow at once; there is no red → green → amber cycle.
  - **Church windows (16b stretch):** a 2-quadrant mask with the door column excluded; they light with `night`, not the house stagger. **Fireflies** are in (+1 draw call, over open meadow). **Corner-shop windows** are skipped (no reliable glass cell). **Crickets** are deferred (no CC0 asset).
  - **Cars drove backwards before v0.3:** `FRONT_ROTATION` π → 0 (16b, confirmed in the browser). The fix regenerated the sample-town / asset-gallery baselines, with changes only on the cars.
  - **Top bar:** the brand turns into the icon badge at ≤ 440 px (was 380) to fit five 44 px actions.
  - **Masked diff:** the 4 top-bar baselines were regenerated. Outside the bar, 0 px changed within 12 px padding, or with a threshold of 10. `title` is unchanged; `night-town` baselines are new.
  - **Reduced motion:** mode switches also snap under OS `prefers-reduced-motion` (integrator), and turning reduced motion on finishes a running sweep.
- **Measured (dev-server inspector, 2026-09-27):**
  - `night-town`: 60 / 59 calls, 176.8k / 111.8k triangles, lamps 4, NightLights +4 / +3 calls (desktop / mobile).
  - Stress town at night: 35 / 34 calls, 299.6k / 232.5k triangles, 40 lamps. By day it is unchanged at 32 / 32.
  - Contrast: full-frame luminance 199 / 227; 3D-only p95−p5 24.7 / 25.4 at night against 66.8 / 73.8 by day. The plan's "≈ 48" reference came from a different measure.
  - Textures by day +4 (glow masks): the stress town reports 14, the sample town 28, against a budget of 30.
- **Evidence** (local, `artifacts/`):
  - `wp-16a/`: t-sweep stills and the title at dusk/night;
  - `wp-16b/`: car-front crops, the night close-ups and `final/`;
  - `wp-16c/`: `masked-diff/`, `night-checks/` (ghost at night), and `day-cycle/` (a 20 s Auto-day video at `?debug&day=20`, `day-cycle-auto-20s.mp4`, a contact sheet and a timeline).

### WP-15 as built (v0.3)
Contract: `docs/PLAN.md` §WP-15. Current facts are in `03-architecture.md`, `02-interaction-and-ui.md`, `models.md` and `CREDITS.md`.

**Catalog**
- Dock categories **Streets / Homes / Town / Nature / Garden** (were Paths / Nature / Buildings / Other); Shift+1–5 switch. 33 placing tools (7 + 7 + 5 + 6 + 8) plus Bulldoze.
- New tools: Roundabout, Traffic light; Bungalow, Suburban, Big house; Fountain, Corner shop, Church, Supermarket, Pool; Bush; Hedge, Planter, Bench, Barbecue, Swing.
- Renamed ids: `tree-a/b/c` → `oak` / `pine` / `birch`, `townhouse-a/b/c` → `cottage` / `townhouse` / `family-home`, `fence-small` → `fence-low`. The family home's type-c variant moved to Suburban.
- `ObjectDef.statGroup` became `group` (`road | street | home | outbuilding | amenity | tree | plant | garden`), which also drives FX classes and tree jitter. `TownStats` gained `amenities`.
- Tool icons are `public/assets/icons/tool-<id>.png` (33, all rendered by `scripts/render-icons.mjs`). The 44 old icons were deleted.

**Roads**
- The roundabout is a road-feature object (see decisions). Cars circle its island counter-clockwise on `lanePaths.ringPath`.
- The crossroad tile is `road-crossroad-path` (zebra crossings on all four arms).

**Assets**
- New Kenney pieces: roads roundabout, traffic lights and zebra crossroad; suburban type-d/-i/-m/-n/-o/-s/-u and planter; commercial `building-e` (new `models/commercial/` folder); platformer hedge; Fantasy Town fountains and commercial parasols (composed fountain and pool).
- Poly Pizza models, normalised by the new "normalised recipes" in `scripts/compose-models.mjs` (sources in `assets-src/polypizza/`): church, swing and barbecue (CC-BY 3.0), corner shop (KayKit, CC0). The in-game Credits panel credits them.
- Payload: 3.58 MB of models (64 GLBs) + 259 KB of icons (33 PNGs).

**Save, tests, demo towns**
- Save v3 with no migrations (see decisions). `parseSave` drops road features that are unaligned or not on road.
- New test hook `setCameraPose(pose)`; `grid.anchorForPointer` has a `snap` parameter.
- The sample town uses all 33 placing tools (stats: homes 8, residents 25, amenities 5, trees 5, roadTiles 40, props 15, fences 27). The asset gallery shows all 25 object kinds. The stress town places Suburban homes instead of family homes.

**Budget (dev-server inspector, stress-town, v0.3 working tree, 2026-09-27)**
- Desktop 32 draw calls, 306.1k triangles; mobile 32 calls, **239.1k** triangles (v0.2: 243.5k). Budget 250k mobile.
- The crossroad now costs 276 triangles instead of 116, but the stress town's lots now hold Suburban homes (800–1 330 triangles) instead of family homes (1 731).
- Evidence (local, gitignored): `artifacts/v03/stress-mobile4/`, `artifacts/v03/stress-desk4/`.

**Rejected options** (from the 2026-09-27 asset research): Poly Pizza pools (heavy textures; the Kenney basin is used), `bbq-gas-grill`, `church-dark-roof` / `church-small-steeple`, `swing-set-sandpit` (anonymous author), the Kenney Mini Market / Survival / Graveyard kits (not needed), and the platformer `plant` as the bush (reads as birds from above).

## Decisions log
- 2026-09-26 — **Sandbox**: no fail state and no economy, per the user's brief. The core loop is place → feedback → grow, and undo makes mistakes free.
- 2026-09-26 — **Assets: Kenney CC0 kits** (City Roads/Suburban/Industrial, Platformer, Fantasy Town, Holiday, Car) for one consistent style.
  - The Nature Kit was rejected: metallic materials and a clashing palette.
  - The bus stop, postbox, fences and garage were composed from Kenney parts.
  - SFX come from Kenney CC0 audio packs, transcoded to MP3.
- 2026-09-26 — **Grid (v0.1)**: 24 × 24 plot, 1 world unit per cell, three layers (ground / object / edge). Fences live on edges. Superseded by WP-12, below.
- 2026-09-26 — **No physics engine**; instanced rendering. Vitest for pure logic, Playwright (full Chromium, 1 worker) for the browser.
- 2026-09-26 — **Two RNG streams**: gameplay (`Game.rng`) and cosmetic (`Game.fxRng`: audio, fx, cars), so a sound never changes the next house variant.
- 2026-09-26 (M1) — A bus stop may stay after its road is repainted away. It's a sandbox, and the rule table doesn't cover the case.
- 2026-09-26 (WP-03 fix2) — The 17 tool icons (33 since v0.3, named `tool-<id>.png`) are rendered in-project from the in-game models: `scripts/render-icons.mjs` + `src/render/IconStudio.ts`, 128 px, CC0.
- 2026-09-26 (WP-09b) — Visual baselines are committed for **darwin only**, and a missing baseline **fails**.
- 2026-09-26 (WP-10) — The dusk toggle was skipped (optional; it needed hooks in WP-03/04/06 files).
- 2026-09-26 (WP-11) — Release settings:
  - relative `base: './'`;
  - `sourcemap: 'hidden'` (don't deploy `*.map`);
  - test hooks **stay in production** but must have no side effects on install (policy in `docs/release.md`);
  - diagnostics shim globals removed.
- 2026-09-26 — **CSS minify**: WP-11 turned it off because lightningcss drops `translate:` next to `transform:`. WP-06 fix2 removed that combination from `.ui-hint`, and it was turned back **on** in `f813b04`. Rule: never combine `translate:` and `transform:` in one CSS rule.
- 2026-09-26 (process) — Copy `artifacts/<wp>/` into the main checkout **before** `git worktree remove --force`. Removing the wp-07 worktree deleted its gitignored audio recording (`playtest-audio.wav`), which can't be recovered.
- 2026-09-27 (v0.2) — **Grid 48 × 48 at `CELL_SIZE` 0.5**. The plot stays 24 × 24 world units, so camera, terrain, decor ring and budgets stay valid. Toy scale: 1 unit ≈ 8 m.
- 2026-09-27 — **Roads are aligned 2 × 2 blocks.** One Kenney tile covers a block, and a block is all road or no road. Cars drive on the 24 × 24 block grid, and `stats.roadTiles` counts blocks.
- 2026-09-27 — **Multi-cell footprints**: cottage and family home 3×3, townhouse 2×3, garage 1×2, bus stop 2×1, everything else 1×1. The footprint centres on the pointer (`anchorForPointer`), and R rotates it.
- 2026-09-27 — **Save `SavedTownV2`** with `SAVE_MIGRATIONS[1]` (v1 → v2). The storage key `tiny-town:save:v1` stays; it's a slot name.
- 2026-09-27 — **Music is streamed**: an `HTMLAudioElement` → `MediaElementAudioSourceNode`, with `src` set only on the first Start/Continue, so the track is not part of the initial download.
  - Settings `music` / `musicVolume`.
  - Events `intent:set-music`, `intent:set-music-volume`, `music:changed` are in `events.ts`; the temporary `musicEvents.ts` is gone.
- 2026-09-27 — **Stats pill removed** as redundant. `TownState.stats()`, `town:stats` and diagnostics `town` remain for tests.
- 2026-09-27 — **Owner-supplied assets are allowed.** The background music "Foundation of Gold" was created by the owner with ElevenLabs. Agents still never call generation services.
- 2026-09-27 (v0.3) — **Dock categories answer "what am I building?"**: Streets (the road network and kerb furniture), Homes (where people live, plus garages), Town (shops and shared civic places), Nature (things that grow: ground cover, trees, bushes), Garden (things people build in a yard or park: paths, hedges, fences, furniture). Inside a category: surfaces → lines → objects. At most 9 tools per category, so every tool has a digit; Shift+1–5 switch category. Ids name what a thing is, not its model file.
- 2026-09-27 (v0.3) — **Roundabouts are road-feature objects**, not a road-tile piece. Auto-tiling only picks straights, corners, tees, crossroads and ends, and a roundabout spans 3 × 3 blocks. So it is an object with `ObjectDef.roadFeature`: block-aligned anchor, placing paints its footprint to road, bulldozing turns it back to field, and its road can't be repainted while it stands. The renderer draws its model instead of the tiles; roads join it only at its four arms; cars use the arms and the centre (ring path), not the corners.
- 2026-09-27 (v0.3) — **CC-BY models are allowed with credits**, and the first ones shipped: the Poly Pizza church, swing and barbecue (CC-BY 3.0). Each has an attribution line in `CREDITS.md`, `composed/License.txt` and the in-game Credits panel. Poly Pizza models are normalised to the Kenney look (game-unit scale, metalness 0, roughness 1).
- 2026-09-27 (v0.3) — **Save v3 without migration.** The owner asked for no backward compatibility, so the v1 → v2 migration, its test and fixtures were deleted. A v1/v2 save is rejected and the game starts a fresh town. The `SAVE_MIGRATIONS` hook stays for later.
- 2026-09-27 (v0.3 plan) — **Day/night cycle (WP-16)**, owner-approved. It ships in v0.3 with WP-15, per the owner's version naming (an earlier draft said v0.4):
  - A 10-minute day with 25% night; cosy "blue hour" darkness, not black.
  - Auto / Day / Night toggle, saved as a setting. The time of day is not saved; Auto starts in the morning.
  - Lights are emissive masks on the Kenney swatch atlases (window glass is one swatch in all 12 suburban houses and the supermarket), plus instanced additive lamp pools. No real point lights.
  - Every existing test state is pinned to afternoon, so the current baselines must not change.
  - Details: `docs/plans/wp-16-day-night.md`.
- 2026-09-28 — **Plot 64 × 64 cells** (32 × 32 world units, `CELL_SIZE` still 0.5), owner request after WP-17's bigger buildings. The default camera keeps the v0.2 zoom (plot corners start just off-screen); world-space tunables (grid fade, title orbit, decor belt, night fog) scaled with the plot. A smaller (48 × 48) save loads centred on the plot, so no save version bump. The 48 × 48 sample town and asset gallery are shifted by `demoOffset()` (8 cells) to the centre. The mobile stress-town triangle budget went 250k → 320k (owner decision; the full town is 1.78× the area). Gates (working tree, 2026-09-28): `npm run verify` green (21 files, 399 unit tests, build OK); `npm run test:e2e` 108 tests, 91 passed + 14 skipped, the 3 `life.spec.ts` failures re-mapped (sample-town cells + `demoOffset`) and green on re-run; all 8 darwin visual baselines regenerated.
- 2026-09-28 — **Junction centre lines and a Zebra crossing tool** (owner request). Tees and crossroads draw their centre lines meeting (`road-intersection-line`, `road-crossroad-line`); the plain tee left a blank patch, and v0.3's automatic crossroad zebras are gone. Zebras are a new Streets tool (34 placing tools; Streets 1–8): a block-aligned road marking (`ObjectDef.roadMarking`) on a straight, tee or cross; the road tile under it draws `road-crossing` / `road-intersection-path` / `road-crossroad-path`. Bulldozing it leaves the road; traffic ignores it. The sample town has one on the main street, the asset gallery one on mask 5.
- 2026-09-28 — **Night grid colours**: the lines blend from white to a dim moon blue at night, the night boost is 0.25 (was 0.6), and the grid shader takes the scene fog and output colour conversion, so it sits in the night scene like it does on the day lawn.
- 2026-09-29 — **Name your town (WP-20)**, owner request. The name belongs to the town (the save's optional `name`, no version bump; unnamed = "Tiny Town"), not to the settings. It is asked before every new town (the destructive confirm stays a separate step), never on Continue; renames come from the top-left pill or the menu, are autosaved and not undoable. Suggestions come from the owner's `public/data/default_town_names.json` (fetched, not bundled) through a per-load seeded stream (`seed()` pins it), the one exception to the fixed-seed rule. The title and loading screens keep the game's logo. The photo file name uses the town's slug (a small addition the owner may drop).
- 2026-09-29 — **Town files (WP-21)**, owner request: download the town as `<slug>-YYYY-MM-DD-HHMM.tinytown.json` and open it again anywhere, with a confirm before replacing. Owner picks: on phones the actions sit in the Menu (a seventh top-bar button doesn't fit one row), and the title gets an "Open a town file" link. An opened town is saved at once and isn't undoable. **Format promise:** save-format bumps used to ship without migrations; with towns living in files, a future bump must add a `SAVE_MIGRATIONS` step or old files stop opening.
- 2026-09-29 — **three.js in a vendor chunk** (WP-20): the fix for the 900 kB main-chunk warning, instead of the lazy `lil-gui` import.
- 2026-09-28 — **Town photo (WP-19)**, owner request: a camera at the top right saves the town as a framed picture. Owner picks: what's on screen (not an auto-framed "whole town" shot), a Polaroid with the title, the date and a sun/moon icon (**no homes/residents line, no time-of-day words**), and a preview with Download only (Share removed after review). The photo is rendered to the game canvas at a raised pixel ratio and copied in the same task, not rendered off-screen, so tone mapping and colours match the screen. No shutter sound until the owner supplies or approves one.
- 2026-09-28 — **Music resumes where it left off (WP-18)**, owner request: short sessions kept hearing only the intro. The position `{ track, time }` has its own key, `tiny-town:music:v1`, not the settings, because it is throwaway data written often. The seek happens on `loadedmetadata`, not through a `#t=` media fragment: it is simpler, and it can't change how the loop wraps. The end guard uses the real `duration`, so no track length is stored.
- 2026-09-27 (v0.3) — **Crossroad tile markings done**: the crossroad uses `road-crossroad-path` (zebra crossings), checked against the mobile triangle budget. Removed from the backlog.

## Open issues
**Mobile budget**
- 64 × 64 plot: the stress town is 291.3k triangles on mobile (Pixel 7 emulation, dev server, 2026-09-28), headroom ~29k under the new 320k budget. Any new content with a large triangle count needs a budget check.

**Touch precision**
- At the default phone pose a cell is about 10.6 px, so small props need a pinch-zoom on touch.

**Release measurements**
- v0.3 (package 0.3.0) was re-measured on the production preview on 2026-09-27 (`docs/release.md` §Budgets; evidence in `artifacts/v03-release/`). Every budget is met.
- The main JS chunk was 887 kB (v0.3) and 898 kB (v0.4). WP-20 split three.js into its own chunk: main 264 kB + `three` 642 kB, so the 900 kB warning is far off (the release table in `docs/release.md` still shows the v0.4 numbers).
- The sample town uses 28 of 30 textures.

**Audio**
- No human has listened to the SFX or the music.
- The WP-07 recording is lost. The WP-13 listen captures exist locally in `artifacts/wp-13/`.

**Tests and platforms**
- **Phone emulation is flaky here** (seen 2026-09-28, WP-19): Pixel 7 emulation in full Chromium sometimes starts a page without touch (`(pointer: coarse)` false, `maxTouchPoints` 0), even on a static SVG. The game then picks the **high** tier and the mouse hint. The run is otherwise green, and a baseline regenerated in that state looks subtly wrong (decor hedges at the top, the "click the map" hint). Always masked-diff a regenerated mobile baseline against the old one; regenerate again if anything outside the expected area changed. One of the 6 WP-19 baselines needed 3 tries; after the WP-19 merge (on top of tall trees), asset-gallery mobile needed 4 and night-town mobile 10. It hits single-test runs in a fresh browser most, so regenerate one baseline at a time in a retry loop with the masked diff as the check.
- In the first full e2e run of WP-19, both dev servers (the test server and a manual one) died together about 1 min into the bot playtest, and every later test failed with `ERR_CONNECTION_REFUSED`. The re-runs were clean. Cause unknown; it looked environmental.
- The visual baselines are darwin only; a Linux CI job would fail until it commits its own set.
- Not tested on real iOS or Android devices.

**Asset manifest**
- `docs/assets/models.json` is hand-maintained. Don't write `inspect:models --json` over it (see `CLAUDE.md`).

**Module constraint**
- `tests/helpers.ts` imports `UI_TEST_IDS` via `src/ui/UiRoot.ts` in Node. `UiRoot.ts` must stay free of CSS and asset side effects; the ids live in `src/ui/testIds.ts`.

**Stale code comments** (owners, when they next touch these files)
- The `events.ts`, `UiRoot.ts` and `types.ts` comments listed here before were fixed in `0e760b5`.

**v0.3 before release**
- Done 2026-09-27: production-preview measurements (all budgets met) and `package.json` 0.3.0.
- `models.md`'s screenshots are from sourcing time (44 models); the `asset-gallery` state is the current visual record.

## Backlog (post-v1 from the M3 review, WP-11, and v0.2)
- Houses auto-face an adjacent road.
- Tall portrait screens leave dead space between the plot and the dock, and the mobile title crops the plot. Re-check both after the WP-12 framing change.
- Fade the hint while zoomed in.
- Optional performance work (budgets are already met):
  - `shadowMap.autoUpdate = false`, with cars not casting shadows (−17% GPU);
  - lazy `lil-gui` import (−30 kB);
  - reuse the diagnostics object instead of rebuilding it every frame;
  - `compileAsync` warm-up for the first-placement hitch.
- ~~Dusk mode (the WP-10 stretch goal).~~ Superseded by the WP-16 day/night cycle (v0.3).
- Day/night follow-ups:
  - night crickets ambience (needs an owner-supplied or CC0 sound);
  - traffic-light colour cycling;
  - corner-shop windows (hand-made mask);
  - lamplight on walls and cars (a uniform array of lamp positions);
  - tune the sunset/sunrise frames (t ≈ 0.70 / 0.05);
  - maybe a lighter night grid boost (0.3–0.4 instead of 0.6).
- Town photo follow-ups (WP-19):
  - a shutter sound (needs an owner-supplied or CC0 sound);
  - an auto-framed "postcard of the whole town" option, since on phones the view shows only part of the plot;
  - more frames (postcard with a stamp, washi-tape corners in the file itself);
  - hide the placement dust and cars on request ("tidy photo").
- A human ear pass on SFX and music.
- Linux baselines, if CI is added.
- Real-device testing.
- Optional: expand the plot. `PLOT_WIDTH/DEPTH` keep this cheap.

## Next actions
1. v0.3 is measured and versioned (0.3.0). What's left is the deploy itself (`docs/release.md` §Build and deploy) and, if wanted, a release tag.
2. For the next iteration, open a new WP section in `docs/PLAN.md`. Take ports from 5218 up and follow the `docs/HANDOVER.md` runbook with an integration branch.

### Tall trees as built (merged from branch `tall-trees`)
An owner request: taller trees that still take one tile. Done directly by the integrator, not a numbered WP.
- **Design history:** the first cut gave oak, pine and birch three player-picked height tiers (H key, Height button, an optional `PlacedObject.height`). The owner reviewed it and simplified: **no player choice, one fixed height per species.** That machinery was removed again.
- **Result:** `ObjectDef.height`: pine ×2, birch natural. A second review found the ×1.7 oak read as a tall slab that did not fill its cell (measured: the crown body is ~90 % of a 0.5 cell and tapers), so the owner asked for the **oak to take a 2 × 2 cell lot** instead: footprint `[2, 2]`, model scale 0.45 → 0.9 (about 0.98 × 1.74 × 1.0), no stretch. Nothing in rules, `PlacedObject`, save (still v4) or UI changed. Existing saves keep their oaks' anchors, so oaks that now overlap are dropped on load (owner-approved, no migration).
- **Drawing:** `TownRenderer` and the ghost stretch Y only. `windSway.ts` measures height along the model's Y axis and bends at half rate above 1 unit (natural trees unchanged; the bush's bend gets a little smaller because its Y is squashed). The oak and pine tool icons were re-rendered (`render-icons.mjs` also nudges ten unrelated icons on every run, so only these two were kept), and the sample-town, asset-gallery and night-town baselines regenerated.
- **Known trade-offs:** a tall tree hides about 1.3 × its height of the view behind it; the heights are one constant each in `catalog/objects.ts` (`OAK_HEIGHT`, `PINE_HEIGHT`).
