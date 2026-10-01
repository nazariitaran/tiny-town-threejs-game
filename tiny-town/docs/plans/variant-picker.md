# Variant picker: choose which version of a building you place (plan, 2026-10-01)

> **Plan, being implemented on the branch `variant-picker`** (from `d7b2437` on `main`, after the Move tool merged; in the main checkout, owner choice: no worktree). It goes to `main` only after owner approval. As-built facts then go to `03-architecture.md`, `02-interaction-and-ui.md`, `docs/assets/models.md` and `progress.md`.

## Owner request (2026-10-01)
> I am a bit annoyed by our variety system of buildings — I never really know if I'm building the exact building of which I see the ghost. […] we should be a bit more explicit about what variants of buildings we have by having some simple mechanism of expanding the tool tile up on hover if that tool has more than one variant, and then whichever the player chooses — we build that.

## The problem today
- The placing ghost always draws the kind's first model (`ToolController.ts`, `objectDefinition.models[0]` in the object branch of the hover refresh).
- The click rolls the model at random (`rules.ts` `planPlaceObject`: `ctx.rng()` picks `variant`).
- The dock icon is the first model too (`IconStudio.ts` places the icon object with `variant: 0`).
- So for the seven kinds with more than one model, the ghost and the icon often promise one building and the click builds another:

  | Tool | Models | Ghost wrong |
  |---|---|---|
  | Suburban (`garage-house`) | 4 | 75 % |
  | Tulips | 3 | 67 % |
  | Townhouse, Bungalow, Big house, Traffic light, Birch | 2 each | 50 % |

## Decisions (owner, 2026-10-01: agreed with every recommendation of the assessment)
1. **The picker opens when the tool is selected, not on hover.** Hover doesn't exist on touch, a popout inside the sideways-scrolling tray would be clipped, and sweeping the mouse along the tray would flicker strips open and shut. Selecting works the same with a click, a digit key or a tap.
2. **What you see is what you build.** The ghost always shows exactly the model the next click places, in every mode.
3. **A "Mix" choice** (the die glyph) builds a random model on each placement, and the ghost still shows the one that will be built next. **Tulips and Birch start on Mix**, because a dragged flower bed or birch stand looks better mixed. Every other kind starts on its first model, which is what its dock icon shows.
4. **The chips are icon-only.** Screen readers get "Style 2 of 4" / "Mix" as the label; there are no style names in the catalog.
5. **Keyboard: `V` / `Shift+V`** step forward / back through the choices, like `R` for rotate.
6. **The choice is remembered per tool for the session** (not saved; a reload starts from the defaults again).
7. **No desktop hover preview** of the strip for now (owner: leave it out at first).
8. **Cards that have variants get a small badge** so the choice is visible before selecting, and **the selected card's icon swaps to the chosen model**.

