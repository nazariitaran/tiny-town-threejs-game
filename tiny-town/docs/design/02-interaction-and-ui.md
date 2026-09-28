# Tiny Town — Interaction & UI Design

> Status: current for v0.2 (48 × 48 grid, 64 × 64 since 2026-09-28, multi-cell footprints, music settings, one-row top bar), updated for v0.3: the WP-15 catalog (five dock categories, 33 tools, roundabouts; 34 with the zebra crossing, 2026-09-28) and the WP-16 day/night controls (time button, menu row, `T`). v0.3 is not yet released. Code references: `src/interaction/*` (WP-05), `src/ui/*` (WP-06), `src/catalog/tools.ts`.

## 1. Camera

Isometric-feeling **perspective** camera (FOV ~35°) orbiting a target on the ground plane. Implemented with `MapControls` from `three/addons/controls/MapControls.js`, remapped so the left button is free for building.

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Pan | Right-drag · WASD / arrow keys · left-drag when **no tool** is selected | Two-finger drag |
| Orbit (yaw) | Middle-drag · Alt/Option + left-drag · Q / E (animated 45° steps) | Two-finger twist |
| Tilt | Alt + left-drag vertical | — (fixed) |
| Zoom | Wheel (zoom-to-cursor) · + / − | Pinch |
| Reset view | Home / `F` | Toolbar "reset view" button in menu |

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
| Bulldoze | Red highlight on what will be removed (object > edge > ground; a whole footprint or road block) | Remove (any footprint cell removes the object; a road cell clears its block) | Remove along drag | Commit |
| None (pointer) | Subtle cell highlight | Left-drag pans | — | — |

- **Rotate**: `R` (clockwise) / `Shift+R` (counter-clockwise), or the on-screen Rotate button (`intent:rotate` direction 1 = clockwise). A rotation swaps the footprint's width and depth (e.g. a 2×3 townhouse covers 3×2 at rotation 1), and the ghost re-centres on the pointer. Rotation persists until changed. The ghost animates the turn (100 ms).
- **Tree height**: `H` (next tier) / `Shift+H` (previous), or the Height button, which takes Rotate's slot in the dock while a tree tool is active (trees get a random yaw and ignore Rotate, and the dock keeps its width). Oak, pine and birch have three tiers (normal · tall · towering: ×1, ×1.5, ×2; the oak tops out at ×1.7 because its round crown turns blobby when stretched). The ghost shows the chosen tier and the tree still covers one cell. The tier persists like rotation, applies to scatter drags, and is ignored (H does nothing, Rotate is shown) for every tool without tiers. Only the height changes, never the width, so tall trees can't crowd their neighbours; but a tall tree hides more of the view behind it (about 1.3 × its height at the default camera), which is why the top tier is capped below the church.
- **Esc**: deselect the tool (back to pointer); with no tool, it opens the menu. Right-click never places; a right click (no drag, under 5 px) also deselects the tool, while a right drag still pans the camera.
- **Tool selection** (UI-owned, `src/ui/uiKeys.ts`): `1`–`9` pick the Nth tool of the **active** category, and pressing the active tool's digit again deselects it. `Shift+1`–`5` switch category (Streets / Homes / Town / Nature / Garden). Uses `event.code`, so layouts and Shift don't change the mapping. `B` = bulldoze, `?` = controls help, `T` = cycle the time of day (Auto → Day → Night; `ToolController`, building phase only).
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
| Bungalow / Suburban | 4 × 4 | field, grass, meadow | Homes (2 / 4 residents). |
| Big house | 5 × 4 | field, grass, meadow | Home (5 residents). |
| Corner shop / Church / Supermarket | 3 × 3 / 3 × 4 / 5 × 4 | field, grass, meadow, pavement | Town amenities. |
| Fountain / Pool | 2 × 2 / 4 × 3 | field, grass, meadow, pavement, garden path | Town amenities. |
| Bush | 1 × 1 | field, grass, meadow, pavement | Drag scatters, like trees. |
| Hedge | cell edge | — | Edge tool, like the fences. |
| Planter / Bench / Barbecue | 1 × 1 | field, grass, meadow, pavement, garden path | Planter drag-scatters. |
| Swing | 2 × 1 | field, grass, meadow | |

## 4. Screen layout (desktop 1280×720)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [🏡 Tiny Town]                                   [↶][↷] │ [🔊][☰]   │  top bar: ONE row (brand pill · action pill)
│            "Drag to lay road — it joins up automatically"            │  hint pill, 10 px under the top bar (fades)
│                                                                      │
│                          3D  TOWN  VIEW                              │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │ [img][img][img][img]  … item tray for the active category …  │   │  item tray (cards: rendered icon + label + key)
│   ├──────────────────────────────────────────────────────────────┤   │
│   │ (Streets) (Homes) (Town) (Nature) (Garden) │ [⟲ Rotate | ↕ Height] [⌫ Bulldoze] │  category tabs + mode buttons
│   └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

- **Dock** (bottom centre): category tabs; the active category's **item tray** slides up above the tabs. The build starts on **Streets**.
- **Categories (v0.3).** Each one answers "what am I building?":

  | Tab (Shift+) | Holds | Tools, in tray order (digit 1–9) |
  | --- | --- | --- |
  | Streets (1) | the road network and everything at the kerb | Road, Pavement, Roundabout, Zebra (Zebra crossing), Traffic light, Lamppost, Bus stop, Postbox |
  | Homes (2) | where people live, and their garages | Cottage, Townhouse, Bungalow, Family home, Suburban, Big house, Garage |
  | Town (3) | shops and civic places everyone shares | Fountain, Corner shop, Church, Supermarket, Pool |
  | Nature (4) | things that grow on their own | Grass, Wildflowers, Bush, Oak, Pine, Birch |
  | Garden (5) | things people build in a yard or park | Garden path, Hedge, Low fence, Tall fence, Planter, Bench, Barbecue, Swing |

  Inside a category the tools run **surfaces → lines → objects** (ground paint, then edges, then placed items). A category holds at most 9 tools, so every tool has a digit. `catalog.test.ts` checks both. An item card is a 44 px icon (the in-project render of the in-game model, `scripts/render-icons.mjs`), a short label and a number-key badge. The selected card is raised with an accent outline. Clicking the active item again deselects it.
