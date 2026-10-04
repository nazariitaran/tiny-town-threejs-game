# Assets

How to add or change a model, an icon or a sound. Licences and attribution lines: [`CREDITS.md`](../CREDITS.md).

## Models

### Sources
One flat, colourful look: a 512 px gradient `colormap.png` per kit, the same greens, lavender-greys and terracotta.

| Folder in `public/assets/models/` | Source | Licence |
| --- | --- | --- |
| `roads/` | Kenney City Kit (Roads) 2.1 | CC0 |
| `suburban/` | Kenney City Kit (Suburban) 2.0 | CC0 |
| `commercial/` | Kenney City Kit (Commercial) 2.1 | CC0 |
| `platformer/` | Kenney Platformer Kit 4.1 | CC0 |
| `fantasy-town/` | Kenney Fantasy Town Kit 2.0 | CC0 |
| `holiday/` | Kenney Holiday Kit 2.0 | CC0 |
| `cars/` | Kenney Car Kit 3.1, optimised by `scripts/build-cars.py` (below) | CC0 |
| `composed/` | built by `scripts/compose-models.mjs` (below) | CC0, except church, swing, barbecue, donut shop (remodelled), tiered fountain and slide: CC-BY 3.0 |
| `parking/` | built in Blender by `scripts/build-parking.py` (below) | CC0 (original; samples the roads atlas) |
| `stadium/` | built in Blender by `scripts/build-stadium.py` (below) | CC0 (original; samples the roads atlas) |

- Every pack folder keeps its `License.txt`; `composed/License.txt` names what each composed GLB is built from.
- `assets-src/` (gitignored) holds the full source packs, the Nature Kit 2.1, the City Kit (Industrial) and `polypizza/` (the Poly Pizza source GLBs with their own `CREDITS.md`).
- A CC-BY model needs a `CREDITS.md` row, a line in the in-game Credits panel (`src/ui/UiRoot.ts`) and a line in `composed/License.txt`.
- The suburban houses can change roof colour: `suburban/Textures/variation-{a,b,c}.png` share the `colormap.png` layout (roof orange, pink or dark). Load one with `TextureLoader`, set `flipY = false` and `colorSpace = SRGBColorSpace`, and assign it as `map` on a **cloned** material.
- Check every GLB: `npm run inspect:models` (bounds, triangles, materials, bytes; exits 1 on a missing texture or a parse error); `--three` also loads each one through `GLTFLoader`.

### Adding a model
1. Put the GLB under `public/assets/models/<pack>/` (Kenney GLBs reference `Textures/colormap.png` relative to themselves, so keep the folder layout) or build it into `composed/`.
2. Add a `ModelSpec` to `MODELS` in `src/catalog/models.ts`: `url`, `scale`, `rotationOffset`, optional `offset`, `sway` (foliage) and `glow` (`windows` for homes, `lamp`, `traffic`).
3. For a new item, add an `ObjectDef` in `src/catalog/objects.ts` and a tool row in `src/catalog/tools.ts`, then render its icon.
4. Per-model look overrides (atlas colour, non-uniform scale, the warm road atlas) go in `MODEL_STYLES`, `src/render/modelStyles.ts`.
5. `npm run test:unit`: `catalog.test.ts` checks that every model loads, fits its footprint at every rotation and keeps the proportions below.

### Scale and grid fit
- A cell is `CELL_SIZE` = 0.5 world units; toy scale is about 1 unit ≈ 8 m, a cell ≈ 4 m.
- A Kenney road tile is exactly 1 × 1 at scale 1 (top at y = 0.02) and covers one aligned 2 × 2 road block. Two lanes of ≈ 0.37 run between the kerbs.
- Homes, the supermarket and the church use `HOME_SCALE` = 4/3 so the building fills its lot; homes are nudged back (offset z −0.2) so a front yard shows.
- Composed Poly Pizza models are scaled into game units by the compose script, so their catalog scale is usually 1.
- Reference sizes as drawn: car 0.43–0.49 long, 0.19–0.26 tall (`LifeSystem.CAR_SCALE` 0.17); cottage 1.11 tall; pine 1.80 (`ObjectDef.height` 2); oak 1.74; lamppost 0.675; traffic light 0.52; church 2.33; stadium 1.42 to the rim of its bowl, 2.15 to the roof, 2.85 to the top of the floodlights, the tallest thing in town (birds fly from 3.1). Trees and plants get ±12 % size jitter from their id.
- The full drawn-size table is logged by `npx vitest run src/catalog/catalog.test.ts -t "bounding-box"`.
- The decor ring outside the plot draws oak and pine at 0.36 regardless of the catalog scale (`DecorRing.TEMPLATE_RESCALE`).

