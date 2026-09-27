# Tiny Town — Architecture & Contracts

> **Status: current (v0.2, `main` 2026-09-27).** This is the source of truth for the grid, rules, save format, module map, diagnostics and budgets. If this file and the code disagree, the code wins; fix this file.

## Stack
TypeScript (strict) · Vite 8 · three.js r184 (`three/addons/*` for MapControls, GLTFLoader) · Web Audio (SFX buffers; music streamed via `HTMLAudioElement`) · lil-gui (`?debug`) · Vitest (pure logic) · Playwright (browser, `channel: 'chromium'`, 1 worker). No physics engine: the game is grid-based and has no simulation that needs one.

## Module map and ownership

```
src/
  main.ts                     bootstrap                                   integrator
  game/Game.ts                composition root, phases, update order,     integrator
                              test hooks, diagnostics
  game/events.ts        [C]   typed EventBus + GameEvents                 integrator
  game/config.ts        [C]   plot size, CELL_SIZE, cell↔world mapping,   integrator
                              assetUrl, storage keys
  catalog/tools.ts      [C]   toolbar tools (ids, category, drag mode)    integrator
  catalog/objects.ts    [C]   object defs (footprint, allowed ground…)    integrator
  catalog/models.ts     [C]   model registry (GLB url, scale, offsets)    integrator (WP-03 may tune numbers)
  town/types.ts         [C]   pure data model, SavedTown(V2)              integrator
  town/grid.ts          [C]   pure grid helpers: footprints, road blocks, integrator
                              anchorForPointer (tested)
  town/TownState.ts           data store                                  WP-02
  town/rules.ts               placement rules (pure, tested)              WP-02
  town/History.ts             undo/redo (cap 200)                         WP-02
  town/TownEditor.ts          the only mutator; publishes facts           WP-02
  town/serialize.ts           save format + validation + v1→v2 migration  WP-02
  town/sampleTown.ts          demo towns: sample, asset gallery, stress   WP-02
  town/fixtures/v1-*.json     v0.1 saves for migration.test.ts            WP-02
  persistence/SaveStore.ts    localStorage autosave + settings            WP-02
  core/Loop.ts, Renderer.ts   rAF loop; WebGLRenderer setup/resize        integrator / WP-04 (Renderer.ts)
  render/ModelLibrary.ts      GLB load + normalise                        WP-03
  render/TownRenderer.ts      incremental instanced drawing + pop-in,     WP-03
                              MODEL_STYLES look overrides
  render/InstancePool.ts, tween.ts   instance pools; pop-in easing        WP-03
  render/roadTiles.ts         road auto-tiling on the block grid (pure)   WP-03
  render/IconStudio.ts        OFFLINE icon renderer (not imported by the  WP-03
                              game; driven by scripts/render-icons.mjs)
  world/**                    sky, lights, terrain, grid overlay, decor   WP-04
  interaction/**              camera, framing.ts (aspect-aware poses),    WP-05
                              picker, tool controller, ghost, keyboard
  ui/**, styles.css           all DOM UI; testIds.ts (UI_TEST_IDS),       WP-06
                              uiKeys.ts (digit shortcuts), glyphs.ts
  audio/AudioManager.ts       Web Audio SFX, master mute/volume           WP-07
  audio/MusicPlayer.ts        streamed background music (owned by         WP-13 (audio)
                              AudioManager)
  audio/sfx.ts          [C]   SFX event ids                               integrator
  audio/sfxTable.ts           GENERATED from docs/assets/audio.json       integrator (npm run gen:sfx)
  vite-env.d.ts         [C]   diagnostics + test-hook types               integrator
  life/**                     ambient cars: TrafficSim, lanePaths,        WP-10
                              LifeSystem (BatchedMesh)
  fx/**                       placement VFX, wind sway                    WP-08
  debug/DebugTools.ts         lil-gui (?debug)                            shared: add folders only
  utils/                      seeded random, dispose helpers              shared
tests/                        Playwright specs + helpers.ts               WP-09, except interaction (05), ui (06),
                                                                          audio (07), fx (08), life (10) specs
scripts/                      inspect-threejs-canvas, inspect-models,     integrator / WP-03 (render-icons,
                              gen-sfx-table, render-icons, compose-models inspect-models)
```
`[C]` = contract file (the header says `CONTRACT FILE`). Workers may not change contract files; they request changes in their hand-off, and the integrator applies them. Adding a new optional field or event is fine to request; renames and removals need the integrator's agreement. The integrator can delegate named contract files to one WP for one change; `config.ts`, `types.ts`, `grid.ts`, `objects.ts` and `models.ts` were delegated to WP-12 (see `docs/PLAN.md`).
There is no `StatsHud`: the stats pill was removed in v0.2 (WP-14).

