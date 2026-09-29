# WP-23 — New build items, garage removed (plan, 2026-09-29)

> **Plan, implemented and merged into `main`** (owner-approved 2026-09-29). **Review amendment:** the Gate was removed, the tulips scaled down (×1.15 → ×0.7) and the Pool moved from Town to Garden; see `progress.md` "WP-23 as built". Built on the branch `wp-23-new-items` (from `d119d54`; worktree `../ThreeJsGames-wt/wp-23-new-items`; dev server 5240). It goes to `main` only after owner approval. As-built facts go to `03-architecture.md`, `02-interaction-and-ui.md`, `docs/assets/*` and `progress.md` ("WP-23 as built").

## Owner request (2026-09-29)
The owner picked these from the asset research (`~/Desktop/tiny-town-inventory-research/`):
- **Kenney, already on disk:** Fantasy Town `stall` (a plain wooden table), `stall-bench`, `fence-gate`.
- **Kenney Nature Kit** (on disk, unused): the red, yellow and purple flowers, **all three in one 0.5 cell**.
- **Poly Pizza:** the Donut shop, the (tiered) Fountain, the Slide and the Mailbox.
- **Remove** the Garage.
- **Accepted:** a category may hold more than 9 tools; tools past the ninth have no digit key.

## Decisions (the owner can overrule any of them)

### 1. New items
Scales are starting targets and are tuned in the game next to the existing items.

| Tool (id) | Label | Dock | Layer, drag | Footprint, ground | Model | Licence |
|---|---|---|---|---|---|---|
| `mailbox` | Mailbox | **Streets**, after Postbox (it stands at the kerb, like the postbox) | object, single | 1 × 1, prop ground | "Mailbox" by CreativeTrio (Poly Pizza `2olZ0G8iur`), normalised; about as tall as the postbox | CC0 |
| `tiered-fountain` | Tiered fountain | **Town**, after Fountain | object, single | 3 × 3, prop ground | "Fountain" by Poly by Google (`7AydBrjR2Ss`), normalised and **recoloured**: its native stone is near-black and its water olive, so the stone becomes light warm grey and the water pool blue | CC-BY 3.0 |
| `donut-shop` | Donut shop | **Town**, after Corner shop | object, single | 3 × 3, paved ok (like the corner shop) | "Donut Store" by J-Toastie (`BvRLKgGwc6`), normalised. Its grey base slab is removed so it stands on our ground; sized to sit with the corner shop (≈ 1.3 wide). Shops stay dark at night (WP-17). | CC-BY 3.0 |
| `tulips` | Tulips | **Nature**, after Wildflowers | object, scatter | 1 × 1, open ground | **New composed model:** Nature Kit `flower_red*`, `flower_yellow*` and `flower_purple*` together in one cell. **3 variants** (the A, B and C flower shapes) picked at random, like the birch. The label is "Tulips", so it can't be confused with the Wildflowers ground. | CC0 |
| `fence-gate` | Gate | **Garden**, after Tall fence | **edge**, line (a click places one) | cell edge | The already-shipped `composed/fence-small-gate.glb` (Fantasy Town `fence-gate`), styled exactly like the low fence (same wood colour and height), so gates sit inside low-fence runs | CC0 |
| `long-bench` | Long bench | **Garden**, after Bench | object, single | 1 × 1, prop ground | Fantasy Town `stall-bench`, shipped as-is next to the kit's colormap | CC0 |
| `garden-table` | Table | **Garden**, after Long bench | object, single | 1 × 1, prop ground | Fantasy Town `stall` (wooden table), same kit scale as the long bench so they match | CC0 |
| `slide` | Slide | **Garden**, after Swing | object, single | 2 × 1, open ground (like the swing) | "Slide" by sirkitree (`8D47EdapzBW`), normalised; the same height as the swing | CC-BY 3.0 |

**Nature Kit fix (used only by the tulips):**
- The kit's materials are plain colours with **metallic 1**, and store sRGB values as linear, which is why it was rejected in v0.1.
- The new compose recipe sets metalness 0 and converts the colours sRGB → linear.
- It also remaps the kit's teal leaf green to the Platformer green, so the leaves match our grass and flowers.
- Nothing else from the kit ships.

### 2. Dock after WP-23

| Dock | Tools |
|---|---|
| Streets (9) | Road, Pavement, Roundabout, Zebra, Traffic light, Lamppost, Bus stop, Postbox, **Mailbox** |
| Homes (6) | Cottage, Townhouse, Bungalow, Family home, Suburban, Big house |
| Town (7) | Fountain, **Tiered fountain**, Corner shop, **Donut shop**, Church, Supermarket, Pool |
| Nature (7) | Grass, Wildflowers, **Tulips**, Bush, Oak, Pine, Birch |
| Garden (12) | Garden path, Hedge, Low fence, Tall fence, **Gate**, Planter, Bench, **Long bench**, **Table**, Barbecue, Swing, **Slide** |

- Totals: 41 placing tools (34 + 8 − 1).
- **The 9-tool cap becomes 12:**
  - `catalog.test.ts` enforces at most 12 per category, the soft limit agreed with the owner, because more than about 12 tools no longer fit a desktop row;
  - digits 1–9 stay;
  - Garden's tools 10–12 (Barbecue, Swing, Slide) show no number badge, and their tooltip has no "(n)";
  - the tray already scrolls sideways where it doesn't fit.

