# Bulldoze highlight that matches the object (plan, 2026-10-01)

> **Plan, implemented and merged into `main`** (owner-approved 2026-10-01; merge `c68c6d0`, built on the branch `bulldoze-highlight` from `2d58ff0`). This is the plan, not the as-built record. **Changed while building:** Decision 4 became a shader recolour (the colour atlas, not the opacity, caused the brown), and the ghost-part helper lives in `GhostPreview.ts` instead of a new `ghostParts.ts`. As-built facts are in `03-architecture.md` (§Rendering, Tall trees) and `02-interaction-and-ui.md` (Bulldoze row).

## Owner request (2026-10-01)
> Highlighting objects in red when we want to bulldoze them: for some models it is a little bit off, for some it's fine, and for some it is very much off.

The owner read the assessment (same day) and approved the recommended fix: make the red copy match the object exactly and paint it onto the object's visible surfaces.

## What is wrong today
The Bulldoze hover is a second, translucent copy of the model (`GhostPreview`, state `remove`), tinted brick red, drawn over the real object, which stays visible underneath. Gallery captures of every object showed three separate faults:

1. **The copy is built differently from the drawn object.** `TownRenderer.addObject` / `addEdge` apply things the ghost never sees:
   - `MODEL_STYLES` scales (`render/modelStyles.ts`): bush Y × 0.58 (the ghost is about 1.9 × too tall), tall fence Y × 1.8 and low fence Y × 1.4 (the ghost is a short rail at the foot of the fence), lamppost × 1.5 / 1.15 thicker (the ghost pole hides inside the real one), hedge X × 1.12;
   - the per-tree yaw and ± 12 % size from `hash01(id)` (oak, pine, birch, bush, tulips): the ghost is turned and sized differently, so leaves poke through;
   - wind sway: trees move, the ghost doesn't.
   The same scales are missing from the **placement** ghost too (bush, fences, lamppost, and the pavement tile's Y × 2).
2. **The 1.08 enlargement** of the `remove` ghost, about the centre of the model's base: the offset grows with height and width, so roofs show doubled edges above the real ones and wide flat things (pool, roundabout) spill past their footprint.
3. **Blending with the colours below.** The copy is 78 % opaque and has no depth of its own, so red over white reads red, but red over green roofs and leaves reads muddy brown, and the copy's hidden faces show through (the pool's umbrellas and rails).

Fine today: church, bench, table, slide, barbecue, postbox, mailbox, traffic light, bus stop. A little off: homes and shops, pool, roundabout, trees, tulips, hedge. Very off: bush, both fences, lamppost.

