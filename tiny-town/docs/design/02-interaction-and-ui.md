# Tiny Town — Interaction & UI Design

> Status: current for v0.2 (48 × 48 grid, multi-cell footprints, music settings, one-row top bar). Code references: `src/interaction/*` (WP-05), `src/ui/*` (WP-06).

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
- Distance clamped **6 → 60** world units. WP-12 left these unchanged, because the plot is still 24 × 24 world units.
- Target clamped to the plot bounds + 2 cells margin; damping on (`enableDamping`, factor ~0.12).
- Build start / reset pose: `defaultPoseFor(width, height)` (`framing.ts`), 45° yaw, 52° polar (58° in portrait).
  - It fits the plot's width inside side insets, with the plot centre between the top bar and the dock.
  - Desktop 1280×720 gives `DEFAULT_POSE` (distance ≈ 35.8).
  - Phones use a side inset of −260, so the plot is wider than the screen and a cell is about 10.6 px. Small props on touch need a pinch-zoom.
- Title pose `TITLE_POSE`: 78° polar, a low hero angle that shows the horizon, sky and sun (the build polar range never can at FOV 35°), with a slow auto-orbit and input disabled. Portrait screens use `titlePoseFor`, which pulls the camera in so the diorama fills the width.

## 2. Pointer → grid

- A single invisible ground plane (y = 0) is raycast on `pointermove`. The hit becomes fractional grid coordinates (`worldToGridPoint`), then:
  - a **cell** (`{x, z}`, 48 × 48 half-unit cells);
  - for edge tools, the **nearest cell edge** (`{x, z, side: 'n' | 'w'}`);
  - for multi-cell objects, a footprint **anchor** from `grid.anchorForPointer`, so the footprint is centred on the pointer: odd sizes on the hovered cell, even sizes on the nearest cell corner, clamped into the plot.
- Road tools and bulldozing a road work on the pointer's aligned 2 × 2 **road block**.
- Raycast only on pointer move / camera change (not every frame when idle).
- Pointer outside the plot → no hover, ghost hidden.

## 3. Tool behaviour

| Tool kind | Hover | Press | Drag | Release |
| --- | --- | --- | --- | --- |
| Ground paint (road, pavement, walkway, grass, meadow) | Cell highlight + flat ghost tile (road: the whole 2 × 2 block) | Paint cell (road: its block) | Paint every cell crossed (Bresenham between samples, no gaps; road visits each block once) | Commit stroke as **one** undo step |
| Object (trees, buildings, props) | Translucent ghost model plus a rectangular frame covering the whole footprint, centred on the pointer and rotated. Mint when valid, brick red when invalid | Place if valid; else invalid feedback | Trees and lamppost scatter (place on each new valid cell). Buildings and postbox: no drag (single place) | Commit |
| Edge (fences) | Ghost fence on nearest edge | Place | Paint along a straight line of edges (axis locked by first move) | Commit |
| Bulldoze | Red highlight on what will be removed (object > edge > ground; a whole footprint or road block) | Remove (any footprint cell removes the object; a road cell clears its block) | Remove along drag | Commit |
| None (pointer) | Subtle cell highlight | Left-drag pans | — | — |

- **Rotate**: `R` (clockwise) / `Shift+R` (counter-clockwise), or the on-screen Rotate button (`intent:rotate` direction 1 = clockwise). A rotation swaps the footprint's width and depth (e.g. a 2×3 townhouse covers 3×2 at rotation 1), and the ghost re-centres on the pointer. Rotation persists until changed. The ghost animates the turn (100 ms).
- **Esc**: deselect the tool (back to pointer); with no tool, it opens the menu. Right-click never places.
- **Tool selection** (UI-owned, `src/ui/uiKeys.ts`): `1`–`9` pick the Nth tool of the **active** category, and pressing the active tool's digit again deselects it. `Shift+1`–`4` switch category (Paths / Nature / Buildings / Other). Uses `event.code`, so layouts and Shift don't change the mapping. `B` = bulldoze, `?` = controls help.
- **Undo/Redo**: `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` / `Ctrl+Y`. Every stroke is one history entry.
- Placement feedback (same frame): pop-in scale tween (easeOutBack, ~220 ms), small dust puff, SFX by category. Removal: shrink-out (~150 ms) + poof + crunch SFX.
- Invalid click: ghost shakes (±0.05, 150 ms), soft "nope" SFX, tooltip near cursor with the reason for ~1.5 s (throttled).

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
│   │ (Paths) (Nature) (Buildings) (Other)   │  [⟲ Rotate] [⌫ Bulldoze] │  category tabs + mode buttons
│   └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

