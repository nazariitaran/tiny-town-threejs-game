# Tiny Town — progress (integrator-maintained)

Only the integrator (WP-01) edits this file. Workers report in their hand-off. This is the recovery point: after any interruption, re-read it together with `docs/HANDOVER.md`.

## Current state (2026-09-27)
- **Version: v0.2**, merged on `main`; the v0.2 integration commit is `30fe85b`. **v0.3 (WP-15) is in progress in the working tree**, not yet committed or released.
- **v0.1** is the M3 "v1" build at `3f9c6cf`. v0.2 adds three owner requests on top:
  - **WP-12**: 48 × 48 grid of 0.5-unit cells, roads as 2 × 2 blocks, multi-cell houses, save v2 with a v1 → v2 migration.
  - **WP-13**: streamed background music with settings.
  - **WP-14**: the stats pill is gone; the top bar is one row.
- **Gates on `main` (2026-09-27):**
  - `npm run verify` is green: 19 test files, 294 unit tests, build OK.
  - `npm run test:e2e`: 82 tests, of which 70 pass and 12 are skipped by design (desktop-only or mobile-only).
  - The 6 visual baselines (darwin) were regenerated after WP-12 (`30fe85b`).
- **In flight: v0.3, WP-15 "New building blocks & categories"**, implemented by the integrator in the `main` working tree (uncommitted, not yet released). See "WP-15 as built" below.
  - Gates on the working tree (2026-09-27): `npm run typecheck` green; unit tests 18 files, 336 passing. `npm run test:e2e`, the visual baselines and the production build: to be measured.
  - No worktrees or WP branches.
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
| WP-15 | New building blocks & categories (v0.3) | 🔄 working tree | — (uncommitted) | see "WP-15 as built" below |

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

### WP-15 as built (v0.3, working tree)
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
- 2026-09-27 (v0.3) — **Crossroad tile markings done**: the crossroad uses `road-crossroad-path` (zebra crossings), checked against the mobile triangle budget. Removed from the backlog.

## Open issues
**Mobile budget**
- Stress-town triangle headroom on mobile is only about 10.9k (239.1k of 250k, v0.3 working tree, dev server; v0.2 was 243.5k). Any new content with a large triangle count needs a budget check.

**Touch precision**
- At the default phone pose a cell is about 10.6 px, so small props need a pinch-zoom on touch.

**Measurements not redone for v0.2**
- The budget table in `docs/release.md` was measured on the v0.1 production preview. v0.2 and v0.3 have only dev-server inspector numbers (WP-12 and WP-15 above).
- Frame time and download size were not re-measured on the preview for v0.2. The one exception is dist size, measured 2026-09-27: 3.29 MB excluding maps and music.

**Audio**
- No human has listened to the SFX or the music.
- The WP-07 recording is lost. The WP-13 listen captures exist locally in `artifacts/wp-13/`.

**Tests and platforms**
- The visual baselines are darwin only; a Linux CI job would fail until it commits its own set.
- Not tested on real iOS or Android devices.

**Asset manifest**
- `docs/assets/models.json` is hand-maintained. Don't write `inspect:models --json` over it (see `CLAUDE.md`).

**Module constraint**
- `tests/helpers.ts` imports `UI_TEST_IDS` via `src/ui/UiRoot.ts` in Node. `UiRoot.ts` must stay free of CSS and asset side effects; the ids live in `src/ui/testIds.ts`.

**Stale code comments** (owners, when they next touch these files)
- `package.json`: `version` is still `0.1.0`.
- The `events.ts`, `UiRoot.ts` and `types.ts` comments listed here before were fixed in `0e760b5`.

**v0.3 before release**
- Run `npm run test:e2e`, regenerate the visual baselines (the dock, sample town and asset gallery all changed) and run `npm run verify`.
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
- Dusk mode (the WP-10 stretch goal).
- A human ear pass on SFX and music.
- Linux baselines, if CI is added.
- Real-device testing.
- Optional: expand the plot. `PLOT_WIDTH/DEPTH` keep this cheap.

## Next actions
WP-15 (v0.3) is in the working tree:
1. Finish the gates listed under "v0.3 before release" in Open issues, then commit v0.3 and fill in the WP-15 row above.
2. Before any release, re-measure `docs/release.md` §Budgets on the production preview. Use a fresh run id, and label the results with the date and version.
3. For the next iteration after that, open a new WP section in `docs/PLAN.md`. Take ports from 5215 up and follow the `docs/HANDOVER.md` runbook.
