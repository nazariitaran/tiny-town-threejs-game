# 3D models — Tiny Town

Every placeable item is covered by **CC0** models, almost all from Kenney's current kits, which share one flat, colourful look: a 512 px gradient `colormap.png` per kit, the same greens, lavender-greys and terracotta. Nothing here is CC-BY.

- Machine-readable manifest: [`models.json`](models.json), with 44 entries covering bounds, pivot, front, scale, footprint, triangle count and bytes.
  - It is **hand-maintained**. `suggestedScale` and `footprintCells` were edited by hand for WP-12 to match `src/catalog/models.ts` and `objects.ts`. When the catalog changes, update the manifest by hand.
- Re-measure and verify: `npm run inspect:models`, or add `--three` to also load every GLB through three.js `GLTFLoader`.
  - The script prints a report and exits 1 on any problem. It does not update `models.json`.
  - **Never pass `--json docs/assets/models.json`.** That writes the raw report, which has a different schema, over the curated manifest.
- Rebuild the composed models: `node scripts/compose-models.mjs`. The sources live in `assets-src/` and are gitignored.
- Screenshots: [town preview](models-town-preview.png), [gallery of all 44 at suggested scale](models-gallery.png), [road pieces top-down](models-road-pieces-topdown.png).
- Payload (measured 2026-09-27): **2.09 MB** of GLB + PNG in `public/assets/models/`, plus 156 KB of icons (44 PNGs). The four cars, used by the ambient life system (WP-10), are 0.73 MB of the model payload.

![town preview](models-town-preview.png)

## Coverage per build tool

Live scales and footprints are in the next section, "Grid and scale", and in `src/catalog/`. This table only maps tools to sources. Note that the manifest ids and the catalog ids differ for road pieces: the catalog's `road-corner` is `road-bend-square.glb`, `road-end` is `road-end-round.glb` and `road-single` is `road-square.glb` (see the integrator note below).

| Tool | Model id(s) in `models.json` | Source file |
| --- | --- | --- |
| Road | `road-straight`, `road-corner` (curved), `road-corner-sidewalk`, `road-corner-square`, `road-tee`, `road-cross`, `road-end`, `road-end-round`, `road-single`; unused `road-crossing`, `road-driveway` | `roads/*.glb` (City Kit Roads) |
| Pavement | `pavement-tile` | `roads/tile-low.glb` |
| Walkway | `walkway-path-long` (arm), `walkway-path-short` (hub); stepping-stone variants `walkway-stones-*`. In game, walkways are procedural slabs; the ghost uses the hub | `suburban/path-*.glb` |
| Grass | `grass-tuft` (scatter) on a flat lawn slab | `platformer/grass.glb` |
| Wildflower meadow | `meadow-flowers`, `meadow-flowers-tall` (+ `grass-tuft`) | `platformer/flowers*.glb` |
| Tree ×3 | `tree-a` round "Oak", `tree-b` "Pine", `tree-c` slim "Birch"/tall (+ `tree-c-small`) | `platformer/tree.glb`, `platformer/tree-pine.glb`, `suburban/tree-large.glb` |
| Townhouse ×3 | `townhouse-a` cottage (type-a), `townhouse-b` narrow townhouse (type-k), `townhouse-c` family home (type-e); variants `townhouse-b-alt` (type-r), `townhouse-c-alt` (type-c) | `suburban/building-type-*.glb` |
| Garage | `garage`: single garage, industrial building-j re-centred; unused `garage-row` (2×1 lock-up block) | `composed/garage.glb`, `industrial/building-s.glb` |
| Bus stop | `bus-stop`: canopy, bench and sign, **composed from Kenney parts** | `composed/bus-stop.glb` |
| Tall fence | `fence-tall`: edge piece built from 2× suburban fence panels | `composed/fence-tall.glb` |
| Small fence | `fence-small`, unused `fence-small-gate`: Fantasy Town fence re-oriented to the edge convention | `composed/fence-small*.glb` |
| Postbox | `postbox`: **procedural red pillar box**, because no CC0 match exists in this style | `composed/postbox.glb` |
| Lamppost | `lamppost` (City Kit Roads `light-curved`); unused `lamppost-classic` (Fantasy Town lantern) | `roads/light-curved.glb`, `fantasy-town/lantern.glb` |
| Extras | `car-sedan`, `car-hatchback`, `car-van`, `car-taxi` (ambient cars, WP-10); unused `bench`; `rocks` and `bush` (plant) in the decor ring | `cars/*`, `holiday/bench`, `platformer/rocks`, `platformer/plant` |

