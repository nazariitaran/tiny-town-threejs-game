# 3D models — Tiny Town

Every placeable item is covered by models in one flat, colourful look: a 512 px gradient `colormap.png` per kit, the same greens, lavender-greys and terracotta. Almost all are **CC0** models from Kenney's current kits. Since v0.3 a few come from **Poly Pizza** (https://poly.pizza): the church, swing and barbecue are **CC-BY 3.0** and need attribution, and the corner shop is CC0 (KayKit). They are normalised to the Kenney look (see "Poly Pizza models" below). Licences and attribution lines: [`CREDITS.md`](CREDITS.md).

- Machine-readable manifest: [`models.json`](models.json), with 65 entries covering bounds, pivot, front, scale, footprint, triangle count and bytes. There are 64 GLB files; `oak` and `bush` share `platformer/tree.glb`.
  - It is **hand-maintained**. `suggestedScale` and `footprintCells` match `src/catalog/models.ts` and `objects.ts` (edited by hand for WP-12 and v0.3). When the catalog changes, update the manifest by hand.
  - Ids are the catalog model ids (`MODELS` in `src/catalog/models.ts`), except the older road-piece and walkway entries (see "Coverage per build tool") and shipped-but-unused files, which have their own ids.
  - `category` is the dock category (`streets`, `homes`, `town`, `nature`, `garden`), or `decor` for cars and the decor ring.
  - `tool` is the dock tool that draws the model, or `extra` for cars, decor and files that are shipped but unused.
  - `icon` is that tool's dock icon, `/assets/icons/tool-<tool>.png`, or **`null`** when `tool` is `extra`. Variants share their tool's icon. No model has an icon of its own.
- Re-measure and verify: `npm run inspect:models`, or add `--three` to also load every GLB through three.js `GLTFLoader`.
  - The script prints a report and exits 1 on any problem. It does not update `models.json`.
  - **Never pass `--json docs/assets/models.json`.** That writes the raw report, which has a different schema, over the curated manifest.
- Rebuild the composed models: `node scripts/compose-models.mjs`. The sources live in `assets-src/` (Kenney kits, and `assets-src/polypizza/` for the Poly Pizza models) and are gitignored.
- Screenshots (historical, from sourcing time, 44 models): [town preview](models-town-preview.png), [gallery of all 44 at suggested scale](models-gallery.png), [road pieces top-down](models-road-pieces-topdown.png). The current in-game gallery is the `asset-gallery` test state: all 25 object kinds, every edge kind and the 16 road masks.
- Payload (measured 2026-09-27, v0.3 working tree): **3.58 MB** of GLB + PNG in `public/assets/models/` (64 GLBs; `du` 3.6 MB), plus 259 KB of icons (33 PNGs; `du` 316 KB). The four cars, used by the ambient life system (WP-10), are 0.73 MB of the model payload.

![town preview](models-town-preview.png)

## Coverage per build tool

Live scales and footprints are in the next section, "Grid and scale", and in `src/catalog/`. This table maps tools to sources, in dock order. Two older manifest ids differ from the catalog for road pieces: the manifest's `road-corner` is the curved `road-bend.glb` (unused), while the catalog's `road-corner` is `road-bend-square.glb` (manifest `road-corner-square`); the catalog's `road-end` is `road-end-round.glb` and `road-single` is `road-square.glb`. The walkway pieces are `walkway-hub` / `walkway-arm` in the catalog and `walkway-path-short` / `-long` in the manifest.