## Data flow

```
 pointer/keys ─► ToolController ──BuildAction──► TownEditor ──► rules.planAction (pure)
      ▲                │                              │ ok: TownState.applyChanges + History
 UiRoot ─intent:*─►    │ tool:changed / hover:changed │
      ▲                ▼                              ▼
      └──── facts ◄── EventBus ◄── town:changed · town:stats · build:placed/removed/invalid · history:changed
                         │
      TownRenderer ◄─────┤ town:changed      (incremental redraw, road neighbours re-tiled)
      LifeSystem   ◄─────┤ town:changed      (road graph; cars despawn when their road goes)
      AudioManager ◄─────┤ build:* / ui:sfx / intent:undo|redo / intent:set-* / phase:changed
        └ MusicPlayer    │ (music on/off, volume, menu duck) → music:changed / audio:changed → UI
      PlacementFx  ◄─────┘ build:placed / build:removed
```
`build:placed`/`build:removed` carry `worldX/worldZ` at the object's footprint centre, the road-block centre for road, or the edge midpoint for fences (`TownEditor`). The comment in `events.ts` that says "cell centre" predates WP-12.

Rules of the road:
1. **Only `TownEditor` mutates town state.** Every change list keeps its primary change last (build events derive from it). Everything else reads via `TownStateReader` or listens to `town:changed`.
2. **UI emits intents and renders facts**; it never calls game objects directly.
3. **Pure logic stays pure**: `src/town/**`, `src/render/roadTiles.ts`, `src/catalog/**` import no three.js and no DOM, so they are unit-testable in Node.
4. **All randomness goes through the seeded RNG** passed into constructors (`Game.rng`). Never `Math.random()` (it breaks screenshots and bot runs).
5. **One cell↔world mapping**: `game/config.ts`. Nobody re-derives it. Likewise every runtime asset URL goes through `assetUrl()`.
6. **Keyboard ownership**: digits 1–9 (tool in the active category), Shift+1–4 (category) and `?` (controls help) belong to the UI (`ui/uiKeys.ts`, `UiRoot`); everything else (R, B, Esc, F/Home, WASD/arrows, Q/E, +/−, undo/redo) belongs to `ToolController`/`CameraController`.
7. **Two RNG streams**: gameplay (`Game.rng`: variants) and cosmetic (`Game.fxRng`: audio/fx jitter, ambient cars), so a sound never changes the next house variant.

## Frame update order (Game.update)
`resizeRenderer` → `ToolController.update` → `CameraController.update` → `TownRenderer.update(animDelta)` → `LifeSystem.update(animDelta)` → `Environment.update(animDelta, animElapsed)` → `PlacementFx.update(animDelta)` → diagnostics → render. With `setReducedMotion(true)`, `animDelta`/`animElapsed` are 0. With `setPausedForScreenshot(true)`, nothing updates but rendering continues.

## Grid
- Plot `48 × 48` cells (`PLOT_WIDTH/DEPTH`), `CELL_SIZE = 0.5` world units per cell (WP-12; v0.1 was 24 × 24 one-unit cells), centred on the origin, so the plot is still 24 × 24 world units. Toy scale: 1 world unit ≈ 8 m, a cell ≈ 4 m. Cell `{x, z}` centre = `cellToWorld`; a footprint's centre = `footprintCentreWorld`; `worldToGridPoint` gives fractional grid coordinates.
- **Road blocks:** roads come in aligned `ROAD_BLOCK × ROAD_BLOCK` (2 × 2) cell blocks whose min corner is at even `x, z` (`grid.roadBlockAnchor` / `roadBlockCells`). A block is either all road or has no road. One Kenney road tile (`ROAD_TILE_SIZE` = 1 world unit) covers a block; auto-tiling (`roadTiles.roadMask`) reads the 4 neighbouring blocks (±2 cells) and the tile is drawn once per block at its centre (`roadBlockCentreWorld`). Ambient cars drive on the 24 × 24 block grid. `stats.roadTiles` counts road blocks.
- **Footprints:** cottage and family home 3×3, townhouse 2×3, garage 1×2, bus stop 2×1, trees / postbox / lamppost 1×1 (`catalog/objects.ts`). The tool centres a footprint on the pointer with `grid.anchorForPointer` (odd sizes on the hovered cell, even sizes on the nearest corner, clamped into the plot).
- Layers per cell: **ground** (exactly one `GroundKind`, default `field`), **object** (0–1 object covering the cell; multi-cell footprints anchored at min corner), and **edges** (fences on cell borders, canonical `n`/`w` sides).
- Rotation: quarter turns CCW from above; rotation 0 ⇒ model front faces +z (towards the default camera). Each model's native facing is corrected once via `rotationOffset` in `catalog/models.ts`.

