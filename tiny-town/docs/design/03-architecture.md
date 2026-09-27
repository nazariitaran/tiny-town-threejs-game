# Tiny Town — Architecture & Contracts

## Stack
TypeScript (strict) · Vite 8 · three.js r184 (`three/addons/*` for MapControls, GLTFLoader) · Web Audio · lil-gui (`?debug`) · Vitest (pure logic) · Playwright (browser, `channel: 'chromium'`, 1 worker). No physics engine: the game is grid-based and has no simulation that needs one.

## Module map and ownership

```
src/
  main.ts                     bootstrap                                   integrator
  game/Game.ts                composition root, phases, update order,     integrator
                              test hooks, diagnostics
  game/events.ts        [C]   typed EventBus + GameEvents                 integrator
  game/config.ts        [C]   plot size, CELL_SIZE, cell↔world mapping    integrator
  catalog/tools.ts      [C]   toolbar tools (ids, category, drag mode)    integrator
  catalog/objects.ts    [C]   object defs (footprint, allowed ground…)    integrator
  catalog/models.ts     [C]   model registry (GLB url, scale, offsets)    integrator (WP-03 may tune numbers)
  town/types.ts         [C]   pure data model                             integrator
  town/grid.ts          [C]   pure grid helpers (tested)                  integrator
  town/TownState.ts           data store                                  WP-02
  town/rules.ts               placement rules (pure, tested)              WP-02
  town/History.ts             undo/redo                                   WP-02
  town/TownEditor.ts          the only mutator; publishes facts           WP-02
  town/serialize.ts           save format + validation + migration        WP-02
  town/sampleTown.ts          deterministic demo town                     WP-02
  persistence/SaveStore.ts    localStorage autosave                       WP-02
  render/ModelLibrary.ts      GLB load + normalise                        WP-03
  render/TownRenderer.ts      incremental instanced drawing + pop-in      WP-03
  render/roadTiles.ts         road auto-tiling (pure, tested)             WP-03
  world/**                    sky, lights, terrain, grid overlay, decor   WP-04
  interaction/**              camera, picker, tool controller, ghost      WP-05
  ui/**, styles.css           all DOM UI                                  WP-06
  audio/AudioManager.ts       Web Audio SFX                               WP-07
  audio/sfx.ts, sfxTable.ts [C] event ids / generated table               integrator (regen: npm run gen:sfx)
  vite-env.d.ts         [C]   diagnostics + test-hook types               integrator
  life/**                     ambient cars / dusk (stretch)               WP-10
  fx/**                       placement VFX                               WP-08
  debug/DebugTools.ts         lil-gui (?debug)                            shared: add folders only
tests/                        Playwright specs                            WP-09, except interaction (05), ui (06),
                                                                          audio (07), fx (08), life (10) specs
```
`[C]` = contract file. Workers may not change contract files; they request changes in their hand-off, and the integrator applies them. Adding a new optional field or event is fine to request; renames and removals need the integrator's agreement.

## Data flow

```
 pointer/keys ─► ToolController ──BuildAction──► TownEditor ──► rules.planAction (pure)
      ▲                │                              │ ok: TownState.applyChanges + History
 UiRoot ─intent:*─►    │ tool:changed / hover:changed │
      ▲                ▼                              ▼
      └──── facts ◄── EventBus ◄── town:changed · town:stats · build:placed/removed/invalid · history:changed
                         │
      TownRenderer ◄─────┤ town:changed      (incremental redraw, road neighbours re-tiled)
      AudioManager ◄─────┤ build:* / ui:sfx / intent:undo|redo
      PlacementFx  ◄─────┘ build:placed / build:removed
```

Rules of the road:
1. **Only `TownEditor` mutates town state.** Every change list keeps its primary change last (build events derive from it). Everything else reads via `TownStateReader` or listens to `town:changed`.
2. **UI emits intents and renders facts**; it never calls game objects directly.
3. **Pure logic stays pure**: `src/town/**`, `src/render/roadTiles.ts`, `src/catalog/**` import no three.js and no DOM, so they are unit-testable in Node.
4. **All randomness goes through the seeded RNG** passed into constructors (`Game.rng`). Never `Math.random()` (it breaks screenshots and bot runs).
5. **One cell↔world mapping**: `game/config.ts`. Nobody re-derives it. Likewise every runtime asset URL goes through `assetUrl()`.
6. **Keyboard ownership**: digits 1–9 (tool/category) belong to the UI; everything else (R, B, Esc, F, WASD, Q/E, undo/redo) belongs to `ToolController`/`CameraController`.
7. **Two RNG streams**: gameplay (`Game.rng`: variants) and cosmetic (`Game.fxRng`: audio/fx jitter), so a sound never changes the next house variant.

