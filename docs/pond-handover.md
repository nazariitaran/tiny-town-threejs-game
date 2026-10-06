# Pond — handover

Status of the pond feature on branch `feature/pond`, and what is left for the owner: mostly the Blender models. Delete this file once the models are in and the open questions are settled (history lives in git).

## What works now

| Area | What | Where |
| --- | --- | --- |
| Pond ground | A new ground kind, `pond`, under **Nature** (third card). Painted a cell at a time like grass; touching cells join into one pond. Bulldoze turns a cell back to field. | `src/town/types.ts`, `src/catalog/tools.ts` |
| Shore | Auto-tiled per **quarter cell**: each quarter of a pond cell picks a shore piece from its two side neighbours and the diagonal between them (open water, straight edge, rounded outer corner, inner notch). Edges and outer corners have several models, picked by a hash of the quarter, so long banks don't repeat. | `src/town/pondTiles.ts`, `TownRenderer.describePond`, `POND_SHORE_MODELS` |
| Pond items | **Lily pads** (3 styles), **Reeds** (2), **Cattails** (2), **Bird house** (floating nest box on a raft). All 1 × 1, only in a pond. Plants scatter on drag and get the trees' hashed yaw and size; the bird house rotates. | `src/catalog/objects.ts`, `models.ts` |
| Rules | Pond-only items refuse dry land ("Lily pads must go in a pond"); everything else refuses water ("Oak can't go in a pond"). No hedge or fence between two pond cells; digging a pond through one removes it. Saves need no version bump (a new ground kind and new object kinds; an older build would drop them). | `src/town/rules.ts`, `serialize.ts` |
| Ducks | Each pond of 6+ cells keeps 1 duck, +1 per 10 more cells, max 6 per pond and 24 in town. They paddle between spots of open water (never through reeds, cattails or the bird house; lily pads are fine), rest, sometimes dabble (tail up), and rest all night. Drakes and brown hens. Not saved; no shadow. | `src/life/DuckSim.ts` (pure), `DuckSystem.ts` |
| Dock | Round **‹ ›** arrows over the tray's ends whenever its cards overflow (Nature's 12 cards below ~1,100 px wide); each shows only while there are cards that way. A click scrolls most of a tray width, snapping to a card. A vertical mouse wheel over the tray scrolls it sideways. | `src/ui/UiRoot.ts` (`updateTrayCue`, `scrollTray`), `ui.css` |
| Effects | Painting a pond throws water droplets; removing it a puff and droplets (`FxClass` `water`). | `src/fx/fxRecipes.ts` |
| Demo towns | The sample town has a 32-cell irregular pond north-east of the car park with every pond item and 3 ducks; the asset gallery a 7 × 5 pond with one dry corner (shows every shore piece) east of the road masks. | `src/town/sampleTown.ts` |
| Icons | Rendered from the placeholder models: `tool-pond`, `tool-lily-pads(-v1, -v2)`, `tool-reeds(-v1)`, `tool-cattails(-v1)`, `tool-bird-house`. `render-icons.mjs` gained `--only`. | `public/assets/icons/` |

To look at it: `npm run dev`, then in the console `__THREE_GAME_TEST_HOOKS__.setState('sample-town')` (ducks stay still in test states) or start a new town and dig one (ducks swim).

## Placeholder models → Blender

Every model in `public/assets/models/pond/` is a **placeholder** from `scripts/build-pond-placeholders.mjs` (three.js, flat vertex colours). Replace each file with a Blender model **at the same path**; the catalog needs no change unless a frame or count below changes. Follow `.claude/agents/town-modeller.md` (the `town-modeller` agent can build them): colour from a shared swatch image (the roads atlas, `../roads/Textures/colormap.png`, adding swatches in free cells if needed), one mesh and one material, flat shading, a `scripts/build-pond.py` that rebuilds them byte for byte. Then retire `build-pond-placeholders.mjs` and update the `pond/` rows in `docs/assets.md`, `CREDITS.md` and `pond/License.txt`.

Axes: the game is Y-up with the front on +Z; Blender is Z-up and its −Y becomes the game's +Z. So "north / −Z in the game" is **Blender +Y**.

### Shore pieces (the contract the tests hold)

