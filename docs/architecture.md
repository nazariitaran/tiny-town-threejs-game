# Tiny Town — architecture

The technical reference: modules, data flow, grid, rules, save format, rendering, test hooks. If this file and the code disagree, the code wins; fix this file. What the game is and how it plays: `docs/design.md`. Assets: `docs/assets.md`. Build, deploy and budgets: `docs/release.md`.

## Stack
TypeScript (strict) · Vite 8 · three.js r184 (`three/addons/*`: MapControls, GLTFLoader, RoomEnvironment) · Web Audio for SFX, `HTMLAudioElement` streaming for music · lil-gui (`?debug`) · Vitest (pure logic, Node) · Playwright (full Chromium, 1 worker). No physics engine: the game is grid-based. The build puts three.js in its own vendor chunk.

## Module map
```
src/
  main.ts                     bootstrap: creates Game, starts the loop
  game/Game.ts                composition root: phases, update order, test hooks, diagnostics
  game/events.ts        [C]   typed EventBus + GameEvents
  game/config.ts        [C]   plot size, CELL_SIZE, the cell↔world mapping, assetUrl, storage keys
  game/graphics.ts      [C]   graphics presets (GRAPHICS_PROFILES), effectivePixelRatio, needsReload, menu copy
  catalog/tools.ts      [C]   dock tools: id, category, layer, drag mode, icon, hint; RETIRED_TOOLS
  catalog/objects.ts    [C]   object defs: footprint, allowed ground, group, residents, models, roadFeature/roadMarking, height
  catalog/models.ts     [C]   model registry: GLB url, scale, offsets, glow; ZEBRA_PIECE_MODELS, ROAD_JOINT_MODELS
  town/types.ts         [C]   pure data model, SavedTown
  town/grid.ts          [C]   pure grid helpers: footprints, road blocks, edges, anchorForPointer
  town/TownState.ts, rules.ts, History.ts   data store + stats; placement rules (pure); undo/redo (200)
  town/TownEditor.ts          the only mutator: plans, applies, records history, publishes facts; holds the name
  town/serialize.ts           save format, validation, SAVE_MIGRATIONS
  town/sampleTown.ts          demo towns: sample, asset gallery, stress
  town/townName.ts, roadTiles.ts   name rules and slug; road auto-tiling, road-feature helpers (pure)
  persistence/SaveStore.ts    localStorage: autosave, settings, music position
  persistence/townFile.ts     town file encode/decode, file name (pure)
  core/Loop.ts, FrameBudget.ts, Renderer.ts   paced rAF loop; active / idle frame cap; WebGLRenderer setup + resize
  render/ModelLibrary.ts      GLB load + normalise, in the preset's material family
  render/TownRenderer.ts      incremental instanced drawing; pop-in, shrink-out and move tweens
  render/InstancePool.ts, tween.ts   one InstancedMesh per (model, part); easing curves
  render/objectPose.ts        object and edge poses, shared by TownRenderer and the ghost
  render/modelStyles.ts       MODEL_STYLES look overrides (tint, warm atlas, non-uniform scale)
  render/materials.ts         Standard → Lambert conversion (toLambert), materialFamily
  render/ShadowScheduler.ts   when the sun's shadow map is redrawn
  render/nightGlow.ts         glow masks, GlowRegistry, window-stagger shader patch
  render/NightLights.ts       lamp pools and halos, headlight beams; lampRegistry.ts, fireflies.ts
  render/IconStudio.ts        offline icon renderer for scripts/render-icons.mjs (not imported by the game)
  world/Environment.ts        lights, fog, environment map, shadow camera, daylight, live graphics parts
  world/Sky.ts, Terrain.ts, terrainShape.ts, GridOverlay.ts, DecorRing.ts
                              sky shader, terrain, grid overlay, background tree ring
  world/dayCycle.ts     [C]   pure day clock, phases, keyframes (its exported API)
  interaction/**              CameraController, framing.ts (aspect-aware poses), GridPicker, ToolController,
                              GhostPreview, keyboard.ts, strokeMath.ts
  ui/UiRoot.ts                all DOM UI; testIds.ts (UI_TEST_IDS), uiKeys.ts (digits, P), glyphs.ts
  audio/AudioManager.ts       Web Audio SFX, master mute / volume; owns MusicPlayer (streamed music) and CrowdLoop
  audio/CrowdLoop.ts          the stadium crowd: one looping buffer, gain set per frame, loaded on first use
  audio/musicPosition.ts      music resume rules (pure)
  audio/sfx.ts          [C]   SFX event ids
  audio/sfxTable.ts           generated from scripts/data/audio.json (npm run gen:sfx)
  life/TrafficSim.ts, lanePaths.ts, LifeSystem.ts
                              ambient cars: simulation, lane paths (incl. the roundabout ring), one BatchedMesh
  life/parkingLayout.ts       car-park stalls and the routes in and out of them, in lot space (pure)
  life/matchSchedule.ts       match nights at the stadium: schedule, level, crowd distance curve, stadium sites (pure)
  life/FlockSim.ts, BirdSystem.ts
                              birds: schedule and flight (pure), one InstancedMesh
  fx/**                       placement VFX, wind sway
  photo/**                    town photo: capture, Polaroid frame; photoLayout.ts is pure
  debug/DebugTools.ts         lil-gui panels (?debug)
  utils/random.ts, download.ts   seeded RNG + entropy seed; file download
  testing/gltfNode.ts         Vitest only: loads public/ GLBs in Node
  vite-env.d.ts         [C]   diagnostics and test-hook types
tests/                        Playwright specs + helpers.ts
scripts/                      canvas inspector, model inspector, generators, icon renderer, model composer, checks
```
`[C]` = shared contract: types and constants the whole game builds against. Adding an optional field, event or entry is fine; a rename, removal or signature change updates every caller in the same change.

