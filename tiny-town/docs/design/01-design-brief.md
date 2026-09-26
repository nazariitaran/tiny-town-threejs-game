# Tiny Town — Design Brief

> Status: agreed baseline for v1. Changes go through the integrator (see `docs/PLAN.md`).

## Player promise
"I start with an empty green field under a big sky and, one satisfying click at a time, grow a cosy little town that feels alive."

## Genre and scope
Relaxed **sandbox builder** (reference feel: Townscaper, Islanders, Kenney-style dioramas). The user explicitly asked for a sandbox, so there is **no fail state, no money, no timer**. That is a deliberate design choice, not a missing loop — see "Why a sandbox still needs a loop" below.

Target platforms: desktop browsers first (mouse + keyboard), mobile/tablet touch as a supported-but-secondary target (must be usable, need not be optimal).

## Core loop contract
> The player **picks a tool** and **paints/places** it on the grid to **shape their town**, while **placement rules** (roads block buildings, fences sit on edges, footprints can't overlap) create light spatial puzzles; success gives an **instant, juicy placement** (pop-in animation, dust puff, sound, auto-connecting roads, stats tick up); a blocked placement shows a **red ghost + gentle "nope" sound + reason tooltip**, and **undo** makes every mistake free.

Clause → proof in code (acceptance for the vertical slice):
| Clause | Proven by |
| --- | --- |
| Verb mapped to real input | Click / drag on canvas places via `ToolController`; keyboard shortcuts select tools; touch tap places |
| Objective visible | Ghost preview + cell highlight shows exactly what will happen before the click |
| Pressure (light) | Placement rules produce valid/invalid ghost states within the first minute (e.g. try to put a house on a road) |
| Reward changes state | Town state changes, roads re-tile their neighbours, HUD stats change, save persists it |
| Failure teaches | Invalid ghost is red, tooltip names the reason (`"Buildings can't go on roads"`) |
| Fast retry | Undo/redo (Ctrl+Z / Ctrl+Shift+Z) and bulldoze |

## Why a sandbox still needs a loop
- **5–30 s repeat:** choose tool → hover → place/drag-paint → watch pop-in → adjust.
- **1–5 min change:** a street appears (roads auto-connect), houses line it, fences and lampposts dress it, trees soften it. HUD stats (homes, residents, trees) climb.
- **Better player does:** plans street grids, uses drag-painting, rotates buildings to face roads, layers pavement/fences/props for charm.
- **Next decision communicated by:** ghost preview, valid/invalid tint, contextual hint line, road auto-tiling preview.
- **Light "reward" hooks (stretch, WP-11):** tiny ambient life that responds to what you built — cars drive on connected roads, lamps glow at dusk, trees sway.

## Target feeling
Calm, tactile, cute. Every click lands with a soft "thock" and a springy pop. Nothing ever punishes the player.

## Verbs
- Primary: **place** (click) / **paint** (click-drag) the selected tool.
- Secondary: rotate (R), bulldoze (B / tool), undo/redo, pan/orbit/zoom camera, select tool (1–9, category tabs).

## Build tools (from the brief)
| Category | Tools | Layer | Input |
| --- | --- | --- | --- |
| Paths | Road (cars), Pavement, Walkway | ground | click-drag paint |
| Nature | Grass, Wildflower meadow | ground | click-drag paint |
| Nature | Trees ×3 (e.g. round, pine, birch/tall) | object 1×1 | click, drag scatters |
| Buildings | Townhouse ×3, Garage, Bus stop | object (footprint from model) | click, rotate with R |
| Buildings | Tall fence, Small fence | **edge** (sits on cell borders) | click-drag along edges |
| Other | Postbox, Lamppost | object 1×1 | click |
| Tools | Bulldoze, Deselect/Pan | — | click-drag |

## Non-goals for v1
Music · economy/money · traffic simulation · citizens walking · terrain height editing · multiplayer · cloud saves · day/night cycle (a single "golden afternoon" lighting; dusk toggle is a stretch goal) · custom asset import.

## Art direction (one paragraph)
Bright, saturated low-poly diorama using Kenney CC0 kits (one consistent palette, flat-shaded with a shared colour atlas). Warm afternoon key light with soft shadows, cool sky fill, a gradient sky dome with a sun halo, subtle fog for depth at the field edge. The buildable plot is a crisp grass field; beyond it the world fades into softer rolling green with scattered distant trees so the plot reads as a diorama, not a floating tile. UI is cream/white rounded panels with the models' own preview renders as icons — cosy, not a web dashboard.
