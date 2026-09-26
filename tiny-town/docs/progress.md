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
Worktrees live in `<repo-parent>/ThreeJsGames-wt/<wp>`, branched from `9a4e084`.

| WP | Status | Branch | Worktree | Port | Notes |
| --- | --- | --- | --- | --- | --- |
| Wave 0 scaffold | ✅ done | main | — | — | walking skeleton, contracts, assets, docs |
| M0 preflight | ✅ done 2026-09-26 | main | — | 5188 | verify green (18 tests); e2e 2/2; inspect m0 clean (see below) |
| WP-02 Town logic | 🔄 running | `wp-02-town-logic` | `wp-02` | — | |
| WP-03 Rendering | 🔄 running | `wp-03-rendering` | `wp-03` | 5203 | |
| WP-04 World & look | 🔄 running | `wp-04-world` | `wp-04` | 5204 | |
| WP-05 Interaction | 🔄 running | `wp-05-interaction` | `wp-05` | 5205 | |
| WP-06 UI | 🔄 running | `wp-06-ui` | `wp-06` | 5206 | |
| WP-07 Audio | 🔄 running | `wp-07-audio` | `wp-07` | 5207 | |
| WP-09a QA harness | ✅ merged (81d8a97) | `wp-09a-qa` | `wp-09a` | 5209 | smoke + build-flow specs, tests/helpers.ts; main e2e 10/10 after merge. Templates annotated, not deleted (left for 09b) |
| WP-08 Feel & VFX | ⬜ wave 2 | | | 5208 | |
| WP-09b Baselines + bot | ⬜ wave 2 | | | 5210 | |
| WP-10 Ambient life | ⬜ stretch, wave 2 | | | 5211 | |
| WP-11 Release | ⬜ wave 3 | | | 5212 | |

## M0 preflight evidence (run id m0, desktop, real GPU: ANGLE Metal / Apple M2 Max, softwareRendered false)
| State | renderer.calls | triangles | textures | luminance.contrast |
| --- | --- | --- | --- | --- |
| title | 3 | 1,010 | 3 | 51.4 |
| sample-town | 210 | 14,547 | 20 | 48.7 |
| stress-town | 599 | 108,457 | 20 | 106.5 |
| asset-gallery | 85 | 16,419 | 23 | 27.9 |
No console/page errors. No blockers. Cosmetic observations routed to owners: some road pieces look mis-rotated in the gallery, thin/offset lamppost (WP-03); flat title sky with a hard seam, no terrain beyond the plot (WP-04). stress-town at 599 calls is the naive "before" for WP-03.

## Open defects
- (none blocking) See M0 observations above.
- tests/helpers.ts imports `UI_TEST_IDS` from `src/ui/UiRoot.ts` in Node, so UiRoot must stay importable in Node. WP-06 was told to keep the ids in a side-effect-free module.
- build-flow.spec assumes current rules (cottage on field next to road; drag = 1 undo entry). Re-check after the WP-02 merge.
- Mobile journey uses the mouse, not touch; a touch variant goes to WP-05/09b.

## Next actions
1. Wait for Wave-1 hand-offs; merge per HANDOVER §4 in order 02 → 03 → 04 → 05 → 06 → 07 (09a merged early: it was the only one ready, and its specs now gate later merges).
2. Collect contract change requests; apply after the wave's merges.
3. Checkpoint M1 (PLAN §5 + SaveStore wiring in Game.ts).
