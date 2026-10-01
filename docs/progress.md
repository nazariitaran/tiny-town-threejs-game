# Tiny Town — progress (integrator-maintained)

Only the integrator (WP-01) edits this file. Workers report in their hand-off. This is the recovery point: after any interruption, re-read it together with `docs/HANDOVER.md`.

## Current state (2026-09-30)
- **Version: v0.5 cut on `main`** (2026-09-30, package 0.5.0; the owner tagged `v0.5` on the WP-24 + WP-25 merge `b1395e1`; not deployed). v0.5 = everything after `v0.4`. Player-facing notes: `CHANGELOG.md`.
  - **WP-20**: name your town;
  - **WP-21**: download and open a town file;
  - **WP-22**: birds over the town;
  - **WP-23**: new build items, garage removed (40 placing tools);
  - **WP-24**: frame budget (60 / 30 fps caps, sun shadow map on demand, car shadows 30 Hz);
  - **WP-25**: graphics presets Low / Medium / High (Low render scale on DPR-1 screens) and the tabbed menu.
  - Save format unchanged (v4), so v0.4 saves and town files open as they are.
  - Gates on `main` at `b1395e1` (package 0.5.0): `npm run verify` green (30 files, 529 unit tests, build OK); e2e against the production preview: 198 tests, 176 passed, 22 skipped by design, 0 failed. Production-preview measurements and release checks: `docs/release.md` (v0.5 column).
  - **Open at release:** the mobile triangle budget on Medium (WP-25 owner decision, below). The v0.5 preview measured 328.3k on the stress town (Pixel 7 emulation, 412 × 915).
- **v0.4** (2026-09-28, package 0.4.0, tag `v0.4`). v0.4 = everything after `v0.3`:
  - **WP-17**: bigger homes and town buildings, smaller swing, only homes glow at night, save v4;
  - **the 64 × 64 plot** (`c5440ff`), with the night-grid colours, plain junction centre lines, the Zebra crossing tool and right-click deselect;
  - **WP-18**: music resumes where it left off;
  - **tall trees**: taller pine, big 2 × 2 oak;
  - **WP-19**: the town photo.
  - Gates on `main` after the WP-19 merge (`f72a8bd`): `npm run verify` green (23 files, 442 unit tests, build OK); `npm run test:e2e` 134 tests, 116 passed, 18 skipped by design, 0 failed (7.5 min). Production-preview measurements and release checks: `docs/release.md` (v0.4 column).
- **v0.3** (tag `v0.3`). v0.3 = WP-15 (new building blocks, `2e4604f`) + WP-16 (day/night, integration branch `v0.3-day-night`, owner-approved and merged into `main` 2026-09-27). v0.2's integration commit is `4ee0741`.
- **v0.1** is the M3 "v1" build at `e955d5d`. v0.2 adds three owner requests on top:
  - **WP-12**: 48 × 48 grid of 0.5-unit cells, roads as 2 × 2 blocks, multi-cell houses, save v2 with a v1 → v2 migration.
  - **WP-13**: streamed background music with settings.
  - **WP-14**: the stats pill is gone; the top bar is one row.
- **Gates on `main` (2026-09-27):**
  - `npm run verify` is green: 19 test files, 294 unit tests, build OK.
  - `npm run test:e2e`: 82 tests, of which 70 pass and 12 are skipped by design (desktop-only or mobile-only).
  - The 6 visual baselines (darwin) were regenerated after WP-12 (`4ee0741`).
- **WP-15 gates on `main` (`2e4604f`, 2026-09-27 WP-16 preflight):**
  - `npm run verify` is green: 18 files, 336 unit tests, build OK.
  - `npm run test:e2e`: 70 passed, 12 skipped, 4 failed in one full run (19 min). The failures were browser-launch/test timeouts, texture-load errors under load, and a music-time check. All 4 passed when re-run in isolation (twice).
- **WP-16 day/night is complete:** the owner approved it on 2026-09-27 and `v0.3-day-night` is merged into `main`. See "WP-16 as built" below.
  - Gates on the branch after all merges (2026-09-27): `npm run verify` green (21 files, 387 unit tests, build OK); `npm run test:e2e` green: 114 tests, 100 passed, 14 skipped by design, 0 failed (6.1 min).
  - Worktrees `wp-16a/b/c` removed after their evidence was copied to `artifacts/wp-16a/`, `wp-16b/`, `wp-16c/`.
- **WP-17 is merged into `main`** (owner-approved; integration branch `building-sizes`; part of v0.4): bigger buildings, smaller swing, dark shops at night. See "WP-17 as built".
- **Tall trees are merged into `main`** (owner-approved, no version tag; built on the branch `tall-trees`): pine ×2 taller (still 1 × 1), birch unchanged, and the oak now a big 2 × 2 tree at natural proportions (fixed per species, no player control). See "Tall trees as built".
- **WP-19 Town photo is merged into `main`** (owner-approved 2026-09-28, after two amendments; built on the branch `wp-19-photo`, branched from `abae251`): a top-bar camera / `P` saves the current view as a Polaroid JPEG, via a preview with Download. See "WP-19 as built".
- **WP-20 Name your town is merged into `main`** (owner-approved 2026-09-29 after one amendment: no note under the dialog heading; built on the branch `wp-20-town-name` from `eaef139`); part of v0.5. See "WP-20 as built".
- **WP-21 Town file is merged into `main`** (owner-approved 2026-09-29 with all planning decisions, including the save-format migration promise; built on the branch `wp-21-town-file` from `aab1865`; part of v0.5). See "WP-21 as built".
- **WP-23 New build items is merged into `main`** (owner-approved 2026-09-29; built on the branch `wp-23-new-items` from `493635d`, with `main` merged in after WP-22): 7 new tools (the gate was removed at review), the garage removed, up to 12 tools per category; part of v0.5. See "WP-23 as built".
- **WP-24 Frame budget and WP-25 Graphics settings + tabbed menu are merged on `main`** (owner-approved 2026-09-30; built on the branch `wp-24-frame-budget`; part of v0.5). WP-25 leaves one open owner decision: the mobile triangle budget (Medium: 324.1k on the WP-25 dev server, 328.3k on the v0.5 production preview, vs 320k). See "WP-25 as built" and "WP-24 as built".
- **Code-review cleanup is merged on `main`** (owner-approved 2026-09-30, merge `19b1e36`; built on the branch `code-review-cleanup` from `2f3ecf8`; no version bump). No behaviour change for players:
  - architecture banner current for v0.5; mobile triangle numbers say which build measured them;
  - dead code removed (`utils/dispose.ts`, `SFX_EVENTS`, `GlyphId`, `footprintOf`), same-file-only helpers unexported;
  - `__THREE_GAME_DIAGNOSTICS__` is a getter built on read (no per-frame cost); test hooks no longer re-publish;
  - tests: `ui.spec.ts` uses `helpers.trackErrors`, `UI_TEST_IDS` imported from `ui/testIds.ts` (no longer re-exported by `UiRoot`), one Node GLTF loader `src/testing/gltfNode.ts`;
  - `render/roadTiles.ts` → `town/roadTiles.ts` (ends the catalog ↔ render import cycle); `MODEL_STYLES` → `render/modelStyles.ts`;
  - `ShadowScheduler`: cars + birds together use the faster rate (both 30 Hz today).
  - Gates on the branch: `npm run verify` green (30 files, 530 unit tests, build OK, main chunk 298.3 kB); `npm run test:e2e` (dev server) 198 tests, 176 passed, 22 skipped by design, 0 failed (11.4 min).
