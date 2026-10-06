# Credits

## 3D Models

Almost all 3D models in `public/assets/models/` are licensed **CC0 1.0 Universal** (public domain, http://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required, but these credits are given with thanks. **Six models are CC-BY 3.0 and must be credited** (see "Poly Pizza models" below): the church, swing, barbecue, donut shop, tiered fountain and slide. Per-model details: `docs/assets.md`. Each pack's original `License.txt` is kept next to the models in `public/assets/models/<pack>/License.txt` and in `assets-src/<pack>/`.

### Kenney kits (CC0)

| Pack | Author | URL | Models used |
|---|---|---|---|
| City Kit (Roads) 2.1 | Kenney (www.kenney.nl) | https://kenney.nl/assets/city-kit-roads | road-straight, road-bend-square, road-intersection-line, road-intersection-path, road-crossroad-line, road-crossroad-path, road-end-round, road-square, road-crossing, road-roundabout (modified: hidden underside removed, round kerbs and lines with fewer segments), tile-low, light-curved, traffic-light, traffic-light-hanging; road-sign-street (inside bus-stop); road-straight, road-bend-square, road-intersection-line, road-crossroad-line, road-end-round, road-crossing (as parking/road-joint-*.glb, centre lines removed) |
| City Kit (Suburban) 2.0 | Kenney | https://kenney.nl/assets/city-kit-suburban | building-type-a/-c/-d/-e/-i/-k/-m/-n/-o/-r/-s/-u, planter, path-long, path-short, path-stones-long, path-stones-short, tree-large, tree-small; fence (inside fence-tall); colour variation textures |
| City Kit (Commercial) 2.1 | Kenney | https://kenney.nl/assets/city-kit-commercial | building-e (supermarket); detail-overhang-wide (inside bus-stop); detail-parasol-a, detail-parasol-b (inside swimming-pool) |
| Platformer Kit 4.1 | Kenney | https://kenney.nl/assets/platformer-kit | tree (also the bush), tree-pine, hedge, flowers, flowers-tall, grass, rocks |
| Fantasy Town Kit 2.0 | Kenney | https://kenney.nl/assets/fantasy-town-kit | stall (Table), stall-bench (Long bench); fence (as composed/fence-small); fountain-round-detail (as composed/fountain); fountain-square (inside swimming-pool) |
| Nature Kit 2.1 | Kenney | https://kenney.nl/assets/nature-kit | flower_red/yellow/purple A–C (inside composed/tulips-a/-b/-c, recoloured) |
| Holiday Kit 2.0 | Kenney | https://kenney.nl/assets/holiday-kit | bench (garden bench, also inside bus-stop) |
| Car Kit 3.1 | Kenney | https://kenney.nl/assets/car-kit | sedan, hatchback-sports, van, taxi (modified: hidden faces removed, wheels rebuilt, one mesh each) |
| Tiny Town (original) | this project | — | composed/postbox.glb (procedural primitives, CC0); parking/parking-small/-medium/-large.glb (built by scripts/build-parking.py on the City Kit (Roads) atlas, CC0); stadium/stadium.glb (built by scripts/build-stadium.py on the same atlas, CC0); cinema/cinema.glb (built by scripts/build-cinema.py on the same atlas, CC0); roads/roundabout-corner.glb (built by scripts/build-roundabout-corner.py from the roundabout's outline, same atlas, CC0); pond/*.glb (placeholder shore pieces, pond plants, bird house and duck built by scripts/build-pond-placeholders.mjs, flat vertex colours, CC0) |

### Poly Pizza models

Downloaded from Poly Pizza (https://poly.pizza) and normalised by `scripts/compose-models.mjs` ("normalised recipes": rescaled to game units, turned, materials set to metalness 0 / roughness 1). The sources are in `assets-src/polypizza/` (gitignored). The in-game **Credits** panel (`src/ui/UiRoot.ts`) repeats these attributions.

CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/) requires attribution. Use the line in the "Attribution" column. CC0 needs no attribution but is credited anyway.

| Shipped file | Title | Author | Licence | Source | Attribution |
|---|---|---|---|---|---|
| `composed/church.glb` | Church | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/0Oe72PEPCK6 | "Church" by Poly by Google, via Poly Pizza, CC-BY 3.0 |
| `composed/swing.glb` | Swing set | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/e-IJdcqZH4p | "Swing set" by Poly by Google, via Poly Pizza, CC-BY 3.0 |
| `composed/barbecue.glb` | Grill | Zsky | CC-BY 3.0 | https://poly.pizza/m/SIlnlrbQR7 | "Grill" by Zsky, via Poly Pizza, CC-BY 3.0 |
| `composed/corner-shop.glb` | Building | Kay Lousberg (KayKit) | CC0 1.0 | https://poly.pizza/m/EL3ePInr1N | "Building" by Kay Lousberg, via Poly Pizza, CC0 |
| `composed/donut-shop.glb` | Donut Store | J-Toastie | CC-BY 3.0 | https://poly.pizza/m/BvRLKgGwc6 | "Donut Store" by J-Toastie, via Poly Pizza, CC-BY 3.0 |
| `composed/tiered-fountain.glb` | Fountain | Poly by Google | CC-BY 3.0 | https://poly.pizza/m/7AydBrjR2Ss | "Fountain" by Poly by Google, via Poly Pizza, CC-BY 3.0 |
| `composed/slide.glb` | Slide | sirkitree | CC-BY 3.0 | https://poly.pizza/m/8D47EdapzBW | "Slide" by sirkitree, via Poly Pizza, CC-BY 3.0 |
| `composed/mailbox.glb` | Mailbox | CreativeTrio | CC0 1.0 | https://poly.pizza/m/2olZ0G8iur | "Mailbox" by CreativeTrio, via Poly Pizza, CC0 |

All six CC-BY models were modified (rescaled, turned, flat materials; the fountain was recoloured; the donut shop was remodelled by hand into a lighter single-mesh version with the same look, without its ground slab or window texture). `composed/License.txt` carries the same lines next to the files.

### Composed models

The composed models (`public/assets/models/composed/`) are built by `scripts/compose-models.mjs`:
- bus-stop, fences, fountain and swimming-pool are rearranged or re-centred copies of the Kenney models above, and remain CC0;
- tulips-a/-b/-c combine three Kenney Nature Kit flowers each, recoloured, and remain CC0;
- postbox is an original primitive model, CC0;
- church, swing, barbecue, donut-shop, tiered-fountain and slide keep their CC-BY 3.0 licence; corner-shop and mailbox stay CC0.

### Icons

The 40 tool icons in `public/assets/icons/tool-<id>.png` (128 px) were rendered in this project from the in-game models, using `scripts/render-icons.mjs` + `src/render/IconStudio.ts` (in-game models and materials). Icons of CC0 models are CC0. The Church, Swing, Barbecue, Donut shop, Tiered fountain and Slide icons are renders of the CC-BY models above and carry the same attribution.

The 40 tool icons have 12 variant icons beside them (`tool-<id>-v<n>.png`, the variant picker), rendered the same way from CC0 models.

The author's link icons in Credits (`src/ui/glyphs.ts` `github`, `linkedin`, `x`; inline SVG) are the platforms' own marks, used only to link to the author's pages on those platforms. The GitHub and X paths are the ones published by [Simple Icons](https://simpleicons.org) (CC0); the LinkedIn "in" was drawn in this project. The marks are trademarks of GitHub, LinkedIn and X Corp.

The favicon (`public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png`) is the title mark: the project's own `homes` UI glyph in white on the brand brick colour, CC0. `favicon.svg` is the source; the PNG/ICO sizes were rendered from it in Chromium.

## Music

| Track | File | Credit |
|---|---|---|
| Foundation of Gold | `public/assets/music/foundation-of-gold.mp3` | Foundation of Gold — background music created by the project owner (generated with ElevenLabs, owner's account); all rights held by the project owner. |

## Data

| Data | File | Credit |
|---|---|---|
| Town name suggestions (500 names) | `public/data/default_town_names.json` | Supplied by the project owner; all rights held by the project owner. Fetched at load, not bundled. |

## Font

| Font | Package | Licence |
|---|---|---|
| Nunito (variable) by Vernon Adams, Cyreal and Jacques Le Bailly | `@fontsource-variable/nunito` (bundled by Vite, no CDN) | SIL Open Font License 1.1 |

## Sound Effects

All sound effects in `public/assets/audio/` except the stadium crowd are derived from **Kenney** audio packs (www.kenney.nl), licensed **CC0 1.0 Universal** (public domain, http://creativecommons.org/publicdomain/zero/1.0/). Attribution is not required; credited with thanks. Files were trimmed, mixed to mono, loudness-matched and transcoded to MP3 (see `docs/assets.md`).

| Pack | URL | Files used |
|---|---|---|
| Interface Sounds (1.0) | https://kenney.nl/assets/interface-sounds | click_001, maximize_008, minimize_008, bong_001, back_004, drop_003 |
| UI Audio | https://kenney.nl/assets/ui-audio | rollover2, rollover5 |
| Impact Sounds | https://kenney.nl/assets/impact-sounds | impactGeneric_light_000/001/002, footstep_grass_000/001/003, impactWood_heavy_000/002/004, impactWood_light_000/001/002/003/004, impactPlank_medium_000/001/002/003, impactMetal_light_001/004, footstep_snow_001/002 |
| RPG Audio | https://kenney.nl/assets/rpg-audio | cloth2 |

Original License.txt files are kept in `assets-src/<pack>/License.txt`.

| Sound | File | Credit |
|---|---|---|
| Stadium crowd | `public/assets/audio/stadium-crowd.mp3` | Supplied by the project owner; all rights held by the project owner. Mixed to mono, made loopable and transcoded to MP3 (see `docs/assets.md`). |
| Cinema posters (4) | `public/assets/posters/cinema-posters.webp` | Supplied by the project owner; all rights held by the project owner. Cropped to 3:4, resized and packed into one atlas by `scripts/build-cinema-posters.py` (see `docs/assets.md`). |

## Software

The open-source libraries shipped to players (`package.json` "dependencies": three.js, lil-gui, the Fontsource Nunito package) are listed with their versions and full licence texts in `public/licenses.txt`, which the in-game Credits panel links to ("open-source licences"). MIT and the SIL Open Font License require their licence text to travel with the copies; the minified bundle drops the comments, so this file carries them. It is generated by `npm run gen:licenses` (`scripts/gen-licenses.mjs`); `npm run verify` fails if it is out of date, so re-run it after adding, removing or upgrading a runtime dependency. Dev dependencies (Vite, TypeScript, Playwright, Vitest) are not shipped and are not listed.
