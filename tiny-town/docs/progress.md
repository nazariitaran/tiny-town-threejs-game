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
| WP-02 Town logic | ✅ merged (13479ad) | `wp-02-town-logic` | `wp-02` | — | full rule table, History cap 200, serialize/parseSave, SaveStore (+settings), silent applyBatch; 172 unit tests; main e2e 10/10 |
| WP-03 Rendering | ✅ merged (17b8185) | `wp-03-rendering` | `wp-03` | 5203 | instanced pools; stress-town 599→21 calls; pop-in; walkway hub+arm; lamppost offset |
| WP-04 World & look | ✅ done (b0f2947, fix1 4b61607: hedgerow frame, 3 decor calls, sun bloom, sandstone kerb) | — | removed | 5204 | evidence copied to artifacts/wp-04/wp04-fix1. Note: DecorRing imports DEFAULT_POSE + fov 35 |
| WP-05 Interaction | ✅ merged (3a1498b + fix 3cd1d16) | `wp-05-interaction` | `wp-05` | 5205 | camera gestures, ghost, tool semantics, touch; fix-up: spec cells under new dock |
| WP-06 UI | ✅ done (df3ed58, fix1 d3ac460: tooltip clearing, stats grouping, touch cues, hint top-centre, title layout) | — | removed | 5206 | evidence copied to artifacts/wp-06/wp06-fix1. Re-check title after WP-05 portrait pose |
| WP-07 Audio | ✅ done (bf55f1d, fixes 8e6eae3, da4063d shims removed; worktree removed) | `wp-07-audio` | `wp-07` | 5207 | all SFX rebuilt, metal prop sound, stroke pitch rise; fix-up: mute test asserts aria-pressed. Local shims in AudioManager can now go |
| WP-09a QA harness | ✅ merged (81d8a97) | `wp-09a-qa` | `wp-09a` | 5209 | smoke + build-flow specs, tests/helpers.ts; main e2e 10/10 after merge. Templates annotated, not deleted (left for 09b) |
| WP-08 Feel & VFX | 🔄 running (wave 2) | `wp-08-fx` | `wp-08` | 5208 | |
| WP-09b Baselines + bot | 🔄 running (wave 2) | `wp-09b-qa` | `wp-09b` | 5210 | bot first; baselines NOT committed until fix-ups merge |
| WP-10 Ambient life | ⏸ held | | | 5211 | stretch; starts after the M1 fix-ups merge, if they land cleanly |
| WP-11 Release | ⬜ wave 3 | | | 5212 | |

## M0 preflight evidence (run id m0, desktop, real GPU: ANGLE Metal / Apple M2 Max, softwareRendered false)
| State | renderer.calls | triangles | textures | luminance.contrast |
| --- | --- | --- | --- | --- |
| title | 3 | 1,010 | 3 | 51.4 |
| sample-town | 210 | 14,547 | 20 | 48.7 |
| stress-town | 599 | 108,457 | 20 | 106.5 |
| asset-gallery | 85 | 16,419 | 23 | 27.9 |
No console/page errors. No blockers. Cosmetic observations routed to owners: some road pieces look mis-rotated in the gallery, thin/offset lamppost (WP-03); flat title sky with a hard seam, no terrain beyond the plot (WP-04). stress-town at 599 calls is the naive "before" for WP-03.

## Process note
- 2026-09-26: removing the wp-07 worktree with --force deleted its gitignored audio evidence (playtest-audio.wav). From now on, copy artifacts/<wp> into the main checkout before removing a worktree.

## Open defects
- (none blocking) See M0 observations above.
- tests/helpers.ts imports `UI_TEST_IDS` from `src/ui/UiRoot.ts` in Node, so UiRoot must stay importable in Node. WP-06 was told to keep the ids in a side-effect-free module.
- build-flow.spec assumes current rules (cottage on field next to road; drag = 1 undo entry). Re-check after the WP-02 merge.
- Mobile journey uses the mouse, not touch; a touch variant goes to WP-05/09b.

## M1 checkpoint (in progress)
Contract requests applied in commit after the Wave-1 merges: sfx `place-prop-metal`, gen-sfx `playbackRate`, CREDITS audio rows, Game.ts SaveStore wiring (autosave, Continue, camera pose, pagehide flush, grid setting, settings → AudioManager, autosave off in setState), `TownRenderer.settle()` on setState/reduced motion, diagnostics `save`. Scorecard + friction: `docs/checkpoints/m1.md` (avg 1.85). Independent reviewer: avg 1.6 (see m1.md). Fix-ups dispatched to WP-03/04/05/06/07 on their existing branches (fix1), in parallel with Wave 2 (WP-08, WP-09b). Worktrees wp-02 and wp-09a removed, branches deleted.

## Pending integrator work for M1 (collected contract requests) — DONE
- WP-02 → Game.ts SaveStore wiring: `hasSave: () => saves.has()`; `saves.attachAutosave(bus, () => editor.serialize(camera.getPose()))`; Continue → `editor.load(saves.read())`; `saves.flush()` on pagehide; `saves.autosaveEnabled = false` inside `setState`. Optional: `save` diagnostics (`pending`, `lastError`) in vite-env.d.ts; drop unused `'edge-occupied'` from InvalidReason in types.ts.
- WP-02 follow-up (unowned by the rule table): bus stop stays after its road is repainted away. Decide at M1.

## Next actions
1. Wait for Wave-1 hand-offs; merge per HANDOVER §4 in order 02 → 03 → 04 → 05 → 06 → 07 (09a merged early: it was the only one ready, and its specs now gate later merges).
2. Collect contract change requests; apply after the wave's merges.
3. Checkpoint M1 (PLAN §5 + SaveStore wiring in Game.ts).