### 3. Garage removed
- These go: the tool, the `garage` object kind, its model, the `garage` compose recipe, `composed/garage.glb`, its icon and the unused `industrial/` folder (it only held `building-s`, the garage-row candidate).
- The `outbuilding` object group is removed with it (the garage was its only member).
- **Saves and town files keep opening, without a version bump.** `parseSave` already drops unknown object kinds, so a garage in an old save or file simply disappears. A test pins this (the WP-21 format promise: old files must still open).
- New kinds need no bump either: an older build opening a newer file drops the kinds it doesn't know.
- **Demo towns:**
  - The sample town's garage spot gets the mailbox.
  - The stress town's 50 garages become a mailbox at the street end plus a tree, which is lighter than a garage.
  - The asset gallery drops the garage.

### 4. Budgets
Mobile triangles have about 27k of headroom on the stress town, and textures are 27 of 30 on the sample town.
- **New textures:**
  - Fantasy Town colormap: +1, shared by the table and the long bench, because they ship as plain kit files, not composed;
  - Mailbox palette: +1;
  - Donut shop window texture: +1, or 0 if its windows get a flat glass colour;
  - the garage's embedded atlas: −1.
- **Target:** the sample town stays at ≤ 30 textures. If it would go over, the donut shop's window texture becomes a flat colour.
- **Triangles:** the donut shop is about 3.4k (one per town, not a scatter item), and the fountain about 1.2k. The tulips are about 230 per cell, so they're a scatter item to watch.
- The stress town (the gate) gets lighter: 50 garages out, 50 mailboxes (242) and trees in. It's re-measured before hand-off.
- **Draw calls:** the donut shop has 14 materials, so up to 14 calls when present. There's plenty of room (31 of 150).

### 5. Credits
- **CC-BY:** the donut shop (J-Toastie), the tiered fountain (Poly by Google) and the slide (sirkitree). Each gets:
  - a `CREDITS.md` row;
  - a line in `composed/License.txt`;
  - a line in the in-game Credits panel.
- **CC0, credited anyway:** the mailbox (CreativeTrio), the Nature Kit tulips and the Fantasy Town table, bench and gate (Kenney).
- Every new file gets `models.json` and `models.md` entries.
- `assets-src/polypizza/` (gitignored) keeps the sources and their `CREDITS.md` / `picks.json` rows.

## Files
- **Contract:**
  - `town/types.ts` (ObjectKind, EdgeKind);
  - `catalog/objects.ts`, `models.ts`, `tools.ts` (+ `catalog.test.ts`).
- **Town:**
  - `town/serialize.ts` (EDGE_KINDS) + test;
  - `sampleTown.ts` + test;
  - rule, editor and fx tests that used the garage.
- **Render:**
  - `TownRenderer.ts` (MODEL_STYLES for the gate);
  - `IconStudio.ts` (gate framing).
- **UI:**
  - `UiRoot.ts`: no digit badge past 9, and the credits lines;
  - `uiKeys.test.ts`.
- **Scripts and assets:**
  - `compose-models.mjs`: new recipes (tulips, donut shop, tiered fountain, slide, mailbox), and the garage recipe removed;
  - new GLBs in `composed/`, and `fantasy-town/stall.glb`, `stall-bench.glb`;
  - new icons (8, `render-icons.mjs`; only the new ones are kept), and `tool-garage.png` removed.
- **Docs:**
  - `docs/assets/{models.json,models.md,CREDITS.md}`, `composed/License.txt`;
  - `02-interaction-and-ui.md` (dock table, digits), `03-architecture.md`;
  - `PLAN.md` §WP-23, `progress.md`.
- **Tests:**
  - e2e `tests/ui.spec.ts` (it clicked the garage);
  - a new `tests/new-items.spec.ts`: each new tool places from the dock, and the dock shows no badge past 9;
  - regenerated visual baselines (sample-town, asset-gallery, night-town), checked with the masked diff.

## Acceptance
1. `npm run verify` green (typecheck, unit tests, build; main chunk under 900 kB).
2. **Unit tests:**
   - every new kind is in the asset gallery;
   - the sample town uses all 41 tools with zero rejections;
   - a v4 save with a garage loads with the garage dropped and everything else kept;
   - gates round-trip through save and load;
   - each category has ≤ 12 tools.
3. **E2E:**
   - `new-items.spec.ts` (desktop + mobile): each new tool places from the dock with no console errors;
   - the Garden tray shows badges 1–9 only;
   - full `npm run test:e2e` green.
4. **A look in the browser** (`artifacts/wp-23/`), by day and night:
   - the new items next to the house, corner shop, swing and bench for proportions;
   - fronts face +z at rotation 0;
   - the tulips read as three flowers in one cell;
   - the gate lines up with low-fence runs.
5. **Budgets:**
   - stress town triangles and draw calls within budget on desktop and mobile;
   - sample town textures ≤ 30 (canvas inspector).
6. Visual baselines regenerated and masked-diffed. Only the demo-town content changes, not the UI.
