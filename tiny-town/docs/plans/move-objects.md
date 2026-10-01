# Move tool: pick up a placed thing and put it somewhere else (plan, 2026-10-01)

> **Plan, implemented on the branch `move-objects`** (from `4338cbb`); it goes to `main` only after owner approval. **Added while building** (see "As built" at the end): a two-row dock on phones narrower than 390 px (owner decision), and the carry ghost shows only its frame when it is back over the object's own spot. As-built facts go to `03-architecture.md`, `02-interaction-and-ui.md`, `01-design-brief.md` and `progress.md`.

## Owner request (2026-10-01)
> I would like to be able to actually select an existing structure (not roads or grass or that kind of things) and move them or rotate maybe.

The owner read the research the same day and agreed with every recommendation, with one addition: **ground never moves** (roads, pavement, grass, wildflowers). The decisions below are those answers.

## Decisions
1. **A dedicated Move tool.** A dock mode button between Rotate and Bulldoze, key **M**. It works the same with a mouse and on touch.
2. **Click to pick up, click to put down**, on every device (touch: tap, tap). No dragging is involved, so it never fights the camera.
3. **What moves:** every placed object (homes, town buildings, street furniture, trees, plants, garden things) **except the roundabout and the zebra crossing**, which belong to the road. Ground (road, pavement, grass, wildflowers, garden path) and hedges and fences never move.
4. **Trees and plants** (oak, pine, birch, bush, tulips) can be moved but not turned. Their look (angle, size) comes from their id, so R does nothing while carrying one, and the hint leaves R out.
5. **While carrying**, the object stays where it is with a **blue "selected" highlight**, and a carry ghost follows the pointer: mint where it can go, red where it can't, turned with R.
6. **Drop animation:** the object **slides and hops** to its new place (about 0.3 s). Undo and redo of a move animate the same way.

## How it behaves
- **Move tool, nothing carried:**
  - hovering a movable object paints it blue (the exact-overlay ghost from the bulldoze highlight work), with a blue frame on its footprint;
  - hovering the roundabout, a zebra crossing or empty ground shows the plain cell outline;
  - a click on a movable object **picks it up** (a soft pick-up sound). A click on the roundabout or a zebra says "Roundabout can't be moved" (the usual invalid tooltip, shake and sound). A click on empty ground does nothing.
- **Carrying:**
  - the carry ghost centres the footprint on the pointer, like placing a new item;
  - R / Shift+R (or the touch Rotate button) turn the carried object, starting from its own rotation. They don't touch the tools' shared rotation;
  - a click **puts it down** if the spot is valid: one undo step, that item's own place sound and dust;
  - an invalid click shakes and shows the reason, as placing does ("Something is already here", "Bus stops need to be next to a road", "Oak needs open field, grass or meadow", …);
  - putting it down where it already is, unturned, just puts it back;
  - **Esc** or a **right-click** puts it back (a second Esc / right-click puts the tool away, as today). Picking another tool, undo/redo, opening the menu or leaving the build phase also put it back.
- **The rules for the new spot are the placing rules**, except that the object's own old footprint doesn't count as occupied. So a house can shuffle one cell over, or turn in place.

## Design

### Town (pure, no three.js)
- `town/types.ts` (contract): `BuildAction` gains `{ type: 'move-object'; id: number; cell: Cell; rotation: Rotation }`, and `InvalidReason` gains `'cannot-move'`.
- `town/rules.ts`:
  - `planMoveObject`: no such id → `nothing-here` ("Nothing to move"); a road feature or road marking → `cannot-move` ("Roundabout can't be moved"); same anchor and rotation → `no-change`. Otherwise it runs the **placing checks** (bounds, other objects, allowed ground, needs-adjacent), ignoring the object's own id. Trees and plants keep their rotation (rule-side too).
  - Changes: `[remove old, add moved]`, **same id and variant**, so undo and redo, saves, the renderer's per-id tree look and the lamp registry all just work. The primary change (the add) is last.
  - The placing checks move into one shared helper (`checkObjectSpot`), so placing and moving can't drift apart.
  - `isMovable(def)` is exported for the controller.