## Decisions
1. **One definition of where a model is drawn.** A new small module `render/objectPose.ts` owns the object pose (yaw: the quarter turn, or a tree's hashed yaw; uniform size: 1, or a tree's hashed jitter; Y stretch: `ObjectDef.height`), the object and edge origin matrices and the `MODEL_STYLES` scale. `TownRenderer` and the ghost both use it, so they can't drift apart again.
2. **The ghost applies `MODEL_STYLES` scales to every part**, as the renderer does to every model it draws. This fixes the placement ghost as well as the bulldoze one (bush, fences, lamppost, hedge, pavement tile).
3. **The bulldoze ghost is drawn exactly on the object** (no 1.08), pulled a little towards the camera (polygon offset, as the solid ground ghosts already do), so only the object's visible surfaces get painted red. No doubled edges, no hidden faces showing through.
4. **Red that reads red on every model.** The `remove` ghost's opacity goes 0.78 → 0.9. *As built:* the opacity alone didn't stop the brown. The ghost tinted its material colour, which three.js multiplies by the colour atlas texel, so red × a green roof texel gave brown. Red states (invalid and remove) now keep the material colour and pull the final surface colour (atlas × vertex colour × material colour) 88 % towards the tint in the shader (`uGhostRecolor`, next to the existing rim patch). Every model then reads the same brick red, with its own shading. The emissive pulse stays.
5. **Ghosts of swaying models sway** (the same `applyWindSway` patch on the ghost's material clone). Sway is driven by shared uniforms and the world position, so the copy moves in step with the tree.
6. **Unchanged:** the red footprint frame and fill, the fence strip, the zebra crossing's solid ghost, ground bulldoze (a flat fill), the mint placement look, the pick rules.

## Design
- **`src/render/objectPose.ts`** (new, three.js allowed under `render/`):
  - `objectPose(def, rotation, id | null)` → `{ yaw, scale, scaleY }`. `id` null = a placement preview (no jitter yet: yaw = the quarter turn, scale 1);
  - `objectOrigin(placed, def, out)` = T(footprint centre) · R(yaw) · S(scale, scale · scaleY, scale);
  - `edgeOrigin(edge, out)` = T(edge centre) · R(0 or a quarter turn);
  - `styleScale(model)` and `styleMatrix(model, out)` (`MODEL_STYLES[model].scale`, else 1, 1, 1).
- **`TownRenderer`**: `addObject` uses `objectOrigin`, `addEdge` uses `edgeOrigin`, and objects, edges and ground models use `styleMatrix`. Same matrices as today (no visual change); the per-tree hashing moves into `objectPose`.
- **`GhostPreview`**:
  - `GhostPart.yaw` (radians, overrides `quarterTurns`); the part's scale is multiplied by `styleScale(part.model)`;
  - `remove`: no 1.08, polygon offset on, opacity `REMOVE_OPACITY` (0.9);
  - red states: `uGhostRecolor` = 0.88 (a shared uniform; the patch mixes `diffuseColor.rgb` towards the tint right after `#include <color_fragment>`); the material colour is no longer tinted in those states;
  - the ghost material clone gets `applyWindSway` when its source has it (after the rim patch, so both chain).
- **`ToolController`**: the object part comes from one helper (`objectGhostPart(def, model, rotation, id)`, exported from `GhostPreview.ts`), used by both placement (`id` null, rotation 0 because the ghost root carries R) and bulldoze (the placed object's id and rotation, ghost root at quarter turn 0). Edges pass no extra scale: the ghost adds the style itself.

## Files
- new: `src/render/objectPose.ts`, `src/render/objectPose.test.ts`, `src/interaction/GhostPreview.test.ts`, this plan;
- changed: `src/render/TownRenderer.ts`, `src/interaction/GhostPreview.ts`, `src/interaction/ToolController.ts`;
- docs: `03-architecture.md` (Tall trees, ghost line), `02-interaction-and-ui.md` (Bulldoze row), `progress.md` after approval.
- No contract files, no save change, no new assets.

## Acceptance
- `npm run verify` green. New unit tests:
  - `objectPose`: plain objects take the quarter turn and size 1; trees and plants take the hashed yaw, a size in [0.88, 1.12] and their height; a preview (`id` null) takes the quarter turn;
  - **ghost = renderer:** for every object kind × variant × rotation (and a tree id), the ghost part's world matrix (a real `GhostPreview` with a stub model library, shown the way `ToolController` shows it) equals `objectOrigin · styleMatrix`, the matrix `TownRenderer` gives that object's instances. The same for the three edge kinds both ways round;
  - the `remove` ghost has no enlargement and uses the polygon offset; red states recolour after `color_fragment`; sway models get the sway patch, others don't.
- e2e: `interaction`, `build-flow`, `fx`, `ui`, `bot-playtest`, `visual` and `visual-regression` specs pass (bulldoze, placing, baselines).
- Visual: the gallery capture script (every object, bulldoze hover off / on, close-up) re-run; each hovered object reads red and lines up with the object; before/after sheets in `artifacts/bulldoze-highlight/`.

## Not in this change
- The ghost keeps the source material's colour, not `MODEL_STYLES.color` (tall fence cream, lamppost iron): in the red state the tint covers it; in the mint placement state the tall fence's ghost stays brown, as today.
- An object still popping in (the 0.3 s grow after placing) can be a little smaller than its ghost for that moment.
