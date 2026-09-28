# Tiny Town — Implementation Plan (hand-off)

This plan took the scaffold to a finished v1 of **Tiny Town**, a cosy sandbox city builder that runs in the browser, then to v0.2, and now to v0.3 (WP-15, in progress). It is written for implementation agents working **in parallel**. Each work package (WP) has its own files, contracts, dependencies and **verifiable acceptance checks**.

Read `CLAUDE.md` first (commands and hard rules), then `docs/progress.md` (current state), then the three design docs in `docs/design/`. To run the swarm (orchestrator prompt, worker template, branches, ports, merge runbook), see `docs/HANDOVER.md`.

> **How to read this file (updated 2026-09-27, v0.2 on `main`, v0.3 in the working tree).** Every WP here is **done and merged** except **WP-15 (v0.3), which is current and in progress**; `docs/progress.md` has SHAs and status.
>
> | Section | Status |
> | --- | --- |
> | §0 Definition of done | current: met at M3 and kept in v0.2 |
> | §1 Scaffold state | **HISTORICAL** (the v0.1 starting point) |
> | §2 How to run in parallel | current |
> | §3 Dependency graph | historical v0.1 waves, plus the v0.2 iteration |
> | §4 WP sections | **Owns** lists are current: use them for file ownership. **Tasks / Acceptance** are the contracts as they were delivered (historical); grid coordinates in v0.1 checks are on the old 24 × 24 grid. **WP-15 is current** |
> | §5 Checkpoints | historical; all passed |
> | §6 Scorecard mapping | current |
> | §7 Risks | current |
>
> Current facts (grid, rules, save, modules, diagnostics, budgets) live in `docs/design/03-architecture.md`, not here.

---

## 0. Definition of done (v1)

> Current. Met at M3 (`3f9c6cf`) and still true in v0.2. v0.2 changed the grid to 48 × 48 half-unit cells with multi-cell buildings (WP-12), added streamed background music with settings (WP-13), and removed the stats pill (WP-14). v0.3 (WP-15) replaces item 1's tool list: 33 tools in **Streets / Homes / Town / Nature / Garden** (see §WP-15 and `02-interaction-and-ui.md`).

A player opens the page, sees a sunny empty field under a sky, clicks **Start building**, and can:

1. Select any of the 17 tools from a dock grouped as **Paths / Nature / Buildings / Other**: road, pavement, walkway, grass, wildflower meadow, 3 trees, 3 townhouses, garage, bus stop, tall fence, low fence, postbox, lamppost. Bulldoze is also available.
2. See a ghost preview (green when valid, red with a reason when not), click or drag to place, and press **R** to rotate.
3. Watch roads auto-connect (straights, corners, T-junctions, crossroads, dead ends), fences follow cell edges, and buildings pop in with a sound and a dust puff.
4. Undo/redo any stroke, bulldoze anything, pan/orbit/zoom the camera with mouse, keyboard or touch, and mute sound.
5. Reload the page and continue the same town (autosave), or start a new one.

It must also meet these quality gates:
- Budgets in `docs/design/03-architecture.md` (≤ 150 draw calls in the `stress-town` state on desktop).
- No console errors in any Playwright run.
- Desktop 1280×720 and mobile 390×844 screenshots with no UI overlap or clipping.
- Visual scorecard average ≥ 2.0, with no category below 2 in Art direction, World and UI (see §6). This is a "polished small game" bar, not a AAA showcase.

## 1. What the scaffold already gave you (walking skeleton)

> **HISTORICAL (v0.1 scaffold, before M0). Don't use this section as current fact.**
> - Everything marked 🟡 or ⬜ was replaced by its WP.
> - The "NOT verified / first integrator action" block was resolved at M0 (`bf77054`): the game renders in real Chromium.
> - The repo has full history; there is no "nothing committed" state.
> - The asset facts below are sourcing-era values; the 24 × 24 grid, 1-cell sizes, scales and 64 px icons are superseded. For current values see `docs/assets/models.md` §Grid and scale, `03-architecture.md` and `docs/release.md`.

| Area | State | Files |
| --- | --- | --- |
| Tooling | ✅ Vite + TS strict + three r184, Vitest, Playwright, canvas inspector, `npm run verify` | `package.json`, `vitest.config.ts`, `playwright.config.ts`, `scripts/` |
| Assets | ✅ 44 CC0 GLBs (2.1 MB), 44 icons (64 px), 21 SFX (88 KB), all Kenney-derived, documented with licences | `public/assets/**`, `docs/assets/{models,audio}.{json,md}`, `docs/assets/CREDITS.md` |
| Contracts | ✅ event bus, data model, grid helpers (tested), config, tool/object/model catalogs, SFX ids | files marked `CONTRACT FILE` |
| Town data | ✅ `TownState` complete · 🟡 rules/history/editor baseline | `src/town/` |
| Rendering | 🟡 loads GLBs; naive (non-instanced) renderer; road auto-tile logic (tested) | `src/render/` |
| World | 🟡 gradient sky, sun + hemisphere light, flat plot, grid lines | `src/world/Environment.ts` |
| Interaction | 🟡 MapControls camera, ground picker, click/drag paint, R/Esc/Ctrl+Z | `src/interaction/` |
| UI | 🟡 plain functional title/dock/topbar | `src/ui/UiRoot.ts`, `src/styles.css` |
| Audio | 🟡 Web Audio manager plays the sourced SFX on bus events | `src/audio/` |
| FX | ⬜ stub | `src/fx/` |
| Test hooks | ✅ `setState`: `title`, `empty-build`, `sample-town`, `active-play`, `asset-gallery`, `stress-town`; `cellToClient`; diagnostics | `src/game/Game.ts` |

🟡 marks a **baseline** implementation. It works end to end, but its owning WP is expected to replace or extend it. Each baseline file's header lists its TODOs.

Run `npm run dev` and open http://127.0.0.1:5188 to see it. Add `?debug` for tuning panels.

**Verified in the scaffold session:**
- `npm run verify` passes (tsc strict, 18 unit tests, production build).
- `src/catalog/catalog.test.ts` loads **every** GLB through three's real `GLTFLoader` in Node and checks, at registry scale/rotation: road and pavement tiles are 1×1, fences are 1 cell long, and objects fit their footprint.
- `src/town/sampleTown.test.ts` builds the sample, gallery and stress towns through the real editor and rules. The sample town has zero rejections and undoes as one entry.

