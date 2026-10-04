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
  catalog/models.ts     [C]   model registry: GLB url, scale, offsets, glow; ZEBRA_PIECE_MODELS
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
  audio/AudioManager.ts       Web Audio SFX, master mute / volume; owns MusicPlayer (streamed music)
  audio/musicPosition.ts      music resume rules (pure)
  audio/sfx.ts          [C]   SFX event ids
  audio/sfxTable.ts           generated from scripts/data/audio.json (npm run gen:sfx)
  life/TrafficSim.ts, lanePaths.ts, LifeSystem.ts
                              ambient cars: simulation, lane paths (incl. the roundabout ring), one BatchedMesh
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
      LifeSystem   ◄─────┤ town:changed   (road graph; cars despawn when their road goes)
      NightLights  ◄─────┤ town:changed   (lamp registry, firefly spots)
      AudioManager ◄─────┤ build:* / ui:sfx / intent:undo|redo / intent:set-* / phase:changed
        └ MusicPlayer    │ → music:changed / audio:changed → UI
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
`resizeRenderer` → `ToolController.update` → `CameraController.update` → `TownRenderer.update` → `LifeSystem.update` → `BirdSystem.update` → `DayClock.advance` (building phase only) → `applyDaylight` (Environment, NightLights, `LifeSystem.setNight`, `BirdSystem.setDaylight`, `daytime:changed` on a mode/phase change) → `Environment.update` → `PlacementFx.update` → activity tracking (frame budget) → render (the shadow scheduler decides whether the sun's map is redrawn). Everything after the camera gets `animDelta`, which is 0 under `setReducedMotion(true)`. With `setPausedForScreenshot(true)` nothing updates but rendering continues.

## Grid
- Plot `64 × 64` cells (`PLOT_WIDTH/DEPTH`), `CELL_SIZE = 0.5`, centred on the origin: 32 × 32 world units. Toy scale: 1 unit ≈ 8 m, a cell ≈ 4 m. `cellToWorld`, `footprintCentreWorld`, `worldToGridPoint` (fractional), `worldToCell`, `edgeToWorld` in `config.ts`.
- **Road blocks:** road comes in aligned 2 × 2 blocks (`ROAD_BLOCK`), min corner at even `x, z` (`grid.roadBlockAnchor` / `roadBlockCells`); a block is all road or none. One Kenney road tile (`ROAD_TILE_SIZE` = 1 unit) per block, drawn at `roadBlockCentreWorld`; `roadTiles.roadMask` reads the 4 neighbouring blocks. Cars drive on the 32 × 32 block grid. `stats.roadTiles` counts road blocks.
- **Road features** (`ObjectDef.roadFeature`; only the roundabout, 6 × 6 cells = 3 × 3 blocks): block-aligned anchor, stands on road, drawn instead of the road tiles under it (`roadTiles.underRoadFeature`). A neighbouring road joins only at the middle block of a side, its **arm** (`isFeatureArm`). Inside, only the 4 arm blocks and the centre carry traffic; cars circle the island counter-clockwise from above (right-hand traffic; `lanePaths` ring, radius 0.5).
- **Road markings** (`ObjectDef.roadMarking`; only the zebra crossing): covers one road block that tiles as a straight, tee or cross. No model of its own: the road tile under it draws its zebra piece (`ZEBRA_PIECE_MODELS`); if the road around it becomes a corner or end, the block draws plain. Placing / bulldozing it adds / removes the object only; its road can't be repainted while it stands. Traffic and connectivity ignore it.
- **Footprints** (cells at rotation 0, `catalog/objects.ts`): roundabout 6×6; big house, supermarket 5×4; cottage, bungalow, family home, suburban 4×4; pool 4×3; townhouse, church 3×4; corner shop, donut shop, tiered fountain 3×3; fountain, oak, zebra 2×2; bus stop, swing, slide 2×1; everything else 1×1. `grid.anchorForPointer` centres a footprint on the pointer (odd sizes on the hovered cell, even on the nearest corner, clamped into the plot); `snap` keeps a road feature on the block grid.
- **Layers per cell:** ground (one `GroundKind`, default `field`), object (0–1; multi-cell footprints anchored at the min corner), edges (hedges and fences on cell borders, canonical `n` / `w` sides).
- **Rotation:** quarter turns CCW from above; rotation 0 faces +z (towards the default camera). Each model's native facing is corrected by `rotationOffset` in `catalog/models.ts`.

## Placement rules (`town/rules.ts`)
| Action | Valid when | Otherwise (`reason` "message") |
| --- | --- | --- |
| paint-ground | in bounds, kind differs; under an object only a kind in its `allowedGround` | `out-of-bounds` "Outside your plot" · `no-change` (never shown) · `occupied` "Move the {label} first" |
| paint road / over road | road converts the whole 2 × 2 block (any object in the block blocks it) and removes fences inside the block and towards neighbouring road; another kind on a road cell converts the whole block. Clicked cell's change last | `occupied` "Move the {label} first" (also over a road feature or zebra) |
| place-object | every footprint cell in bounds, free, ground ∈ `allowedGround`; road features / markings block-aligned; a zebra only on a straight, tee or cross | `out-of-bounds` (also "{label} must line up with the road grid", scripted actions only) · `occupied` "Something is already here" · `blocked-by-road` "{label} can't go on a road" · `needs-ground` "{label} needs {ground}" / "Zebra crossings go on a straight road or a junction" |
| place-object, `requiresAdjacent: 'road'` (bus stop, traffic light) | a footprint cell 4-adjacent to road | `needs-ground` "Bus stops need to be next to a road" / "Traffic lights need to be next to a road" |
| place roundabout | any ground. Changes: fence removals → ground → road for non-road cells → object add (last) | as place-object |
| place-edge | in bounds (border edges allowed), not between two road cells; same kind ⇒ `no-change`; other kind ⇒ replaced | `out-of-bounds` · `blocked-by-road` "Fences can't cross roads" |
| move-object | the object exists and is movable (not a road feature or marking); the new spot passes the place-object checks ignoring the object itself. Trees and plants keep their rotation. Changes: remove → add with the **same id and variant** | `nothing-here` "Nothing to move" · `cannot-move` "{label} can't be moved" · `no-change` · the place-object reasons |
| bulldoze | object on the cell ⇒ remove it (a road feature also returns its road to field); else the picked edge (within 0.3 cell, 0.4 on touch) ⇒ remove it; else road ⇒ its block to field; else non-field ground ⇒ field | `nothing-here` "Nothing to remove" (silent on drag) |

**Variants.** `PlacedObject.variant` stores the model, so undo, redo and saves reproduce it. `place-object` takes an optional `variant`: an integer in `[0, variants)` is used as given; anything else is rolled with the seeded RNG. Player placements always carry one: `ToolController` remembers each multi-model tool's chosen model for the session (0 until picked) and the ghost shows the same model. Demo towns and tests send none. Events: `intent:select-variant { choice }`; `tool:changed` carries `variant: { choice, count } | null`.

**Tree height.** `ObjectDef.height` stretches the drawn model in Y only (pine × 2); footprint, rules and saves never see it. The oak is the 2 × 2 tree. Trees and plants get a hashed yaw and ± 12 % size per id (`render/objectPose.ts`); the ghost uses the same pose. The wind shader measures height along the model's Y and bends at half rate above 1 unit.

## Save format
`SavedTown` (`SavedTownV4`, `town/types.ts`), `CURRENT_SAVE_VERSION = 4`: width/depth, RLE ground, objects, edges, next id, optional camera pose, optional name. `parseSave` treats input as untrusted and never throws; it returns an `Error` for an unreadable or newer save, and otherwise repairs:
- a smaller save is centred on the plot by whole road blocks;
- partial road blocks become field;
- objects of unknown kinds, out of bounds, overlapping or on the wrong ground are dropped; road features and markings must be block-aligned, features on road; an out-of-range variant becomes 0;
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
- **Draw-call costs:** cars: one `BatchedMesh`, +1 main and +1 shadow call. Birds: one `InstancedMesh` of a procedural 18-triangle bird (≤ 16 instances, per-instance colour and `aFlap` wing angles folded in the vertex shader on the lit and depth materials), +1 / +1 while a flock is up. Placement FX: pooled particles in 3 meshes, ≤ 3 calls, 0 when idle. Night lights: §Day/night.

## Frame budget
- **Pacing** (`core/Loop.ts` `paceFrame`, `core/FrameBudget.ts`): at most `activeFps` while the player interacts and `idleFps` after `idleAfterS` (4 s) without activity. Activity = pointer, wheel, touch or key input on the window, a moving camera outside the title screen, TownRenderer tweens, a developing photo. Skipped rAF ticks run neither update nor render; `delta` spans back to the last rendered tick (clamped to 50 ms). The pacing grid is fixed, so 144 Hz averages 60.
- **Shadow map on demand** (`render/ShadowScheduler.ts`, `shadowMap.autoUpdate = false`): redrawn after `town:changed`, after `Environment.shadowVersion` changes (key light re-aimed or refitted, map resized), and every frame while town tweens run. Cars and birds refresh it at `carHz` / `birdHz` (30 each; the faster while both move). A still town draws no shadow pass. Test hooks, screenshot pauses and photos always redraw it first.
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
- **Glow** (`render/nightGlow.ts`): emissive masks (16 × 4 `DataTexture`s, one texel per Kenney atlas cell) on private material clones (`ModelSpec.glow`). Only homes, lampposts, traffic lights and cars glow; shops and the church stay dark. Houses switch on one by one via a per-instance hash patch (`uLightsOn` / `uLightsOff`). Emissive is exactly 0 by day, so day captures are unaffected.
- **Ground light** (`render/NightLights.ts`): no real PointLights; instanced additive layers, hidden while night < 0.05, one draw call each: lamp pools, lamp halos (Medium / High; offset `lampOutset` along the arm, fading out above the lamp), headlight beams (≤ 6 cars), fireflies over free meadow cells.
- **Life:** `LifeSystem.setNight(n)` → traffic density `1 − 0.5·n`.

## Birds
- **Schedule** (`life/FlockSim.ts`, pure, own mulberry32 stream): the first flock 10–25 s after a reset, then every 45–110 s; the wait is × 0.6 at dawn / dusk (starlings likelier) and up to 25 % shorter with trees (fully at 40). No new flock while night > 0.5 (one in the air finishes). At most 2 flocks and 16 birds.
- **Flight:** a quadratic Bézier from 34 units out, over the town, to the far side; ~25 s a crossing. Two altitude lanes, one per flock, above the church and inside the shadow frustum. Birds grow in / shrink out at the path ends.
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
- `setState(name)` for `title | empty-build | sample-town | active-play | asset-gallery | stress-town | night-town`: reseeds, rebuilds deterministically, pins the clock (0.55; `night-town` = sample town at 0.82), turns autosave and spontaneous flocks off until reload. Unknown names throw;
- `setPausedForScreenshot`, `setReducedMotion`, `hideDebugUi`;
- `cellToClient(x, z)`: client coordinates of a cell centre, so bots click with real input;
- `setCameraPose({ targetX, targetZ, azimuth, polar, distance })`: moves the camera at once and renders;
- `setTimeOfDay(t | null)`: pins the time of day and applies it at once, even while paused; `null` releases;
- `spawnFlock(species?)`: launches a flock now; returns its bird count (0 when the sky is full).

Demo towns (`sampleTown.ts`, zero rejections, tested):
- `sample-town` uses every placing tool (38; Move and Bulldoze are modes): homes 8, residents 25, amenities 7, trees 5, roadTiles 40, props 23, fences 28.
- `asset-gallery` places all 32 object kinds at rotation 0, every edge kind, the ground swatches and the 16 road masks.
- `stress-town` fills the plot: 100 homes, 50 mailboxes, a roundabout.

## Diagnostics
`window.__THREE_GAME_DIAGNOSTICS__` is a getter (`Game.installDiagnostics`): each read builds a fresh snapshot, so frames never pay for it. Shapes are in `vite-env.d.ts`. Fields:
- `frame`, `phase`, `tool`, `rotation`, `invalidCount`, `camera`;
- `hover` `{x, z, valid, reason}` (mirrors `hover:changed`), `selection` (the carried object), `variant` `{choice, count}`;
- `town` (`TownState.stats()`: homes, residents, amenities (amenity group), trees, roadTiles (road blocks), props (street, garden and plant objects), fences (all edges)), `townName`, `objects`, `history`;
- `render`: what TownRenderer draws (objects, ground tiles, edges, instances, pools, call and triangle estimates, animating, dying, materials);
- `quality` (the preset) and `graphics` `{preset, booted, reloadRequired, antialias, material, maxDpr, renderScale, shadowMapSize, decorFraction, decorInstances, skyOctaves, activeFps, idleFps, lampHalos}`; `antialias` is read from the context, `material` measured over the scene after load and every test state (`standard | lambert | mixed | none`);
- `audio` (incl. `music`), `save` `{available, pending, lastError}`, `fx`, `life`, `birds`, `daytime` `{mode, t, phase, pinned, night, lightsOn, lamps, drawCalls}`, `photo` `{taken, developing, last}`, `perf` `{targetFps, idle, shadowRenders}`;
- `renderer` (three.js calls, triangles, geometries, textures) and `canvas` (sizes, effective DPR); the canvas inspector reads these.

There are no other diagnostics globals.

## Browser tests
- Playwright projects: `desktop-chrome` (1280 × 720) and `mobile-chrome` (Pixel 7 emulation, touch), full Chromium (`channel: 'chromium'`) on the real GPU, 1 worker. The canvas inspector's `--mobile` is 390 × 844.
- Stable DOM ids: `UI_TEST_IDS` and `MENU_TABS` in `src/ui/testIds.ts` (side-effect free; specs import it). A tool button exists only while its category is active; a menu control is visible only while its tab is selected (`tests/helpers.ts` `openMenuTab`).
- Visual baselines: `tests/visual-regression.spec.ts-snapshots/`, 8 PNGs (title, sample-town, asset-gallery, night-town × desktop, mobile). Darwin only: there a missing baseline fails; on other platforms the spec is skipped.