- `TownEditor`: no API change. `apply(moveAction, toolId)` emits `build:placed` with the toolId it's given (the controller passes the object's own tool id, or `'move'` for a retired kind such as the old fountain).

### Catalog (contract)
- `catalog/tools.ts`: tool `move` (category `mode`, layer `move`, hint "Click something to pick it up"), icon `/assets/ui/move.svg` (new, same style as `bulldoze.svg`). `ToolId` gains `'move'`. `actionForTool` throws for `move` (it has no per-cell action). `RETIRED_TOOLS` excludes it from its key type.
- `game/events.ts`: `selection:changed { id: number | null; kind: ObjectKind | null; rotation: Rotation; rotatable: boolean }`, emitted on pick-up, turn, drop and put-back.
- `vite-env.d.ts`: diagnostics `selection: { id, kind, rotation } | null`.

### Interaction (`ToolController`, `GhostPreview`)
- `GhostPreview`: a new state **`selected`** (sky blue `#4A9BE8`, the design doc's focus/info accent). Like `remove`, it is drawn exactly on the object with the polygon offset and the shader recolour, at a lighter strength so the object still shows through, with a slow breathing glow.
- `ToolController`:
  - holds `carry: { id, kind, variant, rotation } | null` and a **second `GhostPreview`** for the in-place selected highlight (the first one is the hover / carry ghost). Both use the shared `objectGhostPart`, so they lie exactly on their objects;
  - the carry ghost uses the object's real variant and per-id look (a carried tree looks like that tree);
  - keys: M selects the Move tool; Esc / right-click put back first, then put the tool away;
  - publishes `selection` for diagnostics and emits `selection:changed`;
  - a carried object that disappears (undo, load, reset) clears the carry.

### Renderer (`TownRenderer`)
- In one change list, a **remove + add of the same object id** is a move. The renderer keeps the object's instances and tweens them from the old pose to the new one, instead of shrinking and re-popping. Rules: about 0.3 s ease-in-out, position along a low arc (hop height grows a little with distance), yaw slerped, scale lerped. A tree keeps its own per-id pose, so it hops unturned.
- Reduced motion, scripted bursts, load and reset place it at once. `isAnimating` covers moves, so the shadow map and the frame budget follow them.
- A pure helper `hopArc(u, height)` / `moveEase(u)` in `render/tween.ts` is unit-tested.

### UI (`UiRoot`, `glyphs.ts`, `testIds.ts`)
- A **Move** mode button (a four-way arrow glyph) between Rotate and Bulldoze, id `tool-move`, `aria-pressed` while active, title "Move (M)".
- Hints:
  - on picking the tool: "Click something to pick it up";
  - while carrying: "Click where it goes · R to rotate · Esc to cancel" ("· R to rotate" left out for trees and plants);
  - on touch, the same in tap words: "Tap something to pick it up", then "Tap where it goes · tap Rotate to turn it".
- The Rotate button is active while carrying a turnable object.
- Help: "M — Move" under Mouse & keys; "Move — tap a thing, then tap where it goes" under Touch.

### Tests helpers
- `tests/helpers.ts selectTool` handles `move` (the mode button), like `bulldoze`.
- The bot playtest picks from `TOOLS`, so it will also use Move. Its checks (a changed town = exactly one undo entry; no stuck strokes) hold for moves.

## Files
- new:
  - `src/interaction/move.test.ts` (or rules / editor tests in their existing files);
  - `tests/move.spec.ts`;
  - `public/assets/ui/move.svg`;
  - this plan.
- contract: `src/town/types.ts`, `src/catalog/tools.ts`, `src/game/events.ts`, `src/vite-env.d.ts`, `src/game/Game.ts` (diagnostics);
- changed:
  - `src/town/rules.ts`, `src/town/rules.test.ts`, `src/town/TownEditor.test.ts`;
  - `src/interaction/ToolController.ts`, `src/interaction/GhostPreview.ts` (+ test);
  - `src/render/TownRenderer.ts`, `src/render/tween.ts` (+ test);
  - `src/ui/UiRoot.ts`, `src/ui/glyphs.ts`, `src/ui/testIds.ts`, `src/ui/ui.css` if the dock needs room;
  - `src/catalog/catalog.test.ts`, `tests/helpers.ts`;
- docs: `02-interaction-and-ui.md` (tool table, keys, touch, help), `03-architecture.md` (rules table, events, diagnostics, renderer), `01-design-brief.md` (secondary verbs), `docs/assets/models.md` (icon line); `progress.md` after approval.
- No save-format change: a move only changes an object's `anchor` / `rotation`. No new assets beyond the 24 × 24 UI icon (our own drawing).

## Acceptance
- `npm run verify` green. New unit tests:
  - **rules:**
    - a move gives `[remove, add]` with the same id and variant;
    - a one-cell shuffle onto the object's own footprint is allowed, and so is a turn in place;
    - onto another object → `occupied`; out of the plot → `out-of-bounds`;
    - a tree onto pavement → `needs-ground`; a bus stop away from a road → `needs-ground` with its message;
    - roundabout and zebra → `cannot-move`; unknown id → `nothing-here`; same spot → `no-change`;
    - trees keep their rotation;
  - **editor:** a move is one undo entry; undo restores the old anchor / rotation and redo the new; `preview` never mutates; `build:placed` carries the given toolId at the new footprint centre;
  - **catalog:** `move` is a mode tool with an icon file, and the layer order still holds;
  - **ghost:** `selected` lies on the object (offset, recolour, opacity);
  - **tween:** the hop arc starts and ends at 0 and peaks mid-way; the easing is monotonic.
- e2e `tests/move.spec.ts` (desktop + mobile, real input):
  - pick up a cottage with the Move button (desktop also with M) → diagnostics `selection.id` set;
  - put it down on a free spot → one undo entry, object count unchanged, the old spot free and the new one taken (checked by hovering with a placing tool);
  - R turns it on desktop;
  - an invalid drop (onto another building) shows the tooltip and keeps carrying;
  - Esc / right-click put it back;
  - undo moves it back and redo moves it again;
  - a reload keeps it where it was put;
  - a tree can't be turned; the roundabout can't be picked up.
- e2e regressions: `interaction`, `build-flow`, `ui`, `bot-playtest`, `visual`, `visual-regression`. **The dock gains a button, so the screenshot baselines are regenerated** and the diff checked by eye: only the dock changes.
- Visual evidence in `artifacts/move-objects/`: hover highlight, carrying (valid and invalid), the hop mid-way, after the drop, mobile dock.

## Not in this change
- Press-drag-release as a desktop shortcut (a later extra).
- Moving hedges and fences, the roundabout, the zebra crossing or ground.
- Selection extras: Delete on the selected object, copy (pick the same tool and rotation), an info chip.
- At night a moved lamppost's light pool jumps to the new spot at once while the post hops (0.3 s).

## As built (2026-10-01)
- **Dock on phones.** With a third mode button, eight 44 px targets don't fit one row on a 360 px phone (8 × 44 = 352 px plus gaps, against 344 px available), and `ui.spec`'s 44 px check failed there. Each tab and mode now takes its label's width with a 44 px minimum, and labels are 0.66 rem up to 440 px wide, so all eight fit one row from 390 px up. **Below 390 px (owner choice):** the categories take the first row and Rotate · Move · Bulldoze a second one, so every target stays ≥ 44 px; the dock is 193–207 px tall there instead of 155 px.
- **The carry ghost at home.** Over the object's own spot (no change), the carry ghost shows only its frame: the blue highlight already shows the object, and a model there would z-fight with the real one.
- **Hints.** The carry hint hides on the drop or put-back.
- **Known nit.** The drop's dust puff starts at the new spot as the hop begins, not when it lands, because `build:placed` fires on the drop.