**NOT verified: nothing has been rendered in a real browser yet.** The scaffold session ran inside a nono sandbox that denies Chromium's profile paths, so Chromium segfaults on launch; the model-sourcing agent hit the same wall. Its CPU-rendered previews (`docs/assets/models-*.png`) show the assets, not the game. **First integrator action (before Wave 1):**
1. Outside the sandbox, run `npm run dev` and open the page.
2. Run `npm run test:e2e`. `tests/visual.spec.ts` loads the page, clicks Start, selects Road and drags a road through real mouse input.
3. Run `npm run inspect:canvas -- --state asset-gallery --run-id m0 --out artifacts/m0` and look at the screenshot.

Expect small calibration fixes (model `rotationOffset`s, lamppost centring, exposure). Those belong to WP-03/WP-04, but blockers (blank canvas, load errors) are the integrator's to fix before fanning out.

### Asset facts every WP should know
(Full detail: `docs/assets/models.md`, `docs/assets/audio.md`.)
- One style: Kenney City Kit Roads, Suburban and Industrial; Platformer Kit (round trees, flowers, grass tufts); Fantasy Town; Holiday; Car Kit. The Nature Kit was **rejected** (fully metallic materials render near-black, and its palette clashes).
- **Composed models** (no kit had them): `composed/bus-stop.glb` (canopy + bench + sign), `composed/postbox.glb` (a primitive red pillar box, the weakest asset and a candidate for a better authored one), `composed/fence-*.glb`, and `composed/garage.glb` (re-centred industrial building). Rebuild with `node scripts/compose-models.mjs`.
- Kenney city/industrial models face **−Z** natively, so the registry uses `rotationOffset: 2`. Native road connections: straight W+E, corner W+S, tee W+E+S, end E. The registry rotates them onto `roadTiles.ts`'s canonical set.
- Scales: houses/garage 0.75, platformer trees 0.36, scatter flowers/tufts 0.35, lamppost 0.9, cars 0.14. Road and pavement tile tops sit at y = 0.02.
- The lamppost's pole is at the native origin with the arm overhanging, so bbox-centring shifts the pole off-centre. WP-03 should verify it and fix it with `offset`.
- Kit colours: pavement `#a0a8c9`, walkway slab `#747990`, greens `#4ab480`/`#3da679`. The plot field (`#8cc063`) is warmer than the kit greens. **WP-04 owns harmonising the field and ground palette.**
- Extras already shipped but unused: 4 cars (`models/cars/`), bench, rocks, bush, walkway path pieces, roof-colour texture variants, `road-crossing`, `road-driveway`, `garage-row` (2×1), `fence-small-gate`, `lamppost-classic`.
- Icons are 64×64 PNG previews. Original high-res Kenney previews are in `assets-src/<kit>/Previews/` if WP-06 needs crisper retina icons.
- SFX: all Kenney CC0 audio, mono MP3, 54–447 ms, peaks ≤ −1.7 dBTP. The files were chosen by measurement and **not yet listened to** (WP-07).

## 2. How to run this in parallel

- **One integrator** (WP-01) owns the contract files, `src/game/Game.ts`, merges, and the checkpoint verifications. Everyone else is a worker.
- **Isolation:** each worker runs in its own git worktree/branch (`wp-02-town-logic`, …) and only edits the files listed under *Owns*. File ownership is disjoint by design, so merges should be conflict-free apart from `package.json`/`package-lock.json`. On conflict, the integrator re-runs `npm install`.
- **Contracts are frozen during a wave.** If a worker needs a contract change (a new event, catalog field or hook), they write it under *Contract change requests* in their hand-off. They may add a **local, clearly marked** shim inside their own files meanwhile. The integrator applies the change at the checkpoint.
- **Hand-off** = the checklist in `CLAUDE.md`: what was built, the acceptance checks with their output, the files changed, and any contract requests.
- **Ports:** the dev server (5188, `strictPort`), Playwright, the canvas inspector and `render-icons` all read the `PORT` env var. Each worker gets its own port (`PORT=52xx npm run dev` / `test:e2e` / `inspect:canvas`). `vite preview` uses `PORT − 1000`. Port assignments so far are in `docs/HANDOVER.md` §3; the next free port is 5215.
- Recommended concurrency: up to **6 workers**. They are independent, but more agents means more integration load.
- **Worktree evidence:** `artifacts/` is gitignored. Copy `artifacts/<wp>/` into the main checkout **before** `git worktree remove --force`; WP-07's audio evidence was lost that way.
- **Delegated contracts:** for a cross-cutting change the integrator may delegate named contract files to one WP, as it did for WP-12. The WP section must list them.

## 3. Dependency graph

> Historical v0.1 waves, all done. v0.2 ran WP-12, WP-13 and WP-14 in parallel (WP-13 and WP-14 merged first), and the integrator regenerated the baselines once all three were in. v0.3 is one package, WP-15, built by the integrator on the `main` working tree.

```
Wave 0 (done) ── scaffold, assets, contracts, walking skeleton
   │
   ├─ Wave 1 (all parallel, start immediately) ─────────────────────────────┐
   │   WP-02 Town logic & persistence      (pure TS, Vitest)                │
   │   WP-03 Rendering: instancing, road tiles, pop-in                      │
   │   WP-04 World & look: sky, light, terrain, grid overlay                │
   │   WP-05 Interaction: camera, tools, ghost, touch                       │
   │   WP-06 UI: dock, top bar, title, menu, mobile                         │
   │   WP-07 Audio polish                                                   │
   │   WP-09a QA harness: smoke + real-input E2E on the skeleton            │
   │                                                                        │
   ├─ Checkpoint M1 "vertical slice" (integrator) ◄─────────────────────────┘
   │
   ├─ Wave 2 (parallel)
   │   WP-08 Feel & VFX (dust, sparkle, tree sway, hud juice)   needs WP-03 pools
   │   WP-10 Ambient life (stretch: cars on roads, dusk lamps)  needs WP-03, WP-04
   │     (dusk lamps not built; superseded by WP-16 day/night, v0.3)
   │   WP-09b Visual baselines + bot playtest                   needs M1 look
   │   Fix-up tasks from the M1 review (assigned back to the owning WP)
   │
   ├─ Checkpoint M2 "feature complete" (integrator)
   │
   └─ Wave 3: WP-11 Release, performance & final evidence  →  M3 "v1"
```

---

## 4. Work packages

Each WP lists **Owns** (the only files it may edit), **Reads** (contracts it builds against), **Depends on**, **Skills** to load, **Tasks**, and **Acceptance checks**. A WP is done only when every check has been run and its output reported. Every WP also runs `npm run verify`, which must pass.

