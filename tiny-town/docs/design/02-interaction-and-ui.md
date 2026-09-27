# Tiny Town — Interaction & UI Design

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
- Distance clamped **6 → 60** world units (exact values depend on grid scale; retune after assets land).
- Target clamped to the plot bounds + 2 cells margin; damping on (`enableDamping`, factor ~0.12).
- Build start pose `DEFAULT_POSE`: 45° yaw, 52° polar, whole plot visible on desktop 1280×720.
- Title pose `TITLE_POSE`: 78° polar, low hero angle that shows the horizon, sky and sun (the build polar range never can at FOV 35°), with a slow auto-orbit and input disabled.

## 2. Pointer → grid

- A single invisible ground plane (y = 0) is raycast on `pointermove`; result is quantised to a **cell** (`{x, z}`) and, for edge tools, to the **nearest cell edge** (`{x, z, side: 'n' | 'w'}`).
- Raycast only on pointer move / camera change (not every frame when idle).
- Pointer outside the plot → no hover, ghost hidden.

## 3. Tool behaviour

| Tool kind | Hover | Press | Drag | Release |
| --- | --- | --- | --- | --- |
| Ground paint (road, pavement, walkway, grass, meadow) | Cell highlight + flat ghost tile | Paint cell | Paint every cell crossed (Bresenham between samples, no gaps) | Commit stroke as **one** undo step |
| Object (trees, buildings, props) | Translucent ghost model at footprint, rotated; green-ish when valid, red when invalid | Place if valid; else invalid feedback | Trees/props: scatter (place on each new valid cell). Buildings: no drag (single place) | Commit |
| Edge (fences) | Ghost fence on nearest edge | Place | Paint along a straight line of edges (axis locked by first move) | Commit |
| Bulldoze | Red highlight on what will be removed (object > edge > ground) | Remove | Remove along drag | Commit |
| None (pointer) | Subtle cell highlight | Left-drag pans | — | — |

- **Rotate**: `R` (clockwise) / `Shift+R` (counter-clockwise), or on-screen rotate button. (`intent:rotate` direction 1 = clockwise.) Rotation persists per tool until changed. Ghost animates the turn (100 ms).
- **Esc**: deselect tool (back to pointer). Right-click never places.
- **Undo/Redo**: `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` / `Ctrl+Y`. Every stroke is one history entry.
- Placement feedback (same frame): pop-in scale tween (easeOutBack, ~220 ms), small dust puff, SFX by category. Removal: shrink-out (~150 ms) + poof + crunch SFX.
- Invalid click: ghost shakes (±0.05, 150 ms), soft "nope" SFX, tooltip near cursor with the reason for ~1.5 s (throttled).

## 4. Screen layout (desktop 1280×720)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [🏡 Tiny Town]                                        [↶][↷] [🔊][☰] │  top bar (transparent, pills)
│                                                                      │
│                                                                      │
│                          3D  TOWN  VIEW                              │
│                                                                      │
│                                                                      │
│              "Drag to paint road · R rotate · Esc cancel"            │  hint line (fades, 1 line)
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │ [img][img][img][img]  … item tray for the active category …  │   │  item tray (cards w/ Kenney preview icon + label + key)
│   ├──────────────────────────────────────────────────────────────┤   │
│   │ (Paths) (Nature) (Buildings) (Other)   │  [⟲ Rotate] [⌫ Bulldoze] │  category tabs + mode buttons
│   └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

- **Dock** (bottom centre): category tabs; the active category's **item tray** slides up above the tabs. Item card = 64–72 px icon (Kenney preview PNG) + short label + number-key badge. Selected card: raised, accent outline. Clicking the active item again deselects.
- **Mode buttons** (right end of dock): Rotate (shows current rotation arrow), Bulldoze (toggles, red accent when active).
- **Top-left**: title mark only. v0.2 removed the live stats pill as redundant; `TownState.stats()` remains for diagnostics and tests.
- **Top-right**: Undo, Redo (disabled state when unavailable), Sound toggle (mute; long-press/hover shows volume slider), Menu.
- **Hint line**: contextual one-liner above the dock describing the active tool's gesture; hides after 3 uses of that tool.
- **Cursor tooltip**: invalid-placement reason, anchored near the pointer, never under it.
- Nothing overlaps the centre of the view; the dock is ≤ 150 px tall on desktop.

### Mobile (≤ 760 px wide or `pointer: coarse`)
- Dock is full-width at the bottom (safe-area padded); item tray scrolls horizontally (scroll-snap), icons 56 px, labels hidden for the tray when < 380 px wide (tooltip on long-press).
- The top bar stays one row: the title mark (an icon-only badge at ≤ 380 px) plus the actions; undo/redo/menu remain ≥ 44 px targets. The hint pill sits 10 px under the top bar.
- One finger = tool action (tap place / drag paint); two fingers = camera. With no tool selected, one finger pans.
- Hint line mentions "two fingers to move the camera".

## 5. UI states

| State | Content | Enter / exit |
| --- | --- | --- |
| **Loading** | Title mark + progress bar (models/audio loaded / total) | App start → assets ready |
| **Title** | Big "Tiny Town" mark over the live (slowly orbiting) scene; buttons: **Start building** (primary) or **Continue** if a save exists, **New town**, small credits link | Assets ready → user clicks (this click also unlocks audio) |
| **Building** | Dock, top bar, hint line | Main state |
| **Menu** (overlay, sim keeps rendering) | Resume · New town (confirm) · Controls help · Sound volume · Show grid toggle · Credits | ☰ / Esc when no tool |
| **Confirm dialog** | "Start a new town? Your current town will be cleared." Cancel / Clear | From menu |
| **Controls help** | Two-column gesture list (mouse+keys / touch) | From menu, `?` key |
| **Error** | Friendly message if WebGL or asset loading fails, with retry | Fatal load error |

## 6. Visual language

- Panels: warm off-white `#FFF9EF` at ~92% opacity, 16 px radius, soft drop shadow, 1 px `rgba(60,40,20,.08)` border; text `#3B3A36`.
- Accents: grass green `#5DB36A` (selected/valid), sky blue `#4A9BE8` (focus/info), brick `#E0674F` (bulldoze/invalid), sun yellow `#F4C44E` (highlights). Invalid is never conveyed by colour alone — add ✕ icon / shake.
- Font: a rounded sans (e.g. Nunito via `@fontsource-variable/nunito`, OFL, bundled — no runtime CDN).
- Icons: Kenney preview PNGs for items; inline SVG for UI glyphs (undo, redo, sound, menu, rotate, bulldoze).
- Motion: 120–200 ms ease-out for hovers/presses; tray slide 180 ms; respects `prefers-reduced-motion`.
- All interactive elements: hover, pressed, focus-visible, disabled states. Tabbable in a sensible order; toolbar buttons have `aria-label`s.

## 7. State wiring rule
UI never mutates town/game state directly. It **emits intents** on the event bus and **renders facts** it receives (`src/game/events.ts`). One source of truth per concern: `TownEditor` (town + history), `ToolController` (active tool/rotation/hover), `AudioManager` (mute/volume), `Game` (phase).
