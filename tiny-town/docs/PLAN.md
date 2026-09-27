# Tiny Town — Implementation Plan (hand-off)

This plan takes the scaffold in this folder to a finished v1 of **Tiny Town**, a cosy sandbox city builder that runs in the browser. It is written for implementation agents working **in parallel**. Each work package (WP) has its own files, contracts, dependencies and **verifiable acceptance checks**.

Read `CLAUDE.md` first (commands and hard rules), then the three design docs in `docs/design/`. To run the swarm (orchestrator prompt, worker template, branches, ports, merge runbook), see `docs/HANDOVER.md`.

---

## 0. Definition of done (v1)

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

## 1. What the scaffold already gives you (walking skeleton)

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
- **Dev server port:** 5188 is `strictPort`. Concurrent workers should use `npx vite --port 52xx` and pass `--url` to the inspector.
- Recommended concurrency: up to **6 workers** in Wave 1. They are independent, but more agents means more integration load.

> Prerequisite (one-time, by the user or integrator): `git init` has been run but nothing is committed. Make the initial commit of the scaffold before creating worktrees: `git add -A && git commit -m "Tiny Town scaffold"`.

## 3. Dependency graph

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

### WP-01 — Integrator (continuous)
- **Owns:** contract files (`src/game/events.ts`, `src/game/config.ts`, `src/catalog/**`, `src/town/types.ts`, `src/town/grid.ts`, `src/audio/sfx.ts`, `src/audio/sfxTable.ts` (regenerate with `npm run gen:sfx`), `src/vite-env.d.ts` (diagnostics and hook types)), `src/game/Game.ts`, `src/main.ts`, `index.html`, `docs/**`, `CLAUDE.md`.
- **Tasks:** make the initial commit and create worktrees; brief workers with their WP section; merge hand-offs; apply contract change requests; run the checkpoint verifications (§5); keep `docs/progress.md` up to date (the only shared status file; workers don't edit it).
- **Acceptance:** every checkpoint's checks pass on the merged main branch, and `docs/progress.md` is up to date.

### WP-02 — Town logic & persistence
- **Owns:** `src/town/TownState.ts`, `rules.ts`, `History.ts`, `TownEditor.ts`, `serialize.ts` (new), `sampleTown.ts`, `src/persistence/**` (new), all `src/town/*.test.ts`.
- **Reads:** `town/types.ts`, `town/grid.ts`, `catalog/objects.ts`, `game/events.ts`.
- **Depends on:** nothing. **Skills:** `threejs-gameplay-systems` (read "Design first" and "Build").
- **Tasks:**
  1. Implement the full placement rule table in `03-architecture.md §Placement rules`, with a player-facing message for every rejection. `no-change` must stay silent.
  2. Road painting removes fences on edges shared with adjacent road cells, in the same change list so it undoes together. Keep the **primary change last** in every change list: `TownEditor` derives `build:placed`/`build:removed` (layer, kind, world position) from the last change.
  3. `History`: cap at 200 entries; clear on load/reset. `TownEditor.apply` inside a stroke must not emit `history:changed` per cell.
  4. `serialize.ts`: `serializeTown(state, cameraPose?) → SavedTownV1`, `parseSave(unknown) → SavedTownV1 | Error` (validate every field, clamp to plot size, drop unknown kinds), with a migration hook keyed on `version`.
  5. `TownEditor.load(save)`: replace state, emit `town:changed` with cause `'load'` and a full change list, clear history. Add `applyBatch(actions, {silent})` so sample towns and loads don't fire per-item `build:placed` (no sound/FX spam).
  6. `persistence/SaveStore.ts`: `has()`, `read()`, `write(save)`, `clear()`, debounced autosave (1 s after `town:changed`, cause ≠ `'load'`). Handle quota and JSON errors without throwing. Expose settings get/set for mute/volume/grid (key `SETTINGS_STORAGE_KEY`).
  7. `sampleTown.ts`: keep `buildSampleTown` using every tool at least once, with zero rejections (return the list; tests assert it's empty).
- **Acceptance checks:**
  - `npm run test:unit` has ≥ 1 test per rule-table row (valid and invalid case), plus: undo of a 50-cell drag stroke restores a deep-equal state snapshot; redo re-applies it; the sample town round-trips `serialize → JSON → parseSave → load` to an identical snapshot; corrupted/foreign JSON is rejected without throwing; road paint removes the in-between fence and undo restores it.
  - `buildSampleTown(editor).rejected` is `[]` (unit test).
  - Stats: after the sample town, `stats()` matches hand-computed values (unit test).
  - The integrator can wire `SaveStore` into `Game.ts` using only the documented API.
- **Out of scope:** any three.js/DOM code.

### WP-03 — Rendering: models, instancing, road tiles, pop-in
- **Owns:** `src/render/**` (except `roadTiles.ts` logic changes must keep its tests green), `scripts/inspect-models.mjs`, and numeric tuning of `catalog/models.ts` (`scale`, `rotationOffset`, `offset`; tell the integrator in the hand-off).
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
- **Owns:** `src/interaction/**`.
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
- **Owns:** `src/ui/**`, `src/styles.css`, `public/assets/ui/**` (SVG glyphs, new), UI font dependency.
- **Reads:** `game/events.ts`, `catalog/tools.ts`, `town/types.ts` (`TownStats`), `docs/design/02-interaction-and-ui.md` (§4–§7).
- **Depends on:** nothing. **Skills:** `threejs-game-ui-designer` (read `references/ui-patterns.md` fully).
- **Tasks:**
  1. Build the layout and every state in design doc §4–§5: loading, title (Start/Continue/New town), building (dock with category tabs and item tray, mode buttons, top bar with stats/undo/redo/sound/menu, hint line, cursor tooltip for `hover:changed.reason` and `build:invalid`), menu, confirm dialog, controls help, and error.
  2. Visual language from §6: bundled rounded font (`@fontsource-variable/nunito`), SVG glyphs for UI icons, Kenney preview PNGs for items, cream panels, and hover/pressed/focus-visible/disabled states. Respect `prefers-reduced-motion`.
  3. Mobile layout (≤ 760 px or coarse pointer): full-width dock, horizontally scrolling tray with scroll-snap, ≥ 44 px targets, safe areas.
  4. Number keys: 1–4 switch category and 1–9 select tools in the active category (UI owns category state; emit `intent:select-tool`). Coordinate nothing with WP-05, which doesn't handle digits.
  5. Emit `ui:sfx` (`ui-hover` on pointerenter for dock items, `ui-click` on press, `ui-open`/`ui-close` for the tray and menu).
  6. HUD juice: stats count up; a number punch when a stat changes.
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
- **Owns:** `src/audio/AudioManager.ts`, `public/assets/audio/**`, `docs/assets/audio.*`, `tests/audio.spec.ts`. If you change `audio.json`, list it as a contract change so the integrator runs `npm run gen:sfx`.
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
- **Owns:** `tests/**` except `interaction.spec.ts` (WP-05), `ui.spec.ts` (WP-06), `audio.spec.ts` (WP-07), `fx.spec.ts` (WP-08) and `life.spec.ts` (WP-10); also `playwright.config.ts`. Projects: `desktop-chrome` and `mobile-chrome`, both full Chromium.
- **Skills:** `threejs-qa-release` (all three references).
- **09a tasks (skeleton, Wave 1):**
  - `tests/smoke.spec.ts`: the page loads with zero console/page errors; phase reaches `title`; clicking `#btn-start` gives `building`; every `setState` name is acknowledged; unknown states throw.
  - `tests/build-flow.spec.ts`: a real-input journey (select road → drag → place house → undo → redo → bulldoze) asserting diagnostics town stats at each step.
  - `tests/visual.spec.ts` already does load → Start → select Road → real mouse drag → assert road tiles. Keep it as the smoke journey, and adapt or delete `tests/*.template.ts` (excluded from tsc).
- **09b tasks (Wave 2):**
  - `tests/visual-regression.spec.ts`: baselines for `title`, `sample-town` and `asset-gallery` on desktop and mobile (seeded, paused, reduced motion).
  - `tests/bot-playtest.spec.ts`: a builder bot that for 200 steps picks a random tool (seeded), clicks/drags random cells via `cellToClient`, and occasionally undoes. Assert no errors, frames advance, placements ≥ 50, diagnostics `render.objects === objects` at the end, and no stuck stroke. Report the metrics JSON.
- **Acceptance checks:** `npm run test:e2e` green on both projects, with the run output and metrics JSON attached.

### WP-10 — Ambient life (stretch, Wave 2)
- **Owns:** `src/life/**` (new), `tests/life.spec.ts`.
- **Depends on:** WP-03, WP-04. Needs a contract request for the integrator to instantiate it in `Game.ts`.
- **Tasks:**
  - Up to 6 Kenney cars wander the connected road graph, choosing at intersections. Four are already shipped in `public/assets/models/cars/` (scale 0.14, facing −Z); more are in `assets-src/car-kit`, and any you add must be documented. They despawn when their road is removed and never drive through buildings.
  - Optional "dusk" toggle: sky and light lerp, and lampposts gain an emissive glow with a small point-light budget (≤ 4 real lights; the rest emissive only).
- **Acceptance:** a 10 s video of cars following a sample-town loop; bulldozing a road under a car removes it cleanly; draw calls +≤ 6.

### WP-11 — Release, performance & evidence (Wave 3)
- **Owns:** `vite.config.ts`, `artifacts/**` (including `artifacts/evidence.json`), `docs/release.md` (new).
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
- **Contract:** `docs/plans/wp-12-scale.md` (integrator-approved). Grid 48 × 48 cells of 0.5 world units (plot size unchanged), roads in aligned 2 × 2 blocks, multi-cell houses (3×3 / 2×3), garage 1×2, bus stop 2×1, proportion scales in `catalog/models.ts`, `SavedTownV2` + v1 migration.
- **Owns (delegated for this change):** the plan's "Files" list including the contract files it marks [C]; `docs/design/03-architecture.md` §Grid / §Placement rules / §Save format; the scale table in `docs/assets/models.md`/`.json`; e2e specs for cell coordinates only.
- **Acceptance:** unit tests (multi-cell rules, road blocks, `anchorForPointer`, migration fixtures, demo towns, proportions); inspector captures of asset-gallery / sample-town / stress-town on desktop and mobile within budget (stress ≤ 150 calls / 400k tris desktop, ≤ 120 / 250k mobile) with 0 console errors; cell pitch ≥ 12 px desktop / ≥ 9 px mobile; desktop frame time ≤ 8 ms; real-input e2e green except the intended visual-baseline diffs; before/after proportions side-by-side in `artifacts/wp-12/`.

## 5. Checkpoints (integrator runs these on merged main)

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
| Kenney kits have mismatched native scales (Roads vs Suburban vs Nature) | Per-model `scale` in `catalog/models.ts`, verified in `asset-gallery` (WP-03) |
| Road tiles include their own kerbs, so pavement next to road may double up | WP-03 decides visually. Option: use the kit's `road-*` pieces without sidewalk, keep pavement as its own tile |
| Too many draw calls with naive rendering | Instancing is WP-03's first task; the `stress-town` state is the gate |
| Sandboxed agent sessions (e.g. nono) can't launch Chromium, so browser checks silently can't run | Run browser-verifying WPs (03, 04, 05, 06, 09, 11) in sessions whose sandbox profile allows Chromium, or outside the sandbox. An agent that can't run a check must say so, not skip it |
| Postbox is a primitive stand-in | Acceptable for v1; WP-04 or a later art pass can author a better one procedurally |
| MP3 encoder padding (~25 ms) on very old browsers | Accept; documented in `audio.md` |
| Fence-on-edge UX on touch (hard to target edges) | WP-05: edge snapping radius larger on coarse pointers |
| Agents editing `Game.ts` concurrently | Forbidden; contract requests only |
| Open: should the plot grow (expand land) later? | Out of scope for v1; `PLOT_WIDTH/DEPTH` constants keep it cheap to add |