## Data flow
```
 pointer/keys ─► ToolController ──BuildAction──► TownEditor ──► rules.planAction (pure)
      ▲                │                              │ ok: TownState.applyChanges + History
 UiRoot ─intent:*─►    │ tool:changed / hover:changed / selection:changed │
      ▲                ▼                              ▼
      └──── facts ◄── EventBus ◄── town:changed · town:named · build:placed/removed/invalid · history:changed
                         │
      TownRenderer ◄─────┤ town:changed   (incremental redraw, neighbouring road blocks re-tiled)
      LifeSystem   ◄─────┤ town:changed   (road graph; cars despawn when their road or car park goes)
      NightLights  ◄─────┤ town:changed   (lamp and stadium registries, firefly spots)
      AudioManager ◄─────┤ build:* / ui:sfx / intent:undo|redo / intent:set-* / phase:changed
        ├ MusicPlayer    │ → music:changed / audio:changed → UI
        └ CrowdLoop      │ (no events; Game.updateCrowd sets its level every frame)
      PlacementFx  ◄─────┘ build:placed / build:removed
      BirdSystem           (no events; reads town.stats().trees when a flock launches)
```
`build:placed` / `build:removed` carry `worldX/worldZ` at the footprint centre, the road-block centre for road, or the edge midpoint for fences and hedges.

Rules:
1. **Only `TownEditor` mutates town state.** A change list keeps its primary change last; build events derive from it. Everything else reads through `TownStateReader` or listens to `town:changed`.
2. **UI emits intents and renders facts**; it never calls game objects directly.
3. **Pure logic stays pure:** `src/town/**` and `src/catalog/**` import no three.js and no DOM.
4. **One cell↔world mapping** (`game/config.ts`); every runtime asset URL goes through `assetUrl()`.
5. **RNG streams:** `Game.rng` (gameplay: variants), `Game.fxRng` (audio/fx jitter, cars), a bird stream (`seed ^ BIRD_SEED_SALT`) and `Game.nameRng` (name suggestions only, seeded from `crypto.getRandomValues` at boot so new players get different first names; `seed(n)` pins it). Never `Math.random()`.
6. **Keyboard:** the UI owns digits 1–9 (the first nine tools of the active category; a category holds up to 12), Shift+1–5 (category), `?` (controls help) and `P` (photo) (`ui/uiKeys.ts`, `UiRoot`). `ToolController` owns R / Shift+R (rotate), B, M, V / Shift+V (variant), T (time mode), Esc, F / Home and undo/redo (Ctrl/Cmd+Z, Shift+Z, Y); `CameraController` owns WASD / arrows, Q / E and + / −.

## Frame update order (`Game.update`)
`resizeRenderer` → `ToolController.update` → `CameraController.update` → `TownRenderer.update` → `LifeSystem.update` → `BirdSystem.update` → `DayClock.advance` and `MatchSchedule.advance` / `tick` (building phase only) → `applyDaylight` (Environment, the match level, NightLights, `LifeSystem.setNight`, `BirdSystem.setDaylight`, the crowd's level, `daytime:changed` on a mode/phase change) → `Environment.update` → `PlacementFx.update` → activity tracking (frame budget) → render (the shadow scheduler decides whether the sun's map is redrawn). Everything after the camera gets `animDelta`, which is 0 under `setReducedMotion(true)`. With `setPausedForScreenshot(true)` nothing updates but rendering continues.