| Category | Tool | Model id(s) | Source file |
| --- | --- | --- | --- |
| Streets | Road | `road-straight`, `road-corner-square`, `road-tee` / `road-cross` (centre lines meet: `road-intersection-line` / `road-crossroad-line`), `road-end-round`, `road-single`; unused `road-corner` (curved), `road-corner-sidewalk`, `road-crossroad` / `road-intersection` (blank centre), `road-end`, `road-driveway` |
| Streets | Zebra crossing | `road-crossing` (straight), `road-tee-zebra` (`road-intersection-path`), `road-cross-zebra` (`road-crossroad-path`): drawn by the road tile under the marking | `roads/*.glb` (City Kit Roads) | `roads/*.glb` (City Kit Roads) |
| Streets | Pavement | `pavement-tile` | `roads/tile-low.glb` |
| Streets | Roundabout | `roundabout`: 3 × 3 road tiles in one model | `roads/road-roundabout.glb` |
| Streets | Traffic light | `traffic-light`, `traffic-light-hanging` (variants) | `roads/traffic-light*.glb` |
| Streets | Lamppost | `lamppost` (City Kit Roads `light-curved`); unused `lamppost-classic` (Fantasy Town lantern) | `roads/light-curved.glb`, `fantasy-town/lantern.glb` |
| Streets | Bus stop | `bus-stop`: canopy, bench and sign, **composed from Kenney parts** | `composed/bus-stop.glb` |
| Streets | Postbox | `postbox`: **procedural red pillar box**, because no CC0 match exists in this style | `composed/postbox.glb` |
| Homes | Cottage | `cottage` (type-a) | `suburban/building-type-a.glb` |
| Homes | Townhouse | `townhouse` (type-k), `townhouse-alt` (type-r) | `suburban/building-type-{k,r}.glb` |
| Homes | Bungalow | `bungalow` (type-i), `bungalow-l` (type-m, L-shaped) | `suburban/building-type-{i,m}.glb` |
| Homes | Family home | `family-home` (type-e) | `suburban/building-type-e.glb` |
| Homes | Suburban | `garage-house-c`, `-o`, `-s`, `-u` | `suburban/building-type-{c,o,s,u}.glb` |
| Homes | Big house | `big-house-d`, `big-house-n` | `suburban/building-type-{d,n}.glb` |
| Homes | Garage | `garage`: single garage, industrial building-j re-centred; unused `garage-row` (2×1 lock-up block) | `composed/garage.glb`, `industrial/building-s.glb` |
| Town | Fountain | `fountain`: Fantasy Town `fountain-round-detail` | `composed/fountain.glb` |
| Town | Corner shop | `corner-shop`: KayKit "Building" (Poly Pizza, CC0), normalised | `composed/corner-shop.glb` |
| Town | Church | `church`: "Church" by Poly by Google (Poly Pizza, **CC-BY 3.0**), normalised | `composed/church.glb` |
| Town | Supermarket | `supermarket`: City Kit Commercial `building-e` | `commercial/building-e.glb` |
| Town | Pool | `swimming-pool`: Fantasy Town `fountain-square` stretched into a basin, plus two Commercial parasol tables | `composed/swimming-pool.glb` |
| Nature | Grass | `grass-tuft` (scatter) on a flat lawn slab | `platformer/grass.glb` |
| Nature | Wildflowers | `meadow-flowers`, `meadow-flowers-tall` (+ `grass-tuft`) | `platformer/flowers*.glb` |
| Nature | Bush | `bush`: the oak canopy, sunk and squashed | `platformer/tree.glb` |
| Nature | Oak / Pine / Birch | `oak`, `pine`, `birch` (+ `birch-small`) | `platformer/tree.glb`, `platformer/tree-pine.glb`, `suburban/tree-{large,small}.glb` |
| Garden | Garden path | `walkway-path-long` (arm), `walkway-path-short` (hub); stepping-stone variants `walkway-stones-*`. In game, walkways are procedural slabs; the ghost uses the hub | `suburban/path-*.glb` |
| Garden | Hedge | `hedge`: edge piece | `platformer/hedge.glb` |
| Garden | Low fence | `fence-low`, unused `fence-small-gate`: Fantasy Town fence re-oriented to the edge convention | `composed/fence-small*.glb` |
| Garden | Tall fence | `fence-tall`: edge piece built from 2× suburban fence panels | `composed/fence-tall.glb` |
| Garden | Planter | `planter` (suburban) | `suburban/planter.glb` |
| Garden | Bench | `bench` (holiday) | `holiday/bench.glb` |
| Garden | Barbecue | `barbecue`: "Grill" by Zsky (Poly Pizza, **CC-BY 3.0**), normalised | `composed/barbecue.glb` |
| Garden | Swing | `swing`: "Swing set" by Poly by Google (Poly Pizza, **CC-BY 3.0**), normalised | `composed/swing.glb` |
| Decor | — | `car-sedan`, `car-hatchback`, `car-van`, `car-taxi` (ambient cars, WP-10); `rocks` (catalog `decor-rocks`) and the oak/pine in the decor ring; unused `plant` | `cars/*`, `platformer/rocks`, `platformer/plant` |

