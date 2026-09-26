# Tiny Town — progress (integrator-maintained)

Only the integrator (WP-01) edits this file. Workers report in their hand-off.

## Current intent
Deliver v1 per `docs/PLAN.md` §0. Sandbox city builder; desktop first, mobile usable.

## Decisions log
- 2026-09-26 — Sandbox (no fail state/economy), per the user's brief. The core loop is place → feedback → grow; undo makes mistakes free.
- 2026-09-26 — Assets: Kenney CC0 kits (City Roads/Suburban/Industrial, Platformer, Fantasy Town, Holiday, Car) for one consistent style; Nature Kit rejected (metallic materials, clashing palette); bus stop, postbox, fences and garage composed from Kenney parts; SFX from Kenney CC0 audio packs, transcoded to MP3.
- 2026-09-26 — Grid: 24×24 plot, 1 world unit per cell, three layers (ground / object / edge). Fences live on edges.
- 2026-09-26 — No physics engine; instanced rendering; Vitest for pure logic, Playwright for browser.

## Status
| WP | Status | Notes |
| --- | --- | --- |
| Wave 0 scaffold | ✅ done | walking skeleton, contracts, assets, docs |
| WP-02 Town logic | ⬜ not started | |
| WP-03 Rendering | ⬜ not started | |
| WP-04 World & look | ⬜ not started | |
| WP-05 Interaction | ⬜ not started | |
| WP-06 UI | ⬜ not started | |
| WP-07 Audio | ⬜ not started | |
| WP-08 Feel & VFX | ⬜ wave 2 | |
| WP-09 QA harness | ⬜ 09a wave 1 / 09b wave 2 | |
| WP-10 Ambient life | ⬜ stretch | |
| WP-11 Release | ⬜ wave 3 | |

## Open defects
- The skeleton has never been rendered in a real browser: the scaffold session's nono sandbox blocks Chromium. Logic, catalog and asset loading are covered by unit tests only. See PLAN §1.

## Next actions
1. Outside the sandbox: `npm run dev`, look at it; `npm run test:e2e`; `npm run inspect:canvas -- --state asset-gallery --run-id m0 --out artifacts/m0`. Fix any blocker before fanning out.
2. Initial commit (`git add -A && git commit`, from the `ThreeJsGames/` root), then one worktree per Wave-1 WP.
3. Brief the Wave-1 workers with their `docs/PLAN.md` sections.