## Grid
- Plot `64 × 64` cells (`PLOT_WIDTH/DEPTH`), `CELL_SIZE = 0.5`, centred on the origin: 32 × 32 world units. Toy scale: 1 unit ≈ 8 m, a cell ≈ 4 m. `cellToWorld`, `footprintCentreWorld`, `worldToGridPoint` (fractional), `worldToCell`, `edgeToWorld` in `config.ts`.
- **Road blocks:** road comes in aligned 2 × 2 blocks (`ROAD_BLOCK`), min corner at even `x, z` (`grid.roadBlockAnchor` / `roadBlockCells`); a block is all road or none. One Kenney road tile (`ROAD_TILE_SIZE` = 1 unit) per block, drawn at `roadBlockCentreWorld`; `roadTiles.roadMask` reads the 4 neighbouring blocks. Cars drive on the 32 × 32 block grid. `stats.roadTiles` counts road blocks.
- **Road features** (`ObjectDef.roadFeature`: the roundabout, 6 × 6 cells = 3 × 3 blocks, and car parks): block-aligned anchor, stands on road, drawn instead of the road tiles under it (`roadTiles.underRoadFeature`). A neighbouring road joins only at an **arm** (`isFeatureArm`), set by `ObjectDef.roadArms`: `'sides'` (default, the roundabout) is the middle block of each side; `'front'` (car parks) is every block along the front side (+z at rotation 0, turned with the object), entered only from straight in front. Inside the roundabout only the 4 arm blocks and the centre carry traffic; cars circle the island counter-clockwise from above (right-hand traffic; `lanePaths` ring, radius 0.5). A `noTraffic` feature (car parks) is no part of the traffic graph: `TrafficSim.isRoad` is false on all its blocks, so through traffic passes the tee in front of it; cars enter only to park (§Cars in car parks). A `plainJoin` feature (car parks) makes the road blocks joining it draw a **joint**: `roadTiles.roadLook` takes the auto-tiled piece, `plainJoinMask` (the joining sides whose neighbour is a `plainJoin` arm) and `roadJointFor`, which turns those sides into the piece's rotation-0 frame (a symmetric piece takes the turn with the smallest mask), and picks `ROAD_JOINT_MODELS[piece][sides]`: the same piece without its centre line on those sides. A zebra straight uses `ZEBRA_JOINT_MODELS`; zebra tees and crosses have no centre lines and draw as usual. `TownRenderer` and the ghost both draw road through `roadLook`; placing, bulldozing or turning a road feature re-tiles the road blocks around it, so joints follow undo, redo and load.
- **Road markings** (`ObjectDef.roadMarking`; only the zebra crossing): covers one road block that tiles as a straight, tee or cross. No model of its own: the road tile under it draws its zebra piece (`ZEBRA_PIECE_MODELS`); if the road around it becomes a corner or end, the block draws plain. Placing / bulldozing it adds / removes the object only; its road can't be repainted while it stands. Traffic and connectivity ignore it.
- **Footprints** (cells at rotation 0, `catalog/objects.ts`): stadium 14×11; roundabout 6×6; car park by style (`ObjectDef.footprints`): small 4×2, medium 4×4, large 4×6; big house, supermarket 5×4; cottage, bungalow, family home, suburban 4×4; pool 4×3; townhouse, church 3×4; corner shop, donut shop, tiered fountain 3×3; fountain, oak, zebra 2×2; bus stop, swing, slide 2×1; everything else 1×1. A placed object covers its own style's footprint: always read it through `footprintOf(def, variant)` / `placedFootprint(object)` (an unknown style covers style 0's). `grid.anchorForPointer` centres a footprint on the pointer (odd sizes on the hovered cell, even on the nearest corner, clamped into the plot); `snap` keeps a road feature on the block grid.
- **Layers per cell:** ground (one `GroundKind`, default `field`), object (0–1; multi-cell footprints anchored at the min corner), edges (hedges and fences on cell borders, canonical `n` / `w` sides).
- **Rotation:** quarter turns CCW from above; rotation 0 faces +z (towards the default camera). Each model's native facing is corrected by `rotationOffset` in `catalog/models.ts`.

## Placement rules (`town/rules.ts`)
| Action | Valid when | Otherwise (`reason` "message") |
| --- | --- | --- |
| paint-ground | in bounds, kind differs; under an object only a kind in its `allowedGround` | `out-of-bounds` "Outside your plot" · `no-change` (never shown) · `occupied` "Move the {label} first" |
| paint road / over road | road converts the whole 2 × 2 block (any object in the block blocks it) and removes fences inside the block and towards neighbouring road; another kind on a road cell converts the whole block. Clicked cell's change last | `occupied` "Move the {label} first" (also over a road feature or zebra) |
| place-object | every footprint cell in bounds, free, ground ∈ `allowedGround`; road features / markings block-aligned; a zebra only on a straight, tee or cross | `out-of-bounds` (also "{label} must line up with the road grid", scripted actions only) · `occupied` "Something is already here" · `blocked-by-road` "{label} can't go on a road" · `needs-ground` "{label} needs {ground}" / "Zebra crossings go on a straight road or a junction" |
| place-object, `requiresAdjacent: 'road'` (bus stop, traffic light) | a footprint cell 4-adjacent to road | `needs-ground` "Bus stops need to be next to a road" / "Traffic lights need to be next to a road" |
| place roundabout or car park | any ground, the footprint of the chosen style. Changes: fence removals → ground → road for non-road cells → object add (last) | as place-object |
| place-edge | in bounds (border edges allowed), not between two road cells; same kind ⇒ `no-change`; other kind ⇒ replaced | `out-of-bounds` · `blocked-by-road` "Fences can't cross roads" |
| move-object | the object exists and is movable (not a road feature or marking); the new spot passes the place-object checks ignoring the object itself. Trees and plants keep their rotation. Changes: remove → add with the **same id and variant** | `nothing-here` "Nothing to move" · `cannot-move` "{label} can't be moved" · `no-change` · the place-object reasons |
| bulldoze | object on the cell ⇒ remove it (a road feature also returns its road to field); else the picked edge (within 0.3 cell, 0.4 on touch) ⇒ remove it; else road ⇒ its block to field; else non-field ground ⇒ field | `nothing-here` "Nothing to remove" (silent on drag) |

**Variants.** `PlacedObject.variant` stores the model, so undo, redo and saves reproduce it. `place-object` takes an optional `variant`: an integer in `[0, variants)` is used as given; anything else is rolled with the seeded RNG, except for a kind whose styles differ in size (`footprints`, the car park), which builds style 0 and draws no RNG (the footprint must be known before the checks). Player placements always carry one: `ToolController` remembers each multi-model tool's chosen model for the session (0 until picked) and the ghost shows the same model. Demo towns and tests send none. Events: `intent:select-variant { choice }`; `tool:changed` carries `variant: { choice, count } | null`.

**Tree height.** `ObjectDef.height` stretches the drawn model in Y only (pine × 2); footprint, rules and saves never see it. The oak is the 2 × 2 tree. Trees and plants get a hashed yaw and ± 12 % size per id (`render/objectPose.ts`); the ghost uses the same pose. The wind shader measures height along the model's Y and bends at half rate above 1 unit.

