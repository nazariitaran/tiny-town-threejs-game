# WP-12 — Scale, proportions & grid density (plan; integrator-approved 2026-09-27)

This plan was produced by the WP-12 planning agent and approved by the integrator. It is the implementer's contract. Where it says "optional", the implementer may cut it in the stated order.

## Decisions

### 1. Unit system
- The plot keeps its world size (24 × 24 world units). `CELL_SIZE` goes from 1 to **0.5**, so the plot becomes **48 × 48 cells** (4× denser).
- Toy scale: 1 world unit ≈ 8 m, so one cell ≈ 4 m.
- Camera framing (`DEFAULT_POSE` 35.8), the decor ring, the terrain and the budgets stay valid, because the world size is unchanged.
- Draw calls stay flat (about 25): pools are per (model, part), not per cell.
- Instances: only ground slabs grow (worst case 2,304 × 12 triangles). Meadow scatter is cut to 1 clump per cell, so density per area is unchanged.
- Rejected finer option: 0.25-unit cells measure about 7 px on desktop and 5 px on mobile at the default pose, which can't be hit. At 0.5 a cell is about 15 px on desktop and 10 px on mobile, and a 3-cell building about 30 px. Small props on touch need pinch-zoom (minDistance 6 gives about 110 px per cell).

### 2. Proportion table
Sizes are in world units at the new `models.ts` scale.

| Item | Footprint (W×D cells) | Scale (was) | Size w×h×d | Allowed ground |
|---|---|---|---|---|
| Road | **2×2 aligned block** (even x, z) | 1 (same) | 1.0 tile, lanes 0.37 | — |
| Pavement | 1×1, painted as strips | 0.5 + style y×2 | 0.5×0.02×0.5 | — |
| Walkway | 1×1 | procedural `WALKWAY_WIDTH = 0.5·CELL` | path 0.25 wide | — |
| Grass / meadow | 1×1 slab | slab = CELL_SIZE; 1 scatter piece per cell | — | — |
| Cottage (type-a) | **3×3** | **1.0** (0.78) | 1.30×0.83×1.03 | open |
| Townhouse (type-k / type-r) | **2×3** | 1.0 (0.88/0.87) | 0.92–1.03×1.15×1.02 | open |
| Family home (type-e / type-c) | **3×3** | 1.0 (0.78) | 1.30×1.14×1.03 | open |
| Garage | **1×2** | **0.48** (0.78) | 0.49×0.41×0.62 | open + pavement |
| Bus stop | **2×1** | **0.8** (1) | 0.76×0.34×0.37 | prop ground, next to a road |
| Postbox | 1×1 | **1.4** (2) | 0.15×0.24 | prop ground |
| Lamppost | 1×1 | **1.0** (1.35), offset z 0.087 | 0.675 tall, arm 0.2 | prop ground |
| Oak / Pine | 1×1 | **0.45** (0.36) | 0.49×0.87 / 0.43×0.90 | open + pavement |
| Birch (+ small) | 1×1 | **1.15** (1) | 0.24×0.88 (0.65) | open + pavement |
| Tall / low fence | edge, 0.5 long | 0.5; style y 1.8 / 1.4 | 0.21 / 0.10 tall | — |
| Cars (life) | — | **0.17** (0.14) | 0.255 w × 0.43–0.48 long | road lanes |

- Houses get an offset of z −0.15 so the front yard reads.
- Size checks, all encoded in a `catalog.test` proportions block:
  - A house (1.3 wide) is about 3× a car length and 3.5× a lane.
  - Trees (about 0.88 tall) are about cottage height and below townhouse ridges.
  - The lamppost (0.675) is taller than the garage and the bus-stop bench, and below the eaves.
  - The postbox is about car height, about 1.2× real so it stays readable.
  - Fences come out at about 1.65 m and 0.8 m.

#### Roads as aligned 2×2 blocks
The ground stays per cell, with one invariant: a block is either all road or has no road.
- Painting road on any cell converts its whole block.
- Painting another kind on a road cell converts the whole block to that kind.
- Bulldozing a road cell turns the block back to field.
- Painting road fails `occupied` if any cell of the block has an object.
- Painting road removes fences on the block's inside edges, and on its outside edges where the neighbour is road.
- Auto-tiling runs on the block grid (neighbours ±2 cells) and draws one tile per block at its min corner. The tile table and road models are unchanged.
- Pavement is a 1-cell strip beside the road tile's own kerb.

### 3. Multi-cell footprints
- Anchor at the min corner, with w×d swapped for odd rotations (existing contract).
- New pure helper `anchorForPointer(gx, gz, footprint, rotation, W, D) = floor(g − w/2 + 0.5)`, clamped so the footprint stays in the plot. The ghost is centred on the pointer for odd and even sizes, and R re-centres it.
- The rules already check out-of-bounds, occupied and ground over the whole footprint, and bus-stop adjacency on any footprint cell. Only tests are new.
- Bulldozing any footprint cell removes the object (occupancy map).
- The ghost tile uses `tileScale = footprint`.
- The bulldoze highlight and `build:placed`/`build:removed` use a new `footprintCentreWorld()` (road uses the block centre), so FX are centred on the object.
- ToolController `justPlaced` marks every footprint cell and block cell.