## Placement rules (WP-02 implements in `town/rules.ts`, all unit-tested)

| Action | Valid when | Otherwise (`reason` → message shown to player) |
| --- | --- | --- |
| paint-ground | cell in bounds and kind differs | `out-of-bounds` "Outside your plot" · `no-change` (silent, never shown) |
| paint-ground road / over road (WP-12) | road on any cell converts its whole 2 × 2 block; another kind on a road cell converts the whole block to that kind; the clicked cell's change is last (primary) | road: `occupied` "Move the {label} first" if ANY block cell holds an object |
| paint-ground under an object | new kind ∈ that object's `allowedGround` | `occupied` "Move the {label} first" |
| paint-ground road | — also removes fences on the block's 4 inside edges, and on its outside edges where the neighbour is road (same change list, before the ground changes) | — |
| place-object | every footprint cell in bounds, unoccupied, ground ∈ `allowedGround` | `out-of-bounds` · `occupied` "Something is already here" · `blocked-by-road` "{label} can't go on a road" / `needs-ground` "{label} needs {ground}" |
| place-object bus-stop | ≥ 1 footprint cell 4-adjacent to a road cell | `needs-ground` "Bus stops need to be next to a road" |
| place-edge | edge in bounds (border edges allowed) and not between two road cells; same kind already there ⇒ `no-change`; other fence kind ⇒ replace (remove + add) | `out-of-bounds` · `blocked-by-road` "Fences can't cross roads" |
| bulldoze | object covering the cell (any footprint cell) ⇒ remove object; else an edge passed by the picker (pointer within 0.3 cell of it, 0.4 on touch) with a fence ⇒ remove fence; else a road cell ⇒ its whole block back to field; else non-field ground ⇒ back to field | `nothing-here` (silent on drag, shown on click) |

Variant choice (e.g. tree shape, house colour) uses the seeded RNG at placement time and is stored in `PlacedObject.variant`, so undo/redo/save reproduce it exactly.

## Save format
`SavedTownV2` (= `SavedTown`) in `town/types.ts`: versioned, 48 × 48, RLE ground, objects, edges, next id, optional camera pose. `serialize.ts` validates unknown input (never trusts localStorage), migrates older versions, demotes partial road blocks to field, and round-trips (tested). Autosave: debounced 1 s after `town:changed` (never on cause `'load'`; off after any test-hook `setState`), key `tiny-town:save:v1` (a slot name; it did not change with the format). Code uses `SavedTown`; the old `SavedTownV1` alias was removed in `30fe85b`.

**v1 → v2 migration (`SAVE_MIGRATIONS[1]`, WP-12):** each v1 cell (x, z) becomes cells 2x..2x+1 × 2z..2z+1. Ground is copied to all 4 (every v1 road cell is a valid block); each edge becomes 2 half-edges; camera (world units), ids, variants and `nextObjectId` are kept. Objects that fit the 2 × 2 area (trees, props, garage, bus stop) sit flush to its front side (rotation 0 = +z, 1 = +x, 2 = −z, 3 = −x). Houses are placed last in id order, flush to the same front: as their own kind (3-wide ones try both sideways overhangs), then as a 2×3 townhouse, then as a townhouse turned a quarter either way (fits dense 1-deep v1 rows), else dropped. A malformed v1 save only has its version bumped, so `parseSave` rejects it normally. Fixtures: `src/town/fixtures/v1-{sample,stress}.json`, tested in `src/town/migration.test.ts` (v0.1 sample: 0 drops; v0.1 stress: 36 of 56 homes kept). Settings (`muted`, `volume`, `grid`, `music`, `musicVolume`; defaults false / 0.8 / true / true / 0.5) under `tiny-town:settings:v1`; older settings without the music fields load with the defaults.

## Rendering strategy
- `ModelLibrary` loads each GLB once and normalises it (scale, facing, base on y=0, footprint-centred).
- `TownRenderer` draws with **`InstancedMesh` pools keyed by (model, part)**; capacity grows by doubling. Ground `field` is not drawn per cell (the plot plane is). Pop-in/out tweens write per-instance matrices.
- Shared materials: Kenney kits use one colour-atlas texture per kit, so the whole town should need a handful of materials. Don't clone materials per instance.
- Ghost preview uses `ModelLibrary.createObject()` with a separate translucent tinted material (not shared with the town).
- Ambient cars (`LifeSystem`) are one `BatchedMesh`: +1 main-pass and +1 shadow draw call.
- FX (`PlacementFx`) use pooled particles in 3 meshes (soft dust, chips/leaves/petals, sparkles): at most 3 draw calls, and none when idle.

