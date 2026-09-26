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
| WP-03 Rendering | ✅ done (fix1 8638248, fix2 7ef0d3d: 17 icons re-rendered in-game via scripts/render-icons.mjs, postbox 2.0) | — | removed | 5203 | evidence in artifacts/wp-03/ |
| WP-04 World & look | ✅ done (b0f2947, fix1 4b61607: hedgerow frame, 3 decor calls, sun bloom, sandstone kerb) | — | removed | 5204 | evidence copied to artifacts/wp-04/wp04-fix1. Note: DecorRing imports DEFAULT_POSE + fov 35 |
| WP-05 Interaction | ✅ done (fix1 4f6d5b6, fix2 bff21b8: DEFAULT_POSE dist 35.8 target 1.83; phone dist 58.7; portrait title fit) | — | removed | 5205 | evidence in artifacts/wp-05/ |
| WP-06 UI | ✅ done (df3ed58, fix1 d3ac460: tooltip clearing, stats grouping, touch cues, hint top-centre, title layout) | — | removed | 5206 | evidence copied to artifacts/wp-06/wp06-fix1. Re-check title after WP-05 portrait pose |
| WP-07 Audio | ✅ done (bf55f1d, fixes 8e6eae3, da4063d shims removed; worktree removed) | `wp-07-audio` | `wp-07` | 5207 | all SFX rebuilt, metal prop sound, stroke pitch rise; fix-up: mute test asserts aria-pressed. Local shims in AudioManager can now go |
| WP-09a QA harness | ✅ merged (81d8a97) | `wp-09a-qa` | `wp-09a` | 5209 | smoke + build-flow specs, tests/helpers.ts; main e2e 10/10 after merge. Templates annotated, not deleted (left for 09b) |
| WP-08 Feel & VFX | ✅ done (5fd620c) | — | removed | 5208 | 2 draw calls max, 0 idle; instanced wind sway; reduced motion OK; fx diagnostics published. Shim `__THREE_GAME_FX_DIAGNOSTICS__` remains (harmless) |
| WP-09b Baselines + bot | ✅ done (3b5ff02): 6 darwin baselines committed, deterministic capture, missing baseline fails | — | removed | 5210 | |
| WP-10 Ambient life | ✅ done (9ae0d39) | — | removed | 5211 | ≤6 cars, BatchedMesh +1 main +1 shadow call, keep-right lanes, despawn on road removal; wired in Game.ts (142cd95). Dusk toggle skipped (optional) |
| WP-11 Release | ✅ done (5be9faf): base './', hidden sourcemaps, cssMinify off (lightningcss bug), preview e2e 56/12/0, final evidence (avg 2.05) | — | removed | 5212 | evidence in artifacts/final, artifacts/wp-11 |

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

## M2
✅ Passed 2026-09-26. See `docs/checkpoints/m2.md`.

## Next actions (current)
0. WP-11 merged; shims removed (bc1ae5b). M3 in progress: independent reviewer DONE (avg 2.00; blockers = the 2 known mobile UI issues + no exact 390×844 capture; inspector fixed in 8f6db9d). Polish running for margin: WP-05 fix3 (valid ghost visibility, `wp-05-ghost-fix3`), WP-08 fix1 (softer dust, `wp-08-fx-fix1`); WP-06 fix2 (mobile tooltip overlap, count-up spacing, .ui-hint centring so cssMinify can return) running on `wp-06-ui-fix2`.
   Post-v1 from M3 review: auto-orient buildings to road, crossroad tile markings, portrait dead band / mobile title crop, hint auto-fade while zoomed.
   Deferred/optional (WP-11 requests, budgets already met): shadowMap.autoUpdate=false + cars castShadow off (−17% GPU); lil-gui dynamic import (−30 kB); reuse diagnostics object; compileAsync warm-up for first-placement hitch.

1. ✅ fix2 + WP-10 merged/wired. WP-09b generating baselines now.
2. M2 notes so far: FX puff chips read slightly rock-like (tune at M3 if reviewer agrees); FX journey video is zoomed out (tune-*.png are the useful evidence).
3. Checkpoint M2 (PLAN §5), then WP-11 → M3.

## Next actions (old)
1. Wait for Wave-1 hand-offs; merge per HANDOVER §4 in order 02 → 03 → 04 → 05 → 06 → 07 (09a merged early: it was the only one ready, and its specs now gate later merges).
2. Collect contract change requests; apply after the wave's merges.
3. Checkpoint M1 (PLAN §5 + SaveStore wiring in Game.ts).