## How it behaves
- **Selecting a tool with variants** (click, digit, tap) slides a small **variant strip** up from that card, above the dock: one icon chip per model in catalog order, then the **Mix** die chip. The chosen chip is raised with the accent outline, like a selected card.
- **Choosing a chip:** the ghost switches to that model at once (even with the pointer still), the card's icon becomes that model's icon (in Mix it keeps the tool's own icon), and it plays the `ui-click` sound. The tool stays selected; the strip stays open.
- **Placing** builds exactly the model the ghost showed. In Mix, a fresh model is rolled after every successful placement (a scatter drag rolls once per placed cell), and the ghost shows the new roll. A rejected click doesn't re-roll.
- **The strip closes** when the tool is deselected, another tool is picked (Move and Bulldoze included), the menu opens or the game leaves the build phase. It reopens with the remembered choice.
- **Tools with one model** show no strip and no badge; nothing changes for them.
- **`V` / `Shift+V`** (desktop, building phase, a variant tool active, no modifiers) cycle: style 1 → … → style n → Mix → style 1. They do nothing for other tools or while carrying with Move.
- **Hint:** the desktop hint of a variant tool gains "· V for style" (e.g. "Click to build · R to rotate · V for style"). Touch hints don't change; the strip is visible.
- **Help:** "V — next style (Shift+V back)" under Mouse & keys; "Pick a style from the row above the item" under Touch.
- **Move** is unchanged: a carried object keeps its variant (its carry ghost already draws it).
- **The tooltip** (invalid reason) never overlaps the strip: it treats the strip's top as the dock's top while the strip is open.

## Design

### Town (pure, no three.js)
- `town/types.ts` (contract): `place-object` gains an optional **`variant?: number`**.
- `town/rules.ts` `planPlaceObject`: if `action.variant` is an integer in `[0, def.variants)`, use it and **don't call `ctx.rng()`**. Otherwise roll as today. So:
  - the sample town and asset gallery (no `variant` in their actions) keep their exact models and RNG sequence, and their screenshot baselines don't change because of the rules;
  - an out-of-range variant can't put a broken object in the town.
- **No save-format change:** `PlacedObject.variant` is already saved. No `SAVE_MIGRATIONS` step.
- `TownEditor`: no API change.

### Catalog (contract)
- `catalog/tools.ts`:
  - `actionForTool(toolId, cell, edge, rotation, variant?)` passes `variant` into `place-object` (ignored for other layers);
  - `variantIcon(toolId, n)`: icon URL of model `n`. Model 0 is the tool's own icon (`tool-<id>.png`); the rest are `tool-<id>-v<n>.png` (10 new PNGs: Townhouse 1, Bungalow 1, Suburban 3, Big house 1, Traffic light 1, Birch 1, Tulips 2);
  - `VARIANT_DEFAULT_MIX: ReadonlySet<ObjectKind>` = `tulips`, `birch`.
- `catalog/objects.ts`: unchanged (`variants` already = `models.length`).
- `catalog.test.ts`: every variant icon exists on disk; the Mix defaults are multi-variant kinds.

### Interaction (`ToolController` owns the choice, as it owns rotation)
- Types: `VariantChoice = number | 'mix'`; state `choices: Map<ObjectKind, VariantChoice>` (filled lazily from the defaults) and `nextVariant: number` (the model the next placement uses).
- `nextVariant` is resolved whenever the tool or choice changes, and re-rolled after each successful placement when the choice is Mix. A fixed choice resolves to itself.
- The roll uses the **gameplay RNG** (`Game.rng`, passed in by `Game`), never `fxRng`, so sounds still can't change models. Player placements now always carry an explicit `variant`, so the editor's own roll only serves actions without one (demo towns, tests).
- Every `actionForTool(...)` call for an object tool passes `nextVariant`, both the preview (hover validity) and the apply (click, drag, scatter).
- The place ghost uses `def.models[nextVariant]` instead of `models[0]`.
- After a choice change (chip or `V`), refresh the hover the way `rotate()` does, so the ghost updates without moving the pointer.
- `GhostPreview.setParts` must rebuild when only the model changes at the same spot. Check it while implementing; the move work's carry ghost suggests it does.
- Keys: `KeyV` / `Shift+KeyV` in the existing key switch (no repeat).
- Intent `intent:select-variant { choice: VariantChoice }` applies to the active tool and is ignored when the tool has one model.

### Events and diagnostics (contract)
- `game/events.ts`:
  - `intent:select-variant: { choice: VariantChoice }`;
  - `tool:changed` gains `variant: { choice: VariantChoice; count: number } | null` (null for tools with one model or no tool). It is emitted on tool select, rotate (as today) and choice change.
  - `VariantChoice` is exported from `catalog/tools.ts` so `events.ts`, UI and controller share it.
- `vite-env.d.ts` diagnostics: `variant: { choice: number | 'mix'; next: number; count: number } | null`, where `next` is the model the ghost shows and the next click builds. `Game.publishDiagnostics` fills it from `ToolController`.

### UI (`UiRoot`, `ui.css`, `testIds.ts`, `glyphs.ts`)
- **Strip markup:** `<div class="ui-variants" id="ui-variants" role="group" aria-label="Styles" data-phase="building" hidden>`. It is a child of `.ui-dock-wrap`, **outside** the scrolling tray, absolutely positioned above the dock, so it is never clipped and doesn't shift the dock. Chips are `<button class="ui-chip" data-variant="0|1|…|mix" aria-pressed aria-label="Style 2 of 4">`.
- **Position:** horizontally centred over the selected card (from its `getBoundingClientRect`), clamped inside the dock's width. It is re-placed on tray scroll, resize, and category/tool change. If the card is scrolled out of view, it is clamped to the tray's edge.
- **Size:** 44 × 44 px chips with about 36 px icons and 6 px gaps; at most 5 chips (Suburban: 4 + Mix), about 250 px wide, so it fits a 320 px phone. The strip floats above the dock, so the "dock ≤ 150 px tall on desktop" rule still holds. It adds about 56 px of UI above the dock while a variant tool is active.
- **Motion:** slides up 160 ms with `--ease`; with `prefers-reduced-motion` it just appears.
- **Card badge:** a small "stack" mark of 2–4 dots in the card's top-left corner on multi-variant cards. The `kbd` digit badge keeps its corner.
- **Card icon:** `renderTray` sets the selected card's `<img>` to `variantIcon(tool, choice)` (Mix → the tool icon), and the other cards to their tool icon.
- **Tooltip:** `positionTooltip` uses `min(dockTop, stripTop)` while the strip is visible.
- **Hint and Help:** text as in "How it behaves". `GLYPHS.dice` already exists for the Mix chip.
- `testIds.ts`: `variants: 'ui-variants'`, `variantChip: (choice) => 'variant-' + choice`.

### Icons (`render/IconStudio.ts`, `scripts/render-icons.mjs`)
- `sceneForTool` / the icon object take a `variant` (default 0); keep the icon object's id (7) so a birch chip's hashed yaw and size match its tool icon.
- `renderToolIcons` also renders `tool-<id>-v<n>.png` for every n ≥ 1 of multi-variant object tools, so the script writes them with no change of its own (it writes whatever it gets back).
- Licences: every variant model is CC0 (none of the CC-BY Poly Pizza models has a second variant); `docs/assets/CREDITS.md` doesn't change. `docs/assets/models.md`: one line on the variant icons.

### Test helpers
- `tests/helpers.ts`: `selectVariant(page, choice)` clicks the chip; `placedObjects(page)` reads the autosave from `localStorage` after a flush, for checking variants (or reuse whatever `move.spec.ts` already does to check positions).

## Files
- new:
  - `tests/variants.spec.ts`;
  - `public/assets/icons/tool-<id>-v<n>.png` × 10;
  - this plan.
- contract: `src/town/types.ts`, `src/catalog/tools.ts`, `src/game/events.ts`, `src/vite-env.d.ts`, `src/game/Game.ts` (RNG into ToolController, diagnostics).
- changed:
  - `src/town/rules.ts` (+ `rules.test.ts`);
  - `src/interaction/ToolController.ts`;
  - `src/ui/UiRoot.ts`, `src/ui/ui.css`, `src/ui/testIds.ts`;
  - `src/render/IconStudio.ts`;
  - `src/catalog/catalog.test.ts`;
  - `tests/helpers.ts`; `tests/ui.spec.ts` if its 44 px target check walks the dock.
- docs:
  - `02-interaction-and-ui.md` (dock, keys, touch, help, tooltip);
  - `03-architecture.md` (the "Variant choice" paragraph, the place-object row, events, diagnostics);
  - `docs/assets/models.md` (icons);
  - `CHANGELOG.md` (player note);
  - `progress.md` after approval.

## Acceptance
- `npm run verify` green, with new unit tests:
  - **rules:**
    - `place-object` with `variant: k` adds an object with variant `k` and doesn't call `ctx.rng` (a spy RNG);
    - without `variant`, or with an out-of-range or non-integer one, it rolls as before;
    - preview and apply agree;
  - **catalog:** each `tool-<id>-v<n>.png` exists for n ≥ 1 of every multi-variant object tool and none for single-model tools; `variantIcon(id, 0)` is the tool icon; the Mix defaults are multi-variant kinds;
  - **sample town:** still zero rejections, and the same variants as before (it passes no `variant`).
- e2e `tests/variants.spec.ts` (desktop + mobile, real input):
  - selecting Townhouse opens the strip with 3 chips (2 styles + Mix), style 1 pressed; selecting Cottage shows no strip;
  - choosing style 2 makes diagnostics `variant.next` 1; a click builds a townhouse whose saved variant is 1; three more clicks on free spots all build variant 1;
  - in Mix (Tulips by default), each placement's saved variant equals the `variant.next` read just before it, over at least 6 placements (so the ghost never lies), and more than one model appears;
  - desktop: `V` steps the choice and `Shift+V` steps back (diagnostics and the pressed chip agree); `V` with Cottage does nothing;
  - the choice is kept when switching to another tool and back;
  - the strip hides on deselect, on Move / Bulldoze and in the menu;
  - the card icon `src` follows the choice;
  - the strip and chips stay inside the viewport and each chip is ≥ 44 px, at 390 × 844 and at 360 px wide.
- e2e regressions: `interaction`, `build-flow`, `move`, `ui`, `new-items`, `bot-playtest`, `visual`, `visual-regression`. **The card badges change the dock**, so screenshot baselines that show a tray with a multi-variant tool are regenerated, and the diff is checked by eye: only the badges change.
- Visual evidence in `artifacts/variant-picker/`: the strip on Homes (desktop and phone), each Suburban style's ghost next to its built house, Mix tulips mid-drag, the tooltip with the strip open.

## Not in this change
- Restyling an object already placed (a "change style" action on a selected object). Later, it could reuse the strip with the Move tool's selection.
- A hover preview of the strip on desktop (decision 7).
- Saving the choice across reloads.
- More models for single-model kinds.