**Icons** (`public/assets/icons/<id>.png`, 44 files):
- The **17 tool icons** are 128 × 128 and were rendered in this project from the in-game models and materials by `node scripts/render-icons.mjs`, which drives `src/render/IconStudio.ts` in a browser and needs a dev server. They are CC0. The script only rewrites the icons that `catalog/tools.ts` references. They were last re-rendered after WP-12 (`30fe85b`).
- The other **27** are 64 × 64 Kenney preview renders for unused or extra models, also CC0.

The suburban houses can change roof colour. `suburban/Textures/variation-{a,b,c}.png` have the same layout as `colormap.png`: roof swatch orange, pink or dark instead of green. To use one, load it with `TextureLoader`, set `flipY = false` and `colorSpace = SRGBColorSpace`, and assign it as `material.map` on a **cloned** material.

## Grid and scale

This section is **current**, and matches `src/catalog/models.ts` and `objects.ts` on `main` (v0.2).

**WP-12 (v0.2): `CELL_SIZE = 0.5` world units, a 48 × 48-cell plot, and one Kenney road tile (1 world unit, `ROAD_TILE_SIZE`) covers an aligned 2 × 2 road block.** Toy scale: 1 world unit ≈ 8 m, a cell ≈ 4 m. All road pieces are exactly 1 × 1 at scale 1, centred, with their top at y = 0.02. The scales below are the live values in `src/catalog/models.ts`; sizes are as drawn (including TownRenderer's `MODEL_STYLES` Y stretch), measured by `catalog.test.ts` › proportions (it logs this table):

| Item | Footprint (cells) | Scale (v0.1) | Drawn size w × h × d | Why |
| --- | --- | --- | --- | --- |
| Roads | 2 × 2 block | 1 (1) | 1 × 0.02 × 1 | One tile per block. Two lanes of ≈0.37 between kerbs. |
| Pavement `tile-low` | 1 × 1 | 0.5 (1), style Y × 2 | 0.5 × 0.02 × 0.5 | Kerb-height strip beside the road tile's own kerb. |
| Cottage (type-a) | 3 × 3 | 1 (0.78), offset z −0.15 | 1.30 × 0.83 × 1.03 | ≈ 3× a car length, 3.5× a lane; front yard reads. |
| Townhouse (type-k / type-r) | 2 × 3 | 1 (0.88 / 0.87), offset z −0.15 | 0.92–1.03 × 1.15 × 1.02 | Kit-native: storeys and doors match across types. |
| Family home (type-e / type-c) | 3 × 3 | 1 (0.78), offset z −0.15 | 1.29–1.30 × 1.03–1.14 × 1.03 | |
| Garage | 1 × 2 | 0.48 (0.78) | 0.49 × 0.41 × 0.62 | Single car garage, below the eaves. |
| Bus stop | 2 × 1 | 0.8 (1) | 0.76 × 0.34 × 0.37 | |
| Postbox | 1 × 1 | 1.4 (2) | 0.15 × 0.24 × 0.15 | ≈ car height, ~1.2× real so it stays readable. |
| Lamppost `light-curved` | 1 × 1 | 1 (1.35), offset z 0.087, style 1.5 × 1 × 1.15 | 0.075 × 0.675 × 0.26 | Taller than garage and bus-stop bench, below the eaves. |
| Oak / Pine (platformer) | 1 × 1 | 0.45 (0.36) | 0.49 × 0.87 / 0.43 × 0.90 | About cottage height, below townhouse ridges. |
| Birch `tree-large` / `-small` | 1 × 1 | 1.15 (1) | 0.24 × 0.88 / 0.65 | |
| Tall / low fence | cell edge (0.5) | 0.5 (1), style Y 1.8 / 1.4 | 0.5 long, 0.21 / 0.10 tall | ≈ 1.65 m / 0.8 m. |
| Flowers / grass tufts | scatter | 0.35 (0.35) | 0.1–0.27 clumps | One clump per cell (same density per area as v0.1). |
| Walkway | 1 × 1 | procedural | path 0.25 wide (half a cell) | Hub + arms per cell. The ghost uses `path-short` at 1.25 (0.25²). |
| Cars (`LifeSystem.CAR_SCALE`) | road lane | 0.17 (0.14) | 0.22–0.26 × 0.19–0.26 × 0.43–0.49 | Fits one lane. |
| Decor ring oak / pine | outside the plot | rendered at 0.36 (`DecorRing.TEMPLATE_RESCALE`) | unchanged | The ring stays exactly as in v0.1. |

Side-by-side evidence (same camera, v0.1 vs WP-12): `artifacts/wp-12/proportions-{before,after}.png`. `artifacts/` is gitignored, so this exists only in the main checkout.

## Pivot and orientation conventions

- **Axes:** Y-up, as glTF. In top-down views below, +X is right and +Z is down (towards the default camera). "N" = −Z, "E" = +X, "S" = +Z, "W" = −X.
- **Pivot:** almost every model is **centre-bottom**: footprint bounding-box centre at the origin, base at y = 0. There are three exceptions:
  - `lamppost`: the pole is at the origin, and the arm pushes the bounds 0.2 native units towards −Z.
  - `bus-stop`: the bounds centre is about (0.02, −0.05), so it is effectively centred.
  - `bush`: a slight −Z offset of 0.07 native.
  
  The three raw files with off-centre pivots (industrial `building-j`, and Fantasy Town `fence`/`fence-gate`) are shipped only as re-centred composed versions.
- **Front: every Kenney city, suburban, industrial and car model, the bench and all composed models face −Z.** This includes doors and planters, garage doors, the bus-stop open side, the postbox slot, car bonnets and the lamp arm. The game's contract is "rotation 0 ⇒ front faces +z", so use **`rotationOffset: 2`** (180°) for these in `catalog/models.ts`. Trees, flowers, rocks and the lantern are symmetric, so their offset does not matter.
- **Edge pieces** (`fence-tall`, `fence-small`, `fence-small-gate`) are 1 native unit long along X, centred on the origin, base y = 0, 0.075–0.08 thick. At the catalog scale of 0.5 they span one cell edge. Place the origin at the midpoint of the cell edge (positions below are in cell units; `config.edgeToWorld` converts them):
  - N edge of cell (x, z): position (x, z − 0.5), rotation 0.
  - W edge of cell (x, z): position (x − 0.5, z), rotation 90°.
  
  Where two edges meet, the posts overlap cleanly, so no corner piece is needed. Fantasy Town `fence-curved` and Platformer `fence-corner` are available in `assets-src/` if a rounded corner is ever wanted.
- **Walkway** (sourcing recipe from v0.1; the game now draws walkways procedurally in `TownRenderer`, 0.25 wide): put `walkway-path-short` ×1.25 at the cell centre. For each connected neighbour, add one `walkway-path-long` ×1.25 arm, centred 0.25 from the cell centre towards that neighbour, rotated 0° for N/S and 90° for E/W. Swap in `walkway-stones-*` for a stepping-stone garden path. The native pieces run along Z.

### Road auto-tiling (native connections at rotation 0)

![road pieces](models-road-pieces-topdown.png)

| Piece | Connects at rotation 0 |
| --- | --- |
| `road-straight` / `road-crossing` / `road-driveway` | W + E. The driveway's kerb drop is on the S side. |
| `road-corner` / `-sidewalk` / `-square` | W + S |
| `road-tee` | W + E + S (closed side N) |
| `road-cross` | all four |
| `road-end` / `road-end-round` | E only |
| `road-single` | none |

Rotating by q quarter turns counter-clockwise from above (`rotation.y = q·π/2`) maps E→N→W→S→E. Use rotation offset 0 for roads, since they have no "front". The 16 neighbour masks map as follows:

| Neighbours | Piece | q (CCW quarter turns) |
| --- | --- | --- |
| none | single | 0 |
| E | end | 0 |
| N | end | 1 |
| W | end | 2 |
| S | end | 3 |
| E+W | straight | 0 |
| N+S | straight | 1 |
| W+S | corner | 0 |
| S+E | corner | 1 |
| E+N | corner | 2 |
| N+W | corner | 3 |
| W+E+S (no N) | tee | 0 |
| N+S+E (no W) | tee | 1 |
| E+W+N (no S) | tee | 2 |
| N+S+W (no E) | tee | 3 |
| all | cross | 0 |

> **Integrator note (scaffold):** the game does not use the table above directly. `src/render/roadTiles.ts` maps each mask to a *canonical* piece orientation (straight N+S, corner E+S, tee E+S+W, end S), and each piece's `rotationOffset` in `src/catalog/models.ts` turns the native model onto it (straight 1, corner 1, tee 0, end 3). Both are unit-tested, and `asset-gallery` shows all 16 masks. The catalog uses `road-bend-square` for corners (it matches the square T and X pieces) and `road-end-round` for dead ends. `road-corner-sidewalk` is the alternative if curved corners read better in-game.

## Loading notes (three.js r184)

- The Kenney GLBs reference an external `Textures/colormap.png` relative to the GLB. The folder layout under `public/assets/models/<pack>/` preserves that, so load them by URL with `GLTFLoader`. All 44 models were checked to load with their texture: see Verification.
- Materials are `MeshStandardMaterial` with metalness 0, roughness 1 and `KHR_texture_transform` declared, which `GLTFLoader` supports. Suburban and holiday textures use a NEAREST mag filter, which is intended.
- Each GLB is one mesh with one material, except the composed ones (up to 6 small meshes) and industrial models (a second `colormap-specular` material). Building triangle counts are about 880–1 730, and cars about 2 030–2 090. `InstancedMesh` pools keyed by (model, mesh) work fine.
- The composed GLBs embed their textures, so they need no `Textures/` folder. `postbox.glb` uses plain colour materials.
- The **Nature Kit was evaluated and rejected**. Its GLBs set `metallicFactor: 1`, which renders almost black without an environment map. It also stores sRGB colours as linear factors, which makes them look washed out, and its teal foliage clashes with the city kits. The Platformer Kit gives matching trees and flowers in the city-kit palette instead.

### Flat ground tiles: kit palette

These colours were sampled from the kit textures when the assets were sourced. They are the kit reference, **not the live colours**. The live ground colours are in `src/catalog/models.ts` `GROUND_MODELS` (walkway `#c9b99a`, grass `#6cb562`, meadow `#5fa959`). The roads/pavement atlas is re-tinted to warm stone by `TownRenderer` (`MODEL_STYLES` `warmAtlas`).

| Use | Colour |
| --- | --- |
| Pavement (`tile-low` top) | `#a0a8c9` |
| Sidewalk strip on the road tiles | `#bdc6ee` |
| Walkway slabs | `#747990`, with brick edging `#dc855e` |
| Grass greens (platformer grass and trees) | `#4ab480`, `#3da679`, `#55bf85` |
| Flower accents | `#6385d2` (blue), `#ff9832` (orange) |

Pavement uses the kit's `tile-low` model with the warm atlas. Walkway, grass and meadow are procedural flat slabs in the `GROUND_MODELS` colours.

## Gaps and procedural fallbacks

- **Postbox:** no CC0 postbox exists in this style. Poly Pizza's CC0 options are a US kerbside mailbox by CreativeTrio and a chunky KayKit-style one by Isa Lousberg. Both clash, and the good British pillar box there is CC-BY. So `composed/postbox.glb` is a procedural pillar box: 12-sided red body, dome cap, dark slot and plinth, gold plate, 216 triangles, CC0. The game can also rebuild it from `CylinderGeometry` if preferred. The recipe is in `scripts/compose-models.mjs`.
- **Bus stop:** no kit has one. `composed/bus-stop.glb` combines three Kenney parts:
  - the commercial `detail-overhang-wide` canopy at ×0.9;
  - the holiday `bench` at ×0.26;
  - the roads `road-sign-street` pole at ×0.9.
  
  It reads as a bus shelter, but the sign is the green street-sign blade, not a bus logo. A proper "BUS" plate would need a procedural decal.
- **Grass and meadow ground:** there is no Kenney ground tile in the city palette. Use flat tiles in the colours above and scatter `grass-tuft` and the flowers for texture.
- **Small-fence corners:** none are needed, because edges meet at posts.
- **Pedestrians:** none. They are not in scope.

## Verification done

1. **Static check:** `node scripts/inspect-models.mjs` checks all 44 GLBs in `public/assets/models`: every GLB parses and every referenced image exists. It prints bounds, triangles and bytes. Those numbers were copied into `models.json` when the assets were sourced; the script doesn't write the manifest. Re-checked 2026-09-27: 44 models, 0 problems.
2. **three.js check:** `node scripts/inspect-models.mjs --three` loads all 44 with the real three.js r184 `GLTFLoader` in Node. It uses a `fetch`/`createImageBitmap` shim that reads files from disk and checks the PNG size. Result: 44/44 loaded, and every textured material got its 512×512 colormap. A negative test (texture removed) fails as expected.
3. **Visual check (historical, at sourcing time, before M0):**
   - At that point **no browser screenshot could be taken**. Since M0 the game has rendered in real Chromium, and the `asset-gallery` state is covered by the committed visual baselines. The sourcing agent ran inside a nono sandbox where Chromium (Playwright) and Blender both crash at GPU/Metal initialisation, and the sandbox also denies Chrome's `~/Library/Application Support` profile path.
   - Instead, every model was loaded **through the vite dev server by three.js `GLTFLoader`**, which exercises the real URLs and relative texture paths. The resulting three.js scene graph was then drawn with a small CPU rasteriser: perspective-correct texture sampling from the loaded colormaps, and Lambert shading. It is a throwaway in the scratchpad, not in the repo.
   - Those renders are the three screenshots in this folder. They confirm textures resolve, which way each model faces, the road-piece connections, and relative scale.

## Licence and attribution

All shipped models are **CC0 1.0**. Every pack folder in `public/assets/models/` has its `License.txt`, and `composed/License.txt` lists what each composed GLB is built from. Credits are in [`CREDITS.md`](CREDITS.md).

| Folder | Source | Licence |
| --- | --- | --- |
| `roads/` | Kenney City Kit (Roads) 2.1 — https://kenney.nl/assets/city-kit-roads | CC0 |
| `suburban/` | Kenney City Kit (Suburban) 2.0 — https://kenney.nl/assets/city-kit-suburban | CC0 |
| `industrial/` | Kenney City Kit (Industrial) 2.0 — https://kenney.nl/assets/city-kit-industrial | CC0 |
| `platformer/` | Kenney Platformer Kit 4.1 — https://kenney.nl/assets/platformer-kit | CC0 |
| `fantasy-town/` | Kenney Fantasy Town Kit 2.0 — https://kenney.nl/assets/fantasy-town-kit | CC0 |
| `holiday/` | Kenney Holiday Kit 2.0 — https://kenney.nl/assets/holiday-kit | CC0 |
| `cars/` | Kenney Car Kit 3.1 — https://kenney.nl/assets/car-kit | CC0 |
| `composed/` | Built from Kenney City Kit (Commercial) 2.1, Holiday, Roads, Suburban, Fantasy Town and Industrial parts, plus an original primitive postbox | CC0 |

`assets-src/` also holds the full source packs: the rest of every kit above (for example 21 suburban houses and more cars), the City Kit (Commercial) parts used by the bus stop, and the unused Nature Kit 2.1.