> **Status: every WP below is done and merged** (SHAs in `docs/progress.md`). The **Owns** lists were updated on 2026-09-27 to match the files that exist now. A future change to those files goes to the listed owner or to a new WP.
> - **Tasks** and **Acceptance** are the original contracts, kept for the record.
> - Cell coordinates in v0.1 checks (e.g. "road from (2,12) to (12,12)") refer to the old 24 × 24 grid; WP-12 re-mapped the specs to (2x, 2z).
> - Removed since: the stats HUD (`StatsHud`, WP-14) and `tests/*.template.ts` (deleted by WP-09b).

### WP-01 — Integrator (continuous)
- **Owns:** the contract files, `src/game/Game.ts`, `src/main.ts`, `src/core/Loop.ts`, `index.html`, `package.json`/`package-lock.json`, `vitest.config.ts`, `tsconfig.json`, `scripts/inspect-threejs-canvas.mjs`, `scripts/gen-sfx-table.mjs`, `docs/**` and `CLAUDE.md`.
  - Contract files: `src/game/events.ts`, `src/game/config.ts`, `src/catalog/**`, `src/town/types.ts`, `src/town/grid.ts`, `src/audio/sfx.ts`, `src/vite-env.d.ts` (diagnostics and hook types), plus the generated `src/audio/sfxTable.ts` (regenerate with `npm run gen:sfx`).
  - **Delegation:** for WP-12 the integrator delegated `config.ts`, `types.ts`, `grid.ts`, `objects.ts`, `models.ts` (and comment/hint-only edits to `tools.ts` and `vite-env.d.ts`) to WP-12, and took them back after the merge.