## Budgets (full 48×48-cell town, desktop 1280×720; mobile 390×844)
The `stress-town` state is the gate. "Measured" gives the latest number and says where it came from. v0.2 has not been re-measured on the production preview; `docs/release.md` has the v0.1 preview table.

| Metric | Budget desktop | Budget mobile | Measured (desktop / mobile) |
| --- | --- | --- | --- |
| Draw calls | ≤ 150 | ≤ 120 | 30 / 30 (v0.2, WP-12 inspector, dev server, 2026-09-27) |
| Triangles | ≤ 400k | ≤ 250k | 311k / 243.5k (same run). Mobile headroom is only ~6.5k |
| Textures | ≤ 30 | ≤ 30 | 11 / 10 (same run) |
| Shadow maps | 1 × 2048 | 1 × 1024 | as budgeted (`Environment.setQuality`: high 2048, low 1024) |
| DPR cap | 2 | 1.5 | `MAX_DPR` in `config.ts` |
| Frame time (M-series laptop, headless full Chromium) | ≤ 8 ms | — | 1.36 ms (v0.1 production preview, WP-11); not re-measured for v0.2 |
| Initial download (JS + CSS + font + models + SFX + icons) | ≤ 8 MB | ≤ 8 MB | `dist/` 3.29 MB without maps or music (v0.2, 2026-09-27). The 4.68 MB music track is streamed after Start and isn't part of the initial download |

## Test hooks and diagnostics
`window.__THREE_GAME_TEST_HOOKS__` (installed in production too; policy in `docs/release.md`):
- `seed`;
- `setState(name)` for `title | empty-build | sample-town | active-play | asset-gallery | stress-town`. Every state reseeds, rebuilds deterministically and turns autosave off until reload. Unknown names throw.
- `setPausedForScreenshot`, `setReducedMotion`, `hideDebugUi`;
- `cellToClient(x, z)`, which takes 48 × 48 cell coordinates so bots click real cells with real input.

`window.__THREE_GAME_DIAGNOSTICS__` is typed in `src/vite-env.d.ts` and rebuilt every frame by `Game.publishDiagnostics`. Its fields:

| Field | Contents |
| --- | --- |
| `frame`, `phase`, `tool`, `rotation` | |
| `hover` | `{x, z, valid, reason}` or null, mirroring `hover:changed`; a just-placed cell reports valid |
| `town` | `TownState.stats()`: homes, residents, trees, roadTiles (= road blocks), props, fences |
| `objects` | TownState object count |
| `render` | what TownRenderer actually draws: objects, groundTiles, edges, instances, pools, draw/shadow-call and triangle estimates, animating, dying, materials |
| `history` | `canUndo` / `canRedo` / `undoDepth` / `redoDepth` |
| `invalidCount` | |
| `camera` | pose |
| `quality` | |
| `audio` | `muted` / `volume` / `unlocked` / `loaded` / `starts`, plus `music`: `{enabled, volume, playing, loaded, requested, ducked, time, loops}` |
| `save` | `{available, pending, lastError}` |
| `fx` | `FxDiagnostics`: active, drawCalls, spawned, dropped, reducedMotion, windTime, windStrength |
| `life` | `LifeDiagnostics`: loaded, cars, target, drivableCells, spawned, despawned, waiting, drawCalls, … |
| `renderer` | three.js calls, triangles, geometries, textures; the canvas inspector reads this |
| `canvas` | |

There are no other diagnostics globals; the `__THREE_GAME_FX_DIAGNOSTICS__` / `__THREE_GAME_LIFE_DIAGNOSTICS__` shims were removed in `bc1ae5b`.

Playwright projects are `desktop-chrome` (1280×720) and `mobile-chrome` (Pixel 7 emulation, touch). Both run full Chromium (`channel: 'chromium'`) with 1 worker. The canvas inspector's `--mobile` mode is a 390 × 844 touch viewport.

Stable DOM ids for tests are `UI_TEST_IDS` in `src/ui/testIds.ts`, which has no side effects and is re-exported by `UiRoot.ts`. Examples: `btn-start`, `tool-<id>`, `cat-<category>`, `btn-undo`, `btn-redo`, `btn-mute`, `btn-rotate`, `tool-bulldoze`, the menu ids, and `chk-music` / `range-music`. A tool button exists only while its category is active.

Visual baselines live in `tests/visual-regression.spec.ts-snapshots/`: 6 PNGs covering title, sample-town and asset-gallery × desktop and mobile. They are **darwin only**, and a missing baseline fails.
