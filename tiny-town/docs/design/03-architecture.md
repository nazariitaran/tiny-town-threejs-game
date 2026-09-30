# Tiny Town — Architecture & Contracts

> **Status: current for v0.5 on `main` (package 0.5.0, tag `v0.5`, 2026-09-30): WP-15 to WP-25 are all merged, including WP-24 (frame budget) and WP-25 (graphics presets, tabbed menu).** This is the source of truth for the grid, rules, save format, module map, diagnostics and budgets. If this file and the code disagree, the code wins; fix this file.

## Stack
TypeScript (strict) · Vite 8 · three.js r184 (`three/addons/*` for MapControls, GLTFLoader) · Web Audio (SFX buffers; music streamed via `HTMLAudioElement`) · lil-gui (`?debug`) · Vitest (pure logic) · Playwright (browser, `channel: 'chromium'`, 1 worker). No physics engine: the game is grid-based and has no simulation that needs one. The build puts three.js in its own vendor chunk (`vite.config.ts`, WP-20), so the game's own chunk stays far below the 900 kB warning limit.

## Module map and ownership

```
src/
  main.ts                     bootstrap                                   integrator
  game/Game.ts                composition root, phases, update order,     integrator
                              test hooks, diagnostics
  game/events.ts        [C]   typed EventBus + GameEvents                 integrator
  game/config.ts        [C]   plot size, CELL_SIZE, cell↔world mapping,   integrator
                              assetUrl, storage keys
  game/graphics.ts      [C]   WP-25 graphics presets: GRAPHICS_PROFILES,  integrator
                              needsReload, GRAPHICS_UI (menu copy)
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
  town/townName.ts            town name rules, suggestion pick, slug      WP-20
                              (pure, tested)
  persistence/SaveStore.ts    localStorage autosave + settings            WP-02
  persistence/townFile.ts     town file encode/decode, file name (pure)   WP-21
  core/Loop.ts, Renderer.ts   rAF loop + frame pacing; WebGLRenderer setup/resize   integrator / WP-04 (Renderer.ts)
  core/FrameBudget.ts         WP-24: 60 fps active / 30 fps idle cap           integrator
  render/ModelLibrary.ts      GLB load + normalise                        WP-03
  render/materials.ts         WP-25: Standard → Lambert conversion        WP-25a
                              (toLambert), the lit material family
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
                              + birds: FlockSim (pure), BirdSystem        WP-22
                              (procedural InstancedMesh)
  fx/**                       placement VFX, wind sway                    WP-08
  photo/**                    town photo: capture, Polaroid frame,        WP-19
                              download/share; photoLayout.ts is pure
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
      └──── facts ◄── EventBus ◄── town:changed · build:placed/removed/invalid · history:changed
                         │
      TownRenderer ◄─────┤ town:changed      (incremental redraw, road neighbours re-tiled)
      LifeSystem   ◄─────┤ town:changed      (road graph; cars despawn when their road goes)
      BirdSystem         (no events: reads town.stats().trees when a flock is launched)
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
6. **Keyboard ownership**: digits 1–9 (the first nine tools of the active category; a category may hold up to 12, WP-23), Shift+1–5 (category), `?` (controls help) and `P` (take a photo, WP-19) belong to the UI (`ui/uiKeys.ts`, `UiRoot`); everything else (R, B, Esc, F/Home, WASD/arrows, Q/E, +/−, undo/redo) belongs to `ToolController`/`CameraController`.
7. **Two RNG streams**: gameplay (`Game.rng`: variants) and cosmetic (`Game.fxRng`: audio/fx jitter, ambient cars), so a sound never changes the next house variant. A third, `nameRng`, draws only town-name suggestions (WP-20, §Save format).

## Frame update order (Game.update)
`resizeRenderer` → `ToolController.update` → `CameraController.update` → `TownRenderer.update(animDelta)` → `LifeSystem.update(animDelta)` → `BirdSystem.update(animDelta)` (WP-22) → `DayClock.advance(animDelta)` (building phase only) → `Game.applyDaylight()` (`Environment.applyDaylight`, `NightLights.update`, `LifeSystem.setNight`, `daytime:changed` on a mode/phase change) → `Environment.update(animDelta, animElapsed)` → `PlacementFx.update(animDelta)` → frame-budget activity (camera glide, tweens) → diagnostics → render (the shadow scheduler decides whether the sun's map is redrawn, §Frame budget). With `setReducedMotion(true)`, `animDelta`/`animElapsed` are 0. With `setPausedForScreenshot(true)`, nothing updates but rendering continues.

## Grid
- Plot `64 × 64` cells (`PLOT_WIDTH/DEPTH`), `CELL_SIZE = 0.5` world units per cell, centred on the origin, so the plot is 32 × 32 world units (2026-09-28; WP-12 had 48 × 48 cells = 24 × 24 units, v0.1 24 × 24 one-unit cells). World-space tunables were scaled with it: grid fade 30 → 75, title orbit 44, decor belt 60–120, night fog 13 / 225, framing side insets −42 desktop / −412 phone (same zoom as on 48 × 48, so the plot's side corners start just off-screen). Toy scale: 1 world unit ≈ 8 m, a cell ≈ 4 m. Cell `{x, z}` centre = `cellToWorld`; a footprint's centre = `footprintCentreWorld`; `worldToGridPoint` gives fractional grid coordinates.
- **Road blocks:** roads come in aligned `ROAD_BLOCK × ROAD_BLOCK` (2 × 2) cell blocks whose min corner is at even `x, z` (`grid.roadBlockAnchor` / `roadBlockCells`). A block is either all road or has no road. One Kenney road tile (`ROAD_TILE_SIZE` = 1 world unit) covers a block; auto-tiling (`roadTiles.roadMask`) reads the 4 neighbouring blocks (±2 cells) and the tile is drawn once per block at its centre (`roadBlockCentreWorld`). Ambient cars drive on the 32 × 32 block grid. `stats.roadTiles` counts road blocks (a roundabout counts its 9).
- **Road features (v0.3):** an object whose `ObjectDef.roadFeature` is set (only the roundabout) stands on road. Its anchor is block-aligned and its footprint is whole road blocks (the roundabout: 6 × 6 cells = 3 × 3 blocks). The renderer draws the feature's model instead of the road tiles under it (`roadTiles.underRoadFeature`). A neighbouring road block joins a feature only at the middle block of the feature's facing side, its **arm** (`roadTiles.isFeatureArm`), so a road running past a roundabout doesn't tee into its kerb. Inside a roundabout only the 4 arm blocks and the centre block carry traffic (the corners are kerb); cars cross the centre on a ring path round the island, counter-clockwise from above (right-hand traffic; `lanePaths.ringPath`, radius 0.5).
- **Road markings (2026-09-28):** an object whose `ObjectDef.roadMarking` is set (only the zebra crossing) covers one road block (2 × 2 cells, block-aligned) that already is road and tiles as a straight, tee or cross (`rules`: "Zebra crossings go on a straight road or a junction"). It has no model of its own: the road tile under it draws its marked variant (`catalog/models.ts` `ZEBRA_PIECE_MODELS`: `road-crossing`, `road-tee-zebra`, `road-cross-zebra`); if the road around it later becomes a corner or end, the block draws plain. Placing / bulldozing it is just the object add / remove (the road stays); its road can't be repainted while it stands. Road connectivity and traffic ignore it. Junctions without a zebra draw their centre lines meeting (`road-intersection-line`, `road-crossroad-line`).
- **Footprints** (`catalog/objects.ts`, cells at rotation 0):
  - roundabout 6×6;
  - cottage, bungalow, family home and suburban home 4×4; big house and supermarket 5×4; townhouse and church 3×4; corner shop and donut shop 3×3 (WP-17: homes and town buildings grew one cell each way);
  - pool 4×3; tiered fountain 3×3; fountain and oak 2×2 (the oak is the big tree);
  - bus stop, swing and slide 2×1;
  - traffic light, lamppost, postbox, mailbox, pine, birch, bush, tulips, planter, bench, long bench, table and barbecue 1×1.
  - WP-23 removed the garage (1×2) and its `outbuilding` object group.
  
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

**Tall trees.** `ObjectDef.height` is a fixed vertical stretch of the drawn model (default 1): pine ×2, birch and oak none (`catalog/objects.ts`). It is drawing only: the footprint stays 1 × 1, so rules, stats, saves and the bulldozer never see it, and the player has no control over it. The **oak** is the exception to "trees are 1 × 1": it covers **2 × 2 cells** (1 × 1 world units, a road block's size) at natural proportions (model scale 0.9, about 0.98 × 1.74 × 1.0), so the crown fills its lot. Older saves keep their oaks' anchors, so oaks that now overlap are dropped on load (no migration; owner-approved). `TownRenderer` stretches only Y (`origin = R(yaw) · S(j, j·h, j)`, `j` = the ±12 % per-tree jitter), so the crown stays inside its cell; the ghost stretches the same way (`GhostPart.scaleY`). Bush and everything else are unchanged. The wind shader measures a leaf's height along the model's own Y axis and bends at half rate above 1 unit, so tall trees sway more but don't lean into the next cell.

## Save format
`SavedTownV4` (= `SavedTown`) in `town/types.ts`: versioned, 64 × 64 (width/depth are stored; a smaller save, e.g. a 48 × 48 town, is centred on the plot by a whole number of road blocks, so it keeps its world position), RLE ground, objects, edges, next id, optional camera pose. `serialize.ts` validates unknown input (never trusts localStorage), demotes partial road blocks to field, drops road features that are not block-aligned or not standing on road, and round-trips (tested). Autosave: debounced 1 s after `town:changed` (never on cause `'load'`; off after any test-hook `setState`), key `tiny-town:save:v1` (a slot name; it did not change with the format). Code uses `SavedTown`.

**v4 (WP-17: bigger building footprints) has no migrations**, like v3: a v3 save would overlap under the new footprints, so it is rejected ("No migration from save version 3") and the game starts a fresh town. **v3 (v0.3) had no migrations either.** v0.3 renamed object and edge kinds (e.g. `tree-a` → `oak`, `townhouse-a` → `cottage`, `fence-small` → `fence-low`) and added road features. The owner asked for no backward compatibility, so `SAVE_MIGRATIONS` is empty: a v1 or v2 save is rejected ("No migration from save version 2"), `SaveStore.load()` returns null with `lastError` set, and the game starts a fresh town. The v1 → v2 migration, `migration.test.ts` and the `town/fixtures/v1-*.json` saves were deleted on purpose. The migration hook stays: to keep old saves loadable after a future change, add `SAVE_MIGRATIONS[4]`.

**Catalog changes without a bump (WP-23).** New object kinds (mailbox, donut shop, tiered fountain, tulips, long bench, table, slide) need no version bump, and neither did removing the garage: `parseSave` already drops unknown object and edge kinds, so a v4 save or town file with garages still opens, without them (`serialize.test.ts` pins this; the WP-21 format promise holds). An older build opening a newer file drops the kinds it doesn't know the same way.

Settings (`muted`, `volume`, `grid`, `music`, `musicVolume`, `timeMode`, `graphics`; defaults false / 0.8 / true / true / 0.5 / `auto` / `medium`) under `tiny-town:settings:v1`; older settings without a field load with its default, and an unknown `graphics` value falls back to `medium` (WP-25).

**Town name (WP-20).** `SavedTownV4.name` is optional, so it needed no version bump: 1–30 characters (Unicode code points), control characters removed, whitespace collapsed and trimmed (`town/townName.ts` `sanitizeTownName`). `parseSave` keeps a sanitised name and drops one that isn't a string or ends up blank; a save without a name loads as `DEFAULT_TOWN_NAME` ("Tiny Town"), which is also the name after any test-state reset. `TownEditor` holds the name: `reset(name?)`, `load(save)` and `rename(name)` set it and emit `town:named { name, cause: 'load' | 'reset' | 'rename' }`; `serialize()` writes it. Renaming is not undoable. SaveStore autosaves on `town:named` with cause `rename` (debounced like an edit); a new town's name is written with its first edit, or its first rename. Events: `intent:start { mode, name? }` (the name of a `'new'` town), `intent:new-town { name }`, `intent:rename-town { name }`.

**Name suggestions (WP-20).** `Game` fetches `public/data/default_town_names.json` (owner-supplied, 500 names; `assetUrl(TOWN_NAMES_PATH)`) during load, next to the models; a failed fetch only warns, and the suggestion becomes "Tiny Town". It is not bundled, to keep the main chunk small. `UiRoot` gets `suggestTownName(avoid?)`, which picks through a **third RNG stream**, `Game.nameRng`. That stream is seeded from `crypto.getRandomValues` at boot (`utils/random.ts` `entropySeed`), because the fixed default seed would give every new player the same first name; `seed(n)` re-seeds it, so tests are deterministic. It is the only stream not on the fixed seed and is used for nothing else.

**Town files (WP-21).** A town can leave the browser as a file and come back on any machine. `persistence/townFile.ts` (pure, tested) encodes `{ app: 'tiny-town', kind: 'town', format: 1, exportedAt: <ISO>, town: SavedTown }` and names it `<slug>-YYYY-MM-DD-HHMM.tinytown.json` (`townFileStem`, shared with the photo). `town` is exactly the autosave (town, name, camera pose); settings and the time of day are not in it. `decodeTownFile` also takes a bare save, refuses more than 2 MB, and runs `parseSave`, mapping its errors to player-facing messages (not a town / newer version / older version / too big).
- **Download:** `intent:export-town` → `Game` serialises the **live** town with the camera pose → `town-file:ready { blob, fileName }` in the same task, so `UiRoot` downloads it (`utils/download.ts`) inside the click.
- **Open:** `UiRoot` reads the picked file (`<input type="file">`), decodes it, and shows the confirm with the file's name and date; Replace → `intent:open-town { save }` (already through `parseSave`). `Game.openTown`: `editor.load(save)` (cause `load`, history cleared), **writes the save at once** (and turns autosave back on after a test state), enters building and applies the file's camera. From the title it is also the Start click (audio unlock, `clock.startDay()`); from the menu the time of day carries on.
- **Format promise:** until WP-21, save-format bumps shipped without migrations. Now that towns live in files, a format change must add a `SAVE_MIGRATIONS` step, or accept that older files stop opening ("This town is from an older version…").

Music position (WP-18) `{ track, time }` under `tiny-town:music:v1` (`MUSIC_POSITION_STORAGE_KEY`), through `SaveStore.getMusicPosition()` / `setMusicPosition()`. Deleting the town save keeps it. Rules: `docs/assets/audio.md` §Background music.

## Rendering strategy
- `ModelLibrary` loads each GLB once and normalises it (scale, facing, base on y=0, footprint-centred).
- `TownRenderer` draws with **`InstancedMesh` pools keyed by (model, part)**; capacity grows by doubling. Ground `field` is not drawn per cell (the plot plane is). Pop-in/out tweens write per-instance matrices.
- Shared materials: Kenney kits use one colour-atlas texture per kit, so the whole town should need a handful of materials. Don't clone materials per instance.
- Ghost preview uses `ModelLibrary.createObject()` with a separate translucent tinted material (not shared with the town).
- Ambient cars (`LifeSystem`) are one `BatchedMesh`: +1 main-pass and +1 shadow draw call.
- Birds (`BirdSystem`, WP-22) are one `InstancedMesh` of a procedural 18-triangle bird (≤ 16 instances, per-instance colour and wing angles `aFlap`; the wings fold in the vertex shader, on the lit and the shadow depth material): +1 main-pass and +1 shadow call while a flock is up, 0 with an empty sky.
- FX (`PlacementFx`) use pooled particles in 3 meshes (soft dust, chips/leaves/petals, sparkles): at most 3 draw calls, and none when idle.

## Frame budget (WP-24)
The world never stops animating (cars, birds, wind, clouds), so every frame is a full frame. Before WP-24 the game rendered one on every display refresh (120 per second on a ProMotion Mac) at DPR 2 with 4× MSAA and a full shadow pass, which kept an M2 Max GPU ~70% busy in a big town (measurements: WP-24 in `docs/progress.md`).
- **Frame pacing** (`core/Loop.ts` `paceFrame`, `core/FrameBudget.ts`): the loop renders at most `activeFps` (60) while the player interacts and `idleFps` (30) after `idleAfterS` (4 s) without activity. Activity = pointer, wheel, touch or key input on the window, a moving camera (glide/damping; not the title screen's auto-orbit), town pop-in tweens and a developing photo. Skipped rAF ticks run neither update nor render; `delta` is the time since the last rendered tick. Pacing follows a fixed grid, so a 144 Hz display still averages 60. A hidden tab stops rAF altogether (browser).
- **Shadow map on demand** (`render/ShadowScheduler.ts`): `renderer.shadowMap.autoUpdate = false`. The map is redrawn on the next frame after `town:changed`, after `Environment.shadowVersion` changes (key light re-aimed or refitted, map resized), and on every frame while TownRenderer tweens run. Moving casters that aren't the town refresh at their own rate: cars `carHz` 30 (15 until 2026-09-30: the car shadow visibly lagged), a flock `birdHz` 30. A still town with no cars or birds draws no shadow pass at all. Test hooks, frames paused for a screenshot and photos always redraw the map first, so captures are exact.
- **DPR**: the cap comes from the graphics preset (§Graphics presets): Low 1, Medium 1.5 (the default; WP-24 lowered desktop from 2 to 1.5), High 2.
- **Caps per preset**: Low 30 / 30, Medium and High 60 / 30 (`GraphicsProfile.activeFps` / `idleFps`, applied to `FrameBudget.tuning`).
- `?debug` → lil-gui `Performance`: active/idle fps (0 = the display's rate), idle delay, car/bird shadow Hz. A preset change overwrites the sliders. Diagnostics: `perf`.

## Graphics presets (WP-25)
Plan: `docs/plans/wp-25-graphics-and-menu-tabs.md`; as built and measurements: `docs/progress.md` "WP-25 as built". The player picks **Low / Medium / High** in Menu → Graphics. **Every device starts on Medium**; there is no device guess any more (before WP-25 a touch screen silently got a cheaper look with different lighting).

The table is `GRAPHICS_PROFILES` in `src/game/graphics.ts` (a contract file):

| | Low | **Medium (default)** | High | Applies |
| --- | --- | --- | --- | --- |
| DPR cap (`maxDpr`) | 1 | 1.5 | 2 | live (resize) |
| Render scale (`renderScale`) | 0.75 | 1 | 1 | live (resize) |
| MSAA (`antialias`) | off | on | on | **reload** |
| Lit material (`material`) | Lambert | Standard | Standard | **reload** |
| Sun shadow map (`shadowMapSize`) | 1024 | 2048 | 2048 | live (`shadowVersion` bump) |
| Decor-ring trees (`decorFraction`) | 60%, spread evenly | 100% | 100% | live |
| Sky cloud fbm octaves (`skyOctaves`) | 3 | 5 | 5 | live (one sky recompile) |
| Frame cap active / idle | 30 / 30 | 60 / 30 | 60 / 30 | live |
| Lamp halos at night (`lampHalos`) | off | on | on | live |
- **Render scale (2026-09-30):** the canvas pixel ratio is `min(devicePixelRatio × renderScale, maxDpr)` (`graphics.ts` `effectivePixelRatio`, used by `resizeRenderer` and `canvas.dpr`). The DPR cap alone lowers nothing on a DPR-1 screen (a 1080p laptop or a 4K monitor at 100% scaling), so Low also renders at 0.75 of the screen's density there, and the browser upscales. Low on DPR 2 and on phones is still the cap (1); Medium and High are unchanged.

Environment lighting (the RoomEnvironment PMREM) and shadows are on at every level, so the three presets share one set of colours.
- **Boot preset** = the `?graphics=low|medium|high` URL override (tests and evidence; not saved; an invalid value is ignored), else the saved `GameSettings.graphics` (validated with `isGraphicsPreset`), else `DEFAULT_GRAPHICS` (`medium`). `Game.bootGraphics` fixes MSAA (`createRenderer(canvas, { antialias })`) and the material family (`new ModelLibrary(material)`).
- **Live parts:** `Game.applyGraphics(profile)`, at boot and on every change: `tuning.maxDpr` + resize; `Environment.applyGraphics` (shadow-map size, decor share, sky octaves); `FrameBudget.tuning` active / idle fps; `NightLights.setLampHalos` (the halo layer is always built and only shown when on).
- **Lambert** (`render/materials.ts` `toLambert`): with `material: 'lambert'` every lit `MeshStandardMaterial` is converted when it is created (ModelLibrary's GLTF materials, so the town, decor ring and ghost follow; TownRenderer slabs and style clones; terrain; cars; birds), keeping map, colour, emissive / emissiveMap / emissiveIntensity, vertex colours, transparency, side, alphaTest, name and userData. The wind-sway, window-stagger and wing-flap shader patches are applied after the conversion; `scene.environment` still lights Lambert in r184, so Low is close to Medium, not flat. Placement FX chips were always Lambert.
- **Decor share < 1** (`DecorRing.setFraction`): a deterministic, evenly strided subset of each mesh (round-down of n × fraction kept), so every arc of the ring, including the part in front of the orbiting title camera, keeps about that share.
- **Instant vs reload:** `needsReload(booted, next)` is true when MSAA or the material differs from what the page booted with (Medium ↔ High never needs one; anything ↔ Low does). The menu then shows "Some changes apply after a reload" with **Reload now**.
- **Events:** `intent:set-graphics { preset }` → `Game.setGraphics`: save (`saves.setSettings({ graphics })`, written at once), apply the live parts, emit `graphics:changed { preset, reloadRequired }`. The fact is also emitted once at boot, after `UiRoot` exists; the menu's radios render only from it. `intent:reload-graphics` → `saves.flush()` (a pending town autosave is written) and `location.reload()`; a `?graphics=` override is dropped from the URL first (`location.replace`), so the saved preset wins on the reload.
- **Diagnostics:** `quality` = the current preset; `graphics` = `{ preset, booted, reloadRequired, antialias, material, maxDpr, shadowMapSize, decorFraction, decorInstances, skyOctaves, activeFps, idleFps, lampHalos }`. `antialias` is read from the real WebGL context; `material` is measured over the scene after load and after every test state (`standard` | `lambert` | `mixed` | `none`).
- **Tests:** `tests/graphics.spec.ts` (each preset's row through `?graphics=`, saved preset boot, DPR caps at DPR 2), `tests/graphics-menu.spec.ts` (the menu end to end: Low → saved → Reload now → same town on Low with no MSAA and Lambert → Medium → reload; High live without a notice), `tests/menu-tabs.spec.ts` (the Graphics tab UI).

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
  - lamp halos: +1, Medium and High only (`lampHalos`, WP-25);
  - headlight beams: +1, ≤ 6 cars;
  - fireflies over open meadow cells: +1.
- **Life:** `LifeSystem.setNight(n)` → `TrafficSim.setDensity(1 − 0.5·n)`, so there are fewer cars at night. Car Kit cars face native +Z (`FRONT_ROTATION` 0 since v0.3).
- **Birds (WP-22):** `BirdSystem.setDaylight(night, phase)`: no new flock while night > 0.5 (one in the air finishes its crossing), and the wait between flocks is × 0.6 at dawn and dusk, when starlings are likelier.

## Birds (WP-22)
Plan: `docs/plans/wp-22-birds.md`.
- **Schedule** (`life/FlockSim.ts`, pure):
  - the first flock comes 10–25 s after a reset (page load), then one every 45–110 s;
  - the wait is × 0.6 at dawn/dusk and up to 25 % shorter with trees (fully at 40);
  - no new flock at night;
  - at most 2 flocks and 16 birds at once;
  - its own mulberry32 stream (`seed ^ BIRD_SEED_SALT` in `Game`): it never draws from `fxRng`.
- **Flight:**
  - A quadratic Bézier from 34 units off-centre, through a control point within 6 units of the centre (so it passes within about 8 units: over the town), to the far side (±35°).
  - Speed 2.4–3.2 units/s, so about 25 s per crossing.
  - Each flock flies a low lane (2.8–3.0) or a high lane (3.3–3.5), and a second flock takes the other one. Birds stay within ±0.12 of their lane: above the church and inside the shadow frustum (`PLOT_CONTENT_HEIGHT` 4).
  - Birds grow in / shrink out over the first and last 6 % of the path.
- **Species:** pigeons (cloud), starlings (tight cloud), geese (V) and gulls (loose line). Each has its own colour, size (1–1.5 × a 0.36 wingspan), flap rate and glide habit.
- **Tests and reduced motion:**
  - Test states set spontaneous flocks off until a reload, like autosave. So baselines and draw-call checks never meet a surprise flock; `spawnFlock(species?)` launches one.
  - The OS "reduce motion" setting stops spontaneous flocks.
  - `setReducedMotion(true)` clears the sky.
  - `?debug&flock=N` sets a fixed N-second wait (debug only).
- **Photo:** a flock in view is in the photo.

## Town photo (WP-19)
- **Flow:** the top-bar camera button or `P` (no modifiers, building phase only) → `UiRoot` sets its pending view to `photo` and emits `intent:take-photo` → `Game.takePhoto()`:
  1. enters the **menu** phase. The UI shows the photo view instead of the menu. As for the menu, the tools switch off (so the ghost, the footprint frame and the hover highlight go), the grid hides, the clock stops and the music ducks −3 dB;
  2. `photo/capture.ts` renders **one frame to the game canvas** at a raised pixel ratio (`photoPixelRatio`: the long edge reaches 2400 px, never below the screen ratio, capped by `MAX_RENDERBUFFER_SIZE` / `MAX_VIEWPORT_DIMS` and 4096), copies it into a 2D canvas, then restores the ratio and renders again, all in the same task, so nothing flickers. Rendering to the canvas (not a render target) keeps the tone mapping and sRGB output, so the photo matches the screen. The copy must follow the render in the same task because the drawing buffer is not preserved;
  3. `photo/PhotoFrame.ts` draws the Polaroid (layout in `photoLayout.ts`, scaled by the short edge: border 5 %, bottom strip 20 %) with the brick house badge, the **town's name** (WP-20; "Tiny Town" before WP-20), the date ("28 Sep 2026", player's locale) and a sun, or a moon at night. A long name shrinks to fit between the badge and the sun / moon (`fitCaptionTitle`, down to 60 % of the size), then ends in an ellipsis. No town stats and no time-of-day words: the icon says it (owner decisions). It is encoded as JPEG at 0.92 → `photo:ready {blob, width, height, fileName}` or `photo:error`.
- **What the photo shows:** exactly the current view: camera, time of day, cars, lights, fireflies and placement dust. The DOM UI is never in it. On phones it includes the strip under the dock.
- **Saving (UI):** Download = an object URL plus `a[download]` (`<town-slug>-YYYY-MM-DD-HHMM.jpg`, e.g. `puddleton-2026-09-29-1432.jpg`; `tiny-town-…` when the name has no ASCII letters or digits), inside the button's click (fresh user activation). There is no Share button (owner decision, 2026-09-28): on iOS a download goes to Files, and a long press on the preview image still offers "Save to Photos".
- **Closing:** Esc or "Back to town" emits `intent:close-menu` (straight back to building, the tool still selected). A second photo is ignored while one is developing.
- **Cost:** 60–90 ms per photo on an M-series laptop (capture + frame + encode). The JPEG is 0.2–0.4 MB at 2536 × 1688 (desktop) or 1188 × 2670 (Pixel 7).

## Budgets (full 64×64-cell town, desktop 1280×720; mobile 390×844)
The `stress-town` state is the gate. "Measured" gives the latest number and says where it came from. **v0.5 (WP-20 to WP-25) was measured on the production preview on 2026-09-30, desktop and phone both on Medium**; `docs/release.md` §Budgets has the full table, the earlier versions and the method (full Chromium, real GPU; mobile = Pixel 7 emulation). Until WP-25 phones got a hidden cheaper tier (1024 shadows, a quarter of the decor ring, no env lighting), so the mobile numbers below were measured on that tier; **since WP-25 phones start on Medium like desktop** (see the triangle row).
The mobile triangle budget was raised from 250k to 320k with the 64 × 64 plot (owner decision, 2026-09-28): a full town holds 1.78× the area (100 homes instead of 64), with the same content per cell.

| Metric | Budget desktop | Budget mobile | Measured (desktop / mobile) |
| --- | --- | --- | --- |
| Draw calls | ≤ 150 | ≤ 120 | v0.5 (production preview): day 31–33 / 31; night (t 0.82) 34–36 / 34; sample town 86–88 / 86. v0.4: day 31 / 31; night 34 / 33 |
| Triangles | ≤ 400k | ≤ 320k (250k until the 64 × 64 plot) | **v0.5 (production preview, Medium, stress town): day 328.3k–332.4k / 328.3k, night 324.3k / 324.3k–326.4k: the phone is over the 320k budget by up to ~8k (open owner decision, `docs/progress.md` "WP-25 as built").** WP-25 (dev server): Pixel 7 (412 × 839) Medium 324.1k, Low 289.3k; desktop (1512 × 982) Medium / High 332.3k, Low 297.5k. v0.4 (production preview, phones on the old cheaper tier): day 358.2k / 293.2k; night 354.3k / 289.2k. v0.3 (48 × 48): day 306.1k / 237.0k |
| Textures | ≤ 30 | ≤ 30 | Stress town 14 / 14, sample town 28 / 28 (v0.5 production preview; includes the day/night glow masks) |
| Shadow maps | 1 × 2048 | 1 × 2048 (1024 until WP-25) | per preset (`Environment.applyGraphics`): Low 1024, Medium / High 2048 |
| DPR cap | Medium 1.5 (2 until WP-24) | Medium 1.5 | per preset (`GRAPHICS_PROFILES.maxDpr`): Low 1, Medium 1.5, High 2; canvas pixel ratio = `min(devicePixelRatio × renderScale, maxDpr)` (`effectivePixelRatio`), so Low renders at 0.75 on DPR-1 screens |
| Frame time (M-series laptop, headless full Chromium) | ≤ 8 ms | — | v0.5 (production preview, CPU ms per rendered frame, stress town): 1.39 ms building (60 fps) / 1.94 ms idle (30 fps); sample town 1.68 / 2.88 ms. Up to v0.4 this row was the uncapped frame interval (v0.4: 1.46 ms day / 1.51 ms night), which WP-24's caps no longer allow; method in `docs/release.md` |
| Frame rate cap (WP-24) | 60 active / 30 idle | 60 / 30 | `FrameBudget` (§Frame budget); Low 30 / 30 |
| Initial download (JS + CSS + font + models + SFX + icons + name list) | ≤ 8 MB | ≤ 8 MB | 5.26 MB over the network before the title (v0.5 production preview; v0.4: 4.78 MB); `dist/` 5.07 MB without maps or music. The 4.68 MB music track is streamed after Start and isn't part of the initial download |

## Test hooks and diagnostics
`window.__THREE_GAME_TEST_HOOKS__` (installed in production too; policy in `docs/release.md`):
- `seed`;
- `setState(name)` for `title | empty-build | sample-town | active-play | asset-gallery | stress-town | night-town` (`night-town` = the sample town at t = 0.82). Every state reseeds, rebuilds deterministically and turns autosave off until reload. Unknown names throw.
- `setPausedForScreenshot`, `setReducedMotion`, `hideDebugUi`;
- `spawnFlock(species?)` (WP-22): launch a flock now; returns its bird count (0 when the sky is full);
- `cellToClient(x, z)`, which takes 64 × 64 cell coordinates so bots click real cells with real input;
- `setCameraPose(pose)` (v0.3): moves the camera to `{targetX, targetZ, azimuth, polar, distance}` at once and renders, for screenshots of one spot (e.g. the asset gallery).
- `setTimeOfDay(t | null)` (v0.3, WP-16): pins the time of day (0..1) and applies the look at once, even while paused for a screenshot; `null` releases the pin. Every test state pins afternoon (0.55) except `night-town` (0.82).

The `sample-town` state uses every placing tool (40, WP-23) with zero rejections: stats homes 8, residents 25, amenities 7, trees 5, roadTiles 40, props 23, fences 28 (the zebra crossing is on the main street). `asset-gallery` places all 32 object kinds (the zebra on the north–south straight of mask 5; the WP-23 pieces on a third row) at rotation 0, every edge kind, the ground swatches and the 16 road masks. `stress-town` puts a mailbox and trees where its 50 garages stood.

`window.__THREE_GAME_DIAGNOSTICS__` is typed in `src/vite-env.d.ts` and rebuilt every frame by `Game.publishDiagnostics`. Its fields:

| Field | Contents |
| --- | --- |
| `frame`, `phase`, `tool`, `rotation` | |
| `hover` | `{x, z, valid, reason}` or null, mirroring `hover:changed`; a just-placed cell reports valid |
| `town` | `TownState.stats()`: homes, residents, amenities (v0.3: Town-category buildings), trees, roadTiles (= road blocks), props (street, garden and plant objects), fences (every edge: fences and hedges) |
| `townName` | WP-20: the town's name (`TownEditor.name`), as the top bar and the photo show it |
| `objects` | TownState object count |
| `render` | what TownRenderer actually draws: objects, groundTiles, edges, instances, pools, draw/shadow-call and triangle estimates, animating, dying, materials |
| `history` | `canUndo` / `canRedo` / `undoDepth` / `redoDepth` |
| `invalidCount` | |
| `camera` | pose |
| `quality` | WP-25: the current graphics preset (`low` \| `medium` \| `high`) |
| `graphics` | WP-25: `{preset, booted, reloadRequired, antialias, material, maxDpr, shadowMapSize, decorFraction, decorInstances, skyOctaves, activeFps, idleFps, lampHalos}` (§Graphics presets); `antialias` from the real context, `material` measured over the scene |
| `audio` | `muted` / `volume` / `unlocked` / `loaded` / `starts`, plus `music`: `{enabled, volume, playing, loaded, requested, ducked, time, loops, resumedFrom}` |
| `save` | `{available, pending, lastError}` |
| `fx` | `FxDiagnostics`: active, drawCalls, spawned, dropped, reducedMotion, windTime, windStrength |
| `life` | `LifeDiagnostics`: loaded, cars, target, drivableCells, spawned, despawned, waiting, drawCalls, … |
| `birds` | WP-22 `BirdDiagnostics`: `auto` (spontaneous flocks on), flocks, birds, spawned (since the last reset), nextFlockIn (s), species[], drawCalls, shadowDrawCalls, positions `[{x, y, z}]` |
| `daytime` | v0.3: `{mode, t, phase, pinned, night, lightsOn, lamps, drawCalls}`. `drawCalls` = what NightLights adds (0 by day) |
| `perf` | WP-24: `{targetFps, idle, shadowRenders}`: the loop's cap this frame (60 active, 30 idle), whether it is idling, sun shadow-map redraws since boot |
| `photo` | WP-19: `{taken, developing, last}`. `last` = `{width, height, bytes, pixelRatio, ms}` of the latest framed JPEG, or null |
| `renderer` | three.js calls, triangles, geometries, textures; the canvas inspector reads this |
| `canvas` | |

There are no other diagnostics globals; the `__THREE_GAME_FX_DIAGNOSTICS__` / `__THREE_GAME_LIFE_DIAGNOSTICS__` shims were removed in `f06d012`.

Playwright projects are `desktop-chrome` (1280×720) and `mobile-chrome` (Pixel 7 emulation, touch). Both run full Chromium (`channel: 'chromium'`) with 1 worker. The canvas inspector's `--mobile` mode is a 390 × 844 touch viewport.

Stable DOM ids for tests are `UI_TEST_IDS` in `src/ui/testIds.ts`, which has no side effects and is re-exported by `UiRoot.ts`. Examples: `btn-start`, `tool-<id>`, `cat-<category>`, `btn-undo`, `btn-redo`, `btn-mute`, `btn-rotate`, `tool-bulldoze`, the menu ids, `chk-music` / `range-music`, the photo ids (`btn-photo`, `ui-photo`, `ui-photo-img`, `btn-photo-download`, `btn-photo-close`), the town name ids (WP-20: `btn-town-name` (the top-left pill), `btn-rename-town`, `ui-town-name` (the dialog, `data-mode` new / rename), `input-town-name`, `btn-town-name-shuffle`, `btn-town-name-cancel`, `btn-town-name-ok`), and the town file ids (WP-21: `btn-town-file` (top bar, > 440 px), `btn-town-file-menu` (menu, ≤ 440 px), `btn-title-open-file`, `ui-town-file`, `btn-town-file-download`, `btn-town-file-open`, `btn-town-file-close`, `input-town-file`, `ui-town-file-confirm`, `btn-town-file-cancel`, `btn-town-file-replace`, `btn-town-file-keep`), and the menu tab and graphics ids (WP-25: `MENU_TABS` = town / graphics / sound / help, `tab-menu-<tab>`, `panel-menu-<tab>`, `ui-graphics` (the Quality radio group), `radio-graphics-<preset>`, `btn-graphics-reload`). A tool button exists only while its category is active; a menu control is visible only while its tab is selected (`tests/helpers.ts` `openMenuTab`).

Visual baselines live in `tests/visual-regression.spec.ts-snapshots/`: 8 PNGs covering title, sample-town, asset-gallery and night-town × desktop and mobile (the mobile four re-captured for WP-25, when phones moved to Medium). They are **darwin only**, and a missing baseline fails.