### Pivot and orientation
- **Axes:** Y-up. In top-down terms +X is east, +Z is south (towards the default camera); N = −Z, W = −X.
- **Pivot:** `ModelLibrary` re-centres every model on its bounding-box footprint centre and puts its base on y = 0. A catalog `offset` only matters when the visible part should sit off the bounds centre: the lamppost (pole at the native origin, arm overhanging −Z; offset z 0.087) and the hanging traffic light (offset x −0.103 after its turn).
- **Front:** the game's contract is "rotation 0 ⇒ front faces +Z". Kenney city, suburban and commercial models, and the composed bus stop, postbox, pool and donut shop, face −Z, so they use `rotationOffset: 2`. Exceptions:
  - traffic lights face −X: `rotationOffset: 1`;
  - corner shop, church, mailbox and the holiday bench face +Z: `0`;
  - long bench and table run along Z: `1` lays them along X;
  - the swing and slide run along X: `0`;
  - cars (`LifeSystem`, not in the catalog) face +Z natively, so `FRONT_ROTATION` is 0.

  Trees, plants, rocks, fountains, the barbecue and the roundabout are symmetric.
- **Edge pieces** (`hedge`, `fence-low`, `fence-tall`) are 1 native unit long along X, base y = 0; at scale 0.5 they span one cell edge. The origin sits on the edge midpoint (`edgeToWorld`): an `n` edge runs along X, a `w` edge along Z (turned 90°). Runs meet at their posts, so there are no corner pieces. The hedge sits on the +Z half of its native tile; bounds-centring moves it onto the edge.
- **Walkways** are procedural slabs in `TownRenderer` (0.25 wide hub + arms); the Garden path ghost uses `walkway-hub` (`suburban/path-short` × 1.25).

### Road auto-tiling
Native connections at rotation 0:

| Piece (file) | Connects |
| --- | --- |
| straight (`road-straight`), zebra straight (`road-crossing`) | W + E |
| corner (`road-bend-square`) | W + S |
| tee (`road-intersection-line`), zebra tee (`road-intersection-path`) | W + E + S |
| cross (`road-crossroad-line`), zebra cross (`road-crossroad-path`) | all four |
| end (`road-end-round`) | E |
| single (`road-square`) | none |

`src/town/roadTiles.ts` maps each of the 16 neighbour masks to a canonical piece (straight N+S, corner E+S, tee E+S+W, end S) plus quarter turns, counter-clockwise from above (E→N→W→S). Each piece's `rotationOffset` turns the native model onto the canonical one: straight 1, corner 1, tee 0, cross 0, end 3. Both are unit-tested, and the `asset-gallery` test state shows every mask.
- The `-line` junctions are used so the centre lines meet.
- A road block under a Zebra crossing draws `ZEBRA_PIECE_MODELS` (straight, tee, cross) with the plain piece's rotation; corners, ends and singles have no zebra.
- A road block that joins a car park draws a **car-park joint** (`ROAD_JOINT_MODELS`, below): its piece without the centre line on the lot sides.
- The roundabout (`road-roundabout`, 3 × 3 tiles) is a road-feature object, not a road piece. A neighbouring road joins it only at the middle block of each side (`isFeatureArm`). Its lane ring radius is `RING_RADIUS` in `src/life/lanePaths.ts`.
- Road pieces, pavement and the roundabout are drawn with `warmAtlas`: the atlas's periwinkle kerb and paving texels become warm stone.

