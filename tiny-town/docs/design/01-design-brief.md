# Tiny Town — Design Brief

> Status: agreed baseline for v1, updated for v0.2 (48 × 48 grid with multi-cell buildings, background music, no stats HUD) and for the v0.3 catalog (five categories, 33 tools, 34 with the zebra crossing; in the working tree, not yet released). Changes go through the integrator (see `docs/PLAN.md`); current state: `docs/progress.md`.

## Player promise
"I start with an empty green field under a big sky and, one satisfying click at a time, grow a cosy little town that feels alive."

## Genre and scope
Relaxed **sandbox builder** (reference feel: Townscaper, Islanders, Kenney-style dioramas). The user explicitly asked for a sandbox, so there is **no fail state, no money, no timer**. That is a deliberate design choice, not a missing loop — see "Why a sandbox still needs a loop" below.

Target platforms: desktop browsers first (mouse + keyboard), mobile/tablet touch as a supported-but-secondary target (must be usable, need not be optimal).

## Core loop contract
> The player **picks a tool** and **paints/places** it on the grid to **shape their town**, while **placement rules** (roads block buildings, fences sit on edges, footprints can't overlap) create light spatial puzzles; success gives an **instant, juicy placement** (pop-in animation, dust puff, sound, auto-connecting roads); a blocked placement shows a **red ghost + gentle "nope" sound + reason tooltip**, and **undo** makes every mistake free.

Clause → proof in code (acceptance for the vertical slice):
| Clause | Proven by |
| --- | --- |
| Verb mapped to real input | Click / drag on canvas places via `ToolController`; keyboard shortcuts select tools; touch tap places |
| Objective visible | Ghost preview + cell highlight shows exactly what will happen before the click |
| Pressure (light) | Placement rules produce valid/invalid ghost states within the first minute (e.g. try to put a house on a road) |
| Reward changes state | Town state changes, roads re-tile their neighbours, save persists it (v0.2 removed the HUD stats pill; stats remain in diagnostics `town`) |
| Failure teaches | Invalid ghost is red, tooltip names the reason (e.g. `"Cottage can't go on a road"`, `"Bus stops need to be next to a road"`) |
| Fast retry | Undo/redo (Ctrl+Z / Ctrl+Shift+Z) and bulldoze |

## Why a sandbox still needs a loop
- **5–30 s repeat:** choose tool → hover → place/drag-paint → watch pop-in → adjust.
- **1–5 min change:** a street appears (roads auto-connect), houses line it, fences and lampposts dress it, trees soften it, cars start driving on it.
- **Better player does:** plans street grids, uses drag-painting, rotates buildings to face roads, layers pavement/fences/props for charm.
- **Next decision communicated by:** ghost preview, valid/invalid tint, contextual hint line, road auto-tiling preview.
- **Light "reward" hooks:** tiny ambient life that responds to what you built — cars drive on connected roads (WP-10, built), trees and meadows sway (WP-08, built), lamps glow at dusk (WP-10 stretch, not built; now part of the WP-16 day/night cycle, v0.3).

## Target feeling
Calm, tactile, cute. Every click lands with a soft "thock" and a springy pop. Nothing ever punishes the player.

## Verbs
- Primary: **place** (click) / **paint** (click-drag) the selected tool.
- Secondary: rotate (R / Shift+R), bulldoze (B / tool), undo/redo, pan/orbit/zoom camera, select tool (1–9 in the active category, Shift+1–5 or category tabs to switch category).

## Build tools (from the brief)
Grid: 64 × 64 cells of 0.5 world units (48 × 48 in v0.2, WP-12; 64 × 64 since 2026-09-28); roads paint in aligned 2 × 2 blocks. Exact footprints: `catalog/objects.ts`; drag modes: `catalog/tools.ts`.

| Category | Tools | Layer | Input |
| --- | --- | --- | --- |
| Streets | Road (cars), Pavement | ground (road = 2 × 2 block) | click-drag paint |
| Streets | Roundabout 6×6 (3 × 3 road blocks; roads join at its four arms) | object, road feature | click; snaps to the road-block grid |
| Streets | Zebra crossing (one road block of a straight, tee or crossroad) | object, road marking | click on road; snaps to the road-block grid |
| Streets | Traffic light, Bus stop 2×1 (both next to a road), Lamppost, Postbox | object | click; Lamppost also drag-scatters |
| Homes | Cottage 4×4, Townhouse 3×4, Bungalow 4×4, Family home 4×4, Suburban 4×4, Big house 5×4, Garage 1×2 | object (multi-cell footprint) | click; R rotates the footprint |
| Town | Fountain 2×2, Corner shop 3×3, Church 3×4, Supermarket 5×4, Pool 4×3 | object (multi-cell footprint) | click; R rotates the footprint |
| Nature | Grass, Wildflowers (meadow) | ground | click-drag paint |
| Nature | Bush, Pine, Birch (1×1); Oak (2×2, the big tree) | object | click, drag scatters |
| Garden | Garden path (walkway) | ground | click-drag paint |
| Garden | Hedge, Low fence, Tall fence | **edge** (sits on cell borders) | click-drag along edges |
| Garden | Planter, Bench, Barbecue 1×1, Swing 2×1 | object | click; Planter also drag-scatters |
| Modes | Bulldoze; Esc / clicking the active item again = no tool (pan) | — | click-drag |

## Non-goals for v1
Economy/money · traffic simulation · citizens walking · terrain height editing · multiplayer · cloud saves · day/night cycle (a single "golden afternoon" lighting; dusk toggle is a stretch goal; a full cycle ships in v0.3 — WP-16, `docs/plans/wp-16-day-night.md`) · custom asset import. (Background music was a v1 non-goal; v0.2 added one streamed, owner-supplied track — WP-13.)

## Art direction (one paragraph)
Bright, saturated low-poly diorama using Kenney CC0 kits (one consistent palette, flat-shaded with a shared colour atlas); since v0.3 a few Poly Pizza models (church, swing, barbecue, corner shop) fill gaps, normalised to the same flat materials. Warm afternoon key light with soft shadows, cool sky fill, a gradient sky dome with a sun halo, subtle fog for depth at the field edge. The buildable plot is a crisp grass field; beyond it the world fades into softer rolling green with scattered distant trees so the plot reads as a diorama, not a floating tile. UI is cream/white rounded panels with the models' own preview renders as icons — cosy, not a web dashboard.
