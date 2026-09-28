# Tiny Town — progress (integrator-maintained)

Only the integrator (WP-01) edits this file. Workers report in their hand-off. This is the recovery point: after any interruption, re-read it together with `docs/HANDOVER.md`.

## Current state (2026-09-27)
- **Version: v0.3 complete on `main`** (not yet released). v0.3 = WP-15 (new building blocks, `ea54bb5`) + WP-16 (day/night, integration branch `v0.3-day-night`, owner-approved and merged into `main` 2026-09-27). v0.2's integration commit is `30fe85b`.
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
- **WP-17 is built** on the integration branch `building-sizes` and awaits the owner's review (bigger buildings, smaller swing, dark shops at night). See "WP-17 as built".
- **Tall trees are built** on the branch `tall-trees` and await the owner's review: pine ×2 and oak ×1.7 taller than before, birch unchanged, all still 1 × 1 (fixed per species, no player control). See "Tall trees as built".
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
- 2026-09-27 (v0.3) — **Crossroad tile markings done**: the crossroad uses `road-crossroad-path` (zebra crossings), checked against the mobile triangle budget. Removed from the backlog.

## Open issues
**Mobile budget**
- 64 × 64 plot: the stress town is 291.3k triangles on mobile (Pixel 7 emulation, dev server, 2026-09-28), headroom ~29k under the new 320k budget. Any new content with a large triangle count needs a budget check.

**Touch precision**
- At the default phone pose a cell is about 10.6 px, so small props need a pinch-zoom on touch.

**Release measurements**
- v0.3 (package 0.3.0) was re-measured on the production preview on 2026-09-27 (`docs/release.md` §Budgets; evidence in `artifacts/v03-release/`). Every budget is met.
- The main JS chunk is 887 kB, 13 kB under the 900 kB code-split threshold, so the next feature will likely need a split (lazy `lil-gui` saves about 30 kB).
- The sample town uses 28 of 30 textures.

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
- A human ear pass on SFX and music.
- Linux baselines, if CI is added.
- Real-device testing.
- Optional: expand the plot. `PLOT_WIDTH/DEPTH` keep this cheap.

## Next actions
1. v0.3 is measured and versioned (0.3.0). What's left is the deploy itself (`docs/release.md` §Build and deploy) and, if wanted, a release tag.
2. For the next iteration, open a new WP section in `docs/PLAN.md`. Take ports from 5218 up and follow the `docs/HANDOVER.md` runbook with an integration branch.

### Tall trees as built (branch `tall-trees`)
An owner request: taller trees that still take one tile. Done directly by the integrator, not a numbered WP.
- **Design history:** the first cut gave oak, pine and birch three player-picked height tiers (H key, Height button, an optional `PlacedObject.height`). The owner reviewed it and simplified: **no player choice, one fixed height per species.** That machinery was removed again.
- **Result:** `ObjectDef.height`: pine ×2, oak ×1.7 (the "third tier" of the first cut, so it stays squarish: its crown already fills the cell), birch natural. Nothing in rules, `PlacedObject`, save (still v4, unchanged) or UI changed; existing towns just show taller pines and oaks.
- **Drawing:** `TownRenderer` and the ghost stretch Y only. `windSway.ts` measures height along the model's Y axis and bends at half rate above 1 unit (natural trees unchanged; the bush's bend gets a little smaller because its Y is squashed). Tool icons for oak and pine were re-rendered, and the sample-town, asset-gallery and night-town baselines regenerated.
- **Known trade-offs:** a tall tree hides about 1.3 × its height of the view behind it; the heights are one constant each in `catalog/objects.ts` (`OAK_HEIGHT`, `PINE_HEIGHT`).