### 4. Other systems
- **Cars:** TrafficSim works on the 24×24 block grid (`isRoad` checks the block anchor cell). lanePaths uses `ROAD_TILE_SIZE = CELL_SIZE·ROAD_BLOCK` (numbers unchanged). `carCells` reports the fine cell.
- **Fences:** edges are 0.5 long. Edge pick 0.3 cell (0.4 on coarse pointers).
- **Walkway:** hub plus arms per cell, at half the old width.
- **Meadow:** one hashed clump per cell.
- **Decor ring:** oak/pine scale factors ×0.8, so the ring stays exactly as it is.
- **Grid overlay:** major lines every 2 cells (road lattice), minor lines at about 45%, and the moiré fade stays.
- **Camera:** framing and limits unchanged. Acceptance is on cell pitch.

### 5. Saves
- `SavedTownV2` (version 2, 48×48) plus `SAVE_MIGRATIONS[1]`. The storage key `tiny-town:save:v1` stays (it is a slot name).
- Migration: each old cell (x, z) maps to the cells 2x..2x+1 × 2z..2z+1.
  - Ground is copied to all 4 cells, so every road is a valid block.
  - Each old edge becomes 2 half-edges.
  - The camera pose is kept (world coordinates are unchanged).
  - Ids, variants and nextObjectId are kept.
  - Trees, props and bus stops take the old area's front row (front: rotation 0 = +z, 1 = +x, 2 = −z, 3 = −x). Garages take the front column.
  - Houses are placed last, in id order: first their own kind, flush to the front (3-wide houses have 2 sideways options); if that fails, a townhouse 2×3 at the same front; if that fails, the house is dropped.
- `parseSave` then validates as usual and also enforces the road-block rule (a partial block is demoted to field).

### 6. Demo towns (all zero rejections)
- **Sample town:**
  - Main street on rows z 24–25, running x 4–43. Side street on columns x 22–23, running z 8–41 (a T and a crossroads).
  - Pavement on rows 23 and 26.
  - North houses on rows 20–22 at rotation 0; south houses on rows 27–29 at rotation 2.
  - Bus stop on the row-26 pavement; postbox and 4 lampposts on the row-23 pavement.
  - Grass behind the houses with a low fence along its north edge.
  - A meadow crossed by a walkway, a tall-fence run, and 5 trees.
  - The test counts (5 homes, 5 trees) are unchanged.
- **Gallery:**
  - The 16 road masks at block coordinates (1 + 4c, 1 + 4r).
  - Objects at 9-cell spacing in 2 rows, with the bus stop given a road block to its north.
  - Ground swatches and fences on rows 42–43.
- **Stress town:**
  - A 12 × 10 cell repeat: road rows at z 0/10/20/30/40 and road columns at x 0/12/24/36 (all even).
  - A pavement row on each side of every road row.
  - Two rows of 3-deep lots facing opposite ways, each holding a cottage, a family home, a townhouse, a garage and trees.
  - Lampposts and postboxes on the pavements.
  - About 96 homes and 32 garages; estimated about 320k triangles on desktop.

## Implementation order (`npm run verify` green after each step)
0. **Fixtures:** serialize the v0.1 sample and stress towns to `src/town/fixtures/v1-{sample,stress}.json` BEFORE changing anything (a one-off vitest snippet).
1. **Additive helpers and tests** (`CELL_SIZE` still 1):
   - `grid.ts`: `ROAD_BLOCK`, `roadBlockAnchor`, `roadBlockCells`, `anchorForPointer`.
   - `config.ts`: `ROAD_TILE_SIZE`, `footprintCentreWorld`, `roadBlockCentreWorld`.
2. **Logic flip:**
   - `config.ts` → 48×48 and 0.5; `types.ts` gets V2; footprints and scales from the table.
   - Rules for road blocks. `stats.roadTiles` = road blocks, so e2e numbers stay meaningful.
   - TownEditor event positions.
   - `serialize.ts`: V2, the migration and the block check.
   - The three demo towns.
   - Every `src/town` test, the SaveStore tests, and `catalog.test` (footprint × `CELL_SIZE`, plus the proportions block).
3. **Rendering:**
   - `roadTiles.ts`: block mask.
   - TownRenderer: one road tile per block, and changed ground touches the neighbouring block anchors; meadow and walkway changes; `MODEL_STYLES` for fences, pavement and lamppost.
   - IconStudio: centre and clip boxes from `CELL_SIZE`.