- **Dock** (bottom centre): category tabs; the active category's **item tray** slides up above the tabs. An item card is a 44 px icon (the in-project render of the in-game model, `scripts/render-icons.mjs`), a short label and a number-key badge. The selected card is raised with an accent outline. Clicking the active item again deselects it.
- **Mode buttons** (right end of the dock): Rotate (shows the current rotation arrow) and Bulldoze (toggles; red accent when active).
- **Top bar**: one row. The row is 48 px tall (`--topbar-h`; 52 px on phones), so it ends 60 / 64 px below the safe-area top.
  - Left: the title mark only. v0.2 (WP-14) removed the live stats pill as redundant; `TownState.stats()` and diagnostics `town` remain for tests.
  - Right: Undo and Redo (disabled when unavailable), the sound toggle (mute), and Menu. Volume and music settings are in the menu.
- **Hint line**: a contextual one-liner for the active tool's gesture. It sits top-centre, 10 px under the top bar, fades after about 3.5 s, and stops appearing after 3 uses of that tool.
- **Cursor tooltip**: the invalid-placement reason, anchored near the pointer but never under it, and never over the dock or top bar.
- Nothing overlaps the centre of the view. The dock is ≤ 150 px tall on desktop.

### Mobile (≤ 760 px wide or `pointer: coarse`)
- The dock is full-width at the bottom (safe-area padded). The item tray scrolls horizontally with scroll-snap. Cards are 80 × 78 px with 50 px icons; at ≤ 380 px wide they shrink to 64 px and the labels are hidden.
- The top bar stays one row: the title mark (an icon-only badge at ≤ 380 px) plus the actions; undo/redo/menu remain ≥ 44 px targets. The hint pill sits 10 px under the top bar.
- One finger = tool action (tap place / drag paint); two fingers = camera. With no tool selected, one finger pans.
- Hint line mentions "two fingers to move the camera".

## 5. UI states

| State | Content | Enter / exit |
| --- | --- | --- |
| **Loading** | Title mark + progress bar (models/audio loaded / total) | App start → assets ready |
| **Title** | Big "Tiny Town" mark over the live, slowly orbiting scene. Buttons: **Start building** (primary), which reads **Continue** when a save exists; **New town**, shown only when a save exists; a small Credits link | Assets ready → user clicks. This click also unlocks audio and starts the streamed music |
| **Building** | Dock, top bar, hint line | Main state |
| **Menu** (overlay; the sim keeps rendering; music ducks −3 dB) | Resume · Controls · Reset view · Volume · **Music** on/off · **Music volume** · Show grid · New town (confirm) · Credits | ☰, or Esc when no tool is selected |
| **Confirm dialog** | "Start a new town? Your current town will be cleared." Cancel / Clear | From menu |
| **Controls help** | Two-column gesture list (mouse+keys / touch) | From menu, `?` key |
| **Error** | Friendly message if WebGL or asset loading fails, with retry | Fatal load error |

## 6. Visual language

- Panels: warm off-white `#FFF9EF` at ~92% opacity, 16 px radius, soft drop shadow, 1 px `rgba(60,40,20,.08)` border; text `#3B3A36`.
- Accents: grass green `#5DB36A` (selected/valid), sky blue `#4A9BE8` (focus/info), brick `#E0674F` (bulldoze/invalid), sun yellow `#F4C44E` (highlights). Invalid is never conveyed by colour alone — add ✕ icon / shake.
- Font: a rounded sans (e.g. Nunito via `@fontsource-variable/nunito`, OFL, bundled — no runtime CDN).
- Icons: item icons are rendered in-project from the in-game Kenney models (128 px PNG, `scripts/render-icons.mjs` + `src/render/IconStudio.ts`). UI glyphs (undo, redo, sound, menu, rotate, bulldoze, music) are inline SVG.
- Motion: 120–200 ms ease-out for hovers/presses; tray slide 180 ms; respects `prefers-reduced-motion`.
- All interactive elements: hover, pressed, focus-visible, disabled states. Tabbable in a sensible order; toolbar buttons have `aria-label`s.

## 7. State wiring rule
UI never mutates town/game state directly. It **emits intents** on the event bus and **renders facts** it receives (`src/game/events.ts`). One source of truth per concern: `TownEditor` (town + history), `ToolController` (active tool/rotation/hover), `AudioManager` (mute/volume/music, persisted through `SaveStore` settings), `UiRoot` (active dock category), `Game` (phase).