- **Zebra crossing ghost is merged on `main`** (owner request, owner-approved 2026-09-30, merge `9673508`; branch `zebra-ghost` from `2f3ecf8`; no version bump). The ghost used to be a translucent mint copy of the road piece under a mint fill, z-fighting with the road and washing out the stripes. A road marking now uses the solid ground-ghost look (the marked road tile in its real colours, no fill inside the frame; invalid keeps its red fill), and solid ghosts get a polygon offset in every state (also the road tool over a road and bulldoze over a zebra). Not done: the ghost's road atlas isn't warmed like the town's, so its kerbs stay slightly bluish (the road tool's ghost has always looked like this).
  - Gates: `npm run verify` green on `main` after both merges (30 files, 530 unit tests, build OK); on the branch, `interaction`, `build-flow`, `new-items`, `visual`, `visual-regression` and `bot-playtest` e2e: 34 tests, 29 passed, 5 skipped by design, 0 failed.
  - Owner question checked the same day: "houses are turned 180°". Not reproduced: at rotation 0 every home's front (door, porch, planters) faces +z, towards the default camera; ghost, placed model, dock icon and demo towns agree. Note: the tool rotation (R) is shared by all tools and kept until a reload, so a new house can start turned if R was pressed for another item.
- **Owner polish batch is merged on `main`** (owner-approved 2026-09-30; no version bump). Merges `c51d9c0` (branch `polish-favicon-credits`) and `7216b66` (branch `catalog-tweaks`, stacked on it):
  - favicon (`public/favicon.svg` / `.ico` / `apple-touch-icon.png`); tagline "Build your own cosy dream town" (the owner dropped the full stop in `921a8bd`; the title baselines still show it, within the 1% tolerance);
  - Credits panel grouped (3D models / Sound effects / Music / Font / Software) with source and licence links; `public/licenses.txt` generated by `npm run gen:licenses`, checked by `verify`;
  - dock: the tab row is centred; Rotate only on touch screens (R / Shift+R elsewhere);
  - catalog: Streets = road network (5); mailbox → Homes; bus stop, postbox, lamppost → Town; **Fountain and Garden path retired** (`RETIRED_TOOLS`: out of the dock, kinds still load, draw and bulldoze); wildflowers on the grass lawn colour;
  - day/night: Auto phases at their own speeds (`PHASE_SPANS`): dawn 1, day 5, dusk 1, night 2 minutes (9 in all, was an even 10);
  - lamppost light nearer the arm's tip (`lampOutset` 0.03) and no halo above the lamp.
  - Gates: `npm run verify` green on `main` after both merges (30 files, 532 unit tests, build OK). On the branches: full e2e on `catalog-tweaks` before its test fixes, then the failing specs re-run green (ui, new-items, build-flow, interaction, bot-playtest, daynight, visual-regression, photo, graphics); one desktop bot-playtest failure was a one-off dev-server page reload and passed on re-run.
- **Two owner requests are merged on `main`** (owner-approved 2026-10-01; no version bump):
  - **Reset view button removed** (merge `3827323`, branch `remove-reset-view`, commit `e799574`): Menu → Help is now Controls · Credits; the `btn-reset-view` id and the unused `camera` glyph are gone. F / Home still reset the camera (`intent:reset-camera`). Touch screens now have no reset; the owner accepted this, and a gesture (e.g. a two-finger double-tap) could add one later.
  - **Homes on pavement** (merge `e2da770`, branch `homes-on-pavement`, commit `31d7ab8`): all six homes use `PAVED_OK` (field, grass, meadow, pavement), like the shops, the church and the trees; garden path is still refused. No save change.
  - Gates: `npm run verify` green on `main` after both merges (30 files, 532 unit tests, build OK). On the branches: `menu-tabs` e2e (9 passed, 1 skipped by design) and a one-off desktop check that a Cottage and a Big house place on painted pavement with no console errors.
- **Trees and bushes off pavement** (owner request 2026-10-01; merge `f949a71`, branch `trees-off-pavement`, commit `b1654c2`; no version bump): oak, pine, birch and bush use `OPEN_GROUND` (field, grass, meadow), like tulips; pavement can't be painted under them. `PAVED_OK` is now the homes, shops and church. The demo towns had no trees on pavement and still build with zero rejections. Old saves and town files are not fixed up: the loader drops a tree or bush standing on pavement (owner: the app isn't live, so no migration).
  - Gates on the branch (it carries the two changes above too): `npm run verify` green (30 files, 532 unit tests, build OK); full `npm run test:e2e` incl. the visual baselines: 198 tests, 176 passed, 22 skipped by design, 0 failed (11.5 min).
- **Bulldoze highlight matches the object** (owner request 2026-10-01; merge `c68c6d0`, branch `bulldoze-highlight`, commit `fcba470`; no version bump; plan `docs/plans/bulldoze-highlight.md`). The red bulldoze ghost was a 1.08 × translucent copy built apart from the renderer: it missed the `MODEL_STYLES` scales (bush ~1.9 × too tall, fences too short, lamppost hidden inside its pole), the trees' hashed yaw/size and wind sway, and its tint was multiplied by the colour atlas into brown on green roofs and leaves. Now `render/objectPose.ts` is the one definition of an object's / edge's pose and style scale (TownRenderer and the ghost both use it; the placement previews of bush, fences, lamppost and pavement are fixed too); the remove ghost lies exactly on the object with a polygon offset (paints only its visible surfaces), sways with foliage, and red states recolour after the atlas in the shader (`uGhostRecolor` 0.88; remove opacity 0.9). Not done: the tall fence's mint placement preview stays brown (the ghost ignores `MODEL_STYLES.color`).
  - Gates: `npm run verify` green on `main` after the merge (32 files, 544 unit tests, build OK; new: ghost = renderer for every object kind × variant × rotation and every edge kind). On the branch, e2e `interaction`, `build-flow`, `fx`, `ui`, `bot-playtest`, `visual`, `visual-regression`: 47 passed, 10 skipped by design, 1 failed (desktop bot playtest; its error text was not kept) that then passed twice in isolation with no console errors. Before/after gallery captures (every object; wind; Low preset; placement previews): `artifacts/bulldoze-highlight/`.
