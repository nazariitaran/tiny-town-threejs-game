# Tiny Town — Interaction & UI Design

> Status: current for v0.2 (48 × 48 grid, 64 × 64 since 2026-09-28, multi-cell footprints, music settings, one-row top bar), updated for v0.3: the WP-15 catalog (five dock categories, 33 tools, roundabouts; 34 with the zebra crossing, 2026-09-28) and the WP-16 day/night controls (time button, menu row, `T`). v0.3 is not yet released. Updated 2026-09-30 for WP-25 (the tabbed menu and its Graphics tab; branch `wp-24-frame-budget`, not merged). Code references: `src/interaction/*` (WP-05), `src/ui/*` (WP-06), `src/catalog/tools.ts`.

## 1. Camera

Isometric-feeling **perspective** camera (FOV ~35°) orbiting a target on the ground plane. Implemented with `MapControls` from `three/addons/controls/MapControls.js`, remapped so the left button is free for building.

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Pan | Right-drag · WASD / arrow keys · left-drag when **no tool** is selected | Two-finger drag |
| Orbit (yaw) | Middle-drag · Alt/Option + left-drag · Q / E (animated 45° steps) | Two-finger twist |
| Tilt | Alt + left-drag vertical | — (fixed) |
| Zoom | Wheel (zoom-to-cursor) · + / − | Pinch |
| Reset view | Home / `F` | — |

Constraints (tunable in `?debug`):
- Polar angle clamped **30°–70°** from vertical (never flat-on-ground, never top-down-only).
- Distance clamped **6 → 60** world units (at least 1.2× the fitted home distance). The 64 × 64 plot (32 × 32 world units) keeps the old default zoom, so these didn't change.
- Target clamped to the plot bounds + 2 cells margin; damping on (`enableDamping`, factor ~0.12).
- Build start / reset pose: `defaultPoseFor(width, height)` (`framing.ts`), 45° yaw, 52° polar (58° in portrait).
  - It fits the plot's width inside side insets, with the plot centre between the top bar and the dock.
  - Desktop 1280×720 gives `DEFAULT_POSE` (distance ≈ 35.8). Since the 64 × 64 plot the side inset is −42, so the plot is slightly wider than the screen (corners reachable by panning) and a cell stays about 12.5 px.
  - Phones use a side inset of −412 (−260 on 48 × 48), so the plot is ~3× the screen width and a cell is about 10.6 px. Small props on touch need a pinch-zoom.
- Title pose `TITLE_POSE`: 78° polar, a low hero angle that shows the horizon, sky and sun (the build polar range never can at FOV 35°), with a slow auto-orbit and input disabled. Portrait screens use `titlePoseFor`, which pulls the camera in so the diorama fills the width.

## 2. Pointer → grid

- A single invisible ground plane (y = 0) is raycast on `pointermove`. The hit becomes fractional grid coordinates (`worldToGridPoint`), then:
  - a **cell** (`{x, z}`, 64 × 64 half-unit cells);
  - for edge tools, the **nearest cell edge** (`{x, z, side: 'n' | 'w'}`);
  - for multi-cell objects, a footprint **anchor** from `grid.anchorForPointer`, so the footprint is centred on the pointer: odd sizes on the hovered cell, even sizes on the nearest cell corner, clamped into the plot.
  - for the **zebra crossing** (a road marking, one 2 × 2 road block), the same call with `snap = ROAD_BLOCK`; its ghost shows the zebra variant of the road piece under it, turned like the road (R does nothing);
  - for the **roundabout** (a road feature), the same call with `snap = ROAD_BLOCK`, so the anchor stays on the road-block grid (even x, z) and the 6 × 6 footprint covers 3 × 3 whole road blocks.
- Road tools and bulldozing a road work on the pointer's aligned 2 × 2 **road block**.
- Raycast only on pointer move / camera change (not every frame when idle).
- Pointer outside the plot → no hover, ghost hidden.

## 3. Tool behaviour