### Composed models
`node scripts/compose-models.mjs` rebuilds `public/assets/models/composed/*.glb` from `assets-src/`. The composed GLBs embed their textures. Recipe kinds:
- **merge:** parts of kit GLBs in one file: bus stop (Commercial `detail-overhang-wide`, Holiday `bench`, Roads `road-sign-street`), tall fence (two suburban fence panels), low fence (Fantasy Town `fence`, re-centred), pool (Fantasy Town `fountain-square` stretched into a basin plus two Commercial parasols), fountain (Fantasy Town `fountain-round-detail`).
- **primitive:** the postbox, a red pillar box from flat-shaded shapes.
- **Poly Pizza:** one source GLB scaled to game units, turned if needed, flat materials (metalness 0, roughness 1, no metal/roughness map): church, swing, barbecue, corner shop, tiered fountain (recoloured), slide, mailbox. Many Poly Pizza exports set metalness 0.4, which renders almost black without an environment map.
- **Hand-remodelled:** the donut shop is built from `scripts/data/donut-shop-optimised.glb`, a committed GLB (the recipe merges it as it is, flat materials, no slab), because the Poly Pizza "Donut Store" source (3,318 triangles, 11 meshes) was rebuilt in Blender as one mesh of 1,012 triangles and 12 flat-coloured materials, same footprint and look, 0.02 lower. To change it, edit that GLB and re-run the recipe; `assets-src/polypizza/donut-store.glb` is no longer read.
- **Nature Kit:** its materials set metalness 1 and store sRGB colours as linear factors, and its leaves are teal. `natureMaterials()` sets metalness 0, converts the factors and remaps the greens. The tulips (three flowers per model, one model per flower shape) are built this way; any further Nature Kit piece needs the same recipe.

### Cars
`cars/{hatchback-sports,van,taxi,sedan}.glb` are the Kenney Car Kit 3.1 cars, optimised in Blender: each is one mesh and one node (`LifeSystem` merges them into one `BatchedMesh` anyway) with the kit's own `colormap` material, and 1,061 / 1,095 / 1,087 / 1,047 triangles instead of about 2,050 each (5 meshes). Same bounding boxes and the same palette cells, so the look and the `headlights` night glow (head and tail lights) are unchanged.
- **What changed:** every face no ray from outside can reach is gone (the underside, the wheel-arch interiors, anything behind a wheel); one quad stays under the body because shadows are cast from back faces; the wheels are rebuilt as 16-sided tyres with smooth shading and a hub dish.
- **Rebuild:** `/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-cars.py` reads the originals from `assets-src/car-kit/Models/GLB format/` (gitignored, so put the Car Kit there first), rebuilds all four and rewrites the file Kenney-style (`Textures/colormap.png` by relative path, nothing embedded, the original material block). The output is byte-identical from run to run.

### Parking lots
`scripts/build-parking.py` builds `public/assets/models/parking/parking-{small,medium,large}.glb` in Blender, procedurally, from the road kit's measurements. Run it headless (`/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-parking.py`), or `exec` it in an open session and call `build_all()` to review the lots in a "Parking" collection (`build_all(export_glb=True)` also writes the GLBs).
- **Look:** every face samples one texel of the City Kit (Roads) `colormap.png`, as the road pieces do: asphalt at y = 0.01, a 0.1-wide sidewalk kerb at y = 0.02, 0.02-wide paint lines, bays in the road's darker kerb-side grey. The GLBs embed no texture and reference `../roads/Textures/colormap.png`, so `ModelLibrary` shares the road material, and `warmAtlas` warms kerbs and paint the same way. A blue "P" sign (its blue is below the warm tint's luminance cut) and planters with low-poly bushes.
- **Sizes:** whole road blocks, scale 1, `rotationOffset` 0 (the entrance faces +Z natively). Stalls are 0.35 × 0.6 (cars are 0.22–0.255 × 0.43–0.48).

  | Model | Footprint | Stalls | Layout | Triangles |
  | --- | --- | --- | --- | --- |
  | `parking-small` | 2 × 1 blocks (4 × 2 cells) | 4 | nose-in bays open to the street at the front, a planted kerb behind and planters at the ends | 252 |
  | `parking-medium` | 2 × 2 blocks (4 × 4 cells) | 8 | a 0.5-deep entrance apron across the front, a 0.6 aisle down the middle, 4 stalls each side | 158 |
  | `parking-large` | 2 × 3 blocks (4 × 6 cells) | 12 | as medium, with 3 + planter island + 3 stalls each side | 322 |