## Save format
`SavedTown` (`SavedTownV4`, `town/types.ts`), `CURRENT_SAVE_VERSION = 4`: width/depth, RLE ground, objects, edges, next id, optional camera pose, optional name. `parseSave` treats input as untrusted and never throws; it returns an `Error` for an unreadable or newer save, and otherwise repairs:
- a smaller save is centred on the plot by whole road blocks;
- partial road blocks become field;
- objects of unknown kinds, out of bounds, overlapping or on the wrong ground are dropped; road features and markings must be block-aligned, features on road; an out-of-range variant becomes 0, and an object is checked against its (repaired) style's footprint;
- unknown edge kinds and edges between two road cells are dropped.

New catalog kinds therefore need no version bump; an older build drops kinds it doesn't know.

**Migrations.** `SAVE_MIGRATIONS[v]` upgrades a raw save from version v to v + 1; the table is empty. An older save without a migration is rejected ("No migration from save version N"): `SaveStore.load()` returns null with `lastError` set and the game starts a fresh town. Towns live in downloaded files, so **any format change needs a version bump and a `SAVE_MIGRATIONS` step**.

**Autosave** (`SaveStore`): key `tiny-town:save:v1`, written 1 s after the last `town:changed` or rename; never on cause `load`; cause `reset` clears the save (an empty plot is never offered as Continue); flushed on `pagehide`. Off after any test state until reload.

**Settings** (`tiny-town:settings:v1`): `muted` false, `volume` 0.8, `grid` true, `music` true, `musicVolume` 0.5, `timeMode` `auto`, `graphics` `medium`. A missing or invalid field loads its default.

**Music position** (`tiny-town:music:v1`): `{ track, time }` via `SaveStore.getMusicPosition()` / `setMusicPosition()`; survives deleting the town. Resume rules: `docs/assets.md`.

**Town name.** 1–30 code points, control characters removed, whitespace collapsed (`townName.sanitizeTownName`); a blank or non-string name is dropped and loads as `DEFAULT_TOWN_NAME` ("Tiny Town"), as does every test state. `TownEditor.reset(name?)`, `load(save)` and `rename(name)` emit `town:named { name, cause }`; renaming is not undoable. Intents: `intent:start { mode, name? }`, `intent:new-town { name }`, `intent:rename-town { name }`. Suggestions come from `public/data/default_town_names.json` (500 names, fetched at load, not bundled; a failed fetch only warns and the suggestion becomes "Tiny Town") through `Game.nameRng`.

## Town file
`persistence/townFile.ts`: `{ app: 'tiny-town', kind: 'town', format: 1, exportedAt, town: SavedTown }`, named `<slug>-YYYY-MM-DD-HHMM.tinytown.json` (slug shared with the photo). `town` is the autosave payload (town, name, camera); settings and the time of day are not in it. `decodeTownFile` also accepts a bare save, refuses more than 2 MB and runs `parseSave`, mapping errors to player messages (not a town / newer / older / too big).
- **Download:** `intent:export-town` → `Game` serialises the live town → `town-file:ready { blob, fileName }` in the same task, so `UiRoot` downloads inside the click.
- **Open:** `UiRoot` reads and decodes the picked file and confirms (name, date); Replace → `intent:open-town { save }` → `Game.openTown`: `editor.load` (history cleared), the save is written at once and autosave turns on, building phase, the file's camera. From the title it also acts as Start (audio unlock, morning); from the menu the time of day carries on.

## Rendering
- `ModelLibrary` loads each GLB once and normalises it (scale, facing, base on y = 0, footprint-centred).
- `TownRenderer` draws `InstancedMesh` pools keyed by (model, part), capacity doubling. `field` ground is the plot plane, not drawn per cell. Kenney kits share one colour-atlas texture per kit; never clone materials per instance.
- **Moves:** a remove + add of the same id in one change list is a move: the object keeps its instances and tweens to its new pose (0.3 s slide, a hop of 0.1–0.35 units by distance, slerped turn; `tween.ts` `moveEase` / `hopArc` / `hopHeight`), also for undo / redo. Reduced motion, load and reset place it at once. `isAnimating` covers moves.
- **Ghost** (`GhostPreview`): `ModelLibrary.createObject()` with its own translucent material, posed by `render/objectPose.ts` like the town (`GhostPreview.test.ts` checks ghost = renderer for every kind × variant × rotation and edge kind). The bulldoze ghost and the Move tool's sky-blue `selected` ghost lie exactly on the object, sway with it and use a polygon offset, so only its visible surfaces tint; red and blue states recolour after the atlas (`uGhostRecolor`). `ToolController` has two ghosts: the hover / carry preview and the `selected` one on the carried object where it stands.
- **Draw-call costs:** cars: one `BatchedMesh`, +1 main and +1 shadow call (parked cars are the same instances). Birds: one `InstancedMesh` of a procedural 18-triangle bird (≤ 16 instances, per-instance colour and `aFlap` wing angles folded in the vertex shader on the lit and depth materials), +1 / +1 while a flock is up. Placement FX: pooled particles in 3 meshes, ≤ 3 calls, 0 when idle. Night lights: §Day/night.