Six files, all modelled for the **north-west quarter of a cell**, a 0.25 × 0.25 square, with the **origin at the square's centre and the base at y = 0**. The game keeps that origin (`ModelSpec.nativeOrigin`) and turns each piece about it in quarter turns. The water is not part of them: `TownRenderer` draws a water slab over the whole cell, top at **y = 0.008**, colour `#5bb3d9` (`GROUND_MODELS.pond`); the pieces are the bank on top of it.

```
 game view from above (north up)      x −0.125 … +0.125, z −0.125 … +0.125

 edge (land north)     outer (land N + W)      inner (land at the NW point only)
 ┌───────────┐          ┌───────────┐           ┌─╮─────────┐
 │▓▓▓▓▓▓▓▓▓▓▓│ land     │▓▓▓▓▓▓▓▓▓▓▓│           │▓╯         │
 │~~~~~~~~~~~│ bank     │▓▓▓▓▓▓╮~~~~│           │  water    │
 │   water   │          │▓▓▓╭~~╯    │           │           │
 │           │          │▓▓▓│ water │           │           │
 └───────────┘          └───────────┘           └───────────┘
```

| File | Piece | Note |
| --- | --- | --- |
| `pond-edge-a.glb` | straight bank along the north side | the reference profile |
| `pond-edge-b.glb` | same, with pebbles at the waterline | variety |
| `pond-edge-c.glb` | same, the waterline bulging into the pond mid-piece | variety; the bulge must be 0 at both ends |
| `pond-outer-a.glb` | convex corner, land north and west; the waterline a quarter circle | rounded, not square |
| `pond-outer-b.glb` | same, with a rock on the bank | variety |
| `pond-inner.glb` | concave notch round the north-west corner point | small |

Rules, checked by `src/catalog/catalog.test.ts`:
1. **Fits the quarter:** every vertex within x, z ∈ [−0.127, 0.127], y ≥ 0, height < 0.08.
2. **One bank profile at every seam.** Where a piece meets a neighbouring piece, its cross-section must equal the plain edge's: on the edge pieces' west and east ends (x = ±0.125), the outer corners' east end (x = +0.125) and south end (z = +0.125), and the inner piece's west and north sides (x = −0.125, z = −0.125). The test compares the set of (distance from the land side, height) vertex pairs on each seam, ignoring the vertical wall on the land boundary. The placeholder profile is: top **0.022** from the land boundary to 0.028 in, then 0.013 at 0.042, then 0 at **0.07** (it passes under the water at about 0.05). Change it freely, but in every piece at once.
3. A vertical wall from y = 0 to the bank top on the cell boundary that faces land (edge: north; outer corner: north and west), so no gap shows against field or a lawn tile (lawn tops are at 0.016, pavement 0.02).
4. Variety lives in the middle of a piece (bulges, pebbles, a rock, a sandy cove, a tuft of grass); the seams stay identical so any edge variant meets any other.
5. To add a variant: add its file and its id to `POND_SHORE_MODELS.edge` / `.outer` / `.inner` in `src/catalog/models.ts` (and to `MODELS`). Hashing picks among them.

Colour: the placeholder's bank top is the plot's field green (`#84c27c`, `world/Terrain.ts`) so the corners melt into the field, with a sand slope (`#d8c596`) and an earth wall. On a lawn (`#6cb562`) the bank top shows as a lighter rim; decide whether that reads well or whether a sandy or stony top is better everywhere.

Budget: a 10 × 10 pond has about 40 edge cells, so ~80–100 shore quarters. Keep an edge at ≤ 40 triangles and a corner at ≤ 60.

### Pond items

| File | Size and frame | Notes |
| --- | --- | --- |
| `lily-pads-a/-b/-c.glb` | inside a 0.5 × 0.5 cell, centred; flat (a few mm) | The catalog lifts them 0.009 (`offset`) so they float on the water. Pads at one height must not overlap (they would flicker). `-c` has a flower. Exempt from the "taller than 0.1" check. |
| `reeds-a/-b.glb` | one cell, 0.2–0.35 tall | `sway: true` (wind). Stems start at y = 0, under the water. |
| `cattails-a/-b.glb` | one cell, 0.25–0.35 tall | `sway: true`. Brown heads. |
| `bird-house.glb` | one cell, under ~0.3 tall | The front (the hole) faces +Z at rotation 0 (Blender −Y). The raft's deck must be above 0.011 (water plus clearance; the hidden-surface test). |
| `duck.glb` | ~0.14 long, bill towards +Z, base at y = 0 | Drawn by `DuckSystem` 0.008 below the water top (its draft), pitched forward about its base when dabbling. Hens are the same model **multiplied by a brown instance colour** (`HEN_TINT`), so a Blender duck either keeps that (and accepts an olive-brown head on hens), or comes as two files and `DuckSystem` draws two meshes (+1 draw call). |

