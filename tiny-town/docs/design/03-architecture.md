# Tiny Town — Architecture & Contracts

> **Status: current for v0.3 on `main` (WP-15 catalog + WP-16 day/night), 2026-09-27; v0.3 is not yet released.** This is the source of truth for the grid, rules, save format, module map, diagnostics and budgets. If this file and the code disagree, the code wins; fix this file.

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
  catalog/tools.ts      [C]   dock tools (ids, category, drag mode, icon) integrator
  catalog/objects.ts    [C]   object defs (footprint, allowed ground,     integrator
                              group, roadFeature…)
  catalog/models.ts     [C]   model registry (GLB url, scale, offsets)    integrator (WP-03 may tune numbers)
  town/types.ts         [C]   pure data model, SavedTown(V4)              integrator
  town/grid.ts          [C]   pure grid helpers: footprints, road blocks, integrator
                              anchorForPointer (tested)
  town/TownState.ts           data store                                  WP-02
  town/rules.ts               placement rules (pure, tested)              WP-02
  town/History.ts             undo/redo (cap 200)                         WP-02
  town/TownEditor.ts          the only mutator; publishes facts           WP-02
  town/serialize.ts           save format + validation (no migrations)    WP-02
  town/sampleTown.ts          demo towns: sample, asset gallery, stress   WP-02
  persistence/SaveStore.ts    localStorage autosave + settings            WP-02
  core/Loop.ts, Renderer.ts   rAF loop; WebGLRenderer setup/resize        integrator / WP-04 (Renderer.ts)
  render/ModelLibrary.ts      GLB load + normalise                        WP-03
  render/TownRenderer.ts      incremental instanced drawing + pop-in,     WP-03
                              MODEL_STYLES look overrides
  render/InstancePool.ts, tween.ts   instance pools; pop-in easing        WP-03
  render/roadTiles.ts         road auto-tiling on the block grid, road-   WP-03
                              feature helpers (arms, centre) (pure)
  render/nightGlow.ts         glow masks + GlowRegistry, window stagger    WP-16b
                              shader patch (v0.3)
  render/NightLights.ts, lampRegistry.ts, fireflies.ts               WP-16b
                              lamp pools/halos, headlight beams, fireflies
  render/IconStudio.ts        OFFLINE icon renderer (not imported by the  WP-03
                              game; driven by scripts/render-icons.mjs)
  world/**                    sky, lights, terrain, grid overlay, decor   WP-04
  world/dayCycle.ts     [C*]  pure day clock + keyframes (the Contract    integrator (contract) /
                              section is fixed)                           WP-16a (bodies)
  interaction/**              camera, framing.ts (aspect-aware poses),    WP-05
                              picker, tool controller, ghost, keyboard
  ui/**, styles.css           all DOM UI; testIds.ts (UI_TEST_IDS),       WP-06
                              uiKeys.ts (digit shortcuts), glyphs.ts
  audio/AudioManager.ts       Web Audio SFX, master mute/volume           WP-07
  audio/MusicPlayer.ts        streamed background music (owned by         WP-13 (audio)
                              AudioManager)
  audio/musicPosition.ts      music resume rules (pure; saved position)   WP-18
  audio/sfx.ts          [C]   SFX event ids                               integrator
  audio/sfxTable.ts           GENERATED from docs/assets/audio.json       integrator (npm run gen:sfx)
  vite-env.d.ts         [C]   diagnostics + test-hook types               integrator
  life/**                     ambient cars: TrafficSim, lanePaths (incl.  WP-10
                              the roundabout ring), LifeSystem (BatchedMesh)
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
6. **Keyboard ownership**: digits 1–9 (tool in the active category), Shift+1–5 (category) and `?` (controls help) belong to the UI (`ui/uiKeys.ts`, `UiRoot`); everything else (R, B, Esc, F/Home, WASD/arrows, Q/E, +/−, undo/redo) belongs to `ToolController`/`CameraController`.
7. **Two RNG streams**: gameplay (`Game.rng`: variants) and cosmetic (`Game.fxRng`: audio/fx jitter, ambient cars), so a sound never changes the next house variant.

## Frame update order (Game.update)
`resizeRenderer` → `ToolController.update` → `CameraController.update` → `TownRenderer.update(animDelta)` → `LifeSystem.update(animDelta)` → `DayClock.advance(animDelta)` (building phase only) → `Game.applyDaylight()` (`Environment.applyDaylight`, `NightLights.update`, `LifeSystem.setNight`, `daytime:changed` on a mode/phase change) → `Environment.update(animDelta, animElapsed)` → `PlacementFx.update(animDelta)` → diagnostics → render. With `setReducedMotion(true)`, `animDelta`/`animElapsed` are 0. With `setPausedForScreenshot(true)`, nothing updates but rendering continues.

## Grid
- Plot `64 × 64` cells (`PLOT_WIDTH/DEPTH`), `CELL_SIZE = 0.5` world units per cell, centred on the origin, so the plot is 32 × 32 world units (2026-09-28; WP-12 had 48 × 48 cells = 24 × 24 units, v0.1 24 × 24 one-unit cells). World-space tunables were scaled with it: grid fade 30 → 75, title orbit 44, decor belt 60–120, night fog 13 / 225, framing side insets −42 desktop / −412 phone (same zoom as on 48 × 48, so the plot's side corners start just off-screen). Toy scale: 1 world unit ≈ 8 m, a cell ≈ 4 m. Cell `{x, z}` centre = `cellToWorld`; a footprint's centre = `footprintCentreWorld`; `worldToGridPoint` gives fractional grid coordinates.
- **Road blocks:** roads come in aligned `ROAD_BLOCK × ROAD_BLOCK` (2 × 2) cell blocks whose min corner is at even `x, z` (`grid.roadBlockAnchor` / `roadBlockCells`). A block is either all road or has no road. One Kenney road tile (`ROAD_TILE_SIZE` = 1 world unit) covers a block; auto-tiling (`roadTiles.roadMask`) reads the 4 neighbouring blocks (±2 cells) and the tile is drawn once per block at its centre (`roadBlockCentreWorld`). Ambient cars drive on the 32 × 32 block grid. `stats.roadTiles` counts road blocks (a roundabout counts its 9).
- **Road features (v0.3):** an object whose `ObjectDef.roadFeature` is set (only the roundabout) stands on road. Its anchor is block-aligned and its footprint is whole road blocks (the roundabout: 6 × 6 cells = 3 × 3 blocks). The renderer draws the feature's model instead of the road tiles under it (`roadTiles.underRoadFeature`). A neighbouring road block joins a feature only at the middle block of the feature's facing side, its **arm** (`roadTiles.isFeatureArm`), so a road running past a roundabout doesn't tee into its kerb. Inside a roundabout only the 4 arm blocks and the centre block carry traffic (the corners are kerb); cars cross the centre on a ring path round the island, counter-clockwise from above (right-hand traffic; `lanePaths.ringPath`, radius 0.5).
- **Road markings (2026-09-28):** an object whose `ObjectDef.roadMarking` is set (only the zebra crossing) covers one road block (2 × 2 cells, block-aligned) that already is road and tiles as a straight, tee or cross (`rules`: "Zebra crossings go on a straight road or a junction"). It has no model of its own: the road tile under it draws its marked variant (`catalog/models.ts` `ZEBRA_PIECE_MODELS`: `road-crossing`, `road-tee-zebra`, `road-cross-zebra`); if the road around it later becomes a corner or end, the block draws plain. Placing / bulldozing it is just the object add / remove (the road stays); its road can't be repainted while it stands. Road connectivity and traffic ignore it. Junctions without a zebra draw their centre lines meeting (`road-intersection-line`, `road-crossroad-line`).
- **Footprints** (`catalog/objects.ts`, cells at rotation 0):
  - roundabout 6×6;
  - cottage, bungalow, family home and suburban home 4×4; big house and supermarket 5×4; townhouse and church 3×4; corner shop 3×3 (WP-17: homes and town buildings grew one cell each way);
  - pool 4×3; fountain 2×2;
  - garage 1×2; bus stop and swing 2×1;
  - traffic light, lamppost, postbox, trees, bush, planter, bench and barbecue 1×1.
  
  The tool centres a footprint on the pointer with `grid.anchorForPointer` (odd sizes on the hovered cell, even sizes on the nearest corner, clamped into the plot). Its `snap` parameter (v0.3) keeps a road feature's anchor on multiples of `ROAD_BLOCK`.
- Layers per cell: **ground** (exactly one `GroundKind`, default `field`), **object** (0–1 object covering the cell; multi-cell footprints anchored at min corner), and **edges** (hedges and fences on cell borders, canonical `n`/`w` sides).
- Rotation: quarter turns CCW from above; rotation 0 ⇒ model front faces +z (towards the default camera). Each model's native facing is corrected once via `rotationOffset` in `catalog/models.ts`.

## Placement rules (WP-02 implements in `town/rules.ts`, all unit-tested)

| Action | Valid when | Otherwise (`reason` → message shown to player) |
| --- | --- | --- |
| paint-ground | cell in bounds and kind differs | `out-of-bounds` "Outside your plot" · `no-change` (silent, never shown) |
| paint-ground road / over road (WP-12) | road on any cell converts its whole 2 × 2 block; another kind on a road cell converts the whole block to that kind; the clicked cell's change is last (primary) | road: `occupied` "Move the {label} first" if ANY block cell holds an object |
| paint-ground under an object | new kind ∈ that object's `allowedGround` | `occupied` "Move the {label} first" |
| paint-ground road | — also removes fences on the block's 4 inside edges, and on its outside edges where the neighbour is road (same change list, before the ground changes) | — |
| place-object | every footprint cell in bounds, unoccupied, ground ∈ `allowedGround` | `out-of-bounds` · `occupied` "Something is already here" · `blocked-by-road` "{label} can't go on a road" / `needs-ground` "{label} needs {ground}" |
| place-object bus-stop / traffic-light (`requiresAdjacent: 'road'`) | ≥ 1 footprint cell 4-adjacent to a road cell | `needs-ground` "Bus stops need to be next to a road" / "Traffic lights need to be next to a road" |
| place-object road feature (roundabout, v0.3) | anchor block-aligned (even x, z); any ground, including road. Changes: fence removals (edges inside the footprint, and between it and existing road) → ground → road for every non-road footprint cell → object add (primary, last) | `out-of-bounds` "Roundabout must line up with the road grid" (only scripted actions; the tool snaps) · `occupied` |
| paint-ground over a road feature | never while it stands | `occupied` "Move the Roundabout first" |
| place-edge | edge in bounds (border edges allowed) and not between two road cells; same kind already there ⇒ `no-change`; other edge kind ⇒ replace (remove + add) | `out-of-bounds` · `blocked-by-road` "Fences can't cross roads" |
| bulldoze | object covering the cell (any footprint cell) ⇒ remove object (a road feature also turns its road cells back to field, before the object removal); else an edge passed by the picker (pointer within 0.3 cell of it, 0.4 on touch) with a hedge or fence ⇒ remove it; else a road cell ⇒ its whole block back to field; else non-field ground ⇒ back to field | `nothing-here` (silent on drag, shown on click) |

Only road features stand on road; every other object's `allowedGround` excludes it.

Variant choice (e.g. tree shape, house model, traffic-light style) uses the seeded RNG at placement time and is stored in `PlacedObject.variant`, so undo/redo/save reproduce it exactly.

**Tall trees.** `ObjectDef.height` is a fixed vertical stretch of the drawn model (default 1): pine ×2, oak ×1.7, birch none (`catalog/objects.ts`). It is drawing only: the footprint stays 1 × 1, so rules, stats, saves and the bulldozer never see it, and the player has no control over it. `TownRenderer` stretches only Y (`origin = R(yaw) · S(j, j·h, j)`, `j` = the ±12 % per-tree jitter), so the crown stays inside its cell; the ghost stretches the same way (`GhostPart.scaleY`). Bush and everything else are unchanged. The wind shader measures a leaf's height along the model's own Y axis and bends at half rate above 1 unit, so tall trees sway more but don't lean into the next cell.

## Save format
`SavedTownV4` (= `SavedTown`) in `town/types.ts`: versioned, 64 × 64 (width/depth are stored; a smaller save, e.g. a 48 × 48 town, is centred on the plot by a whole number of road blocks, so it keeps its world position), RLE ground, objects, edges, next id, optional camera pose. `serialize.ts` validates unknown input (never trusts localStorage), demotes partial road blocks to field, drops road features that are not block-aligned or not standing on road, and round-trips (tested). Autosave: debounced 1 s after `town:changed` (never on cause `'load'`; off after any test-hook `setState`), key `tiny-town:save:v1` (a slot name; it did not change with the format). Code uses `SavedTown`.

**v4 (WP-17: bigger building footprints) has no migrations**, like v3: a v3 save would overlap under the new footprints, so it is rejected ("No migration from save version 3") and the game starts a fresh town. **v3 (v0.3) had no migrations either.** v0.3 renamed object and edge kinds (e.g. `tree-a` → `oak`, `townhouse-a` → `cottage`, `fence-small` → `fence-low`) and added road features. The owner asked for no backward compatibility, so `SAVE_MIGRATIONS` is empty: a v1 or v2 save is rejected ("No migration from save version 2"), `SaveStore.load()` returns null with `lastError` set, and the game starts a fresh town. The v1 → v2 migration, `migration.test.ts` and the `town/fixtures/v1-*.json` saves were deleted on purpose. The migration hook stays: to keep old saves loadable after a future change, add `SAVE_MIGRATIONS[4]`.

Settings (`muted`, `volume`, `grid`, `music`, `musicVolume`; defaults false / 0.8 / true / true / 0.5) under `tiny-town:settings:v1`; older settings without the music fields load with the defaults.

Music position (WP-18) `{ track, time }` under `tiny-town:music:v1` (`MUSIC_POSITION_STORAGE_KEY`), through `SaveStore.getMusicPosition()` / `setMusicPosition()`. Deleting the town save keeps it. Rules: `docs/assets/audio.md` §Background music.

## Rendering strategy
- `ModelLibrary` loads each GLB once and normalises it (scale, facing, base on y=0, footprint-centred).
- `TownRenderer` draws with **`InstancedMesh` pools keyed by (model, part)**; capacity grows by doubling. Ground `field` is not drawn per cell (the plot plane is). Pop-in/out tweens write per-instance matrices.
- Shared materials: Kenney kits use one colour-atlas texture per kit, so the whole town should need a handful of materials. Don't clone materials per instance.
- Ghost preview uses `ModelLibrary.createObject()` with a separate translucent tinted material (not shared with the town).
- Ambient cars (`LifeSystem`) are one `BatchedMesh`: +1 main-pass and +1 shadow draw call.
- FX (`PlacementFx`) use pooled particles in 3 meshes (soft dust, chips/leaves/petals, sparkles): at most 3 draw calls, and none when idle.

## Day/night (v0.3, WP-16)
Plan and rationale: `docs/plans/wp-16-day-night.md`. The as-built deviations are in `docs/progress.md` ("WP-16 as built").
- **Clock** (`world/dayCycle.ts`, pure):
  - `t ∈ [0,1)` of a day: dawn 0–0.10, day 0.10–0.65, dusk 0.65–0.75, night 0.75–1.
  - An Auto day is `DAY_LENGTH_S` = 600 s; `?debug&day=N` overrides it (debug only).
  - Modes: Auto (starts at 0.12 on Start), Day (0.55), Night (0.82).
  - A mode switch sweeps `t` forward over 2.5 s. It snaps under reduced motion (the test hook or the OS setting).
  - The clock runs only in the building phase. The title always shows 0.55 unless pinned.
  - `sampleDay(0.55)` reproduces the v0.2 look bit-exactly: `LIGHTING` / `SKY_PALETTE` / `SUN_DIRECTION` are the afternoon keyframe.
- **Settings:** `timeMode` ('auto' | 'day' | 'night', default auto) is saved with the settings. The time of day is never saved.
- **World** (`Environment.applyDaylight`):
  - One DirectionalLight is both sun and moon; it swaps direction where its intensity is 0.
  - Hemisphere, fog colour and near/far, `environmentIntensity`, and sky uniforms (stars, moon, cloud shade, sun visibility) follow the sample.
  - The shadow camera is refit only after the key moves > 0.2°.
  - The grid gets stronger at night (`GRID_NIGHT.boost` 0.25), its lines blend from white to a dim moon blue (`GRID_NIGHT.color` `#7896c4`), and it takes the scene fog like the ground, so it reads as subtly at night as by day.
- **Light sources** (`render/nightGlow.ts`): emissive masks on private material clones (`ModelSpec.glow`).
  - Masks are 16 × 4 swatch-cell `DataTexture`s on the Kenney atlases (window glass (11,1), lamp (8,2), lenses (9,1)/(11,3)/(15,3), car head (3,3) / tail (5,3)). Only homes glow: the supermarket, corner shop and church stay dark at night (WP-17, owner request).
  - Houses switch on one by one through a per-instance hash shader patch (`uLightsOn`/`uLightsOff`).
  - Emissive intensity is exactly 0 when `night` = 0, so the day look, icons and baselines are unchanged.
- **Ground light** (`render/NightLights.ts`): a lamp registry fed by `town:changed`, plus three instanced additive layers, all hidden when night < 0.05. No real PointLights.
  - lamp pools: +1 draw call;
  - lamp halos: +1, high tier only;
  - headlight beams: +1, ≤ 6 cars;
  - fireflies over open meadow cells: +1.
- **Life:** `LifeSystem.setNight(n)` → `TrafficSim.setDensity(1 − 0.5·n)`, so there are fewer cars at night. Car Kit cars face native +Z (`FRONT_ROTATION` 0 since v0.3).

## Budgets (full 64×64-cell town, desktop 1280×720; mobile 390×844)
The `stress-town` state is the gate. "Measured" gives the latest number and says where it came from. v0.3 was re-measured on the production preview on 2026-09-27; `docs/release.md` §Budgets has the full table and method. The 64 × 64 plot (2026-09-28) was measured on the dev server with the WP-11 method's browser (full Chromium, real GPU; mobile = Pixel 7 emulation, which gets the low tier).
The mobile triangle budget was raised from 250k to 320k with the 64 × 64 plot (owner decision, 2026-09-28): a full town holds 1.78× the area (100 homes instead of 64), with the same content per cell.

| Metric | Budget desktop | Budget mobile | Measured (desktop / mobile) |
| --- | --- | --- | --- |
| Draw calls | ≤ 150 | ≤ 120 | 64 × 64: day 31 / 31; night (t 0.82) 34 / 33 (dev server, 2026-09-28). v0.3 (48 × 48, production preview): day 32 / 32, night 35 / 34 |
| Triangles | ≤ 400k | ≤ 320k (250k until the 64 × 64 plot) | 64 × 64: day 362.4k / 291.3k; night 356.5k / 289.3k (dev server, 2026-09-28; mobile headroom ~29k; the town itself is ~236k). v0.3 (48 × 48): day 306.1k / 237.0k |
| Textures | ≤ 30 | ≤ 30 | Stress town 14 / 13, sample town 28 / 27 (v0.3 production preview; includes the 4 day/night glow masks) |
| Shadow maps | 1 × 2048 | 1 × 1024 | as budgeted (`Environment.setQuality`: high 2048, low 1024) |
| DPR cap | 2 | 1.5 | `MAX_DPR` in `config.ts` |
| Frame time (M-series laptop, headless full Chromium) | ≤ 8 ms | — | 1.38 ms day / 1.37 ms night on the stress town (v0.3 production preview, uncapped); v0.1: 1.36 ms |
| Initial download (JS + CSS + font + models + SFX + icons) | ≤ 8 MB | ≤ 8 MB | 4.70 MB over the network before the title (v0.3 production preview); `dist/` 4.94 MB without maps or music. The 4.68 MB music track is streamed after Start and isn't part of the initial download |

## Test hooks and diagnostics
`window.__THREE_GAME_TEST_HOOKS__` (installed in production too; policy in `docs/release.md`):
- `seed`;
- `setState(name)` for `title | empty-build | sample-town | active-play | asset-gallery | stress-town | night-town` (`night-town` = the sample town at t = 0.82). Every state reseeds, rebuilds deterministically and turns autosave off until reload. Unknown names throw.
- `setPausedForScreenshot`, `setReducedMotion`, `hideDebugUi`;
- `cellToClient(x, z)`, which takes 64 × 64 cell coordinates so bots click real cells with real input;
- `setCameraPose(pose)` (v0.3): moves the camera to `{targetX, targetZ, azimuth, polar, distance}` at once and renders, for screenshots of one spot (e.g. the asset gallery).
- `setTimeOfDay(t | null)` (v0.3, WP-16): pins the time of day (0..1) and applies the look at once, even while paused for a screenshot; `null` releases the pin. Every test state pins afternoon (0.55) except `night-town` (0.82).

The `sample-town` state uses every placing tool (34) with zero rejections: stats homes 8, residents 25, amenities 5, trees 5, roadTiles 40, props 15, fences 27 (the zebra crossing is on the main street). `asset-gallery` places all 26 object kinds (the zebra on the north–south straight of mask 5) at rotation 0, every edge kind, the ground swatches and the 16 road masks.

`window.__THREE_GAME_DIAGNOSTICS__` is typed in `src/vite-env.d.ts` and rebuilt every frame by `Game.publishDiagnostics`. Its fields:

| Field | Contents |
| --- | --- |
| `frame`, `phase`, `tool`, `rotation` | |
| `hover` | `{x, z, valid, reason}` or null, mirroring `hover:changed`; a just-placed cell reports valid |
| `town` | `TownState.stats()`: homes, residents, amenities (v0.3: Town-category buildings), trees, roadTiles (= road blocks), props (street, garden and plant objects), fences (every edge: fences and hedges) |
| `objects` | TownState object count |
| `render` | what TownRenderer actually draws: objects, groundTiles, edges, instances, pools, draw/shadow-call and triangle estimates, animating, dying, materials |
| `history` | `canUndo` / `canRedo` / `undoDepth` / `redoDepth` |
| `invalidCount` | |
| `camera` | pose |
| `quality` | |
| `audio` | `muted` / `volume` / `unlocked` / `loaded` / `starts`, plus `music`: `{enabled, volume, playing, loaded, requested, ducked, time, loops, resumedFrom}` |
| `save` | `{available, pending, lastError}` |
| `fx` | `FxDiagnostics`: active, drawCalls, spawned, dropped, reducedMotion, windTime, windStrength |
| `life` | `LifeDiagnostics`: loaded, cars, target, drivableCells, spawned, despawned, waiting, drawCalls, … |
| `daytime` | v0.3: `{mode, t, phase, pinned, night, lightsOn, lamps, drawCalls}`. `drawCalls` = what NightLights adds (0 by day) |
| `renderer` | three.js calls, triangles, geometries, textures; the canvas inspector reads this |
| `canvas` | |

There are no other diagnostics globals; the `__THREE_GAME_FX_DIAGNOSTICS__` / `__THREE_GAME_LIFE_DIAGNOSTICS__` shims were removed in `bc1ae5b`.

Playwright projects are `desktop-chrome` (1280×720) and `mobile-chrome` (Pixel 7 emulation, touch). Both run full Chromium (`channel: 'chromium'`) with 1 worker. The canvas inspector's `--mobile` mode is a 390 × 844 touch viewport.

Stable DOM ids for tests are `UI_TEST_IDS` in `src/ui/testIds.ts`, which has no side effects and is re-exported by `UiRoot.ts`. Examples: `btn-start`, `tool-<id>`, `cat-<category>`, `btn-undo`, `btn-redo`, `btn-mute`, `btn-rotate`, `tool-bulldoze`, the menu ids, and `chk-music` / `range-music`. A tool button exists only while its category is active.

Visual baselines live in `tests/visual-regression.spec.ts-snapshots/`: 6 PNGs covering title, sample-town and asset-gallery × desktop and mobile. They are **darwin only**, and a missing baseline fails.