| Tool kind | Hover | Press | Drag | Release |
| --- | --- | --- | --- | --- |
| Ground paint (road, pavement, walkway, grass, meadow) | Cell highlight + flat ghost tile (road: the whole 2 × 2 block) | Paint cell (road: its block) | Paint every cell crossed (Bresenham between samples, no gaps; road visits each block once) | Commit stroke as **one** undo step |
| Object (roundabout, street furniture, homes, town buildings, trees, garden items) | Translucent ghost model plus a rectangular frame covering the whole footprint, centred on the pointer and rotated (the roundabout snaps to the road-block grid). Mint when valid, brick red when invalid | Place if valid; else invalid feedback | Trees, bush, lamppost and planter scatter (place on each new valid cell). Everything else: no drag (single place) | Commit |
| Edge (hedge, fences) | Ghost piece on nearest edge | Place | Paint along a straight line of edges (axis locked by first move) | Commit |
| Bulldoze | Red highlight on what will be removed (object > edge > ground; a whole footprint or road block). An object or fence is painted red exactly where it stands (same shape, turn and sway), with the red frame on its footprint | Remove (any footprint cell removes the object; a road cell clears its block) | Remove along drag | Commit |
| Move (2026-10-01) | Nothing carried: the movable object under the pointer is painted sky blue exactly where it stands, with a blue frame on its footprint (roundabout, zebra crossings and ground show the plain cell outline). Carrying: the object stays blue in place and a ghost of it follows the pointer, footprint centred on it, mint where it can go and red where it can't | Nothing carried: pick the object up (a click on the roundabout or a zebra says "{label} can't be moved"). Carrying: put it down (one undo entry; the item's own place sound and dust; it slides and hops there in 0.3 s), or the reason when it can't go there; putting it down where it stood just puts it back | — (click, click; touch: tap, tap) | Commit on the drop |
| None (pointer) | Subtle cell highlight | Left-drag pans | — | — |