4. **Interaction:**
   - ToolController: pointer anchoring, road strokes deduplicated per block, block ghost and bulldoze target, footprint tile, `justPlaced`.
   - GhostPreview: rectangular frame.
5. **World:** GridOverlay major/minor lines; DecorRing scale ×0.8.
6. **Life:** TrafficSim on blocks, lanePaths, `CAR_SCALE` 0.17, `life.test`.
7. **FX (optional):** removal-poof radius scales with the footprint.
8. **E2E:** re-map every spec's cells (v0.1 (x, z) → (2x, 2z); choose house cells whose footprint fits), then inspector captures.
9. **Docs:** architecture §Grid/§Save, the `models.md` scale table, and a PLAN WP-12 section. The integrator updates progress.md.

## Files (`[C]` = contract file, owned by the integrator but DELEGATED to WP-12 for this change)
- **Contracts:** `src/game/config.ts` [C], `src/town/types.ts` [C], `src/town/grid.ts` [C] (+ `grid.test.ts`), `src/catalog/objects.ts` [C], `src/catalog/models.ts` [C], `src/catalog/catalog.test.ts`. `tools.ts` [C] only for hint text. `vite-env.d.ts` [C] only for a comment.
- **Town:** `rules.ts`, `TownState.ts`, `TownEditor.ts`, `serialize.ts`, `sampleTown.ts`, `fixtures/*.json`, `src/town/*.test.ts`, `src/persistence/SaveStore.test.ts`.
- **Render:** `roadTiles.ts` (+ tests), `TownRenderer.ts`, `IconStudio.ts`, `roadModels.test.ts`.
- **Interaction:** `ToolController.ts`, `GhostPreview.ts`, `framing.test.ts`.
- **World:** `GridOverlay.ts`, `DecorRing.ts`.
- **Life:** `TrafficSim.ts`, `lanePaths.ts`, `LifeSystem.ts`, `life.test.ts`.
- **FX (optional):** `fxRecipes.ts`.
- **Tests:** `helpers.ts` and the build-flow, interaction, life, fx, ui, audio, smoke and bot-playtest specs (cell coordinates only).
- **No changes:** `src/ui/**`, `Game.ts`.

## Acceptance checks
- **Unit tests** (0 failures):
  - Multi-cell rules: partial out-of-bounds, occupied and needs-ground; rotation swap (2×3 at rotation 1 occupies 3×2); bus-stop adjacency through any footprint cell; bulldoze from any footprint cell.
  - Road blocks: paint, repaint, bulldoze; the inside-edge fence ban and removal.
  - `anchorForPointer` for sizes 1, 2 and 3 plus clamping.
  - Migration:
    - The v1 sample migrates with 0 drops, the same ids and variants, ground ×4, and `roadTiles` equal to v1.
    - The v1 stress migration is deterministic, has no overlaps, loads through `TownEditor.load`, and keeps at least 50% of its homes.
    - Migrated saves round-trip through `parseSave`.
  - Demo towns: 0 rejections, and the gallery shows all 16 block masks.
  - The proportions test passes.
- **Inspector:** asset-gallery, sample-town and stress-town, desktop and `--mobile` (390×844), into `artifacts/wp-12/`.
  - Stress-town: ≤ 150 calls and ≤ 400k triangles on desktop; ≤ 120 calls and ≤ 250k triangles on mobile.
  - 0 console errors.
  - Cell pitch at the default pose, |cellToClient(24,24) − cellToClient(25,24)|: ≥ 12 px on desktop and ≥ 9 px on mobile.
- **Desktop frame time** ≤ 8 ms (method as in WP-11).
- **Real-input e2e:** green on both projects. Build-flow: a road stroke x 16–31 on row 24 gives `roadTiles` 8; then a cottage, undo/redo, and a bulldoze drag that removes 4.
- **Side-by-side:** `artifacts/wp-12/proportions-{before,after}.png`, taken from a worktree at `3f9c6cf` versus the new build, same camera, on the gallery objects row and a sample-town street. Add a table of the bounding boxes `catalog.test` logs.
- **Baselines:** sample-town and asset-gallery change on both desktop and mobile; title probably doesn't. The integrator regenerates all 6 after WP-14 (stats removal) also lands.

## Risks and cut order
- **Mobile triangles:** estimated about 283k, over the 250k mobile budget. Fixes in order: (1) swap half the stress-town oaks for birches (42 triangles each); (2) thin the decor ring on the low tier (it is 86k triangles).
- **Touch precision on props at the default zoom:** document pinch-zoom. Optional retune: narrow `side` −150 → −260 (framing.ts).
- **Migration house re-fit:** cut to "own kind or drop" if needed.
- **Stray 1-cell assumptions** (IconStudio centre, `0.25·CELL` offsets): grep for `CELL_SIZE` and literal 0.5 and 1.
- **Cut order:** FX radius → GridOverlay major lines → icon regeneration → the migration's townhouse substitution.