- **Move tool** (owner request 2026-10-01; merge `2776525`, branch `move-objects`, commit `4573f42`; no version bump; plan `docs/plans/move-objects.md`). A dock mode button (M) between Rotate and Bulldoze: click (tap) a placed object to pick it up (it stays sky blue in place, a mint / red ghost follows the pointer, R turns it except trees and plants), click (tap) where it goes to put it down: one undo entry (`move-object` = [remove, add] with the same id and variant, so no save change), the item's own sound and dust, and a 0.3 s slide-and-hop (`TownRenderer`: same-id remove + add = a move tween; also on undo/redo). Esc / right-click put it back. Roundabout and zebra crossings don't move ("{label} can't be moved"); ground, hedges and fences never do. The placing checks are one helper shared with place-object (`rules.checkObjectSpot`), ignoring the object's own old footprint. Phone dock: buttons sized by label with a 44 px minimum; **below 390 px two rows** (categories, then Rotate · Move · Bulldoze; owner choice), so `ui.spec` keeps 44 px targets at 360 px. Desktop visual baselines regenerated (only the dock changed). Not done: the dust puff starts as the hop starts; at night a moved lamppost's light jumps before the post lands.
  - Gates: `npm run verify` green on `main` after the merge (32 files, 557 unit tests, build OK). On the branch: full `npm run test:e2e` 204 tests, 180 passed, 24 skipped by design, 0 failed (12.0 min), incl. the new `tests/move.spec.ts` (desktop + mobile, real input; positions read back from the autosave). Evidence: `artifacts/move-objects/`.