## Frame update order (Game.update)
`ToolController.update` → `CameraController.update` → `TownRenderer.update(animDelta)` → `LifeSystem.update(animDelta)` → `Environment.update(animDelta, animElapsed)` → `PlacementFx.update(animDelta)` → diagnostics → render. With `setReducedMotion(true)`, `animDelta`/`animElapsed` are 0. With `setPausedForScreenshot(true)`, nothing updates but rendering continues.

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
`SavedTownV2` (= `SavedTown`) in `town/types.ts`: versioned, 48 × 48, RLE ground, objects, edges, next id, optional camera pose. `serialize.ts` validates unknown input (never trusts localStorage), migrates older versions, demotes partial road blocks to field, and round-trips (tested). Autosave: debounced 1 s after `town:changed`, key `tiny-town:save:v1` (a slot name; it did not change with the format). (`SavedTownV1` survives only as a deprecated alias of `SavedTown` for `SaveStore.ts`.)

**v1 → v2 migration (`SAVE_MIGRATIONS[1]`, WP-12):** each v1 cell (x, z) becomes cells 2x..2x+1 × 2z..2z+1. Ground is copied to all 4 (every v1 road cell is a valid block); each edge becomes 2 half-edges; camera (world units), ids, variants and `nextObjectId` are kept. Objects that fit the 2 × 2 area (trees, props, garage, bus stop) sit flush to its front side (rotation 0 = +z, 1 = +x, 2 = −z, 3 = −x). Houses are placed last in id order, flush to the same front: as their own kind (3-wide ones try both sideways overhangs), then as a 2×3 townhouse, then as a townhouse turned a quarter either way (fits dense 1-deep v1 rows), else dropped. Fixtures: `src/town/fixtures/v1-{sample,stress}.json` (v0.1 sample: 0 drops; v0.1 stress: 36 of 56 homes kept). Settings (mute/volume/grid) under `tiny-town:settings:v1`.

## Rendering strategy
- `ModelLibrary` loads each GLB once and normalises it (scale, facing, base on y=0, footprint-centred).
- `TownRenderer` draws with **`InstancedMesh` pools keyed by (model, part)**; capacity grows by doubling. Ground `field` is not drawn per cell (the plot plane is). Pop-in/out tweens write per-instance matrices.
- Shared materials: Kenney kits use one colour-atlas texture per kit, so the whole town should need a handful of materials. Don't clone materials per instance.
- Ghost preview uses `ModelLibrary.createObject()` with a separate translucent tinted material (not shared with the town).

## Budgets (full 48×48-cell town, desktop 1280×720; mobile 390×844)
| Metric | Desktop | Mobile |
| --- | --- | --- |
| Draw calls | ≤ 150 | ≤ 120 |
| Triangles | ≤ 400k | ≤ 250k |
| Textures | ≤ 30 | ≤ 30 |
| Shadow maps | 1 × 2048 | 1 × 1024 |
| DPR cap | 2 | 1.5 |
| Frame time (M-series laptop, headless full chromium) | ≤ 8 ms | — |
| Initial download (JS + models + audio + icons) | ≤ 8 MB | ≤ 8 MB |

## Test hooks and diagnostics
`window.__THREE_GAME_TEST_HOOKS__`: `seed`, `setState(name)` for `title | empty-build | sample-town | active-play | asset-gallery | stress-town` (every state reseeds and rebuilds deterministically), `setPausedForScreenshot`, `setReducedMotion`, `hideDebugUi`, `cellToClient(x, z)` (so bots click real cells with real input).
`window.__THREE_GAME_DIAGNOSTICS__` (typed in `src/vite-env.d.ts`): `phase`, `tool`, `rotation`, `hover`, `town` (stats), `objects` (TownState count), `render` (what TownRenderer actually draws), `history` (`canUndo`/`canRedo`/`undoDepth`/`redoDepth`), `invalidCount`, `camera` (pose), `quality`, `audio` (`muted`/`volume`/`unlocked`/`loaded`/`starts`), `renderer` (three.js counts; the canvas inspector reads this), `canvas`.
Playwright projects: `desktop-chrome` (1280×720) and `mobile-chrome` (Pixel 7 emulation, touch), both full Chromium, 1 worker.
Stable DOM ids for tests: `UI_TEST_IDS` in `src/ui/UiRoot.ts` (`btn-start`, `tool-<id>`, `cat-<category>`, `btn-undo`, `btn-redo`, `btn-mute`, `btn-rotate`, `tool-bulldoze`).