All must stay under the cottage eaves and the lamppost (the garden-furniture test covers the bird house).

### After replacing a model

1. `npm run test:unit` — the catalog test checks the shore contract, footprints, heights and hidden surfaces.
2. `node scripts/render-icons.mjs --only pond,lily-pads,reeds,cattails,bird-house` (dev server on `PORT`).
3. `npm run inspect:object -- --kind lily-pads --variant all` etc., and the `town-visual-inspector` agent on the sample town's pond and the gallery's pond (shore seams, flicker between the water slab and pads, the bank against lawn, pavement and road).
4. Re-capture the visual baselines on macOS (`npx playwright test tests/visual-regression.spec.ts --update-snapshots`): the sample town, night town and asset gallery now have ponds.

## Decisions taken (change them if you disagree)

- **A pond is a ground kind, not an object.** It paints and bulldozes like grass, joins up like road and needs no new save version. A pond under a lily pad can't be repainted until the pad is moved.
- **Quarter-cell auto-tiling** (4 pieces per cell) rather than a 47-piece blob set: 6 small models cover every shape, and variants are cheap.
- **Water sits on top of the field** (y = 0.008), below the lawn tiles (0.016): the terrain is flat by design, so the pond is a shallow pool with a raised bank, not a dug hole.
- **Reeds and cattails grow only in water**, as asked; a version that also grows on the bank would allow `field` and `grass` too.
- **Labels:** "Bird house" on the card, "Floating bird house" in messages; "Reeds" for the common reed.
- **Nature now has 12 tools**, the catalog's maximum per category; digits 1–9 reach Grass … Lily pads, the last three have no key. With the arrows the 12-tool cap could go; it is still asserted in `catalog.test.ts`.
- **Ducks in test states arrive at once and stay still** (like birds, which stay away), so captures are stable.
- **Ducks cast no shadow**, so they never wake the on-demand shadow map.
- No new sound: a pond uses `place-nature`.

## Checks run

- `npm run verify` (local paths, licences, typecheck, unit tests, production build): see the hand-off message for the run.
- New unit tests: `src/town/pondTiles.test.ts` (piece choice and turns, ponds as 4-connected groups), pond cases in `rules.test.ts` and `serialize.test.ts`, the shore contract in `catalog.test.ts`, `src/life/ducks.test.ts` (count by size, determinism, 4 minutes of swimming on an L-shaped pond never leaving open water, night rest, following town edits).
- New e2e spec `tests/pond.spec.ts`: dig a pond by drag, plant it, float the bird house, ducks arrive for its size, refusals, ducks leave when it is filled in; the tray arrows at 900 px wide.
- Screenshots under `artifacts/pond/` (local only, gitignored).

## Known gaps and follow-ups

- **Placeholders** everywhere in `pond/` (above).
- **Still water:** no ripple, sparkle or reflection; at night the water is just darker. A small shader patch on the water slab (like the wind sway) could add a slow shimmer.
- **No splash sound**: a `place-water` SFX would need `scripts/build-audio.py` and `npm run gen:sfx`.
- **Ducks are simple:** no flocking, no wake, they don't react to the camera or to placements next to them, and they don't fly in or out (they pop). A duck can rest within 0.22 of another one only if it arrived there.
- **Fireflies** rise over meadows only; ponds at dusk could have them too.
- **The grid overlay** draws over the water like everywhere else.
- **The shore against road and pavement** is the same bank as against field; a road running along a pond might want a kerb-height wall instead.
- **Visual baselines** (darwin) are stale for sample-town, night-town and asset-gallery.
- **Phones:** see `docs/mobile-backlog.md` (tray arrows on touch, tiny pond items at the phone zoom).
