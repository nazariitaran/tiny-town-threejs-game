# Credits

## 3D Models

Almost all 3D models in `public/assets/models/` are licensed **CC0 1.0 Universal** (public domain, http://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required, but these credits are given with thanks. **Three models are CC-BY 3.0 and must be credited** (see "Poly Pizza models" below); they are the first CC-BY assets in the project (v0.3). Per-model details are in `docs/assets/models.md` and `docs/assets/models.json`. Each pack's original `License.txt` is kept next to the models in `public/assets/models/<pack>/License.txt` and in `assets-src/<pack>/`.

### Kenney kits (CC0)

| Pack | Author | URL | Models used |
|---|---|---|---|
| City Kit (Roads) 2.1 | Kenney (www.kenney.nl) | https://kenney.nl/assets/city-kit-roads | road-straight, road-bend, road-bend-sidewalk, road-bend-square, road-intersection, road-intersection-line, road-intersection-path, road-crossroad, road-crossroad-line, road-crossroad-path, road-end, road-end-round, road-square, road-crossing, road-driveway-single, road-roundabout, tile-low, light-curved, traffic-light, traffic-light-hanging; road-sign-street (inside bus-stop) |
| City Kit (Suburban) 2.0 | Kenney | https://kenney.nl/assets/city-kit-suburban | building-type-a/-c/-d/-e/-i/-k/-m/-n/-o/-r/-s/-u, planter, path-long, path-short, path-stones-long, path-stones-short, tree-large, tree-small; fence (inside fence-tall); colour variation textures |
| City Kit (Industrial) 2.0 | Kenney | https://kenney.nl/assets/city-kit-industrial | building-s; building-j (as composed/garage) |
| City Kit (Commercial) 2.1 | Kenney | https://kenney.nl/assets/city-kit-commercial | building-e (supermarket); detail-overhang-wide (inside bus-stop); detail-parasol-a, detail-parasol-b (inside swimming-pool) |
| Platformer Kit 4.1 | Kenney | https://kenney.nl/assets/platformer-kit | tree (also the bush), tree-pine, hedge, flowers, flowers-tall, grass, plant, rocks |
| Fantasy Town Kit 2.0 | Kenney | https://kenney.nl/assets/fantasy-town-kit | lantern; fence, fence-gate (as composed/fence-small, fence-small-gate); fountain-round-detail (as composed/fountain); fountain-square (inside swimming-pool) |
| Holiday Kit 2.0 | Kenney | https://kenney.nl/assets/holiday-kit | bench (garden bench, also inside bus-stop) |
| Car Kit 3.1 | Kenney | https://kenney.nl/assets/car-kit | sedan, hatchback-sports, van, taxi |
| Tiny Town (original) | this project | — | composed/postbox.glb (procedural primitives, CC0) |

### Poly Pizza models (v0.3)

Downloaded from Poly Pizza (https://poly.pizza) and normalised by `scripts/compose-models.mjs` ("normalised recipes": rescaled to game units, turned, materials set to metalness 0 / roughness 1). The sources are in `assets-src/polypizza/` (gitignored). The in-game **Credits** panel (`src/ui/UiRoot.ts`) repeats these attributions.

CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/) requires attribution. Use the line in the "Attribution" column. CC0 needs no attribution but is credited anyway.

| Shipped file | Title | Author | Licence | Source | Attribution |
|---|---|---|---|---|---|
| `composed/church.glb` | Church | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/0Oe72PEPCK6 | "Church" by Poly by Google, via Poly Pizza, CC-BY 3.0 |
| `composed/swing.glb` | Swing set | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/e-IJdcqZH4p | "Swing set" by Poly by Google, via Poly Pizza, CC-BY 3.0 |
| `composed/barbecue.glb` | Grill | Zsky | CC-BY 3.0 | https://poly.pizza/m/SIlnlrbQR7 | "Grill" by Zsky, via Poly Pizza, CC-BY 3.0 |
| `composed/corner-shop.glb` | Building | Kay Lousberg (KayKit) | CC0 1.0 | https://poly.pizza/m/EL3ePInr1N | "Building" by Kay Lousberg, via Poly Pizza, CC0 |

All three CC-BY models were modified (rescaled, turned, flat materials). `composed/License.txt` carries the same lines next to the files.

### Composed models

The composed models (`public/assets/models/composed/`) are built by `scripts/compose-models.mjs`:
- bus-stop, fences, garage, fountain and swimming-pool are rearranged or re-centred copies of the Kenney models above, and remain CC0;
- postbox is an original primitive model, CC0;
- church, swing and barbecue keep their CC-BY 3.0 licence; corner-shop stays CC0.

### Icons

The 34 tool icons in `public/assets/icons/tool-<id>.png` (128 px) were rendered in this project from the in-game models, using `scripts/render-icons.mjs` + `src/render/IconStudio.ts` (in-game models and materials). Icons of CC0 models are CC0. The Church, Swing and Barbecue icons are renders of the CC-BY models above and carry the same attribution. v0.3 deleted the old icons, including Kenney's 64 px preview renders of unused models.

## Music

| Track | File | Credit |
|---|---|---|
| Foundation of Gold | `public/assets/music/foundation-of-gold.mp3` | Foundation of Gold — background music created by the project owner (generated with ElevenLabs, owner's account); all rights held by the project owner. |

## Font

| Font | Package | Licence |
|---|---|---|
| Nunito (variable) by Vernon Adams, Cyreal and Jacques Le Bailly | `@fontsource-variable/nunito` (bundled by Vite, no CDN) | SIL Open Font License 1.1 |

## Sound Effects

All sound effects in `public/assets/audio/` are derived from **Kenney** audio packs (www.kenney.nl), licensed **CC0 1.0 Universal** (public domain, http://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required; credited with thanks. Files were trimmed, mixed to mono, loudness-matched and transcoded to MP3 (see `docs/assets/audio.md`).

| Pack | URL | Files used |
|---|---|---|
| Interface Sounds (1.0) | https://kenney.nl/assets/interface-sounds | click_001, maximize_008, minimize_008, bong_001, back_004, drop_003 |
| UI Audio | https://kenney.nl/assets/ui-audio | rollover2, rollover5 |
| Impact Sounds | https://kenney.nl/assets/impact-sounds | impactGeneric_light_000/001/002, footstep_grass_000/001/003, impactWood_heavy_000/002/004, impactWood_light_000/001/002/003/004, impactPlank_medium_000/001/002/003, impactMetal_light_001/004, footstep_snow_001/002 |
| RPG Audio | https://kenney.nl/assets/rpg-audio | cloth2 |

Original License.txt files are kept in `assets-src/<pack>/License.txt`.