- **Entrance:** the front edge is open asphalt; medium and large keep a 0.2 × 0.1 kerb nub where their two front blocks meet (where two road tiles' kerbs would join) and carry the sign on it. Height: 0.37 to the top of the sign.
- The exporter output is rewritten like a Kenney GLB (`kenney_style`): external image, `minFilter` 9987, metalness 0, double-sided, one node named after the model.

### Car-park joints
A road block in front of a car park's entrance draws its usual Kenney piece without the centre line on the sides that face a lot, so the street's own line stays unbroken and no lane line runs into the lot. The same script builds them (`build_joints()`; the headless run builds lots and joints) as `public/assets/models/parking/road-joint-<piece>-<sides>.glb`:
- **Source:** the City Kit (Roads) piece itself (`road-straight`, `road-bend-square`, `road-intersection-line`, `road-crossroad-line`, `road-end-round`, and `road-crossing` for the zebra straight). The centre-line faces (lane-paint texel, within 0.0105 of the axis) on each lot side are cut at 0.01 past the junction and recoloured to the asphalt texel; nothing else changes. When every arm faces a lot, the paint left in the middle goes too. Same Kenney-style GLB rewrite as the lots, so they share the road material and its warm tint.
- **Frame:** each joint keeps its base piece's native orientation and `rotationOffset` (straight 1, corner 1, tee 0, cross 0, end 3). `<sides>` are the lot sides in the game's canonical frame (after `rotationOffset`, rotation 0: straight N+S, corner E+S, tee E+S+W, cross all, end S), lower-case `nesw`.
- **Set:** one joint per piece and set of lot sides, where sets a symmetric piece turns into each other (the straight's half turn, the cross's quarter turns) share the one with the smallest mask: straight `n`, `ns`; corner `e`, `s`, `es`; tee `e`, `s`, `w`, `es`, `ew`, `sw`, `esw`; cross `n`, `ne`, `ns`, `nes`, `nesw`; end `s`; zebra straight `n`, `ns`. 20 GLBs, 4–13 kB each.
- **Triangles:** the Kenney piece's count plus the cuts: straight 48–52 (44), corner 61–62 (60), tee 76–84 (76), cross 114–118 (108), end 222 (218), zebra straight 104 (104).
- The zebra tee and cross (`-path`) have no centre lines, so a zebra on a junction in front of a lot keeps its usual piece; corners and ends never carry a zebra.

### Stadium
`scripts/build-stadium.py` builds `public/assets/models/stadium/stadium.glb` in Blender, procedurally (`/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-stadium.py`; in an open session `exec` it and call `build_stadium()` to review it in a "Stadium" collection). It reuses the parking script's exporter, so the GLB is Kenney-style too: no embedded texture, `../roads/Textures/colormap.png`.
- **Design:** a football ground on a 14 × 11 cell lot (7 × 5.5 units, 0.05 margin), 1,724 triangles, 2.85 tall. An octagonal bowl in two tiers split by a concourse (`PROFILE`), the seats in red blocks with aisles on the straights (`BLOCKS`, `AISLE`) and white in the corners, over a concrete wall with a dark base, a dark window band and a red band at the rim (`WALL_BANDS`); a striped pitch with cut-in markings (penalty and six-yard boxes, centre circle), two goals and two dugouts inside a terracotta running track; a main stand at the back under a deep ribbed roof with a red fascia; a three-pylon gate with two doors, a red sign and a step at the front (+Z natively, `rotationOffset` 0, scale 1); a scoreboard on the +x end; five flags on the front rim; a floodlight mast on a footing in each corner, two rows of lamps tilted at the pitch.
- **Fit:** the bowl sits 0.06 back on the lot (`BOWL_SHIFT`) and the step is 0.10 deep, so the gate stays inside the lot; the bounds are z −2.70…2.74, which `ModelLibrary`'s centring evens out.
- **No `warmAtlas`:** it is a building, so its concrete stays the kit's lavender-grey, like the supermarket.
- **Night:** the lamps (atlas cell 0, 1) and scoreboard digits (5, 1) sample cells nothing else on the model uses; `GLOW_CELLS.floodlight` (`src/render/nightGlow.ts`) lights exactly those on a match night. The game measures the four lamp banks from those lamp-cell triangles (one bank per quadrant of the model) and lights the rest of the stadium from them, so keep one bank per corner and the lamps on their own cell. The pitch stripes (14, 3 and 15, 3), track (10, 2) and pitch paint and goals (9, 2) also keep their own cells, though nothing depends on it now. When changing colours: the roof, corner seats, lintel, dugouts and white flag use plain white (8, 2), which is the lamppost's lamp cell, and the yellow flags use (4, 1); both stay dark.
- The floor markings are cut into the floor mesh (`pitch_cuts` / `pitch_texel`), not laid on top, so they cannot z-fight at any zoom.

### Ground colours
Grass and wildflower ground share one lawn colour, walkways their own; both are flat procedural tiles in `GROUND_MODELS` (`src/catalog/models.ts`), with an instanced tuft or flower scatter on top. Pavement is the kit's `tile-low` with the warm atlas.

### Icons
- `public/assets/icons/tool-<id>.png`: one 128 × 128 icon per placing tool, plus `tool-<id>-v<n>.png` for every extra model n ≥ 1 of a multi-model tool (`variantIcon` in `catalog/tools.ts`).
- Rendered from the in-game models and materials by `node scripts/render-icons.mjs [--size 128]`, which drives `src/render/IconStudio.ts` in Chromium and needs a dev server on `PORT`. It writes only the icons the catalog references; a run nudges unchanged icons by a few pixels.
- `catalog.test.ts` checks that the folder holds exactly the tool and variant icons.
- Move and Bulldoze use UI svgs (`/assets/ui/move.svg`, `/assets/ui/bulldoze.svg`).
- An icon carries its model's licence; the six CC-BY models' icons carry their attribution.

## Sound effects

All SFX come from Kenney CC0 audio packs. MP3 (VBR `-q:a 4`), mono, 44.1 kHz: Safari's Web Audio support for Ogg Vorbis is unreliable, so everything is transcoded. Two groups, `ui` and `sfx`, share one master gain (mute, volume).

### Event → file

| Event | File(s) in `public/assets/audio/` | Source (pack / file, layers) |
| --- | --- | --- |
| `ui-hover` | `ui-hover-1/2` | UI Audio / `rollover2`, `rollover5` |
| `ui-click` | `ui-click` | Interface Sounds / `click_001` |
| `ui-open` / `ui-close` | `ui-open`, `ui-close` | Interface Sounds / `maximize_008`, `minimize_008` |
| `place-path` | `place-path-1..3` | Impact Sounds / `impactGeneric_light_000/001/002` |
| `place-nature` | `place-nature-1..3` | `footstep_grass_000/001/003` + Interface Sounds `drop_003` @ −6 dB |
| `place-building` | `place-building-1..3` | `impactWood_heavy_000/002/004` + `impactWood_light_001/003/004` + `impactPlank_medium_000/002/003` @ −6 dB, high-passed at 80 Hz |
| `place-prop` | `place-prop-1/2` | `impactWood_light_000/002` |
| `place-prop-metal` | `place-prop-metal-1/2` | `impactMetal_light_001/004` + `impactWood_light_000/002` @ −6 dB |
| `rotate` | `rotate` | RPG Audio / `cloth2`, trimmed to 0.2 s |
| `remove` | `remove-1/2` | `footstep_snow_001/002` + `impactPlank_medium_001/002` @ −5 dB |
| `invalid` | `invalid` | Interface Sounds / `bong_001` |
| `undo` / `redo` | `undo-redo` (shared) | Interface Sounds / `back_004`, played at 0.89× / 1.12× |

Which tool plays which placement event: `sfx` in `src/catalog/tools.ts`. Bulldozing pitches `remove` by layer: object 0.92×, edge 1×, ground 1.06×.

### Levels
Loudness is **one-shot LUFS**: the highest EBU R128 momentary (400 ms) loudness, measured with 0.6 s of silence padded on. Targets: UI −29 to −32 (`invalid` −26), placements −21 to −25, `remove` −24, `rotate` −28. Kenney impacts are a single transient and the build allows at most 4 dB of limiting, so several placements land a few LU under target. Per-event runtime gain (`suggestedVolume`): UI 0.35–0.6, SFX 0.6–1.0; a building (1.0) is the loudest thing the player does, the bulldozer (0.75) sits under it. Measured numbers per file: `scripts/data/audio.json`.

### Rebuilding the SFX
`scripts/build-audio.py` builds every MP3 and writes `scripts/data/audio.json`; `npm run gen:sfx` turns that JSON into `src/audio/sfxTable.ts` (generated, never edited by hand). Edit the `PLAN` list at the top of the script to change sources, layers, targets or runtime gains. It needs Python 3 with numpy and scipy, plus ffmpeg.

```bash
# 1. fetch + unpack the packs into the gitignored assets-src/
cd assets-src
for u in \
  https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip \
  https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip \
  https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip \
  https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip; do
  n=$(basename "$u" .zip); n=${n#kenney_}; mkdir -p "$n"
  curl -sL -o "$n/$(basename "$u")" "$u" && (cd "$n" && unzip -oq "$(basename "$u")")
done
cd ..

# 2. build public/assets/audio/*.mp3 + scripts/data/audio.json, then the runtime table
ASSETS_SRC="$PWD/assets-src" python3 scripts/build-audio.py
npm run gen:sfx
```

Per file the script decodes and sums the layers (each with its own end fade), high-passes the mix (40 Hz, 80 Hz for buildings), trims leading silence with a 2 ms fade-in, ends on an 8 ms fade so no file stops on a non-zero sample, gains to the target (UI capped at −1.5 dBTP; SFX with at most 4 dB of 3 ms lookahead limiting) and re-measures the encoded MP3.

## Stadium crowd

| Sound | File | Format | Loudness |
| --- | --- | --- | --- |
| Stadium crowd loop | `public/assets/audio/stadium-crowd.mp3` (277 kB) | MP3 VBR `-q:a 4`, mono, 44.1 kHz, 29.0 s | −23.0 LUFS integrated, −10.1 dBTP |

Supplied by the project owner (`A_noisy_stadium_with_#1-….mp3`: 30.0 s, stereo, 48 kHz, 192 kbps); credit in `CREDITS.md`. Transcoded to the SFX format and made loopable by `scripts/build-crowd.py`:
```bash
mkdir -p assets-src/owner && cp <the owner's file> assets-src/owner/stadium-crowd-source.mp3
ASSETS_SRC="$PWD/assets-src" python3 scripts/build-crowd.py    # python3 + numpy + scipy, ffmpeg
```
- **Loop:** the last 1.5 s are cross-faded (equal power) into the first, which makes a 28.5 s loop; its first 0.5 s are appended again, so the file repeats after 28.5 s anywhere in its first half second. The runtime (`src/audio/CrowdLoop.ts`) loops the decoded buffer from 0.1 s to 28.6 s, clear of the silence an MP3 encoder pads on, so there is no gap or click whatever delay a decoder adds. The script checks the encoded file (correlation 0.993 across the seam). `CROWD_LOOP_START_S` and `CROWD_PERIOD_S` must match the script's numbers.
- **Loaded on first use:** fetched and decoded (about 5.5 MB of PCM) the first time a match is audible, never before Start and never in a town without a stadium, so it is not part of the download before the title.
- **Level:** `CROWD_TRIM` 0.5 (−6 dB) puts the crowd at the stadium at about −29 LUFS: under placement sounds (−21 to −25, momentary), a little over the music at its default volume (about −31). The two scales differ (integrated against momentary), so judge it by ear; a replacement file at another loudness needs a new trim.

## Music

| Track | File | Format | Loudness |
| --- | --- | --- | --- |
| Foundation of Gold | `public/assets/music/foundation-of-gold.mp3` (4.68 MB) | MP3, stereo, 44.1 kHz, 64 kbps CBR, 9:45 (585.05 s) | −13.0 LUFS integrated, −0.7 dBTP; a built-in fade-out from ~578 s |

Supplied by the project owner and copied unchanged; credit in `CREDITS.md`. The runtime (`src/audio/MusicPlayer.ts`, `musicPosition.ts`) depends on these facts:
- **Streamed** through an `HTMLAudioElement`, never decoded into an `AudioBuffer` (585 s of PCM is ~200 MB). It is requested on the first Start / Continue, not with the initial download.
- **Trim:** `MUSIC_TRIM` 0.25 (−12 dB) offsets the −13 LUFS master against SFX at about −25, so music at the default volume (0.5) sits about 15 dB under placement sounds. A replacement track mastered at a different loudness needs a new trim.
- **Loop:** the loop fade-out starts 1.2 s before the end, on top of the track's own ending fade. A saved position within 5 s of the end (`RESUME_END_GUARD_S`) restarts from 0.
- **Track id:** the saved position is keyed by `MUSIC_URL`; a new file name resets every player's position.