**Icons** (`public/assets/icons/tool-<toolId>.png`, 33 files, one per dock tool; Bulldoze uses `/assets/ui/bulldoze.svg`):
- All 33 are 128 × 128 and were rendered in this project from the in-game models and materials by `node scripts/render-icons.mjs`, which drives `src/render/IconStudio.ts` in a browser and needs a dev server. The script only writes the icons that `catalog/tools.ts` references. They were last re-rendered for v0.3.
- Icons of CC0 models are CC0. The Church, Swing and Barbecue icons show CC-BY models and carry their attribution (`CREDITS.md`).
- v0.3 deleted the 44 older icons (named after model ids), including the 27 Kenney 64 px previews of unused models. Only tools have icons now.

The suburban houses can change roof colour. `suburban/Textures/variation-{a,b,c}.png` have the same layout as `colormap.png`: roof swatch orange, pink or dark instead of green. To use one, load it with `TextureLoader`, set `flipY = false` and `colorSpace = SRGBColorSpace`, and assign it as `material.map` on a **cloned** material.

## Grid and scale

This section is **current**. It matches `src/catalog/models.ts` and `objects.ts` after WP-17 (bigger buildings, smaller swing; v0.2 rows otherwise unchanged).

**WP-17:** every home, the corner shop, the supermarket and the church grew one cell in each direction, and their models scaled up to fill the bigger lot: the homes, supermarket and church by `HOME_SCALE` = 4/3 (the depth ratio 3 → 4), the corner shop by 1.4. The front-yard nudge grew with them (−0.15 → −0.2; type-n −0.04 → −0.05), so the yard keeps its share of the lot. The swing shrank to 0.87. Trees (≈ 0.88) now reach about 80 % of the cottage (1.11) instead of matching it. Drawn sizes below are from `catalog.test.ts` › proportions.