## Frame budget
- **Pacing** (`core/Loop.ts` `paceFrame`, `core/FrameBudget.ts`): at most `activeFps` while the player interacts and `idleFps` after `idleAfterS` (4 s) without activity. Activity = pointer, wheel, touch or key input on the window, a moving camera outside the title screen, TownRenderer tweens, a developing photo. Skipped rAF ticks run neither update nor render; `delta` spans back to the last rendered tick (clamped to 50 ms). The pacing grid is fixed, so 144 Hz averages 60.
- **Shadow map on demand** (`render/ShadowScheduler.ts`, `shadowMap.autoUpdate = false`): redrawn after `town:changed`, after `Environment.shadowVersion` changes (key light re-aimed or refitted, map resized), and every frame while town tweens run. Cars and birds refresh it at `carHz` / `birdHz` (30 each; the faster while both move); cars only while one of them is not parked, pops in or has just come, gone or parked (`LifeSystem.castsShadows`), so a town whose cars all stand parked is still. A still town draws no shadow pass. Test hooks, screenshot pauses and photos always redraw it first.
- `?debug` → lil-gui `Performance`: active / idle fps (0 = display rate), idle delay, car / bird shadow Hz; a preset change overwrites them.

## Graphics presets
Menu → Graphics: **Low / Medium / High**, saved in the settings; every device starts on Medium. `GRAPHICS_PROFILES` in `game/graphics.ts`:

| | Low | **Medium** | High | Applies |
| --- | --- | --- | --- | --- |
| DPR cap (`maxDpr`) | 1 | 1.5 | 2 | live |
| `renderScale` | 0.75 | 1 | 1 | live |
| MSAA (`antialias`) | off | on | on | reload |
| Lit material | Lambert | Standard | Standard | reload |
| Sun shadow map | 1024 | 2048 | 2048 | live (`shadowVersion` bump) |
| Decor-ring trees | 60 % | 100 % | 100 % | live |
| Sky cloud octaves | 3 | 5 | 5 | live (one sky recompile) |
| Frame cap active / idle | 30 / 30 | 60 / 30 | 60 / 30 | live |
| Lamp halos | off | on | on | live |

- Canvas pixel ratio = `min(devicePixelRatio × renderScale, maxDpr)` (`effectivePixelRatio`), so Low also renders at 0.75 density on DPR-1 screens, where the cap alone changes nothing.
- Environment lighting (RoomEnvironment PMREM) and shadows are on at every level, so the presets share one palette.
- **Boot preset:** `?graphics=low|medium|high` (not saved; invalid ignored), else the saved setting, else `medium`. It fixes MSAA (`createRenderer`) and the material family (`new ModelLibrary(material)`).
- **Live parts** (`Game.applyGraphics`): DPR and render scale + resize; `Environment.applyGraphics` (shadow-map size, decor share, sky octaves); `FrameBudget.tuning` fps; `NightLights.setLampHalos`.
- **Lambert** (`toLambert`): every lit `MeshStandardMaterial` is converted at creation (models, ghost, lawns, terrain, cars, birds); shader patches (wind, window stagger, wing flap) apply after the conversion. `scene.environment` still lights Lambert.
- **Decor share** (`DecorRing.setFraction`): a deterministic, evenly strided subset of each mesh.
- **Reload:** `needsReload(booted, next)` is true when MSAA or the material differs from the boot preset (anything ↔ Low). The menu then offers **Reload now**.
- **Events:** `intent:set-graphics { preset }` → save at once, apply live parts, `graphics:changed { preset, reloadRequired }` (also emitted once at boot; the menu radios render only from it). `intent:reload-graphics` → `saves.flush()`, then reload; a `?graphics=` override is dropped from the URL first.

## Day/night
- **Clock** (`world/dayCycle.ts`, pure): `t ∈ [0, 1)`: dawn 0–0.10, day 0.10–0.65, dusk 0.65–0.75, night 0.75–1. An Auto day is `DAY_LENGTH_S` = 540 s with per-phase speeds (`PHASE_SPANS`): dawn 60 s, day 300 s, dusk 60 s, night 120 s. Modes: Auto (starts at 0.12 on Start), Day (0.55), Night (0.82). A mode switch sweeps `t` forward over 2.5 s; it snaps under reduced motion (hook or OS setting). The clock runs only while building; the title shows 0.55 unless pinned. The afternoon keyframe equals `LIGHTING` / `SKY_PALETTE` / `SUN_DIRECTION` (`Environment.ts`).
- **Settings:** `timeMode` is saved; the time of day is not. Intents: `intent:set-time-mode`, `intent:cycle-time-mode` (T, the top-bar button).
- **World** (`Environment.applyDaylight`): one DirectionalLight is sun and moon, swapping direction at zero intensity. Hemisphere, fog, `environmentIntensity` and sky uniforms follow the sample. The shadow camera refits only after the key moves > 0.2°. The grid turns a dim moon blue at night (`GRID_NIGHT`) and takes the fog.
- **Glow** (`render/nightGlow.ts`): emissive masks (16 × 4 `DataTexture`s, one texel per Kenney atlas cell) on private material clones (`ModelSpec.glow`). Only homes, lampposts, traffic lights, cars and the stadium glow; shops and the church stay dark. The stadium's `floodlight` kind lights its lamp banks and scoreboard digits, which sample atlas cells nothing else on the model uses, at the match level (§Match nights), not with the street lamps. Houses switch on one by one via a per-instance hash patch (`uLightsOn` / `uLightsOff`). Emissive is exactly 0 by day, so day captures are unaffected.
- **Ground light** (`render/NightLights.ts`): no real PointLights; instanced additive layers, hidden while night < 0.05, one draw call each: lamp pools, lamp halos (Medium / High; offset `lampOutset` along the arm, fading out above the lamp), headlight beams (≤ 6 cars), fireflies over free meadow cells, and on a match night the stadium's spill pool and mast halos (§Match nights).
- **Life:** `LifeSystem.setNight(n)` → traffic density `1 − 0.5·n`. Parked cars keep the batch's lamp glow (one material) but get no headlight beam (`CarPose.beam`).