- **Rotate**: `R` (clockwise) / `Shift+R` (counter-clockwise), or, on touch screens, the dock's Rotate button (`intent:rotate` direction 1 = clockwise; hidden with a mouse and keyboard since 2026-09-30, where R does the job). A rotation swaps the footprint's width and depth (e.g. a 2×3 townhouse covers 3×2 at rotation 1), and the ghost re-centres on the pointer. Rotation persists until changed. The ghost animates the turn (100 ms).
- **Style (variant picker, 2026-10-01, `docs/plans/variant-picker.md`)**: the seven object tools with more than one model (Townhouse, Bungalow, Suburban, Big house, Traffic light, Birch, Tulips) let the player choose which one to build. Selecting one of them (click, digit or tap) opens a **strip of icon-only chips** above the dock over its card: one chip per model in catalog order, then **Mix** (the die). The chosen chip is raised with the accent outline. The ghost always shows exactly the model the next placement builds, and the click builds it. In Mix, a fresh model is rolled (gameplay RNG) after every successful placement, once per cell in a scatter drag, and the ghost shows the new roll. Tulips and Birch start on Mix; the others start on their first model (the one their icon shows). Each tool remembers its choice for the session (not saved). `V` / `Shift+V` step style 1 → … → Mix → style 1 (desktop; no repeat). The strip hides when the tool goes away (another tool, Move, Bulldoze, deselect), while another category's tray is open and outside the build phase. A placed object keeps its model when moved.
- **Tree heights are fixed, not chosen:** pine stands ×2 of its kit model, birch keeps its natural height (`ObjectDef.height`); pine and birch stretch in height only, so they still cover one cell. The **oak** is a big round tree on a 2 × 2 cell lot (a road block's size), drawn at natural proportions; its ghost frame covers the whole lot and a drag scatters oaks two cells apart. A tall tree hides about 1.3 × its height of the view behind it at the default camera.
- **Esc**: deselect the tool (back to pointer); with no tool, it opens the menu. Right-click never places; a right click (no drag, under 5 px) also deselects the tool, while a right drag still pans the camera.
- **Tool selection** (UI-owned, `src/ui/uiKeys.ts`): `1`–`9` pick the Nth tool of the **active** category, and pressing the active tool's digit again deselects it. `Shift+1`–`5` switch category (Streets / Homes / Town / Nature / Garden). Uses `event.code`, so layouts and Shift don't change the mapping. `B` = bulldoze, `M` = move, `V` / `Shift+V` = next / previous style of a multi-model tool, `?` = controls help, `T` = cycle the time of day (Auto → Day → Night; `ToolController`, building phase only), `P` = take a photo (WP-19; UI-owned, building phase only, no modifiers, so Ctrl/Cmd+P still prints).
- **Undo/Redo**: `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` / `Ctrl+Y`. Every stroke is one history entry.
- Placement feedback (same frame): pop-in scale tween (easeOutBack, ~220 ms), small dust puff, SFX by category. Removal: shrink-out (~150 ms) + poof + crunch SFX.
- Invalid click: ghost shakes (±0.05, 150 ms), soft "nope" SFX, tooltip near cursor with the reason for ~1.5 s (throttled).

### v0.3 items: placement at a glance
Full rules: `03-architecture.md` §Placement rules. Footprints are cells at rotation 0 (width × depth).

| Item | Footprint | Ground | Notes |
| --- | --- | --- | --- |
| Zebra crossing | 2 × 2 (one road block) | existing road: a straight, tee or crossroad | Snaps to the road-block grid. The tile under it draws zebras across a straight, or on every arm of a tee or crossroad. Bulldozing it leaves the road. Cars ignore it. |
| Roundabout | 6 × 6 (3 × 3 road blocks) | any, even existing road | Snaps to the road-block grid. Placing it paints its footprint to road (fences across it go); bulldozing it turns the footprint back to field. Roads join it only at the middle of each side (its four arms). Cars go round the island counter-clockwise. |
| Traffic light | 1 × 1 | field, grass, meadow, pavement, garden path | Must be next to a road ("Traffic lights need to be next to a road"). Two variants: pole and hanging arm. |
| Bungalow / Suburban | 4 × 4 | field, grass, meadow, pavement | Homes (2 / 4 residents). |
| Big house | 5 × 4 | field, grass, meadow, pavement | Home (5 residents). |
| Corner shop / Church / Supermarket | 3 × 3 / 3 × 4 / 5 × 4 | field, grass, meadow, pavement | Town amenities. |
| Fountain / Pool | 2 × 2 / 4 × 3 | field, grass, meadow, pavement, garden path | Amenities. The Pool is in the Garden dock since the WP-23 review. |
| Donut shop (WP-23) | 3 × 3 | field, grass, meadow, pavement | A shop like the corner shop; dark at night. |
| Tiered fountain (WP-23) | 3 × 3 | field, grass, meadow, pavement, garden path | A plaza fountain. |
| Mailbox (WP-23) | 1 × 1 | field, grass, meadow, pavement, garden path | At the kerb, like the postbox. |
| Tulips (WP-23) | 1 × 1 | field, grass, meadow | Drag scatters; three variants. |
| Bush | 1 × 1 | field, grass, meadow | Drag scatters, like trees (oak, pine and birch also take field, grass or meadow only, not pavement). |
| Hedge | cell edge | — | Edge tool, like the fences. |
| Planter / Bench / Long bench / Table / Barbecue | 1 × 1 | field, grass, meadow, pavement, garden path | Planter drag-scatters. |
| Swing / Slide | 2 × 1 | field, grass, meadow | |

## 4. Screen layout (desktop 1280×720)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [🏡 Puddleton]                       [↶][↷] │ [🗂][📷][☀][🔊][☰]  │  top bar: ONE row (town name pill · action pill)
│            "Drag to lay road — it joins up automatically"            │  hint pill, 10 px under the top bar (fades)
│                                                                      │
│                          3D  TOWN  VIEW                              │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │ [img][img][img][img]  … item tray for the active category …  │   │  item tray (cards: rendered icon + label + key)
│   ├──────────────────────────────────────────────────────────────┤   │
│   │    (Streets) (Homes) (Town) (Nature) (Garden) │ [⌫ Bulldoze]    │  category tabs + mode buttons (centred)
│   └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

- **Dock** (bottom centre): category tabs; the active category's **item tray** slides up above the tabs. The build starts on **Streets**.
- **Categories (v0.3).** Each one answers "what am I building?":

  | Tab (Shift+) | Holds | Tools, in tray order (digits 1–9 reach the first nine) |
  | --- | --- | --- |
  | Streets (1) | the road network | Road, Pavement, Roundabout, Zebra (Zebra crossing), Traffic light |
  | Homes (2) | where people live (and their mailbox) | Cottage, Townhouse, Bungalow, Family home, Suburban, Big house, Mailbox |
  | Town (3) | shops, civic places and the street furniture everyone shares | Tiered fountain, Corner shop, Donut shop, Church, Supermarket, Bus stop, Postbox, Lamppost |
  | Nature (4) | things that grow on their own | Grass, Wildflowers, Tulips, Bush, Oak, Pine, Birch |
  | Garden (5) | things people build in a yard or park | Hedge, Low fence, Tall fence, Planter, Bench, Long bench, Table, Barbecue, Swing, Slide, Pool |

  **2026-09-30 (owner):** the mailbox moved to Homes; the lamppost, postbox and bus stop to Town; the **Fountain** and **Garden path** tools were retired. Retired tools leave the dock only: their kinds stay in the catalog (`RETIRED_TOOLS` in `catalog/tools.ts`), so towns that already have them (saves, town files, the demo towns) still load and draw them, and they can be bulldozed; the ground column "garden path" below still applies to those. Wildflowers now use the grass lawn colour (only the flower scatter differs).

  Inside a category the tools run **surfaces → lines → objects** (ground paint, then edges, then placed items). **WP-23 (owner decision, 2026-09-29):** a category holds at most **12** tools (about what fits a desktop row; the tray scrolls sideways where it doesn't). Digits 1–9 pick the first nine; tools past the ninth (today Garden's Slide and Pool) have no number badge, no "(n)" in their tooltip and no key. `catalog.test.ts` checks the order and the cap. An item card is a 44 px icon (the in-project render of the in-game model, `scripts/render-icons.mjs`), a short label and a number-key badge. The selected card is raised with an accent outline. Clicking the active item again deselects it. A card whose tool has several models carries one small dot per model in its top-left corner, and while that tool is selected the card shows the chosen model's icon (`tool-<id>-v<n>.png`; Mix keeps the tool icon) and the **style strip** floats above the dock over it (44 px chips, a caret pointing at the card; outside the scrolling tray, so never clipped; it doesn't count toward the dock's height).
- **Tab row** (2026-09-30, owner request): the category tabs and the mode buttons form one row centred under the tray, so it stays in the same place whatever the category's tray width.
- **Mode buttons** (after the tabs): on touch screens only, Rotate (shows the current rotation arrow); Move (2026-10-01; toggles; sky blue when active, like its in-world highlight); Bulldoze (toggles; red accent when active). On phones every tab and mode takes its label's width with a 44 px minimum (labels 0.66 rem up to 440 px wide), so all eight fit one row from 390 px up; below 390 px (owner, 2026-10-01) the categories take the first row and the modes a second one, so every target stays ≥ 44 px (the dock is ~50 px taller there).
- **Move** (2026-10-01, `docs/plans/move-objects.md`): moves any placed object except the roundabout and zebra crossings (they belong to the road); ground, hedges and fences never move. The new spot follows the placing rules, except that the object's own old footprint doesn't count as occupied (a house can shuffle one cell or turn in place). R / Shift+R (or the touch Rotate button) turn what is carried, starting from its own rotation, not the tools' shared one; trees and plants can't be turned (their look comes from their id), so their hint leaves R out. Esc or a right-click put it back (the next Esc / right-click puts the tool away); another tool, undo/redo, the menu and leaving the build phase put it back too. Hints while carrying: "Click where it goes · R to rotate · Esc to cancel" / "Tap where it goes · tap Rotate to turn it" (first three pick-ups), hidden on the drop. With a mouse and keyboard (`(hover: hover) and (pointer: fine)`) Rotate is hidden: `R` / `Shift+R` rotate, the item hint says so, and Help lists it. Phones and tablets have no R key, so they keep the button.
- **Top bar**: one row. The row is 48 px tall (`--topbar-h`; 52 px on phones), so it ends 60 / 64 px below the safe-area top.
  - Left: the **town name pill** (WP-20): the brick house badge and the player's town name (bold, ellipsised when too long; desktop caps the pill at 40 % of the width). It is a button: click / tap it to rename the town. v0.2 (WP-14) removed the live stats pill as redundant; `TownState.stats()` and diagnostics `town` remain for tests.
  - Right: Undo and Redo (disabled when unavailable), then the **Town file** folder (WP-21; wider than 440 px only), the **photo camera** (WP-19, key `P`), the **time-of-day button** (v0.3, WP-16), the sound toggle (mute), and Menu. Volume and music settings are in the menu's Sound tab.
  - The time button cycles Auto → Day → Night (`intent:cycle-time-mode`; key `T`). Its glyph is sun + moon, sun or moon, and its label reads "Time of day: Auto". It renders from `daytime:changed`. The mode is a saved setting; the time of day is not.
- **Hint line**: a contextual one-liner for the active tool's gesture. It sits top-centre, 10 px under the top bar, fades after about 3.5 s, and stops appearing after 3 uses of that tool.
- **Cursor tooltip**: the invalid-placement reason, anchored near the pointer but never under it, and never over the dock, the style strip or the top bar.
- Nothing overlaps the centre of the view. The dock is ≤ 150 px tall on desktop.
- **Grid overlay** (Menu → Graphics → "Show grid"): line opacity is capped at `GRID_MAX_OPACITY` (0.14; design cap ≤ 20%) by day. At night it may exceed the cap: opacity × (1 + `GRID_NIGHT.boost`·night), with boost 0.6 (v0.3, WP-16a), so building at night stays as easy as by day.
- **Day/night (v0.3):** building works the same at any time of day. The ghost, the footprint frame and the grid stay clearly visible at night.

### Mobile (≤ 760 px wide or `pointer: coarse`)
- The dock is full-width at the bottom (safe-area padded). The item tray scrolls horizontally with scroll-snap. Cards are 80 × 78 px with 50 px icons; at ≤ 380 px wide they shrink to 64 px and the labels are hidden.
- The top bar stays one row: the town name pill plus the actions (six 44 px actions since WP-19's photo camera, about 290 px; WP-21's Town file button is hidden here, because a seventh needs ~337 px, and the Menu carries a **Town file** row instead); every top-bar action stays a ≥ 44 px target. At **400–440 px** the name gets a smaller size and whatever is left (about 7 characters at 412 px, then an ellipsis); **below 400 px** the pill is the icon-only badge (still a rename button), because only 2–3 characters would fit. The menu's heading shows the full name, so phones always have a place where it reads in full. The hint pill sits 10 px under the top bar.
- One finger = tool action (tap place / drag paint); two fingers = camera. With no tool selected, one finger pans.
- Hint line mentions "two fingers to move the camera".

## 5. UI states

| State | Content | Enter / exit |
| --- | --- | --- |
| **Loading** | Title mark + progress bar (models/audio loaded / total) | App start → assets ready |
| **Title** | Big "Tiny Town" mark (the game's logo, never the town's name) over the live, slowly orbiting scene. Buttons: **Start building** (primary), which reads **Continue** when a save exists; **New town**, shown only when a save exists; small **Open a town file** (WP-21: straight to the file picker, then the Town file confirm) and Credits links | Assets ready → user clicks. Continue goes straight in; Start building (no save) and New town (after its confirm) open **Name your town** first. The click that enters the game (Continue, or the name dialog's Start building) unlocks audio and starts the streamed music |
| **Name your town** (WP-20; over the title, or the menu phase with the name view) | "Name your town" (new town) or "Rename your town": a text field (≤ 30 characters, live "n / 30" counter) pre-filled with a random name from `public/data/default_town_names.json` (new) or the current name (rename); a **die** button draws another random name; **Cancel** and **Start building** / **Save**. Enter submits, Esc cancels; a blank name can't be submitted. Desktop focuses the field with the text selected; touch focuses the button, so the keyboard opens only when the field is tapped | New town: from the title's Start building (no save) or after "Start a new town?" → Clear (title or menu); nothing is cleared until the name is confirmed. Rename: the top-left pill (Cancel returns to building) or Menu → Rename town (Cancel returns to the menu). Renaming is not undoable and is autosaved |
| **Building** | Dock, top bar, hint line | Main state |
| **Menu** (overlay; the sim keeps rendering; music ducks −3 dB; the day clock pauses) | Headed by the **town's name** (WP-20), then **Resume**, then (WP-25) a tab bar **Town · Graphics · Sound · Help** (glyph over label) with one panel per tab (§5.1) | ☰, or Esc when no tool is selected |
| **Photo** (WP-19; the menu phase with the photo view instead of the menu: same pause, duck and dim) | A white flash (none under reduced motion), then the photo as a slightly tilted Polaroid with a strip of washi tape: "Developing…" on a warm grey print, then the picture fades up from pale sepia. **Download** and **Back to town** (no Share button, owner decision) | Camera button or `P` while building → Esc / Back to town returns to building (the tool stays selected) |
| **Town file** (WP-21; the menu phase with the file view, like the photo) | "Town file": **Download this town** (primary; the live town as `<slug>-YYYY-MM-DD-HHMM.tinytown.json`), **Open a town file…** (the system picker, `.json`, ≤ 2 MB), a status line ("Saved as …", or why a file can't be opened, in brick) and **Back to town** / **Back**. On the title (after a bad file) Download is hidden | The top-bar folder (Back returns to building) or Menu → Town file on phones (Back returns to the menu); the title link on a bad file |
| **Town file confirm** (WP-21) | "Open Bumbleford?", "Saved on 29 Sep 2026.", then "Puddleton will be replaced. Download it first if you want to keep it." (in the game) or "Your saved town will be replaced." (title with a save). **Cancel** (focused) and **Replace town** (brick), or **Open town** (green) when nothing is replaced; in the game a **Download Puddleton first** link. The file's town, name and camera replace the current ones (not undoable) and are saved at once | After a good file is picked. Cancel / Esc return to the panel (title: close). Replace from the title also starts the game (unlocks audio, morning) |
| **Confirm dialog** | "Start a new town? Your current town will be cleared." Cancel / Clear (Clear opens Name your town; WP-20) | From menu, or the title's New town |
| **Controls help** | Two-column gesture list (mouse+keys / touch) | From menu, `?` key |
| **Error** | Friendly message if WebGL or asset loading fails, with retry | Fatal load error |

### 5.1 Menu tabs (WP-25)
- **Tabs and contents** (every control keeps its id from before WP-25):
  - **Town**: Time of day (Auto / Day / Night segmented control); **Town file** (phones ≤ 440 px only, WP-21); **Rename town** · **New town** (confirm, then Name your town).
  - **Graphics**: **Quality**, a Low / Medium / High segmented radio group like Time of day; under it the selected preset's one-line description (`GRAPHICS_UI`); while a reload is needed, the notice "Some changes apply after a reload" with **Reload now**; **Show grid**.
  - **Sound**: Volume, Music on/off, Music volume.
  - **Help**: Controls, Credits. (The Reset view button was removed 2026-10-01; F / Home still reset the camera.)
- **Graphics wiring:** the radios, the description and the notice render only from the last `graphics:changed` fact (Game emits it at boot and after every change); picking a preset emits `intent:set-graphics` and applies the live parts at once. The notice appears when the choice changes MSAA or the material from what the page booted with (anything ↔ Low); Medium ↔ High never needs it. **Reload now** emits `intent:reload-graphics`: the town save is flushed and the page reloads to the title, where Continue brings the same town back on the new preset. The choice is saved in the settings; the default is Medium on every device. Rules and numbers: `03-architecture.md` §Graphics presets.
- **Keyboard** (WAI-ARIA tabs, automatic activation): the tab bar is one Tab stop (roving `tabindex`, the selected tab); ←/→ move and wrap, Home / End jump to the first / last tab; Tab moves into the open panel and Shift+Tab comes back to the selected tab. Arrows inside a radio group move its choice, as usual. The arrows never reach the camera while the menu is open.
- **Remembered tab:** the menu opens on the tab used last in this page session (Town after a load or reload). Back from a sub-view (Controls, Credits, the New town confirm, Rename, Town file) and Esc from one return to the menu **on the same tab**, with focus on the control that opened it; `?` opens Controls from building, and Esc from there lands on the remembered tab.
- **Steady size:** every panel sits in the same grid cell, so the menu is as tall as the tallest tab and doesn't jump when the tab changes; on short screens the panel area scrolls. It fits 390 × 844 and the Pixel 7 viewport with no sideways scroll and no clipped labels (`tests/menu-tabs.spec.ts`).

## 6. Visual language

- Panels: warm off-white `#FFF9EF` at ~92% opacity, 16 px radius, soft drop shadow, 1 px `rgba(60,40,20,.08)` border; text `#3B3A36`.
- Accents: grass green `#5DB36A` (selected/valid), sky blue `#4A9BE8` (focus/info), brick `#E0674F` (bulldoze/invalid), sun yellow `#F4C44E` (highlights). Invalid is never conveyed by colour alone — add ✕ icon / shake.
- Font: a rounded sans (e.g. Nunito via `@fontsource-variable/nunito`, OFL, bundled — no runtime CDN).
- Icons: item icons are rendered in-project from the in-game models (128 px PNG, `tool-<id>.png`, `scripts/render-icons.mjs` + `src/render/IconStudio.ts`). UI glyphs (undo, redo, sound, menu, rotate, bulldoze, music) are inline SVG.
- Motion: 120–200 ms ease-out for hovers/presses; tray slide 180 ms; respects `prefers-reduced-motion`.
- All interactive elements: hover, pressed, focus-visible, disabled states. Tabbable in a sensible order; toolbar buttons have `aria-label`s.

## 7. State wiring rule
UI never mutates town/game state directly. It **emits intents** on the event bus and **renders facts** it receives (`src/game/events.ts`). One source of truth per concern: `TownEditor` (town + history), `ToolController` (active tool/rotation/hover), `AudioManager` (mute/volume/music, persisted through `SaveStore` settings), `UiRoot` (active dock category), `Game` (phase).