- **Variant picker** (owner request 2026-10-01; merge `0e666f8`, branch `variant-picker`, commits `755d567` + `a22ed4f`; no version bump; plan `docs/plans/variant-picker.md`). Before, the place ghost always drew a kind's first model while the click rolled one at random (wrong 50–75 % of the time for the seven multi-model kinds). Now, selecting Townhouse, Bungalow, Suburban, Big house, Traffic light, Birch or Tulips opens a strip of icon-only style chips over its card (`UiRoot.renderVariants` / `placeVariants`; outside the scrolling tray, `pointer-events: auto`). The ghost shows the chosen model, and every placement builds it: `place-object` has an optional `variant`, and `ToolController` passes its per-tool choice (session only, model 0 until picked). `V` / `Shift+V` cycle. Cards with several models show one dot per model, and the selected card shows the chosen model's icon. 10 new icons `tool-<id>-v<n>.png` (IconStudio renders every model). **No random option** (owner review: "player will always choose"; the first build's Mix chip was removed). No save change; demo towns send no variant and still roll as before. Events `intent:select-variant`; `tool:changed.variant`; diagnostics `variant {choice, count}`. `CHANGELOG.md` gained an **Unreleased** section backfilling everything since v0.5 (Move included).
  - Gates on the branch after the Mix removal: `npm run verify` green (32 files, 560 unit tests, build OK); full `npm run test:e2e` 210 tests, 185 passed, 25 skipped by design, 0 failed (12.4 min), incl. the new `tests/variants.spec.ts` (desktop + mobile; built variants read back from the autosave; phone strip at 390 and 360 px). Screenshot baselines unchanged (the card dots stay within tolerance). Evidence: `artifacts/variant-picker/`.
- **Game moved to the repo root** (owner decision 2026-10-01: this repo is Tiny Town only; merge `b5c34a1`, branch `repo-root`, commit `4486ad5`; no version bump). Everything in `tiny-town/` moved up one level as git renames (`git log --follow` and every quoted hash still work); the folders git doesn't track (`assets-src/`, `artifacts/`, `node_modules/`, `dist/`, `test-results/`) were moved by hand, and `assets-src` and `artifacts` were checked file-for-file. One `.gitignore` at the root. `CLAUDE.md` and `HANDOVER.md` (worktree, merge and checkpoint steps) use root paths: no more `cd tiny-town`, skills at `.claude/skills/`, npm cache `.npm-cache`. Historical plans, checkpoints and older progress entries keep their `tiny-town/` paths. Not done (optional, owner): renaming the repo folder `ThreeJsGames`.
  - Gates from the root: `npm run verify` green (32 files, 560 unit tests, build OK; `package-lock.json` unchanged); full `npm run test:e2e` 210 tests, 185 passed, 25 skipped by design, 0 failed (12.4 min).
- **Where current facts live:**
  - grid, rules, save, modules, diagnostics and budgets: `docs/design/03-architecture.md`;
  - asset scales and footprints: `docs/assets/models.md`;
  - release and measured budgets: `docs/release.md`.
- **Local evidence:** `artifacts/` is gitignored. Evidence cited below exists only in the main checkout.

## Work packages
The SHA is the merge commit on `main`; the WP's own commit is in brackets. Every worktree has been removed and every WP branch merged and deleted.

| WP | Title | Status | Merge (commit) | Notes |
| --- | --- | --- | --- | --- |
| Wave 0 | Scaffold | ✅ | `3c3abd1`, `d48d4db` | walking skeleton, contracts, assets, swarm docs, PORT env |
| M0 | Preflight | ✅ | `59af3fa` | first real-browser run: verify, e2e, inspector m0; no blockers |
| WP-02 | Town logic & persistence | ✅ | `dbc7626` (`0bb5e21`) | rule table, History cap 200, serialize/parseSave, SaveStore, silent applyBatch |
| WP-03 | Rendering | ✅ | `26b7ec1`; fix1 `e687a8d`; fix2 `0227d8c` (`10ee895`) | instanced pools, pop-in, road tiles; fix2 re-rendered the tool icons in-game (`scripts/render-icons.mjs`) |
| WP-04 | World & look | ✅ | `7684585`; fix1 `3e7afe1` | sky, light, diorama terrain, decor ring, shader grid, hedgerow frame |
| WP-05 | Interaction | ✅ | `8f5f3ee`; fix-ups `966e94c`, `ae7561d`, `33361f9`, `944b05e` | camera, tools, ghost, touch; aspect-aware framing (`framing.ts`); visible valid ghost |
| WP-06 | UI | ✅ | `d7522e4`; fix1 `dd052d0`; fix2 `59c4807` | dock, top bar, overlays, mobile; fix2 made the hint centring transform-free so CSS minify could return |
| WP-07 | Audio polish | ✅ | `32edaf5`; fix-ups `be2cffd`, `aa40403` | SFX rebuilt, metal prop clink, stroke pitch rise; shims removed |
| WP-08 | Feel & VFX | ✅ | `8c5676d`; fix1 `2c502d7` | pooled dust/sparkle/poof, wind sway; fix1 soft billboard dust, ≤ 3 FX draw calls |
| WP-09a | QA harness | ✅ | `5ff633f` | smoke + real-input build-flow specs, `tests/helpers.ts` |
| WP-09b | Baselines + bot | ✅ | `f797a58`, `4671877` | seeded bot playtest; 6 darwin baselines; a missing baseline fails |
| WP-10 | Ambient life | ✅ | `0dccaf8`; wired `69e0f53` | ≤ 6 cars (BatchedMesh, +1 main +1 shadow call); dusk toggle not built |
| WP-11 | Release | ✅ | `d03ece2` | relative base, hidden sourcemaps, test-hook policy, measured budgets (`docs/release.md`) |
| M1 / M2 / M3 | Checkpoints | ✅ | `7804563` / `cf6f000` / `e955d5d` | `docs/checkpoints/m1.md`, `m2.md`, `m3.md` (historical) |
| WP-14 | Remove stats pill | ✅ | `88c78f6` (`9ebe044`) | `StatsHud` deleted; one-row top bar (48 px row desktop / 52 px phones); hint 10 px under it |
| WP-13 | Background music | ✅ | `b60fd56` (`7802976`) | `src/audio/MusicPlayer.ts`; streamed after Start; music on/off + volume; −3 dB menu duck |
| WP-12 | Scale & grid density | ✅ | `d4b3058` (plan `3fffe7e`, docs `176e3dd`) | see "WP-12 as built" below |
| WP-15 | New building blocks & categories (v0.3) | ✅ | `2e4604f` (`cac4433`) | see "WP-15 as built" below |
| WP-18 | Music resumes where it left off | ✅ merged to `main` (owner-approved 2026-09-28) | `b31f8f6` (`b6752da`) | `src/audio/musicPosition.ts`; saved on hide / `pagehide` / every 15 s; seek on `loadedmetadata`; 5 s end guard |
| WP-19 | Town photo | ✅ merged to `main` (owner-approved 2026-09-28) | merge on `main` (`87caaa6`, `e9178e8`, `72a79d6`, `ec65d3c`) | `src/photo/**`; camera button / `P` → menu phase → one frame at long edge 2400 px → Polaroid JPEG → preview (Download) |
| WP-24 | Frame budget (performance) | ✅ merged to `main` (owner-approved 2026-09-30) | merge on `main` (`e11081b`; branch `wp-24-frame-budget`) | 60 fps active / 30 fps idle cap (`core/FrameBudget.ts`), sun shadow map on demand (`render/ShadowScheduler.ts`; cars 30 Hz (15 until `8888da3`), birds 30 Hz), desktop DPR 2 → 1.5, `town:stats` removed; diagnostics `perf` |
| WP-25 | Graphics settings (Low / Medium / High) and a tabbed menu | ✅ merged to `main` (owner-approved 2026-09-30) | merge on `main` (via `wp-24-frame-budget`: 25b `97918fb`, 25a `d5ad3ee`, 25c `7cb9c96`; render scale `7dd308d`) | `game/graphics.ts` presets (Medium default everywhere), Lambert + no MSAA on Low (reload), live DPR / shadows / decor / sky / fps / halos, saved setting, `?graphics=`; menu tabs Town · Graphics · Sound · Help; diagnostics `graphics`; mobile baselines re-captured. **Open:** mobile triangles 324.1k (dev) / 328.3k (v0.5 preview) vs 320k |
| WP-22 | Birds over the town | ✅ merged to `main` (owner-approved 2026-09-29) | merge on `main` (`884a508`) | `src/life/FlockSim.ts` (pure) + `BirdSystem.ts`; a flock every 45–110 s (none at night), 4 species, procedural 18-tri bird, flapping shadows; `spawnFlock` hook, `?debug&flock=N` |
| WP-23 | New build items, garage removed | ✅ merged to `main` (owner-approved 2026-09-29) | merge on `main` (`86cdf11`; review amendment on the branch) | 7 new tools (mailbox, tiered fountain, donut shop, tulips, long bench, table, slide; the gate was removed at review), garage removed, pool moved to Garden, ≤ 12 tools per category (digits for the first nine), Nature Kit material fix |
| WP-21 | Download and open a town file | ✅ merged to `main` (owner-approved 2026-09-29) | merge on `main` (`a17c3d7`) | `src/persistence/townFile.ts`; top-bar folder (> 440 px) / Menu → Town file (phones) / title link; `.tinytown.json`; confirm before replacing; saved at once |
| WP-20 | Name your town | ✅ merged to `main` (owner-approved 2026-09-29) | merge on `main` (`691ec28` + amendment) | `src/town/townName.ts`; name dialog before every new town, rename from the top-left pill / menu; saved in `SavedTownV4.name`; photo caption + file name; three.js vendor chunk |
| WP-16 | Day/night cycle (v0.3) | ✅ merged to `main` (owner-approved) | contract `6293a40`, `9d9b84b`; 16a `389cd21` (`e71d78e`); 16b `30cc649` (`743112c`); 16c `2fd1d7f` (`e9919d7`) | see "WP-16 as built" below |

**Integrator (WP-01) commits worth knowing:**

| Commit | Change |
| --- | --- |
| `34e39c7` | Wave-1 contract requests + SaveStore wiring |
| `f2778c3` | Dropped the `tests/*.template.ts` exclude; the templates are gone |
| `577152c` | Diagnostics `hover` carries `valid`/`reason` |
| `b3d3102` | Diagnostics `fx` |
| `69e0f53` | Diagnostics `life` |
| `f06d012` | Removed the `__THREE_GAME_FX_DIAGNOSTICS__` / `__THREE_GAME_LIFE_DIAGNOSTICS__` shim globals |
| `c63886f` | Inspector `--mobile` = the full 390 × 844 viewport |
| `1ece424` | CSS minification back on |
| `18572ed` | Baselines after WP-14; owner-supplied asset rule |
| `4ee0741` | Post-WP-12 integration: `SavedTown` rename in SaveStore (the deprecated `SavedTownV1` alias removed), phone top inset 76, tool icons re-rendered, baselines regenerated |

### WP-12 as built (vs `docs/plans/wp-12-scale.md`)
The plan was approved and implemented. The as-built facts are in `03-architecture.md` §Grid / §Placement rules / §Save format and in `models.md` §Grid and scale. Where the build differs from the plan:

**Migration** (historical: v0.3 deleted the v1 → v2 migration, see WP-15)
- One fallback was added: a house that fits neither as its own kind nor as a 2×3 townhouse tries a townhouse **turned a quarter** either way (3 × 2 fits dense 1-deep v1 rows) before it is dropped.
- A malformed v1 save only has its version bumped, so `parseSave` rejects it with the normal message.
- Results: v0.1 sample town, 0 drops; v0.1 stress town, 36 of 56 homes kept (120 → 100 objects).

**Stress town**
- Trimmed to fit the mobile budget: birch and pine instead of oak, open-field lots and fewer props.
- The decor ring's share on phones (the hidden touch-screen tier, removed in WP-25) went from 0.6 to 0.25.
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
- WP-12 was merged after WP-13/14 (`0d0ef3e` merged main into the WP-12 branch).

### WP-25 as built (branch `wp-24-frame-budget`; vs `docs/plans/wp-25-graphics-and-menu-tabs.md`)
- **Production preview (2026-09-30):** whole-GPU use on the stress town at an emulated 120 Hz goes from 59–73% on `main` to Medium 32–35% active / 18–20% idle, Low 10%, and High 42–45% / 24%. The full table and method are in `docs/release.md` §Budgets.
- **Car shadows 15 → 30 Hz (2026-09-30, owner request):** at 15 Hz a moving car's shadow visibly lagged. Re-measured on the production preview: Medium 33–35% building / 20–21% idle (was 32–35% / 18–20%). `docs/release.md` §Budgets.
- **1080p laptop (DPR 1, 2026-09-30):** Low now renders at 0.75 of the screen's density (`renderScale`; 1440 × 727 on 1080p) and is ~4× cheaper per frame than Medium on a software-GPU stand-in. Medium and High are identical on DPR-1 screens. Table: `docs/release.md` §Budgets.
Owner request (2026-09-30), after the graphics-settings assessment (`~/Desktop/tiny-town-graphics-settings/REPORT.md`). Current facts: `03-architecture.md` §Graphics presets and `02-interaction-and-ui.md` §5.1 Menu tabs. Three parallel parts: **25a** the engine (branch `wp-25a-graphics`), **25b** the tabbed menu (`wp-25b-menu-tabs`), both merged into `wp-24-frame-budget` (`d5ad3ee`), then **25c** integration and QA (`wp-25c-integration`).
- **Built:**
  - Presets Low / Medium / High (`src/game/graphics.ts`), **Medium the default on every device**. The hidden touch-screen tier (`QualityTier`, `MAX_DPR`, `Environment.setQuality`, the low-tier hemisphere boost and quarter decor ring) is gone, so phones now get the desktop look.
  - Boot parts (reload): MSAA from the boot preset (`createRenderer`), and the Lambert material on Low (`render/materials.ts` `toLambert`, applied in ModelLibrary, TownRenderer, terrain, cars, birds and the ghost; shader patches still apply; env lighting still lights Lambert).
  - Live parts (`Game.applyGraphics`): DPR cap, shadow-map size, an evenly spread decor subset (`DecorRing.setFraction`; nearest-first dropped the trees in front of the title camera), sky octaves (a define, one recompile), frame caps, lamp halos.
  - The setting in `tiny-town:settings:v1` (`graphics`, validated); `?graphics=` override (not saved; dropped by Reload now); `intent:set-graphics`, `intent:reload-graphics` (flush + reload), `graphics:changed` (at boot after UiRoot, and after every change).
  - Diagnostics: `quality` = the preset; `graphics` with the real context's `antialias` and the measured `material`.
  - The tabbed menu: Resume above a Town · Graphics · Sound · Help tab bar (WAI-ARIA tabs, roving tabindex, arrows / Home / End), the tab remembered for the page session, Back from a sub-view to the same tab, a steady panel size; the Graphics tab (Quality radios rendered from the fact, the preset's description, the reload notice with Reload now, Show grid). `tests/helpers.ts` `openMenuTab`; every menu-driving spec opens the right tab first.
- **25c integration fixes:**
  - The 25b Graphics-tab test failed on both projects on the merged build. Root cause (test, not product): it read `diagnostics.graphics` right after the click, but diagnostics are published once per frame, so it saw the previous preset while the UI, answered synchronously by `graphics:changed`, already showed Low. It now waits for the engine's answer and requires Low with the reload notice (the no-engine fallback is gone).
  - No product bug was found: `npm run verify` was green on the merged build, and every other e2e test passed (170 passed, 22 skipped, those 2 failed).
- **Measured** (25a probes, `artifacts/wp-25/probes/`: whole-GPU utilisation from `ioreg`, stress town, full Chromium on the real GPU, M2 Max, 1512 × 982 viewport at DPR 2, 120 Hz emulated, 2 rounds; draw calls 33 on every preset):

  | preset | GPU active (medians) | GPU idle | fps active / idle | canvas | triangles | MSAA / material |
  | --- | --- | --- | --- | --- | --- | --- |
  | Low | 8% / 8% | 8% / 8% | 30 / 30 | 1512 × 982 (DPR 1) | 297,542 | off / Lambert |
  | Medium | 32% / 32% | 17% / 18% | 60 / 30 | 2268 × 1473 (DPR 1.5) | 332,314 | on / Standard |
  | High | 42% / 44% | 23% / 23% | 60 / 30 | 3024 × 1964 (DPR 2) | 332,314 | on / Standard |

  The machine idles at 0–1%. For comparison, WP-24 measured 33–36% active and 18–19% idle on the same setup (then DPR 1.5, i.e. today's Medium), and `main` before WP-24 66–74%.
- **Phones (Pixel 7 emulation, 412 × 839 at DPR 2.625, dev server; `mobile-tris.jsonl`, re-run by 25c on the merged build with identical results):** stress town **Medium 324,096 triangles** / 31 calls (canvas 618 × 1258 at DPR 1.5, 282 decor instances), Low 289,324 (169 decor instances, DPR 1), High 324,096 (DPR 2). Sample town: Medium / High 191,425, Low 156,653 (82 calls). The whole Medium − Low difference is the decor ring (113 instances ≈ 34.8k triangles, ~308 per instance; the title shows the same 34.8k).
- **Open owner decision: the mobile triangle budget.** Phones on Medium draw 324,096 triangles in the stress town, ~4k (1.3%) over the 320k mobile budget. The preset table and the budget were **not** changed. Options:
  1. **Raise the mobile budget to 330k** (keeps phones = desktop look; ~6k headroom, so new big content needs another look);
  2. **Medium `decorFraction` 0.9 on its own** (≈ 29 fewer decor instances ≈ 315k, an estimate from the per-instance average, not measured; the ring gets slightly sparser on every device, and Medium no longer equals the pre-WP-25 desktop look, so the desktop baselines would change);
  3. **Default phones to Low** (289.3k; but that brings back a device guess, and Low is Lambert, no MSAA, DPR 1 and 30 fps).
- **Mobile baselines re-captured** (25c): all four mobile PNGs (title, sample-town, asset-gallery, night-town). They were stale: captured on the hidden phone tier and before the WP-23 items, but still inside the 1% tolerance. Old / new / |diff| × 8 side-by-sides (`artifacts/wp-25/mobile-baselines/*-old-new-diff.png`, plus a night zoom) show only the intended changes: the environment lighting (a slightly different green), the full decor ring (the hedges at the top edge, more title trees), lamp halos at night, and the WP-23 items (donut shop, tiered fountain, table, bench, slide). The top bar and the dock are pixel-identical. The desktop baselines are byte-identical. Note: Playwright ≥ 1.50 only rewrites failing snapshots with `--update-snapshots`; a deliberate re-capture of passing ones needs `--update-snapshots=all`.
- **Tests:**
  - `npm run verify`: 30 files, 528 unit tests, build OK.
  - New `tests/graphics-menu.spec.ts` (25c, both projects, real input only): Medium → Low in the menu (live DPR 1 / 30-30 fps / 1024 shadows / 60% decor / no halos, saved, notice + Reload now) → Reload now → Continue restores the same town (road + cottage) booted on Low with no MSAA in the real context and Lambert → Medium → notice → reload → Standard + MSAA; Medium → High live with no notice; keyboard arrows through the presets (desktop). `--repeat-each=3`: 18/18.
  - Full e2e after 25c (`wp-25c-integration`, PORT 5303, 12.5 min): **198 tests, 176 passed, 22 skipped by design (per-project skips), 0 failed**, including all 8 darwin baselines. On the merged build before 25c: 194 tests, 170 passed, 22 skipped, 2 failed (the Graphics-tab test above).
- **Evidence** (local only): `artifacts/wp-25/` (25a preset screenshots and probes, `menu/` tab screenshots incl. `graphics-low-reload-desktop-chrome.png` / `-mobile-chrome.png` from the real engine, `mobile-baselines/`).
- **Not verified:** real phones and a production-preview measurement; GPU numbers on a phone-sized viewport.

### WP-24 as built (branch `wp-24-frame-budget`; vs `docs/PLAN.md` WP-24)
Owner report (2026-09-29): the frame rate drops and the fans spin up after building for a while; switching away from Chrome helps a little. Investigation: `~/Desktop/tiny-town-performance/REPORT.md` (probes in `probes/`).
- **Diagnosis:**
  - No leak or accumulation. After a 480-edit real-input session, the frame cost equalled a fresh reload of the same town.
  - The game was GPU-bound at the display's refresh rate: DPR 2 + 4× MSAA plus a full shadow pass on every frame, 120 per second on ProMotion. A hidden tab stops rAF, so the chip cooled.
- **Built:**
  - frame pacing (`core/Loop.ts` `paceFrame` + `core/FrameBudget.ts`): 60 fps active, 30 fps after 4 s idle;
  - the shadow map on demand (`render/ShadowScheduler.ts`; `shadowMap.autoUpdate = false`; cars 15 Hz, birds 30 Hz; test hooks, screenshot pauses and photos always redraw);
  - the desktop DPR cap 2 → 1.5 (since WP-25 the Medium preset's cap);
  - `town:stats` removed;
  - diagnostics `perf`;
  - lil-gui `Performance` folder.

  Architecture: §Frame budget.
- **Measured** (stress town, whole-machine GPU utilisation from `ioreg`, full Chromium on the real GPU, M2 Max, 1512 × 982 viewport at DPR 2, Auto clock running, emulated display rate):

  | display | `main` (`6f0fe45`) | WP-24 interacting (60 fps) | WP-24 idle (30 fps) |
  | --- | --- | --- | --- |
  | 120 Hz | 66–74% | 33–36% | 18–19% |
  | 60 Hz | 47–50% | 32–36% | 19% |

  Shadow redraws with cars driving: ~15 per second instead of one per frame. A still town with no cars or flock redraws nothing.
- **Checks:**
  - `npm run verify`: 514 unit tests, including the new `src/core/frameBudget.test.ts` and `src/render/ShadowScheduler.test.ts`.
  - Full e2e: 152 passed, 20 skipped (per-project skips), 0 failed. All 8 darwin baselines are unchanged: the desktop project runs at DPR 1, and paused screenshots always redraw the shadow map.
  - `tests/perf.spec.ts`, repeated 3×: 12/12.
- **Trade-offs and follow-ups:**
  - Car and bird shadows update at 15 / 30 Hz (tunable).
  - Ambient life animates at 30 fps once idle.
  - Retina renders at 1.5× instead of 2×; MSAA stays on.
  - Not done (see the report, P2): diagnostics are still rebuilt every frame; the macOS Cmd + held pan key can get stuck; a menu setting for the frame cap; adaptive resolution.

### WP-23 as built (branch `wp-23-new-items`; vs `docs/plans/wp-23-new-items.md`)
Owner request (2026-09-29), picked from the asset research on the owner's Desktop (`tiny-town-inventory-research/`).
- **New tools (7 after the review; 40 placing tools):**
  - Streets: **Mailbox** (CreativeTrio, CC0);
  - Town: **Tiered fountain** (Poly by Google, CC-BY, recoloured), **Donut shop** (J-Toastie, CC-BY, 3 × 3 like the corner shop, dark at night);
  - Nature: **Tulips** (three Nature Kit flowers in one cell, three variants);
  - Garden: **Long bench**, **Table** (Fantasy Town, shipped as kit files sharing one colormap), **Slide** (sirkitree, CC-BY). A **Gate** (edge) shipped in the first cut and was removed at the owner's review.
- **Removed:** the Garage (tool, kind, `outbuilding` group, model, icon, compose recipe) and the unused `industrial/` folder and composed `fence-small-gate.glb`. Old saves and town files with garages still open, without them (no version bump; tested).
- **Dock:** up to 12 tools per category (owner); digits 1–9 for the first nine, no badge past that (Garden's Swing, Slide, Pool).
- **Owner review amendment (2026-09-29):** tulips scaled down (×1.15 → ×0.7), the Gate removed (tool, edge kind, model, icon; gates in saves are dropped on load like any unknown edge kind), and the **Pool moved from Town to Garden** (last in the Garden tray; still counted as an amenity in stats and FX).
- **Compose script:** new helpers `recolor`, `dropMaterials`, `pruneTextures` and `natureMaterials` (the Nature Kit fix: metalness 0, sRGB → linear, teal leaves → green). The donut shop's ground slab is dropped and its window texture flattened (it added a texture for no visible gain).
- **Where the plan changed while building:**
  - The mailbox is ×0.36 of the source (0.35 tall), not postbox height: at postbox height it read as a stick.
  - The tulips were ×1.15 in the first cut (filling the cell); the owner found them huge, so they are ×0.7 now (≈ 0.33 × 0.18, lower than the bush).
- **Budgets** (dev server, canvas inspector, 2026-09-29; `artifacts/wp-23/inspect-*`):
  - stress town: desktop 31 calls, 330.3k triangles (v0.4: 358.2k); mobile (the pre-WP-25 phone tier) 31 calls, 261.2k (v0.4: 293.2k; budget 320k). Mailboxes and trees replaced its 50 garages.
  - sample town: 87 / 87 calls, 192.2k / 127.2k triangles, **28 / 27 textures** (desktop / mobile; budget 30; v0.4: 27 / 26). The new pieces add the Fantasy Town colormap and the mailbox palette; the garage's atlas is gone; the donut shop's window texture was flattened (29 before).
- **Gates (worktree, 2026-09-29):** `npm run verify` green (25 files, 479 unit tests, build OK; main chunk 274 kB). Full `npm run test:e2e` (156 tests): 132 passed, 18 skipped by design, 6 failed, all expected: two `ui.spec.ts` checks with the old tool counts/digits (updated; `ui.spec.ts` then 20 passed, 4 skipped) and the three desktop baselines that show the new items. The new `tests/new-items.spec.ts` passes on desktop and mobile.
- **Baselines:** sample-town, asset-gallery and night-town (desktop) regenerated. The diff (`artifacts/wp-23/diff-*.png`, old ones in `baselines-before/`) shows only the dock's 9th Streets card, the new pieces, the mailbox in the garage's spot and a few trees in the sample town whose ±12 % jitter moved (the tulips' variant pick advances the seeded stream). The mobile baselines still pass (the changes stay under the 1 % tolerance in the phone's view), so they were not regenerated.
- **Evidence:** `artifacts/wp-23/` (in-game shots `g-*.png`, icons sheet, inspector captures, baseline diffs).

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
  - Pixel 7 emulation (the pre-WP-25 phone tier): 31 → 32 calls. Triangles move by ±4k from the cars driving in and out of view (287.2k–291.3k with no birds), so the birds' +288 is inside that noise.
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
  - Baselines: the three phone top-bar baselines (sample-town, asset-gallery, night-town) were regenerated one at a time; the masked diff (top bar + 12 px pad, threshold 0) finds **0 px changed outside the top bar** in each (4.2–4.7k px inside it). The **committed mobile `sample-town` baseline had been captured in the flaky no-touch state** (the "click the map" hint and the desktop decor hedges of the pre-WP-25 tiers; see Open issues), so it was checked against a correct touch-state capture instead of the old file. Desktop baselines are unchanged (a strict pixel compare finds 1 anti-aliased pixel in the house badge; not committed). All 8 baselines pass afterwards. Old baselines and diff images: `artifacts/wp-20/baselines-before/`, `masked-diff/`.
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
- **Bundle:** the main chunk went from 890.92 kB (`main`, `abae251`) to 900.11 kB, over the 900 kB warning limit. `PhotoFrame` is now loaded on the first photo (a 2.08 kB chunk), leaving the main chunk at **899.47 kB** (898.21 kB after the Share button was removed). It's under the limit, but with no headroom; most of the photo cost is UI markup, glyphs and CSS, which must be in the main chunk. **The next feature needs a split first**; the lazy `lil-gui` import (about 30 kB) is the known one.
- **Gates** (branch, 2026-09-28):
  - `npm run verify` green: 23 files, 440 unit tests, build OK.
  - `npm run test:e2e`: 134 tests, 116 passed, 18 skipped by design, 0 failed (7.9 min). That run predates the lazy import; after it, `tests/photo.spec.ts` was re-run: 6 passed, 4 skipped. Earlier, `--repeat-each=3` gave 18 / 18.
  - Baselines: the six with a top bar (sample-town, asset-gallery and night-town × desktop and mobile) were regenerated. The masked diff (`tests/tools/maskedDiff.ts`, threshold 0, 12 px pad around the top bar) finds **0 px changed outside the top bar** in all six. `title` is unchanged. Old baselines and diff images: `artifacts/wp-19/baselines-before/`, `masked-diff/`.
- **Evidence:** `artifacts/wp-19/`: `desktop-*`, `night-*`, `mobile-*` (the before-shot, developing, preview and the saved JPEG), `e2e-*` downloads and previews, and `e2e-full.log`.
- **Not verified here:** what Download does on a real iPhone (Files) and Android phone, and long-press "Save to Photos" on the iOS preview, need a device check.

### WP-17 as built (branch `building-sizes`; vs `docs/plans/wp-17-building-sizes.md`)
- **Merges:** plan + contract `b53ab04` → 17b (shop lights) → 17a (scale & layouts) → 17c (QA).
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
- **Merges** (integration branch): contract `6293a40` + `9d9b84b` → 16a `389cd21` → church glow `a318b97` → reduced-motion snap `fedbb74` → 16b 30cc649 → 16c 2fd1d7f.
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
- 2026-09-26 — **CSS minify**: WP-11 turned it off because lightningcss drops `translate:` next to `transform:`. WP-06 fix2 removed that combination from `.ui-hint`, and it was turned back **on** in `1ece424`. Rule: never combine `translate:` and `transform:` in one CSS rule.
- 2026-09-26 (process) — Copy `artifacts/<wp>/` into the main checkout **before** `git worktree remove --force`. Removing the wp-07 worktree deleted its gitignored audio recording (`playtest-audio.wav`), which can't be recovered.
- 2026-09-27 (v0.2) — **Grid 48 × 48 at `CELL_SIZE` 0.5**. The plot stays 24 × 24 world units, so camera, terrain, decor ring and budgets stay valid. Toy scale: 1 unit ≈ 8 m.
- 2026-09-27 — **Roads are aligned 2 × 2 blocks.** One Kenney tile covers a block, and a block is all road or no road. Cars drive on the 24 × 24 block grid, and `stats.roadTiles` counts blocks.
- 2026-09-27 — **Multi-cell footprints**: cottage and family home 3×3, townhouse 2×3, garage 1×2, bus stop 2×1, everything else 1×1. The footprint centres on the pointer (`anchorForPointer`), and R rotates it.
- 2026-09-27 — **Save `SavedTownV2`** with `SAVE_MIGRATIONS[1]` (v1 → v2). The storage key `tiny-town:save:v1` stays; it's a slot name.
- 2026-09-27 — **Music is streamed**: an `HTMLAudioElement` → `MediaElementAudioSourceNode`, with `src` set only on the first Start/Continue, so the track is not part of the initial download.
  - Settings `music` / `musicVolume`.
  - Events `intent:set-music`, `intent:set-music-volume`, `music:changed` are in `events.ts`; the temporary `musicEvents.ts` is gone.
- 2026-09-27 — **Stats pill removed** as redundant. `TownState.stats()`, `town:stats` and diagnostics `town` remain for tests.
- 2026-09-30 — **`town:stats` event removed** (WP-24, owner request): nothing subscribed, and it recomputed `TownState.stats()` for every cell of a drag. `TownState.stats()` and diagnostics `town` stay (tests, bird scheduling).
- 2026-09-30 — **Frame budget** (WP-24): 60 fps active / 30 fps idle, the shadow map redrawn on demand, desktop DPR 1.5. The game was GPU-bound at the display's refresh rate; see §Frame budget in `03-architecture.md`.
- 2026-09-30 — **Graphics presets replace the hidden touch-screen tier** (WP-25, owner request): the player picks Low / Medium / High in Menu → Graphics, saved in the settings. The touch-screen guess gave phones different colours (no environment lighting, a hemisphere boost) and fewer decor trees; it is gone. MSAA and the material need a reload ("Reload now"); everything else applies at once.
- 2026-09-30 — **Medium is the default on every device** (WP-25): Medium = the pre-WP-25 desktop look (DPR 1.5, MSAA, Standard, 2048 shadows, full decor, 60 / 30 fps). Phones therefore draw ~324k triangles in the stress town against the 320k budget: open owner decision ("WP-25 as built").
- 2026-09-30 — **Lambert on Low** (WP-25): the Kenney look is flat colour with roughness ≈ 1, so Lambert looks nearly the same as Standard at ~⅔ of the cost; with MSAA off, DPR 1 and 30 fps, Low measured 8% GPU against Medium's 32% (active) on the stress town.
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
- 2026-09-29 — **New build items (WP-23)**, owner request from the asset research: 8 new tools, the garage removed, categories may hold up to 12 tools (digits for the first nine). Removing an object kind needs no save bump: `parseSave` drops unknown kinds. The Kenney Nature Kit (rejected in v0.1) is usable through a compose-script material fix; only its flowers ship so far.
- 2026-09-29 — **three.js in a vendor chunk** (WP-20): the fix for the 900 kB main-chunk warning, instead of the lazy `lil-gui` import.
- 2026-09-28 — **Town photo (WP-19)**, owner request: a camera at the top right saves the town as a framed picture. Owner picks: what's on screen (not an auto-framed "whole town" shot), a Polaroid with the title, the date and a sun/moon icon (**no homes/residents line, no time-of-day words**), and a preview with Download only (Share removed after review). The photo is rendered to the game canvas at a raised pixel ratio and copied in the same task, not rendered off-screen, so tone mapping and colours match the screen. No shutter sound until the owner supplies or approves one.
- 2026-09-28 — **Music resumes where it left off (WP-18)**, owner request: short sessions kept hearing only the intro. The position `{ track, time }` has its own key, `tiny-town:music:v1`, not the settings, because it is throwaway data written often. The seek happens on `loadedmetadata`, not through a `#t=` media fragment: it is simpler, and it can't change how the loop wraps. The end guard uses the real `duration`, so no track length is stored.
- 2026-09-27 (v0.3) — **Crossroad tile markings done**: the crossroad uses `road-crossroad-path` (zebra crossings), checked against the mobile triangle budget. Removed from the backlog.

## Open issues
**Mobile budget**
- **WP-25 (open owner decision):** phones now start on Medium, and the stress town draws **324,096 triangles** on Pixel 7 emulation (dev server, 2026-09-30), ~4k over the 320k mobile budget. Options: see "WP-25 as built". Until WP-25 (the hidden phone tier) it was 291.3k (64 × 64 plot, 2026-09-28). Any new content with a large triangle count needs a budget check.

**Touch precision**
- At the default phone pose a cell is about 10.6 px, so small props need a pinch-zoom on touch.

**Release measurements**
- v0.5 (package 0.5.0) was measured on the production preview on 2026-09-30 (`docs/release.md` §Budgets, v0.5 column; evidence in `artifacts/v05-release/`). Every budget is met except the mobile triangles on Medium (open decision above).
- Since WP-24 the WP-11 frame-time method (mean rAF interval with vsync off) no longer measures a frame: the loop skips most callbacks. v0.5 reports CPU ms per *rendered* frame instead (`artifacts/v05-release/frame-cost.mjs`); see `docs/release.md`.
- The main JS chunk was 887 kB (v0.3) and 898 kB (v0.4). WP-20 split three.js into its own chunk: v0.5 main 298 kB + `three` 642 kB, so the 900 kB warning is far off.
- The sample town uses 28 of 30 textures and 86–88 draw calls by day, 90 in the night town (v0.4: 57 / 61; WP-23 measured 87 with its new pieces). Budget 150 / 120.

**Audio**
- No human has listened to the SFX or the music.
- The WP-07 recording is lost. The WP-13 listen captures exist locally in `artifacts/wp-13/`.

**Tests and platforms**
- **Phone emulation is flaky here** (seen 2026-09-28, WP-19): Pixel 7 emulation in full Chromium sometimes starts a page without touch (`(pointer: coarse)` false, `maxTouchPoints` 0), even on a static SVG. The game then shows the mouse hint ("click the map"); before WP-25 it also switched to the desktop look (decor hedges at the top). Since WP-25 the look is the preset, not a touch guess, so only the hint can differ. The run is otherwise green, and a baseline regenerated in that state looks subtly wrong. Always masked-diff a regenerated mobile baseline against the old one; regenerate again if anything outside the expected area changed. One of the 6 WP-19 baselines needed 3 tries; after the WP-19 merge (on top of tall trees), asset-gallery mobile needed 4 and night-town mobile 10. It hits single-test runs in a fresh browser most, so regenerate one baseline at a time in a retry loop with the masked diff as the check.
- In the first full e2e run of WP-19, both dev servers (the test server and a manual one) died together about 1 min into the bot playtest, and every later test failed with `ERR_CONNECTION_REFUSED`. The re-runs were clean. Cause unknown; it looked environmental.
- The visual baselines are darwin only; a Linux CI job would fail until it commits its own set.
- Not tested on real iOS or Android devices.

**Asset manifest**
- `docs/assets/models.json` is hand-maintained. Don't write `inspect:models --json` over it (see `CLAUDE.md`).

**Module constraint**
- `tests/helpers.ts` imports `UI_TEST_IDS` via `src/ui/UiRoot.ts` in Node. `UiRoot.ts` must stay free of CSS and asset side effects; the ids live in `src/ui/testIds.ts`.

**Stale code comments** (owners, when they next touch these files)
- The `events.ts`, `UiRoot.ts` and `types.ts` comments listed here before were fixed in `d78186f`.

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
  - ~~reuse the diagnostics object instead of rebuilding it every frame;~~ diagnostics are built on read (`code-review-cleanup`);
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
