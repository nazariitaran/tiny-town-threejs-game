# Tiny Town — progress (integrator-maintained)

Only the integrator (WP-01) edits this file. Workers report in their hand-off. This is the recovery point: after any interruption, re-read it together with `docs/HANDOVER.md`.

## Current state (2026-09-27)
- **Version: v0.2**, merged on `main`; the v0.2 integration commit is `30fe85b`.
- **v0.1** is the M3 "v1" build at `3f9c6cf`. v0.2 adds three owner requests on top:
  - **WP-12**: 48 × 48 grid of 0.5-unit cells, roads as 2 × 2 blocks, multi-cell houses, save v2 with a v1 → v2 migration.
  - **WP-13**: streamed background music with settings.
  - **WP-14**: the stats pill is gone; the top bar is one row.
- **Gates on `main` (2026-09-27):**
  - `npm run verify` is green: 19 test files, 294 unit tests, build OK.
  - `npm run test:e2e`: 82 tests, of which 70 pass and 12 are skipped by design (desktop-only or mobile-only).
  - The 6 visual baselines (darwin) were regenerated after WP-12 (`30fe85b`).
- **In flight:** no WPs, worktrees or WP branches.
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

**Migration**
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
- 2026-09-26 (WP-03 fix2) — The 17 tool icons are rendered in-project from the in-game models: `scripts/render-icons.mjs` + `src/render/IconStudio.ts`, 128 px, CC0.
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

## Open issues
**Mobile budget**
- Stress-town triangle headroom on mobile is only about 6.5k (243.5k of 250k). Any new content with a large triangle count needs a budget check.

**Touch precision**
- At the default phone pose a cell is about 10.6 px, so small props need a pinch-zoom on touch.

**Measurements not redone for v0.2**
- The budget table in `docs/release.md` was measured on the v0.1 production preview. v0.2 has only the WP-12 dev-server inspector numbers above.
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
- `events.ts`: the `build:*` comment says the world position is the cell centre. It is the footprint or road-block centre.
- `UiRoot.ts:117`: says "shim events".
- `types.ts`: ends with an orphan `@deprecated` comment.
- `package.json`: `version` is still `0.1.0`.

## Backlog (post-v1 from the M3 review, WP-11, and v0.2)
- Houses auto-face an adjacent road.
- Crossroad tile markings.
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
Nothing is in flight. When the owner asks for the next iteration:
1. Open a new WP section in `docs/PLAN.md`. Take ports from 5215 up and follow the `docs/HANDOVER.md` runbook.
2. Before any release, re-measure `docs/release.md` §Budgets on the production preview. Use a fresh run id, and label the results with the date and version.