## Match nights
Ambient, like the cars: nothing is saved, `TownEditor` never sees a match, and there are no events.
- **Schedule** (`life/matchSchedule.ts` `MatchSchedule`, pure, owned by `Game`): counts nights; odd ones (`isMatchNight`) are match nights. A night begins when the displayed clock passes `KICKOFF_T` (0.70, `T_SUNSET`) and is still in the evening once any mode sweep has ended, so a sweep that only passes sunset on its way to Day mode is not a night; a reduced-motion snap counts the same way. A held clock in the evening (Night mode) begins a new night every `HELD_NIGHT_S` (= `DAY_LENGTH_S`). On a match night the window stays open until `MATCH_NIGHT_S` (30) seconds of the night phase have passed, or the clock leaves the evening. `tick(night, delta)` moves one number towards on (window open and dark) or off at the fade rates (`MATCH_FADE_IN_S` 4 s, `MATCH_FADE_OUT_S` 5 s), so no clock jump, mode sweep or new night can snap it. `level(night)`, for the lights, is that fade × the street lamps' switch-on gate (`night` 0.3–0.42), so it is exactly 0 by day; `sound(night)`, for the crowd, is the fade alone, so a sweep to Day mode fades the crowd out over the full 5 s while the lights go with the sky.
- **Driving it** (`Game`): `stepMatch` runs after `DayClock.advance`, in the building phase only, with `animDelta` scaled by `DAY_LENGTH_S / dayLengthS` (so `?debug&day=N` shortens the match with the day); the title, the menu, the photo view, reduced motion and a screenshot pause therefore freeze it. `MatchSchedule.start(t)` on Start, Continue and a town opened from the title resets the count (and begins a night at once when the session starts after sunset, i.e. in Night mode); every test state calls `reset`. **A pinned clock runs no schedule** (`sync` only, also on the first frame after a release; `tick` still runs), so test states and `setTimeOfDay` never start a match; the `setMatchNight` hook does. `applyDaylight` reads the level (0 outside building / menu), hands it to `NightLights.update(sample, match)` and calls `updateCrowd`, so test hooks apply both while paused.
- **Light on the stadium** (`render/nightGlow.ts` `applyFloodlight`): a shader patch on the stadium's private `floodlight` glow clone, Standard or Lambert. Four spots at the mast lamp banks, aimed at the middle of the pitch, add `albedo × colour × Σ cone × wrapped N·L / (1 + d² / range²)` to the emissive term (back faces use the flipped normal), in model space (the instance matrix only places the stadium). `uFloodLevel` = `floodLitLevel(match, night)` (softer at dusk); at 0 the branch is skipped, so day pixels are unchanged. `GlowRegistry.flood` is the one uniforms object; `NightLights.measureMasts` fills the lamp positions from the model (the lamp-cell triangles of each quadrant) and the lot size from its bounds. No three.js light, no shadow pass, no texture.
- **Light around it** (`NightLights`): layer `floodPool`, one ground quad per stadium turned with it, 0 inside the lot and fading over `floodReach` (2.4 units) outside its walls; layer `floodHalo`, a billboard per mast head, drawn only with `lampHalos` (Medium / High). +2 draw calls on a match night (+1 on Low), 0 otherwise; both are warmed with the other layers at load.
- **Sites** (`StadiumSites`, owned by `NightLights`): the stadiums and their footprint centres, rebuilt on `town:changed`; `distanceTo(x, z)` is the nearest centre.
- **Crowd** (`Game.updateCrowd` → `AudioManager.setCrowdLevel` → `audio/CrowdLoop.ts`): level = `MatchSchedule.sound` × `crowdGainAt(distance from the camera's ground target to the nearest stadium)`: 1 within `CROWD_FULL_DISTANCE` (3.5), (1 − x)² down to 0 at `CROWD_CUTOFF_DISTANCE` (20), the same for every stadium. `CrowdLoop` fetches and decodes the file the first time the level is above 0 with audio unlocked, loops a buffer source between `CROWD_LOOP_START_S` and + `CROWD_PERIOD_S` into a gain node on the master (so Mute and Volume apply), ramps the gain (`setTargetAtTime`, only on a change ≥ 0.01), and stops the source 1 s after silence. Gain = level × `CROWD_TRIM` (0.5) × the menu duck (−3 dB); 0 while muted or hidden.