- **Mode buttons** (right end of the dock): Rotate (shows the current rotation arrow) or, while a tree tool is active, Height in the same slot (a small badge shows the tier 1–3), and Bulldoze (toggles; red accent when active).
- **Top bar**: one row. The row is 48 px tall (`--topbar-h`; 52 px on phones), so it ends 60 / 64 px below the safe-area top.
  - Left: the title mark only. v0.2 (WP-14) removed the live stats pill as redundant; `TownState.stats()` and diagnostics `town` remain for tests.
  - Right: Undo and Redo (disabled when unavailable), then the **time-of-day button** (v0.3, WP-16), the sound toggle (mute), and Menu. Volume and music settings are in the menu.
  - The time button cycles Auto → Day → Night (`intent:cycle-time-mode`; key `T`). Its glyph is sun + moon, sun or moon, and its label reads "Time of day: Auto". It renders from `daytime:changed`. The mode is a saved setting; the time of day is not.
- **Hint line**: a contextual one-liner for the active tool's gesture. It sits top-centre, 10 px under the top bar, fades after about 3.5 s, and stops appearing after 3 uses of that tool.
- **Cursor tooltip**: the invalid-placement reason, anchored near the pointer but never under it, and never over the dock or top bar.
- Nothing overlaps the centre of the view. The dock is ≤ 150 px tall on desktop.
- **Grid overlay** (menu "Show grid"): line opacity is capped at `GRID_MAX_OPACITY` (0.14; design cap ≤ 20%) by day. At night it may exceed the cap: opacity × (1 + `GRID_NIGHT.boost`·night), with boost 0.6 (v0.3, WP-16a), so building at night stays as easy as by day.
- **Day/night (v0.3):** building works the same at any time of day. The ghost, the footprint frame and the grid stay clearly visible at night.

### Mobile (≤ 760 px wide or `pointer: coarse`)
- The dock is full-width at the bottom (safe-area padded). The item tray scrolls horizontally with scroll-snap. Cards are 80 × 78 px with 50 px icons; at ≤ 380 px wide they shrink to 64 px and the labels are hidden.
- The top bar stays one row: the title mark (an icon-only badge at **≤ 440 px** since v0.3: five 44 px actions need about 245 px) plus the actions; every top-bar action stays a ≥ 44 px target. The hint pill sits 10 px under the top bar.
- One finger = tool action (tap place / drag paint); two fingers = camera. With no tool selected, one finger pans.
- Hint line mentions "two fingers to move the camera".

## 5. UI states

| State | Content | Enter / exit |
| --- | --- | --- |
| **Loading** | Title mark + progress bar (models/audio loaded / total) | App start → assets ready |
| **Title** | Big "Tiny Town" mark over the live, slowly orbiting scene. Buttons: **Start building** (primary), which reads **Continue** when a save exists; **New town**, shown only when a save exists; a small Credits link | Assets ready → user clicks. This click also unlocks audio and starts the streamed music |
| **Building** | Dock, top bar, hint line | Main state |
| **Menu** (overlay; the sim keeps rendering; music ducks −3 dB; the day clock pauses) | Resume · Controls · Reset view · Volume · **Music** on/off · **Music volume** · Show grid · **Time of day** (Auto / Day / Night segmented control) · New town (confirm) · Credits | ☰, or Esc when no tool is selected |
| **Confirm dialog** | "Start a new town? Your current town will be cleared." Cancel / Clear | From menu |
| **Controls help** | Two-column gesture list (mouse+keys / touch) | From menu, `?` key |
| **Error** | Friendly message if WebGL or asset loading fails, with retry | Fatal load error |

## 6. Visual language

- Panels: warm off-white `#FFF9EF` at ~92% opacity, 16 px radius, soft drop shadow, 1 px `rgba(60,40,20,.08)` border; text `#3B3A36`.
- Accents: grass green `#5DB36A` (selected/valid), sky blue `#4A9BE8` (focus/info), brick `#E0674F` (bulldoze/invalid), sun yellow `#F4C44E` (highlights). Invalid is never conveyed by colour alone — add ✕ icon / shake.
- Font: a rounded sans (e.g. Nunito via `@fontsource-variable/nunito`, OFL, bundled — no runtime CDN).
- Icons: item icons are rendered in-project from the in-game models (128 px PNG, `tool-<id>.png`, `scripts/render-icons.mjs` + `src/render/IconStudio.ts`). UI glyphs (undo, redo, sound, menu, rotate, height, bulldoze, music) are inline SVG.
- Motion: 120–200 ms ease-out for hovers/presses; tray slide 180 ms; respects `prefers-reduced-motion`.
- All interactive elements: hover, pressed, focus-visible, disabled states. Tabbable in a sensible order; toolbar buttons have `aria-label`s.

## 7. State wiring rule
UI never mutates town/game state directly. It **emits intents** on the event bus and **renders facts** it receives (`src/game/events.ts`). One source of truth per concern: `TownEditor` (town + history), `ToolController` (active tool/rotation/hover), `AudioManager` (mute/volume/music, persisted through `SaveStore` settings), `UiRoot` (active dock category), `Game` (phase).