**WP-12 (v0.2): `CELL_SIZE = 0.5` world units, a 48 × 48-cell plot (64 × 64 since 2026-09-28; cell size unchanged), and one Kenney road tile (1 world unit, `ROAD_TILE_SIZE`) covers an aligned 2 × 2 road block.** Toy scale: 1 world unit ≈ 8 m, a cell ≈ 4 m. All road pieces are exactly 1 × 1 at scale 1, centred, with their top at y = 0.02. The scales below are the live values in `src/catalog/models.ts`; sizes are as drawn (including TownRenderer's `MODEL_STYLES` stretch). The v0.2 rows were measured by `catalog.test.ts` › proportions (it logs this table). The v0.3 rows are the `inspect:models` bounds × the catalog scale, at rotation 0.

| Item | Footprint (cells) | Scale (v0.1) | Drawn size w × h × d | Why |
| --- | --- | --- | --- | --- |
| Roads | 2 × 2 block | 1 (1) | 1 × 0.02 × 1 | One tile per block. Two lanes of ≈0.37 between kerbs. |
| Pavement `tile-low` | 1 × 1 | 0.5 (1), style Y × 2 | 0.5 × 0.02 × 0.5 | Kerb-height strip beside the road tile's own kerb. |
| Cottage (type-a) | 4 × 4 | 4/3 (0.78), offset z −0.2 | 1.73 × 1.11 × 1.37 | ≈ 3.6× a car length, 4.7× a lane; front yard reads. |
| Townhouse (type-k / type-r) | 3 × 4 | 4/3 (0.88 / 0.87), offset z −0.2 | 1.23–1.37 × 1.53 × 1.36 | Same scale as the other homes: storeys and doors match across types. |
| Family home (type-e) | 4 × 4 | 4/3 (0.78), offset z −0.2 | 1.73 × 1.52 × 1.37 | v0.3: type-c moved to Suburban. |
| Bungalow (type-i / type-m) | 4 × 4 | 4/3 (new), offset z −0.2 / none | 1.71 × 0.98 × 1.37 / 1.90 × 0.98 × 1.90 | Single storey. The L-shaped type-m fills the footprint, so no nudge. |
| Suburban (type-c / -o / -s / -u) | 4 × 4 | 4/3 (type-c 0.78), offset z −0.2 | 1.69–1.90 × 1.38–1.52 × 1.37–1.45 | Two storeys with an attached garage. |
| Big house (type-d / type-n) | 5 × 4 | 4/3 (new), offset z −0.2 / −0.05 | 2.34 × 1.65 × 1.37 / 2.38 × 1.52 × 1.84 | type-n is deeper, so only a small nudge. |
| Corner shop (KayKit, composed) | 3 × 3 | 1.4 (new) | 1.29 × 1.06 × 1.29 | Composed GLB normalised to 0.92 wide; WP-17 scales it 1.4 (not 1.5) so it stays below the two-storey homes. |
| Supermarket (commercial building-e) | 5 × 4 | 4/3 (new) | 2.19 × 1.19 × 1.34 | Low and wide. |
| Church (Poly Pizza, composed) | 3 × 4 | 4/3 (new) | 1.04 × 2.33 × 1.89 | Tallest building. |
| Pool (composed) | 4 × 3 | 0.5 (new) | 2 × 0.36 × 1.44 | Basin at the back, deck with two parasols in front. |
| Fountain (composed) | 2 × 2 | 0.45 (new) | 0.9 × 0.22 × 0.9 | |
| Roundabout | 6 × 6 (3 × 3 road blocks) | 1 (new) | 3 × 0.02 × 3 | Same tile scale as the road pieces. |
| Traffic light (plain / hanging) | 1 × 1 | 1 (new) | 0.09 × 0.52 × 0.12 / 0.30 × 0.51 × 0.12 | Below the lamppost (0.675). |
| Garage | 1 × 2 | 0.48 (0.78) | 0.49 × 0.41 × 0.62 | Single car garage, below the eaves. |
| Bus stop | 2 × 1 | 0.8 (1) | 0.76 × 0.34 × 0.37 | |
| Postbox | 1 × 1 | 1.4 (2) | 0.15 × 0.24 × 0.15 | ≈ car height, ~1.2× real so it stays readable. |
| Lamppost `light-curved` | 1 × 1 | 1 (1.35), offset z 0.087, style 1.5 × 1 × 1.15 | 0.075 × 0.675 × 0.26 | Taller than garage and bus-stop bench, below the eaves. |
| Oak / Pine (platformer) | 1 × 1 | 0.45 (0.36) | 0.49 × 0.87 / 0.43 × 0.90 | About 80 % of the cottage since WP-17, below townhouse ridges. |
| Bush (platformer `tree`) | 1 × 1 | 0.3 (new), offset y −0.26, style Y × 0.58 | ≈ 0.33 wide, a low round canopy | The trunk is sunk out of sight. Trees and bushes also get ±12 % size jitter. |
| Birch `tree-large` / `-small` | 1 × 1 | 1.15 (1) | 0.24 × 0.88 / 0.65 | |
| Tall / low fence | cell edge (0.5) | 0.5 (1), style Y 1.8 / 1.4 | 0.5 long, 0.21 / 0.10 tall | ≈ 1.65 m / 0.8 m. |
| Hedge (platformer) | cell edge (0.5) | 0.5 (new), style X 1.12 | 0.56 × 0.20 × 0.15 | A little longer than the edge so runs close up at corners. |
| Planter (suburban) | 1 × 1 | 1 (new) | 0.40 × 0.18 × 0.30 | |
| Bench (holiday) | 1 × 1 | 0.3 (0.26, unused) | 0.34 × 0.22 × 0.19 | |
| Barbecue (Poly Pizza, composed) | 1 × 1 | 1 (new) | 0.15 × 0.20 × 0.15 | Scale baked into the GLB. |
| Swing (Poly Pizza, composed) | 2 × 1 | 0.87 (new) | 0.48 × 0.37 × 0.28 | Composed GLB is 0.56 wide; WP-17 made it 13 % smaller. Frame along x. |
| Flowers / grass tufts | scatter | 0.35 (0.35) | 0.1–0.27 clumps | One clump per cell (same density per area as v0.1). |
| Walkway | 1 × 1 | procedural | path 0.25 wide (half a cell) | Hub + arms per cell. The ghost uses `path-short` at 1.25 (0.25²). |
| Cars (`LifeSystem.CAR_SCALE`) | road lane | 0.17 (0.14) | 0.22–0.26 × 0.19–0.26 × 0.43–0.49 | Fits one lane. |
| Decor ring oak / pine | outside the plot | rendered at 0.36 (`DecorRing.TEMPLATE_RESCALE`) | unchanged | The ring stays exactly as in v0.1. |

Side-by-side evidence (same camera, v0.1 vs WP-12): `artifacts/wp-12/proportions-{before,after}.png`; WP-17: `artifacts/wp-17a/{before,after}/`. `artifacts/` is gitignored, so this exists only in the main checkout.

## Pivot and orientation conventions

- **Axes:** Y-up, as glTF. In top-down views below, +X is right and +Z is down (towards the default camera). "N" = −Z, "E" = +X, "S" = +Z, "W" = −X.
- **Pivot:** almost every model is **centre-bottom**: footprint bounding-box centre at the origin, base at y = 0. `ModelLibrary` bounds-centres every model and puts its base on y = 0 anyway, so an off-centre pivot only matters where the visible part (a pole) should sit mid-cell. The exceptions:
  - `lamppost`: the pole is at the origin, and the arm pushes the bounds 0.2 native units towards −Z. The catalog `offset` puts the pole back mid-cell.
  - `traffic-light-hanging`: the same shape; the arm overhangs −Z by 0.25. No offset is set, so its pole sits about 0.1 off the cell centre.
  - `bus-stop`: the bounds centre is about (0.02, −0.05), so it is effectively centred.
  - `swimming-pool`: the bounds centre is at z = 0.065 (native).
  - `hedge`: the piece sits on the +Z half of its tile (z 0.2 → 0.5); bounds-centring moves it onto the edge.
  - `barbecue`: centred, but its base is at y = −0.143 natively.
  - `plant` (unused): a slight −Z offset of 0.07 native.
  
  The three raw files with off-centre pivots (industrial `building-j`, and Fantasy Town `fence`/`fence-gate`) are shipped only as re-centred composed versions.
- **Front: the Kenney city, suburban, industrial and commercial models face −Z**, and so do the composed bus stop, postbox, garage and pool. This includes doors and planters, garage doors, the bus-stop open side, the postbox slot, the lamp arm and the pool deck. The game's contract is "rotation 0 ⇒ front faces +z", so use **`rotationOffset: 2`** (180°) for these in `catalog/models.ts`. The exceptions (v0.3):
  - **traffic lights** (`traffic-light`, `traffic-light-hanging`): the lamps face **−X** natively, so `rotationOffset: 1`;
  - **corner shop** and **church**: the shop front and the church tower and door face **+Z** natively, so `rotationOffset: 0`;
  - **holiday bench**: the seat faces **+Z**, so `rotationOffset: 0` (the bus stop's bench is turned inside the composed model).
  - **Car Kit cars** (not in the catalog; `LifeSystem`): the bonnet, raked windscreen and yellow headlights are at native **+Z** and the red tail lights at −Z. `LifeSystem.FRONT_ROTATION` is therefore 0. Until v0.3 (WP-16b) it was π and the cars drove backwards.
  
  Trees, the bush, flowers, rocks, the lantern, the fountain, the barbecue and the roundabout are symmetric, so their offset does not matter. The swing frame runs along X and is open on both sides (offset 0).
- **Edge pieces** (`hedge`, `fence-tall`, `fence-low`, unused `fence-small-gate`) are 1 native unit long along X, base y = 0. The fences are centred on the origin and 0.075–0.08 thick; the hedge is 0.3 thick and sits off-centre (see Pivot). At the catalog scale of 0.5 they span one cell edge. Place the origin at the midpoint of the cell edge (positions below are in cell units; `config.edgeToWorld` converts them):
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
>
> **Junctions and zebras (2026-09-28):** tees and crossroads draw `road-intersection-line` (76 triangles) / `road-crossroad-line` (108), whose centre lines meet; the plain `road-intersection` / `road-crossroad` left a blank patch in the middle. (v0.3 drew `road-crossroad-path` with zebras on every crossroad.) Zebras are the player's Zebra crossing tool: the road block under one draws `road-crossing` (straight, 104), `road-intersection-path` (tee, 204) or `road-crossroad-path` (cross, 276), each with the same rotation as the plain piece. The **roundabout** is not a road piece: it is a road-feature object that draws its own 3 × 3-tile model over its road blocks, and a neighbouring road joins it only at the middle block of each side (`roadTiles.isFeatureArm`).

## Loading notes (three.js r184)

- The Kenney GLBs reference an external `Textures/colormap.png` relative to the GLB. The folder layout under `public/assets/models/<pack>/` preserves that, so load them by URL with `GLTFLoader`. All 64 models were checked to load: see Verification.
- Materials are `MeshStandardMaterial` with metalness 0, roughness 1 and `KHR_texture_transform` declared, which `GLTFLoader` supports. Suburban and holiday textures use a NEAREST mag filter, which is intended.
- Each GLB is one mesh with one material, except the composed ones (up to 6 small meshes) and industrial models (a second `colormap-specular` material). Building triangle counts are about 800–1 760, the roundabout 1 636, and cars about 2 030–2 090. `InstancedMesh` pools keyed by (model, mesh) work fine.
- The composed GLBs embed their textures, so they need no `Textures/` folder. `postbox.glb` uses plain colour materials.
- **Poly Pizza models** (v0.3) go through the "normalised recipes" in `scripts/compose-models.mjs`: one source GLB from `assets-src/polypizza/`, scaled straight to game units (so the catalog scale is 1), turned if needed, and given flat materials (metalness 0, roughness 1, no metal/roughness map). Many Poly Pizza exports set metalness 0.4, which renders almost black without an environment map, the same problem as the Nature Kit.
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
- **v0.3 items with no Kenney model:**
  - **Church, swing, barbecue:** Poly Pizza CC-BY 3.0 models (`church-steeple-salmon`, `swing-set-wood`, `bbq-kettle-red`), normalised. These are the project's first CC-BY assets.
  - **Corner shop:** KayKit "Building" from Poly Pizza (CC0), normalised.
  - **Pool:** the Kenney Fantasy Town `fountain-square` basin stretched to a 4 × 2 pool, plus two Commercial parasol tables. It matches the palette.
  - **Fountain:** Fantasy Town `fountain-round-detail` as shipped.
  - **Bush:** the platformer `tree` canopy, sunk and squashed (the decor-ring hedgerow trick). The platformer `plant` read as birds from above.
- **Rejected in v0.3** (from the 2026-09-27 asset research):
  - Poly Pizza `public-pool` and `swimming-pool-inground`: heavy textures (the in-ground pool is 2 MB); the Kenney basin is used instead.
  - `bbq-gas-grill` (CreativeTrio, CC0): the kettle reads better.
  - `church-dark-roof` and `church-small-steeple`: `church-steeple-salmon` has the closest palette.
  - `swing-set-sandpit`: credited only to "Anonymous".
  - The Kenney Mini Market, Survival and Graveyard kits: not needed once `building-e`, the corner shop and the Poly Pizza models were in.

## Verification done

1. **Static check:** `node scripts/inspect-models.mjs` checks every GLB in `public/assets/models`: every GLB parses and every referenced image exists. It prints bounds, triangles and bytes. Those numbers were copied into `models.json` by hand (at sourcing time, and for the v0.3 models); the script doesn't write the manifest. Re-checked 2026-09-27 on the v0.3 working tree: 64 models, 0 problems.
2. **three.js check:** `node scripts/inspect-models.mjs --three` loads every GLB with the real three.js r184 `GLTFLoader` in Node. It uses a `fetch`/`createImageBitmap` shim that reads files from disk and checks the PNG size. Result then: 44/44 loaded, and every textured material got its 512×512 colormap. A negative test (texture removed) fails as expected. Re-run 2026-09-27 on the v0.3 working tree: 64/64 loaded.
3. **Visual check (historical, at sourcing time, before M0):**
   - At that point **no browser screenshot could be taken**. Since M0 the game has rendered in real Chromium, and the `asset-gallery` state is covered by the committed visual baselines. The sourcing agent ran inside a nono sandbox where Chromium (Playwright) and Blender both crash at GPU/Metal initialisation, and the sandbox also denies Chrome's `~/Library/Application Support` profile path.
   - Instead, every model was loaded **through the vite dev server by three.js `GLTFLoader`**, which exercises the real URLs and relative texture paths. The resulting three.js scene graph was then drawn with a small CPU rasteriser: perspective-correct texture sampling from the loaded colormaps, and Lambert shading. It is a throwaway in the scratchpad, not in the repo.
   - Those renders are the three screenshots in this folder. They confirm textures resolve, which way each model faces, the road-piece connections, and relative scale.

## Licence and attribution

All shipped models are **CC0 1.0**, except three composed models that are **CC-BY 3.0**: `church.glb`, `swing.glb` and `barbecue.glb` (attribution lines in [`CREDITS.md`](CREDITS.md) and in the in-game Credits panel). Every pack folder in `public/assets/models/` has its `License.txt`, and `composed/License.txt` lists what each composed GLB is built from, with the Poly Pizza sources and licences.

| Folder | Source | Licence |
| --- | --- | --- |
| `roads/` | Kenney City Kit (Roads) 2.1 — https://kenney.nl/assets/city-kit-roads | CC0 |
| `suburban/` | Kenney City Kit (Suburban) 2.0 — https://kenney.nl/assets/city-kit-suburban | CC0 |
| `industrial/` | Kenney City Kit (Industrial) 2.0 — https://kenney.nl/assets/city-kit-industrial | CC0 |
| `platformer/` | Kenney Platformer Kit 4.1 — https://kenney.nl/assets/platformer-kit | CC0 |
| `fantasy-town/` | Kenney Fantasy Town Kit 2.0 — https://kenney.nl/assets/fantasy-town-kit | CC0 |
| `commercial/` | Kenney City Kit (Commercial) 2.1 — https://kenney.nl/assets/city-kit-commercial | CC0 |
| `holiday/` | Kenney Holiday Kit 2.0 — https://kenney.nl/assets/holiday-kit | CC0 |
| `cars/` | Kenney Car Kit 3.1 — https://kenney.nl/assets/car-kit | CC0 |
| `composed/` | Built from Kenney City Kit (Commercial) 2.1, Holiday, Roads, Suburban, Fantasy Town and Industrial parts, plus an original primitive postbox; normalised Poly Pizza models (church, swing, barbecue, corner shop) | CC0, except church / swing / barbecue: CC-BY 3.0 |

`assets-src/` also holds the full source packs: the rest of every kit above (for example 21 suburban houses and more cars), the City Kit (Commercial) parts used by the bus stop and the pool, the unused Nature Kit 2.1, and `polypizza/` (the four Poly Pizza source GLBs with their own `CREDITS.md`).