## Cars in car parks
Ambient, like the rest of `life/`: nothing is saved and `TownEditor` never sees a car.
- **Layout** (`life/parkingLayout.ts`, pure): lot space is the frame of `scripts/build-parking.py` `layout()` (x across the 2-unit front, y into the lot, y = 0 the open front); `lotFrame` + `lotToWorld` turn it by the object's rotation onto its footprint centre. `stallPose(style, stall)` is the parked pose (small: 4 bays facing in from the street; medium / large: left column front to back, then the right one, noses to the kerb). `entryRoute(style, gate, approach, stall)` and `exitRoute(style, stall, gate, exit)` are pre-sampled polylines split into legs (forward or reverse, each with its top speed); a combination that cannot be driven cleanly is `null`. `gate` is the front block (0 or 1). Aisle-lot routes start and end on the lot's front edge on the street lanes; small-lot routes include the stretch across the front block. `parkingLayout.test.ts` reads the real GLBs: stalls match the painted bays, and every route is swept in lot space with a car box against the models' planters, sign, kerbs and a car parked in every other stall; separate cases check that `lotToWorld` puts the stalls on the drawn model at all four rotations. Change the models and the test says which route breaks.
- **Phases** (`TrafficSim`, `Car.phase`): `drive` → (`approach`, aisle lots: crossing the front block on the normal lane path) → `in` → `parked` → `out` (reverse legs, then forward) → `drive`.
- **Deciding:** when a car enters a plain road block that fronts a car park's entrance, has driven 4 blocks since it spawned or last parked, and fewer than `parkedShare` (half) of the cars are in car parks, it lists the free stalls it can reach from there (direction order N, E, S, W, then stall order) whose lot is idle, whose front block is free and which have a way back out. The front block must be free to take, not asked for by a car waiting to leave, and no other car within 0.75 of it (its tail is still in the block behind). Two entries that would be hairpins (the small lot's inner bays from the far front block, an aisle lot's first two right-hand stalls from the right-hand gate) are not offered. No option, no draw; otherwise one draw against `parkChance` (0.55) and, on a yes, one for the stall. A town without car parks therefore draws exactly what it drew before. Dwell is uniform in `dwellMin`–`dwellMax` (10–30 s); tuning lives in `TrafficSim.parking` (`?debug` → Life).
- **No tables to leak:** a stall is taken while some car names it, a lot is busy while one of its cars is not `parked`, and a front block is held while a car with `locks` names it. Removing a car, by any route, frees all three.
- **Front-block lock:** a car holds its lot's front block (`Car.locks`) from the decision to park until its body is inside the lot, and on the way out from the moment it may go (in its stall for a small lot, at the hold point inside an aisle lot) until it drives on into the next block. Other cars treat a held block like a closed crossing: they ease to a stop line 0.55 before the end of their path (never closer than 0.26, so their nose stays out; on a turn, 0.2 into the arc while they still can, not mid-junction) and, with the queue behind them, do not count the wait towards the gridlock breaker (`Car.held`). Lots facing each other across one block share that block's lock.
- **A holder never waits for a holder.** A car takes a block only if it is plain road, empty (no car's nose or tail over its edge either), with nobody too close to stop, held by nobody, and not the block another holder is about to drive into; a leaving car also needs the block it will drive into (its way out, chosen when its dwell ends and again only if an edit closes it) to be held by nobody. So two manoeuvres are never each in the other's way, every manoeuvre ends, and held cars always resume. On the last leg out of a bay a car is in the street lane (`merging`): it follows the car ahead like any other, waits 0.3 before the end of its route while a car in the next block (or about to enter it) is within 0.9 of where it comes out, and can use the gridlock breaker. A car that has just left an aisle lot keeps its block until it has turned out of it. A car that has waited 3 s to leave **asks** for its front block (`Car.asking`): cars that can still stop ease up at the stop line, for at most 3 s each, so a busy street cannot starve it; a car standing in a block that is itself asked for drives on instead. From 6 s, no other car within two blocks starts to park or leave before it has gone (a wait more than 0.5 s longer wins; near-equal waits defer to nobody), so neighbouring car parks take turns. As a guard, a car that has not moved for 30 s, or has asked to leave for 60 s, is taken away and replaced on the road (`stats.unstuck`; the tests hold it at 0).
- **Town changes:** on any change that touches roads or road features, a lot car stays only while its lot stands unchanged (same id, anchor, rotation, style), the front block it is using is still plain road, and its stall still has a way out; otherwise it is removed at once, like a car whose road goes. `load` / `reset` clear everything; redo brings a lot back empty. Night thinning removes the newest cars first, parked or not.
- **Drawing:** the same `BatchedMesh` slots. Lot routes pass centimetres from kerbs and parked cars, so `LifeSystem` turns a lot car's yaw to its facing at `YAW_FOLLOW_LOT` (60 /s, against 18 on the road: next to no lag), legs cap their speed at 1.15 × their tightest radius, and a car comes onto a route at no more than 1.5 × its first leg's speed.

## Birds
- **Schedule** (`life/FlockSim.ts`, pure, own mulberry32 stream): the first flock 10–25 s after a reset, then every 45–110 s; the wait is × 0.6 at dawn / dusk (starlings likelier) and up to 25 % shorter with trees (fully at 40). No new flock while night > 0.5 (one in the air finishes). At most 2 flocks and 16 birds.
- **Flight:** a quadratic Bézier from 34 units out, over the town, to the far side; ~25 s a crossing. Two altitude lanes (3.3–3.5 and 3.8–4.0), one per flock, above the stadium floodlights (2.85, the tallest thing) and inside the shadow frustum, which is fitted to the plot up to `PLOT_CONTENT_HEIGHT` (4.5, `game/config.ts`); `catalog.test.ts` holds every model under the birds and the birds under that height. Birds grow in / shrink out at the path ends.
- **Species:** pigeon (cloud), starling (tight cloud), goose (V), gull (loose line); `SPECIES` in `FlockSim.ts`.
- **Tests and motion:** test states switch spontaneous flocks off until reload; `spawnFlock(species?)` launches one. The OS reduce-motion setting stops spontaneous flocks; `setReducedMotion(true)` clears the sky. `?debug&flock=N` gives a fixed N-second wait.

## Town photo
- **Flow:** the top-bar camera or `P` (no modifiers, building only) → `intent:take-photo` → `Game.takePhoto()`:
  1. enters the **menu** phase (the UI shows the photo view): tools off (no ghost or hover), grid hidden, clock stopped, music ducked −3 dB;
  2. `photo/capture.ts` renders one frame to the game canvas at a raised pixel ratio (long edge 2400 px, capped by the GPU and 4096), copies it to a 2D canvas, restores the ratio and renders again, all in one task (the drawing buffer is not preserved). Rendering to the canvas keeps tone mapping and sRGB, so the photo matches the screen;
  3. `photo/PhotoFrame.ts` (lazy chunk) draws the Polaroid (`photoLayout.ts`) with the house badge, the town name (shrunk, then ellipsised, to fit), the date in the player's locale and a sun or moon; JPEG 0.92 → `photo:ready { blob, width, height, fileName }` or `photo:error`.
- **Content:** exactly the current view (camera, time of day, cars, birds, lights, dust); never the DOM UI.
- **Saving:** Download = object URL + `a[download]` inside the click: `<slug>-YYYY-MM-DD-HHMM.jpg` (`tiny-town-…` when the name has no ASCII letters or digits). No Share button; on iOS a long press on the preview offers "Save to Photos".
- **Closing:** Esc or "Back to town" → `intent:close-menu`, tool still selected. A second photo is ignored while one develops.
- **Cost:** 60–90 ms per photo on an M-series laptop; 0.2–0.4 MB JPEG.

## Budgets
Targets and the latest measurements: `docs/release.md` §Budgets. The `stress-town` state is the gate.

## Test hooks
`window.__THREE_GAME_TEST_HOOKS__` (installed in production too; policy in `docs/release.md`), typed in `vite-env.d.ts`:
- `seed(n)` reseeds every stream;
- `setState(name)` for `title | empty-build | sample-town | active-play | asset-gallery | stress-town | night-town`: reseeds, rebuilds deterministically, pins the clock (0.55; `night-town` = sample town at 0.82, no match), turns autosave and spontaneous flocks off until reload. Unknown names throw;
- `setPausedForScreenshot`, `setReducedMotion`, `hideDebugUi`;
- `cellToClient(x, z)`: client coordinates of a cell centre, so bots click with real input;
- `setCameraPose({ targetX, targetZ, azimuth, polar, distance })`: moves the camera at once and renders;
- `setTimeOfDay(t | null)`: pins the time of day and applies it at once, even while paused; `null` releases;
- `spawnFlock(species?)`: launches a flock now; returns its bird count (0 when the sky is full);
- `setMatchNight(on | null)`: `true` holds a stadium match at full level (lights and crowd, once it is dark), `false` holds none, `null` returns to the schedule. Applies at once, even while paused.

Demo towns (`sampleTown.ts`, zero rejections, tested):
- `sample-town` uses every placing tool (40; Move and Bulldoze are modes): homes 8, residents 25, amenities 8 (incl. the stadium south of the shops, its gate on the side street), trees 5, roadTiles 46 (incl. the large car park facing the side street), props 23, fences 28.
- `asset-gallery` places all 34 object kinds at rotation 0 (the three car-park styles on a road of their own, the stadium in the south-east), every edge kind, the ground swatches and the 16 road masks.
- `stress-town` fills the plot: 100 homes, 50 mailboxes, a roundabout.

## Diagnostics
`window.__THREE_GAME_DIAGNOSTICS__` is a getter (`Game.installDiagnostics`): each read builds a fresh snapshot, so frames never pay for it. Shapes are in `vite-env.d.ts`. Fields:
- `frame`, `phase`, `tool`, `rotation`, `invalidCount`, `camera`;
- `hover` `{x, z, valid, reason}` (mirrors `hover:changed`), `selection` (the carried object), `variant` `{choice, count}`;
- `town` (`TownState.stats()`: homes, residents, amenities (amenity group), trees, roadTiles (road blocks), props (street, garden and plant objects), fences (all edges)), `townName`, `objects`, `history`;
- `render`: what TownRenderer draws (objects, ground tiles, edges, instances, pools, call and triangle estimates, animating, dying, materials, `roadJoints`: road tiles drawn as a car-park joint);
- `quality` (the preset) and `graphics` `{preset, booted, reloadRequired, antialias, material, maxDpr, renderScale, shadowMapSize, decorFraction, decorInstances, skyOctaves, activeFps, idleFps, lampHalos}`; `antialias` is read from the context, `material` measured over the scene after load and every test state (`standard | lambert | mixed | none`);
- `audio` (incl. `music` and `crowd` `{level, gain, requested, loaded, playing, ducked, starts}`), `match` `{night, matchNight, playing, forced, level, stadiums, distance}`, `save` `{available, pending, lastError}`, `fx`, `life` (cars, target, `parked`, `manoeuvring`, per car `carCells` with its cell, position, `phase`, `lot`, `stall`), `birds`, `daytime` `{mode, t, phase, pinned, night, lightsOn, lamps, drawCalls, stadiums, floodlights}`, `photo` `{taken, developing, last}`, `perf` `{targetFps, idle, shadowRenders}`;
- `renderer` (three.js calls, triangles, geometries, textures) and `canvas` (sizes, effective DPR); the canvas inspector reads these.

There are no other diagnostics globals.

## Browser tests
- Playwright projects: `desktop-chrome` (1280 × 720) and `mobile-chrome` (Pixel 7 emulation, touch), full Chromium (`channel: 'chromium'`) on the real GPU, 1 worker. The canvas inspector's `--mobile` is 390 × 844.
- Stable DOM ids: `UI_TEST_IDS` and `MENU_TABS` in `src/ui/testIds.ts` (side-effect free; specs import it). A tool button exists only while its category is active; a menu control is visible only while its tab is selected (`tests/helpers.ts` `openMenuTab`).
- Visual baselines: `tests/visual-regression.spec.ts-snapshots/`, 8 PNGs (title, sample-town, asset-gallery, night-town × desktop, mobile). Darwin only; a missing baseline fails.