- **Tasks:** create worktrees; brief workers with their WP section; merge hand-offs; apply contract change requests; run the checkpoint verifications (§5); keep `docs/progress.md` up to date (the only shared status file; workers don't edit it).
- **Acceptance:** every checkpoint's checks pass on the merged main branch, and `docs/progress.md` is up to date.

### WP-02 — Town logic & persistence
- **Owns:** `src/town/TownState.ts`, `rules.ts`, `History.ts`, `TownEditor.ts`, `serialize.ts` (save format; v0.3 removed the v1→v2 migration), `sampleTown.ts`, `src/persistence/**`, all `src/town/*.test.ts`. (`src/town/fixtures/**` and `migration.test.ts` were deleted in v0.3.)
- **Reads:** `town/types.ts`, `town/grid.ts`, `catalog/objects.ts`, `game/events.ts`.
- **Depends on:** nothing. **Skills:** `threejs-gameplay-systems` (read "Design first" and "Build").
- **Tasks:**
  1. Implement the full placement rule table in `03-architecture.md §Placement rules`, with a player-facing message for every rejection. `no-change` must stay silent.
  2. Road painting removes fences on edges shared with adjacent road cells, in the same change list so it undoes together. Keep the **primary change last** in every change list: `TownEditor` derives `build:placed`/`build:removed` (layer, kind, world position) from the last change.
  3. `History`: cap at 200 entries; clear on load/reset. `TownEditor.apply` inside a stroke must not emit `history:changed` per cell.
  4. `serialize.ts`: `serializeTown(state, cameraPose?) → SavedTownV1` (now `SavedTown` = `SavedTownV2`), `parseSave(unknown) → SavedTownV1 | Error` (validate every field, clamp to plot size, drop unknown kinds), with a migration hook keyed on `version`.
  5. `TownEditor.load(save)`: replace state, emit `town:changed` with cause `'load'` and a full change list, clear history. Add `applyBatch(actions, {silent})` so sample towns and loads don't fire per-item `build:placed` (no sound/FX spam).
  6. `persistence/SaveStore.ts`: `has()`, `read()`, `write(save)`, `clear()`, debounced autosave (1 s after `town:changed`, cause ≠ `'load'`). Handle quota and JSON errors without throwing. Expose settings get/set for mute/volume/grid (key `SETTINGS_STORAGE_KEY`; WP-13 later added `music`/`musicVolume`).
  7. `sampleTown.ts`: keep `buildSampleTown` using every tool at least once, with zero rejections (return the list; tests assert it's empty).
- **Acceptance checks:**
  - `npm run test:unit` has ≥ 1 test per rule-table row (valid and invalid case), plus: undo of a 50-cell drag stroke restores a deep-equal state snapshot; redo re-applies it; the sample town round-trips `serialize → JSON → parseSave → load` to an identical snapshot; corrupted/foreign JSON is rejected without throwing; road paint removes the in-between fence and undo restores it.
  - `buildSampleTown(editor).rejected` is `[]` (unit test).
  - Stats: after the sample town, `stats()` matches hand-computed values (unit test).
  - The integrator can wire `SaveStore` into `Game.ts` using only the documented API.
- **Out of scope:** any three.js/DOM code.

### WP-03 — Rendering: models, instancing, road tiles, pop-in
- **Owns:** `src/render/**` (`ModelLibrary`, `TownRenderer`, `InstancePool`, `tween`, `roadTiles` (logic changes must keep its tests green), and the offline `IconStudio.ts`), `scripts/inspect-models.mjs`, `scripts/render-icons.mjs`, `scripts/compose-models.mjs`, `public/assets/models/**`, `public/assets/icons/**`, and numeric tuning of `catalog/models.ts` (`scale`, `rotationOffset`, `offset`; tell the integrator in the hand-off). `docs/assets/models.json` is hand-maintained: never write `inspect:models --json` over it.
- **Reads:** `catalog/*`, `game/config.ts`, `town/types.ts`, `docs/assets/models.md`.
- **Depends on:** nothing (use the `asset-gallery`, `sample-town` and `stress-town` states). **Skills:** `threejs-aaa-graphics-builder` (`references/asset-import.md`, `technical-art.md`), `threejs-debug-profiler`.
- **Tasks:**
  1. **Orientation calibration:** in the browser console run `await __THREE_GAME_TEST_HOOKS__.setState('asset-gallery')`, or capture it with `inspect:canvas --state asset-gallery`. The layout is documented in `buildAssetGallery`, and a unit test proves each cluster centre has its intended mask. Every road piece connects correctly for all 16 masks; every object's front (door) faces +z at rotation 0; fences sit exactly on cell edges. Fix via `catalog/models.ts` numbers only.
  2. `ModelLibrary`: share one material per source texture across all models (Kenney kits use a colour atlas), set texture colour space/anisotropy, merge each model's meshes per material, and record per-model triangle counts. Honour `ModelSpec.sway` by giving swaying models their own material clone and calling `applyWindSway(material)` from `src/fx/windSway.ts`. That util is a no-op stub now; WP-08 fills it.
  3. `TownRenderer`: `InstancedMesh` pools keyed by model part, with capacity doubling and swap-remove freeing. Incremental updates only; road neighbours re-tile.
  4. Pop-in on add (scale 0 → 1.08 → 1 with easeOutBack, ~220 ms, per instance), shrink-out on remove (~150 ms). No animation when `cause` is `'load'` or `'reset'`. Durations are tunable via `debug.folder('Render')`.
  5. Variants: per-object `variant` picks a model from `ObjectDef.models`. Trees also get a deterministic scale/rotation jitter from `hash(id)`. Don't use the RNG here: it must be stable across reloads.
  6. Ground visuals. Meadow: an instanced `meadow-flowers`/`meadow-flowers-tall`/`grass-tuft` scatter (deterministic per cell). Grass: a slightly raised lawn tile with a soft edge so painted lawns read against the field. Walkway: `walkway-hub` plus a `walkway-arm` towards each walkway/pavement neighbour (the model ids are already registered). WP-03 owns the ground-tile colours in `GROUND_MODELS`. WP-04 owns the plot field and terrain colours; both harmonise with the kit greens (`#4ab480`/`#3da679`), and the integrator reconciles at M1.
  7. Extend `TownRenderer.getDiagnostics()` (already published as diagnostics `render`) with `instances`, `pools` and `drawCallsEstimate`. Keep `objects`, `groundTiles` and `edges` counting what is actually drawn.
- **Acceptance checks:**
  - Screenshot of `asset-gallery` (desktop): all 16 road masks visibly correct (list each mask → piece in the hand-off); every building's front faces the camera; fences are on edges.
  - `npm run inspect:canvas -- --state stress-town --run-id wp03 --out artifacts/wp03` reports `renderer.calls ≤ 150` and triangles ≤ 400k. Report before/after numbers against the naive baseline.
  - Placing 100 road cells in one drag keeps frame time under 16 ms (measure via diagnostics or the Performance panel; report the method).
  - Undo/redo after pop-in leaves no orphaned instances: diagnostics `render.objects === objects` and `render.edges === town.fences` after a place → undo → redo sequence.
  - `npm run verify` passes.

### WP-04 — World & look (sky, light, terrain, grid overlay)
- **Owns:** `src/world/**`, `src/core/Renderer.ts`.
- **Reads:** `game/config.ts`, `docs/design/01-design-brief.md` (art direction).
- **Depends on:** nothing. **Skills:** `threejs-aaa-graphics-builder` (read `visual-scorecard.md`, `authoring-recipes.md`, `shader-cookbook.md`: Gradient Sky Dome, contact shadows, renderer/env map).
- **Tasks:**
  1. Sky dome with sun disc and halo matching the sun light direction, plus soft stylised clouds (billboards or cheap noise in the dome shader; one draw call each).
  2. Lighting: a warm key sun with a shadow frustum fitted to the plot; hemisphere fill; a `RoomEnvironment` PMREM env map at low intensity for gentle speculars. Tune exposure and tone mapping against `sample-town`. Shadow acne and peter-panning must be gone.
  3. Terrain: the plot reads as a diorama. Add a subtle soil/kerb border and surrounding meadow with gentle undulation beyond the plot (never inside it). Add a ring of instanced distant trees and bushes (`tree-a`, `tree-b`, `decor-bush`, `decor-rocks` from `ModelLibrary`, built in `Environment.populate(library)`, which `Game` calls after loading; ≤ 4 draw calls), with fog blending into the horizon colour.
  4. Grid overlay: shader-based lines that fade with camera distance and appear only in build phase (`setGridVisible`). Keep them subtle (≤ 20% opacity), with no z-fighting against ground tiles.
  5. `setQuality('high'|'low')`: low drops the shadow map to 1024 and disables the env map. `Game` already picks the tier (coarse pointer = low), applies `MAX_DPR[tier]`, and publishes diagnostics `quality`.
  6. Title look: `TITLE_POSE` (polar 78°) is the only pose that shows the horizon; the build camera's 30–70° polar range never does. Make the title shot the showcase for sky, sun halo and clouds, and let the sky colour tint the fog/horizon seen in build view.
- **Acceptance checks:**
  - `inspect:canvas` on `sample-town` desktop and mobile: `luminance.contrast ≥ 60`, `colorEntropyBits ≥ 3`, `dominantColorShare ≤ 0.6` (cite values).
  - Screenshot of `title` shows sky, sun halo, horizon and the plot as a diorama. `sample-town` shows a readable plot edge and surrounding terrain (no void or hard cut-off) at the build camera.
  - Environment draw calls ≤ 12, measured as diagnostics `renderer.calls` in the `empty-build` state (town empty, so it is environment plus grid).
  - Scorecard self-assessment for Art direction, World, and Lighting with one line of evidence each (target ≥ 2).

### WP-05 — Interaction: camera, tools, ghost, touch
- **Owns:** `src/interaction/**` (`CameraController`, `framing.ts` (aspect-aware build/title poses and HUD insets), `GridPicker`, `ToolController`, `GhostPreview`, `keyboard.ts`, `strokeMath.ts`), `tests/interaction.spec.ts`.
- **Reads:** `catalog/tools.ts`, `town/types.ts`, `town/grid.ts`, `game/config.ts`, `game/events.ts`, `render/ModelLibrary.ts` (`createObject` API only).
- **Depends on:** nothing (the baseline editor works). **Skills:** `threejs-gameplay-systems` (`references/game-feel.md`), `threejs-game-ui-designer` (touch section of `references/ui-patterns.md`).
- **Tasks:**
  1. `CameraController`: the full gesture table from design doc §1. Includes WASD/arrow pan (frame-rate independent), Q/E animated 45° orbit, zoom-to-cursor, clamps, and a reset tween. (`getPose()`/`setPose()`, `setMode('title'|'build')`, `reset()` and `TITLE_POSE` already exist; keep their signatures.) Title mode: slow auto-orbit, no input. With a tool active, one finger = tool and two fingers = camera; with none, one finger pans.
  2. `GhostPreview` (new, built from the `ModelLibrary` already passed to `ToolController`): a translucent model of the selected tool at the hovered cell/footprint/edge, tinted valid (soft white-green) or invalid (red). It follows the cursor with a light lerp, animates rotation over 100 ms, shakes on an invalid click, and hides off-plot or in non-build phases. Ground tools show a flat tinted tile. Bulldoze highlights what will be removed.
  3. Tool semantics per design doc §3: `paint` (gap-free), `scatter` (each new valid cell), `single` (click only), `line` (edges along one axis locked by the first movement). Bulldoze passes an edge only when the pointer is within 0.3 cell of it.
  4. Shortcuts (1–9 belong to WP-06, which owns the active category): B bulldoze; R / Shift+R rotate; Esc deselect (with no tool, emit `intent:open-menu`); F/Home reset camera; Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl+Y.
  5. Robustness: `pointercancel`, `lostpointercapture`, window blur and `visibilitychange` all end strokes. Right-click never builds. Ignore keyboard shortcuts while focus is in inputs.
  6. Throttle `build:invalid` to at most one per 400 ms per reason.
- **Acceptance checks:**
  - A Playwright spec, `tests/interaction.spec.ts` (owned by this WP), drives **real mouse input** using `cellToClient`:
    - drag road from (2,12) to (12,12): 11 road tiles, diagnostics `history.undoDepth` +1;
    - place a townhouse at a valid cell, then on a road cell: rejected, diagnostics `invalidCount` +1;
    - R rotates the ghost (diagnostics `rotation`);
    - fence drag along 4 edges gives 4 fences;
    - bulldoze removes them;
    - Ctrl+Z restores.
  - On the `mobile-chrome` project: a tap places. A two-finger pan, driven with CDP `Input.dispatchTouchEvent` (`page.context().newCDPSession(page)`), moves diagnostics `camera.targetX/Z` without placing anything.
  - Pointer released outside the window leaves no stuck stroke (the next click starts a new undo entry).

### WP-06 — UI
- **Owns:** `src/ui/**` (`UiRoot.ts`, `testIds.ts` (`UI_TEST_IDS`, side-effect free), `uiKeys.ts`, `glyphs.ts`, `ui.css`), `src/styles.css`, `public/assets/ui/**`, the UI font dependency, `tests/ui.spec.ts`. (`StatsHud.ts` was deleted in v0.2 by WP-14.)
- **Reads:** `game/events.ts`, `catalog/tools.ts`, `town/types.ts` (`TownStats`), `docs/design/02-interaction-and-ui.md` (§4–§7).
- **Depends on:** nothing. **Skills:** `threejs-game-ui-designer` (read `references/ui-patterns.md` fully).
- **Tasks:**
  1. Build the layout and every state in design doc §4–§5: loading, title (Start/Continue/New town), building (dock with category tabs and item tray, mode buttons, top bar with stats/undo/redo/sound/menu, hint line, cursor tooltip for `hover:changed.reason` and `build:invalid`), menu, confirm dialog, controls help, and error.
  2. Visual language from §6: bundled rounded font (`@fontsource-variable/nunito`), SVG glyphs for UI icons, Kenney preview PNGs for items, cream panels, and hover/pressed/focus-visible/disabled states. Respect `prefers-reduced-motion`.
  3. Mobile layout (≤ 760 px or coarse pointer): full-width dock, horizontally scrolling tray with scroll-snap, ≥ 44 px targets, safe areas.
  4. Number keys: 1–4 switch category and 1–9 select tools in the active category (UI owns category state; emit `intent:select-tool`). Coordinate nothing with WP-05, which doesn't handle digits. *(As built: `Shift+1–4` switch category and `1–9` pick a tool in the active category, pressing the active tool's digit again deselects it; see `src/ui/uiKeys.ts`.)*
  5. Emit `ui:sfx` (`ui-hover` on pointerenter for dock items, `ui-click` on press, `ui-open`/`ui-close` for the tray and menu).
  6. HUD juice: stats count up; a number punch when a stat changes. *(Delivered in v0.1; the stats pill was removed in v0.2 by WP-14.)*
  7. Handle the menu via `intent:open-menu`/`intent:close-menu`. `Game` switches phase `building` ⇄ `menu`, and Esc with no tool emits open-menu from WP-05.
  8. Keep `UI_TEST_IDS` stable (add new ids and list them in the hand-off).
- **Acceptance checks:**
  - `tests/ui.spec.ts` (owned by this WP):
    - for every category, after clicking `cat-<category>`, every tool button in it exists, and selecting it sets diagnostics `tool` (buttons only exist while their category is active);
    - undo/redo disabled states follow history;
    - the mute toggle flips diagnostics `audio.muted`;
    - the menu opens and closes, and "New town" asks for confirmation.
  - Screenshots in the `stress-town` state (largest real stats) at 1280×720, 1024×768, 390×844 and 360×640, with the Buildings tray open (longest label "Family home"): no overlap or clipping. Stat numerals are fixed-width and reserve 4 digits (`min-width: 4ch`, tabular-nums). Attach them.
  - Keyboard-only: Tab reaches every dock button with a visible focus ring.
  - The dock is ≤ 150 px tall on desktop and never covers the plot centre at the default camera.

### WP-07 — Audio polish
- **Owns:** `src/audio/AudioManager.ts`, `src/audio/MusicPlayer.ts` (added by WP-13), `public/assets/audio/**`, `public/assets/music/**`, `docs/assets/audio.*`, `tests/audio.spec.ts`. If you change `audio.json`, list it as a contract change so the integrator runs `npm run gen:sfx`.
- **Reads:** `audio/sfx.ts`, `game/events.ts`, `persistence` settings API (WP-02; use a local shim until merged).
- **Depends on:** nothing. **Skills:** `threejs-gameplay-systems/references/audio-integration.md`.
- **Tasks:**
  1. Persist mute/volume. Suspend the context on `visibilitychange` hidden and resume on visible. Surface decode errors once via `console.warn`, never throwing.
  2. During drag-paint, rate-limit to ≤ 1 placement sound per 60 ms and rise pitch by +2% per consecutive placement in a stroke (reset on stroke end). Use `build:placed.strokeIndex`.
  3. **Listen-test every SFX** in the browser and swap weak fits. The sourcing agent flagged `place-prop` (wood, too dull for lamppost/postbox → consider `impactMetal_light`), `remove` (may be too light), and `rotate`. Originals are in `assets-src/` (regenerate with `assets-src/audio-tools/build_audio.py`).
  4. Keep UI sounds quieter than placement sounds (current gains are documented in `audio.md`).
- **Acceptance checks:**
  - `tests/audio.spec.ts` clicks Start, confirms diagnostics `audio.unlocked === true` and `audio.loaded ≥ 13`, and sees no decode warnings in the console.
  - Placing 30 road tiles in one drag raises diagnostics `audio.starts` by ≥ 10 and ≤ 30. The hand-off notes each swapped file and why.

### WP-08 — Feel & VFX (Wave 2)
- **Owns:** `src/fx/**`, `tests/fx.spec.ts`.
- **Depends on:** M1 (WP-03 pools/materials, WP-05 ghost). **Skills:** `threejs-gameplay-systems/references/game-feel.md`, `threejs-aaa-graphics-builder/references/shader-cookbook.md` (wind sway, cheap tricks).
- **Tasks:** pooled dust puff on place (scaled by category: path small, building large); a "poof" and a few debris chips on remove (sized by `build:removed.layer`/`kind`); a small leaf/petal burst for nature; a subtle sparkle ring when a building completes; wind sway for trees and meadow (`applyWindSway`, instancing-aware per the cookbook). Include a reduced-motion fallback, seeded RNG only, ≤ 3 draw calls for all FX, and zero per-frame allocations.
- **Acceptance checks:** `tests/fx.spec.ts` records a short Playwright video (`recordVideo`) of placing a road stroke, a house and a tree, then bulldozing, attached and described; FX draw calls ≤ 3 (diagnostics before/after); `setReducedMotion(true)` freezes sway and hides particles (screenshot diff stable across two captures).

### WP-09 — QA harness (09a in Wave 1, 09b in Wave 2)
- **Owns:** `tests/**` (`helpers.ts`, `smoke`, `build-flow`, `visual`, `visual-regression` + its `-snapshots/`, `bot-playtest`) except `interaction.spec.ts` (WP-05), `ui.spec.ts` (WP-06), `audio.spec.ts` (WP-07), `fx.spec.ts` (WP-08) and `life.spec.ts` (WP-10); also `playwright.config.ts`. The integrator regenerates baselines after approved look changes. Projects: `desktop-chrome` and `mobile-chrome`, both full Chromium.
- **Skills:** `threejs-qa-release` (all three references).
- **09a tasks (skeleton, Wave 1):**
  - `tests/smoke.spec.ts`: the page loads with zero console/page errors; phase reaches `title`; clicking `#btn-start` gives `building`; every `setState` name is acknowledged; unknown states throw.
  - `tests/build-flow.spec.ts`: a real-input journey (select road → drag → place house → undo → redo → bulldoze) asserting diagnostics town stats at each step.
  - `tests/visual.spec.ts` already does load → Start → select Road → real mouse drag → assert road tiles. Keep it as the smoke journey, and adapt or delete the `tests/*.template.ts` files (done: WP-09b deleted them in `09adbfa`).
- **09b tasks (Wave 2):**
  - `tests/visual-regression.spec.ts`: baselines for `title`, `sample-town` and `asset-gallery` on desktop and mobile (seeded, paused, reduced motion).
  - `tests/bot-playtest.spec.ts`: a builder bot that for 200 steps picks a random tool (seeded), clicks/drags random cells via `cellToClient`, and occasionally undoes. Assert no errors, frames advance, placements ≥ 50, diagnostics `render.objects === objects` at the end, and no stuck stroke. Report the metrics JSON.
- **Acceptance checks:** `npm run test:e2e` green on both projects, with the run output and metrics JSON attached.

### WP-10 — Ambient life (stretch, Wave 2)
- **Owns:** `src/life/**` (`TrafficSim`, `lanePaths`, `LifeSystem`, `life.test.ts`), `tests/life.spec.ts`. Delivered: cars (the dusk toggle was not built).
- **Depends on:** WP-03, WP-04. Needs a contract request for the integrator to instantiate it in `Game.ts`.
- **Tasks:**
  - Up to 6 Kenney cars wander the connected road graph, choosing at intersections. Four are already shipped in `public/assets/models/cars/` (scale 0.14, facing −Z); more are in `assets-src/car-kit`, and any you add must be documented. They despawn when their road is removed and never drive through buildings.
  - Optional "dusk" toggle: sky and light lerp, and lampposts gain an emissive glow with a small point-light budget (≤ 4 real lights; the rest emissive only). *Not built; superseded by WP-16 (full day/night cycle, no real point lights).*
- **Acceptance:** a 10 s video of cars following a sample-town loop; bulldozing a road under a car removes it cleanly; draw calls +≤ 6.

### WP-11 — Release, performance & evidence (Wave 3)
- **Owns:** `vite.config.ts`, `artifacts/**` (gitignored, local-only; including `artifacts/evidence.json`), `docs/release.md`.
- **Skills:** `threejs-qa-release` (release pass), `threejs-debug-profiler` (profiling order), director `references/evidence-manifest.md`.
- **Tasks:**
  - Production build and `npm run preview` tested (not only dev).
  - Relative `base` so it works on static hosting (e.g. GitHub Pages). Every runtime URL already goes through `assetUrl()`; grep for any new absolute `/assets/` use. Check debug gating (lil-gui only with `?debug`, and no test hooks affecting players).
  - Bundle review (three tree-shaking; code-split if > 900 kB).
  - Profile `stress-town` on the production preview and fix the top bottleneck.
  - Capture the evidence manifest: desktop+mobile `title`, `sample-town`, `stress-town`.
  - Run `check_evidence.py`, score the visual scorecard, and write `artifacts/final-evidence.md`.
- **Acceptance:**
  - `python3 ../.claude/skills/threejs-game-director/scripts/check_evidence.py . --manifest artifacts/evidence.json` passes.
  - Budgets met or overruns documented.
  - The scorecard table is filled in, with measured metrics cited.

---

### WP-12 — Scale, proportions & grid density (v0.2)
- **Status:** merged (`fbbef2a`). As-built facts are in `03-architecture.md` and `models.md`; the deviations from the plan are in `docs/progress.md` ("WP-12 as built").
- **Contract:** `docs/plans/wp-12-scale.md` (integrator-approved). Grid 48 × 48 cells of 0.5 world units (plot size unchanged), roads in aligned 2 × 2 blocks, multi-cell houses (3×3 / 2×3), garage 1×2, bus stop 2×1, proportion scales in `catalog/models.ts`, `SavedTownV2` + v1 migration.
- **Owns (delegated for this change, returned to the integrator after merge):** the plan's "Files" list, including the contract files it marks [C]; `docs/design/03-architecture.md` §Grid / §Placement rules / §Save format; the scale table in `docs/assets/models.md`/`.json`; e2e specs for cell coordinates only.
- **Acceptance:** unit tests (multi-cell rules, road blocks, `anchorForPointer`, migration fixtures, demo towns, proportions); inspector captures of asset-gallery / sample-town / stress-town on desktop and mobile within budget (stress ≤ 150 calls / 400k tris desktop, ≤ 120 / 250k mobile) with 0 console errors; cell pitch ≥ 12 px desktop / ≥ 9 px mobile; desktop frame time ≤ 8 ms; real-input e2e green except the intended visual-baseline diffs; before/after proportions side-by-side in `artifacts/wp-12/`.

### WP-13 — Background music + settings (v0.2)
- **Status:** merged (`1fab73f`; work `e76d1a8`).
- **Owned:** `src/audio/MusicPlayer.ts` (new), `AudioManager.ts`, `public/assets/music/**`, `docs/assets/audio.md`, `audio.music.json`, `CREDITS.md` rows, SaveStore settings fields, the menu music rows in `UiRoot`, and music cases in `tests/audio.spec.ts` / `ui.spec.ts`.
- **Contract changes applied by the integrator in the merge commit:** `intent:set-music`, `intent:set-music-volume` and `music:changed` in `events.ts` (replacing the temporary `src/audio/musicEvents.ts`, since deleted); diagnostics `audio.music` in `vite-env.d.ts`.
- **Result:**
  - One owner-supplied track (ElevenLabs), streamed via `HTMLAudioElement` after Start, so it is not in the initial download.
  - Music on/off and volume settings, persisted.
  - −3 dB duck in the menu; paused while muted or hidden.

### WP-14 — Remove the top-left stats pill (v0.2)
- **Status:** merged (`d0aa182`; work `8d91b1b`).
- **Owned:** `src/ui/**`, `src/styles.css`, `tests/ui.spec.ts`, `tests/visual-regression.spec.ts`.
- **Result:**
  - `StatsHud.ts`, its CSS, glyphs and test id are deleted.
  - One-row top bar: a 48 px row on desktop, 52 px on phones.
  - The hint and the refusal tooltip are re-anchored under the top bar.
  - `town:stats` and diagnostics `town` stay.
- **Integrator follow-up:** regenerated the baselines (`51d074d`, then again after WP-12 in `30fe85b`); phone top inset set to 76 in `framing.ts`.

### WP-15 — New building blocks & categories (v0.3)
- **Status: current, in progress** in the `main` working tree (uncommitted, not yet released). As-built notes: `docs/progress.md` ("WP-15 as built").
- **Owner:** the integrator (WP-01), with delegated helpers for tests and docs. It touches contract files (`catalog/*.ts`, `town/types.ts`, `town/grid.ts`, `vite-env.d.ts`), so it is not split across parallel WPs.
- **Motivation:** the 2026-09-27 asset research (crossroad, roundabout, traffic light, pool, barbecue, swing, house with garage, bench, bush, church, supermarket), and a dock that answers "what am I building?".
- **Scope:**
  - Dock categories Streets / Homes / Town / Nature / Garden (Shift+1–5), ≤ 9 tools each, surfaces → lines → objects. Ids renamed to what a thing is (`oak`, `cottage`, `fence-low`, …); `ObjectDef.group` replaces `statGroup`; `TownStats.amenities`.
  - New tools: Roundabout (road feature, 6 × 6, block-aligned), Traffic light (next to a road), Bungalow, Suburban, Big house, Fountain, Corner shop, Church, Supermarket, Pool, Bush, Hedge (edge), Planter, Bench, Barbecue, Swing. Crossroad tile with zebra crossings.
  - Road features in rules, auto-tiling (arms only), rendering (model instead of tiles) and traffic (ring path round the island).
  - Poly Pizza models through normalised recipes in `scripts/compose-models.mjs`; CC-BY credits in `CREDITS.md`, `composed/License.txt` and the in-game Credits panel.
  - Tool icons `tool-<id>.png` for all 33 tools; old icons deleted.
  - Save v3, no migrations (owner decision); `parseSave` drops bad road features.
  - Test hook `setCameraPose`; sample town uses every placing tool; asset gallery shows every object kind.
- **Owns:** the files listed in `git status` for v0.3 — `src/catalog/**`, `src/town/**`, `src/render/{roadTiles,TownRenderer,IconStudio}.ts`, `src/life/{TrafficSim,lanePaths}.ts`, `src/interaction/ToolController.ts`, `src/ui/**`, `src/fx/fxRecipes.ts`, `src/world/DecorRing.ts`, `src/game/Game.ts`, `src/vite-env.d.ts`, `scripts/{compose-models,render-icons}.mjs`, `public/assets/{icons,models}/**`, the affected `tests/*.spec.ts`, and the docs.
- **Acceptance:**
  - `npm run verify` green (typecheck, unit tests incl. `catalog.test.ts` category/icon/footprint/proportion checks, build).
  - `npm run test:e2e` green; visual baselines regenerated and reviewed (dock, sample town, asset gallery).
  - Sample town builds with 0 rejections using all 33 placing tools; asset gallery shows all 25 object kinds.
  - Stress town within budget on the inspector: ≤ 150 calls / 400k triangles desktop, ≤ 120 / 250k mobile. Measured on the dev server: 32 / 306.1k and 32 / 239.1k.
  - Cars circle a roundabout counter-clockwise and join only at its arms (unit tests in `life.test.ts`).
  - Every new asset recorded in `models.md` / `models.json` and `CREDITS.md`; CC-BY lines visible in the in-game Credits panel.

### WP-16 — Day/night cycle (v0.3)
- **Status: done** (2026-09-27). 16a, 16b and 16c merged into `v0.3-day-night`; the owner approved it and it is merged into `main`. As built: `docs/progress.md` "WP-16 as built".
- **Contract:** `docs/plans/wp-16-day-night.md`. It holds the owner decisions, the measured asset facts, the design, the budgets and the acceptance checks. This section is only a summary.
- **Owner decisions:**
  - 10-minute day with 25% night, cosy "blue hour" darkness.
  - Auto / Day / Night toggle, saved as a setting. The clock itself isn't saved; Auto starts in the morning.
  - In scope: lit windows, glowing lamps with light pools, traffic-light lenses, car head/tail lights, fewer cars at night.
  - Stretch: shop/church windows, fireflies, crickets.
- **Approach:**
  - A pure `DayClock` blends keyframes (afternoon = today's look, exactly); `Environment`/`Sky` apply them.
  - Lights are **emissive masks on existing materials**: an 8 × 4 swatch mask as `emissiveMap`, plus a per-house stagger shader patch, so windows and lamps add 0 draw calls.
  - Lamp pools, halos and headlight beams are instanced additive quads: +3 draw calls, only at night. No real `PointLight`s.
- **Integrator first:** the contract commit on `v0.3-day-night`. It compiles and keeps today's look through stubs:
  - `events.ts`: `intent:set-time-mode`, `intent:cycle-time-mode`, `daytime:changed`;
  - `models.ts`: `ModelSpec.glow`;
  - `dayCycle.ts`: the types, plus an afternoon-only stub;
  - `vite-env.d.ts`: diagnostics `daytime` and hook `setTimeOfDay`;
  - `Game.ts`: wiring and the `night-town` test state;
  - the `timeMode` setting and the `T` key;
  - stubs for `Environment.applyDaylight`, `NightLights` and `LifeSystem.setNight`.
- **Then three parallel WPs.** Each runs in a worktree branched from `v0.3-day-night` and merges back into it in the order 16a → 16b → 16c:
  - **WP-16a Daylight** (`wp-16a-daylight`, port 5215): `src/world/{dayCycle.ts,dayCycle.test.ts,Environment.ts,Sky.ts,GridOverlay.ts}`.
  - **WP-16b Night lights** (`wp-16b-night-lights`, port 5216): `src/render/{nightGlow.ts,NightLights.ts,ModelLibrary.ts,TownRenderer.ts}` plus their tests, `src/life/**`. It also fixes the car front (the cars drive backwards).
  - **WP-16c Controls & QA** (`wp-16c-controls`, port 5217): `src/ui/**`, `src/styles.css`, `tests/**`. New and regenerated baselines come last, after 16a and 16b merge.
- **Acceptance (summary):**
  - `npm run verify` and `npm run test:e2e` green.
  - **The 3D look in the 6 existing baselines is unchanged.** Every existing test state is pinned to afternoon. Only the time button in the top bar may change `sample-town` / `asset-gallery`, proven by a masked diff.
  - New `night-town` baselines for desktop and mobile.
  - Night inspector contrast ≥ 25; stress town within budget at night.
  - Real-input mode toggle that persists across reload.
  - A 20 s day → night → day capture in `artifacts/wp-16/`.

### WP-17 — Bigger buildings, smaller swing, dark shops at night
- **Status: built** on the integration branch `building-sizes` (17a, 17b and 17c merged 2026-09-27) and awaiting the owner's approval. As built: `docs/progress.md` "WP-17 as built". The version label is the owner's call.
- **Contract:** `docs/plans/wp-17-building-sizes.md`. It holds the footprint table, the save v4 decision, ownership and acceptance.
- **Summary:**
  - Homes and town buildings grow by one cell each way, with models scaled to fill the new lot.
  - The swing gets about 10–15% smaller.
  - The supermarket, corner shop and church don't light up at night.
- **Work split:** 17a Scale & layouts (port 5218) and 17b Shop lights (5219) run in parallel; then 17c QA (5221).

## 5. Checkpoints (integrator runs these on merged main)

> Historical: M1, M2 and M3 all passed on 2026-09-26 (`docs/checkpoints/m1.md`–`m3.md`). Reuse the procedure for future checkpoints.

**M1 — vertical slice (after Wave 1).** Merge order: WP-02 → WP-03 → WP-04 → WP-05 → WP-06 → WP-07 → WP-09a. Resolve lockfile conflicts by re-running `npm install`. Then:
1. Wire `SaveStore` into `Game.ts`: autosave, Continue on the title screen (`UiRoot`'s `hasSave` callback) and the camera pose. Apply the contract requests. (Debug folders, `ModelLibrary` for ghosts, menu phase, quality tier and DPR, grid visibility by phase, title camera, reseeding and all diagnostics fields are already wired.)
2. `npm run verify && npm run test:e2e` all green.
3. Manual play for 5 minutes on desktop: build a street with houses, pavement, lamps, trees, fences and a bus stop; undo/redo; reload and Continue. Note every friction point.
4. Inspector captures: `sample-town` desktop+mobile with run id `m1`. Attach and self-score the scorecard.
5. File fix-ups against the owning WPs, and start Wave 2.

**M2 — feature complete (after Wave 2).** Everything in §0 works through real input on desktop and mobile; bot playtest green; visual baselines committed; FX video reviewed.

**M3 — v1 release (after WP-11).** `artifacts/final-evidence.md` complete; the §0 quality gates are met.

## 6. Visual scorecard mapping (for this genre)
From `threejs-aaa-graphics-builder/references/visual-scorecard.md`, interpreted for a sandbox builder:
Hero = the town's buildings as placed (silhouette, facing, pop-in). Obstacles = placement constraints and their invalid feedback (red ghost, reason). Rewards/interactables = the ghost preview, auto-tiling roads and placement feedback. World = plot, terrain, sky, distant decor. UI = dock, top bar, overlays. Target: every category ≥ 2 except VFX (≥ 1.5 acceptable for v1), average ≥ 2.0.

## 7. Risks & open questions
| Risk | Mitigation / owner |
| --- | --- |
| Kenney kits have mismatched native scales (Roads vs Suburban vs Nature) | Per-model `scale` in `catalog/models.ts`, verified in `asset-gallery` (WP-03) and by the `catalog.test.ts` proportions block (WP-12) |
| Road tiles include their own kerbs, so pavement next to road may double up | WP-03 decides visually. Option: use the kit's `road-*` pieces without sidewalk, keep pavement as its own tile |
| Too many draw calls with naive rendering | Instancing is WP-03's first task; the `stress-town` state is the gate |
| Sandboxed agent sessions (e.g. nono) can't launch Chromium, so browser checks silently can't run | Run browser-verifying WPs (03, 04, 05, 06, 09, 11) in sessions whose sandbox profile allows Chromium, or outside the sandbox. An agent that can't run a check must say so, not skip it |
| Postbox is a primitive stand-in | Acceptable for v1; WP-04 or a later art pass can author a better one procedurally |
| MP3 encoder padding (~25 ms) on very old browsers | Accept; documented in `audio.md` |
| Fence-on-edge UX on touch (hard to target edges) | Done (WP-05): the bulldoze edge pick is 0.4 cell on coarse pointers vs 0.3 |
| v0.2 half-unit cells are small on phones (~10.6 px at the default pose) | Documented: pinch-zoom for small props; framing side inset −260 (WP-12) |
| Mobile stress-town triangle headroom: ~29k (291.3k / 320k on the 64 × 64 plot, dev server, 2026-09-28; the budget was 250k on 48 × 48) | Check triangles on mobile for any new content (`inspect:canvas --state stress-town --mobile`) |
| Agents editing `Game.ts` concurrently | Forbidden; contract requests only |
| Should the plot grow (expand land) later? | Done 2026-09-28: 64 × 64 cells (`PLOT_WIDTH/DEPTH`) |
