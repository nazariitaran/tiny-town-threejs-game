# WP-25 — Graphics settings (Low / Medium / High) and a tabbed menu

**Status:** the approved plan (owner request 2026-09-30), built on top of WP-24 on the branch `wp-24-frame-budget`. This file is the plan, not the as-built record: that goes in `docs/progress.md`.

**Inputs:**
- The owner's assessment, `~/Desktop/tiny-town-graphics-settings/REPORT.md` (measured 2026-09-27 at `5797105`, before WP-12/WP-24).
- The WP-24 performance report, `~/Desktop/tiny-town-performance/REPORT.md`.

## 1. What changed since the assessment

The report proposed "free wins for every level, before any settings UI". WP-24 has already shipped these:
- the 60 fps cap, plus a 30 fps idle cap;
- the shadow map redrawn only on change (cars at 15 Hz, birds at 30 Hz);
- a DPR cap of 1.5 on the high tier.

What is left from the report:
- presets the player can see and choose, saved in the settings;
- the Lambert material, which is nearly free visually and saves 35–45% GPU time;
- antialias off and DPR 1 on Low;
- fixing which decor trees Low keeps;
- cheaper clouds on Low;
- ending the touch-screen guess, which gave phones different colours (environment lighting off plus a hemisphere boost).

Deliberately **not** done (the report says they aren't worth a setting): shadow map size or filter as a *separate* option, fog, textures, LOD. An **Auto** mode that measures frame time is out of scope; the default is Medium.

## 2. Presets (contract: `src/game/graphics.ts`)

| | Low | **Medium (default, every device)** | High |
|---|---|---|---|
| DPR cap | 1 | 1.5 | 2 |
| MSAA | off (reload) | on | on |
| Material | Lambert (reload) | Standard | Standard |
| Environment lighting | on | on | on |
| Sun shadows | on, 1024, drawn on demand | on, 2048 | on, 2048 |
| Decor-ring trees | 60%, spread evenly | 100% | 100% |
| Sky clouds (fbm octaves) | 3 | 5 | 5 |
| Frame cap, active / idle | 30 / 30 | 60 / 30 | 60 / 30 |
| Lamp halos at night | off | on | on |

- **Medium = today's desktop look.** The desktop visual baselines run at DPR 1, so they must not change.
- **Phones change:** they move from the hidden low tier to Medium, with the same lighting as desktop, 2048 shadows and all decor trees. The mobile visual baselines are re-captured after an owner-visible review.
- **Mobile triangle budget:** it is 320k, and full decor may land around 330k. Measure it, and flag it for the owner if it is over.
- **Instant vs reload:** everything applies at once except MSAA and the material. Those are fixed at context and model creation, so `needsReload(booted, next)` decides whether the menu offers "Reload to apply".
- **Reload** = `SaveStore.flush()` and then `location.reload()`.
- **`?graphics=low|medium|high`** overrides the boot preset without saving it; it exists for tests and evidence captures.

## 3. Contract (committed before the fan-out)

- **`src/game/graphics.ts`:** `GraphicsPreset`, `GRAPHICS_PRESETS`, `DEFAULT_GRAPHICS`, `GraphicsProfile`, `GRAPHICS_PROFILES`, `isGraphicsPreset`, `needsReload`, `GRAPHICS_UI` (labels and one-line descriptions).
- **`src/game/events.ts`:**
  - `intent:set-graphics { preset }` and `intent:reload-graphics`;
  - the fact `graphics:changed { preset, reloadRequired }`, emitted once at boot (after `UiRoot` exists) and after every change.
- **`src/ui/testIds.ts`:**
  - `MENU_TABS = ['town', 'graphics', 'sound', 'help']`;
  - `menuTab(tab)` → `tab-menu-<tab>` and `menuTabPanel(tab)` → `panel-menu-<tab>`;
  - `graphicsGroup` `ui-graphics`, `graphicsOption(preset)` → `radio-graphics-<preset>`, `graphicsReload` `btn-graphics-reload`.

## 4. Work split (parallel worktrees from `wp-24-frame-budget`, merged back into it)

### WP-25a — Graphics engine (branch `wp-25a-graphics`, PORT 5301)
Owns:
- `game/Game.ts`, `game/config.ts`, `core/Renderer.ts`, `vite-env.d.ts` (diagnostics);
- `persistence/SaveStore.ts`;
- `world/Environment.ts`, `world/DecorRing.ts`, `world/Sky.ts`, `world/Terrain.ts`;
- `render/ModelLibrary.ts`, `render/TownRenderer.ts`, `render/NightLights.ts`, `render/nightGlow.ts`;
- `life/LifeSystem.ts`, `life/BirdSystem.ts`, `interaction/GhostPreview.ts` (material only), `fx/windSway.ts` (only if needed);
- a new `render/materials.ts`;
- tests for all of these.

Work:
1. **Replace `QualityTier`/`MAX_DPR`** (the touch-screen guess) with the preset.
   - Boot preset = the `?graphics=` override, else the saved `GameSettings.graphics` (default `medium`, validated with `isGraphicsPreset`).
   - Diagnostics:
     - `quality` becomes the current `GraphicsPreset`;
     - add `graphics: { preset, booted, reloadRequired, antialias, material, maxDpr, shadowMapSize, decorFraction, skyOctaves, activeFps, idleFps, lampHalos }`.
     - `antialias` and `material` report what the page actually runs with.
2. **Boot-time parts:**
   - Create the WebGL context with `antialias` from the boot profile.
   - Material mode: `lambert` converts every lit `MeshStandardMaterial` to an equivalent `MeshLambertMaterial`, keeping map, color, emissive/emissiveMap/emissiveIntensity, vertexColors, transparent/opacity, side, alphaTest, name and userData. This covers:
     - GLTF materials in `ModelLibrary` (so the town, decor ring and ghost follow);
     - `TownRenderer` slabs and style clones;
     - terrain, cars and birds.
   - Check that the patches still apply: wind sway, window-glow stagger, bird flap, and `NightLights` glow masks (`emissiveMap` works on Lambert).
   - Check that `scene.environment` still lights Lambert (it does in r184, per the report). Verify by screenshot that Low looks close to Medium, not flat.
3. **Live parts, applied by `Game.applyGraphics(profile)` at boot and on `intent:set-graphics`:**
   - `tuning.maxDpr` (resize);
   - `Environment.applyGraphics(profile)` replaces `setQuality`:
     - shadow map size (bump `shadowVersion`);
     - env map **always on** (drop the low-tier hemisphere boost);
     - decor fraction;
     - sky octaves (a define plus a one-off recompile);
   - `FrameBudget.tuning` active/idle fps;
   - `NightLights`: build the halo layer always, and show it only when `lampHalos`.
4. **`DecorRing` at a fraction < 1:** keep an **evenly spread** deterministic subset (e.g. by index stride or angle hash), not nearest-first. The title camera circles far out, so nearest-first dropped the trees in front of it.
5. **Persistence and events:**
   - `SaveStore` settings get `graphics` (default `medium`, validated).
   - On `intent:set-graphics`: save, apply, and emit `graphics:changed { preset, reloadRequired: needsReload(booted, preset) }`.
   - On `intent:reload-graphics`: `saves.flush()` and `location.reload()`.
   - Emit the boot `graphics:changed` after the UI exists.
6. **Tests and measurements:**
   - Unit tests: the settings round-trip; `needsReload`; the decor subset spread; the Lambert conversion keeps the fields.
   - e2e with `?graphics=low|high`: diagnostics prove DPR, antialias, material, shadow size, decor count and caps.
   - GPU utilisation per preset on the stress town, using `~/Desktop/tiny-town-performance/probes` (copy them into the scratch area; the pattern is in `compare.mjs`/`refresh.mjs`). DPR 2 viewport, emulated 120 Hz, active and idle.
   - Screenshots of each preset (sample town, title, night) under `artifacts/wp-25/`.

### WP-25b — Tabbed menu and the Graphics tab UI (branch `wp-25b-menu-tabs`, PORT 5302)
Owns: `ui/UiRoot.ts`, `ui/ui.css`, `ui/glyphs.ts`, `tests/helpers.ts`, and every spec that drives the menu.

1. **Menu layout:**
   - The town name heading and **Resume** stay above the tabs.
   - Below them, a tab bar: **Town · Graphics · Sound · Help** (`role=tablist`), with one panel per tab (`role=tabpanel`; the others `hidden`).
   - Tab contents (every existing control keeps its id):
     - **Town:** Time of day (the existing segmented radios); Rename town / New town; the Town file row (still phones-only, ≤ 440 px).
     - **Graphics:**
       - Quality: a segmented Low / Medium / High radio group (`ui-graphics`, the ids from testIds), styled like Time of day;
       - under it, the selected preset's one-line description (`GRAPHICS_UI`);
       - a notice "Some changes apply after a reload" with the button **Reload now** (`btn-graphics-reload`), shown only while `reloadRequired`;
       - Show grid.
     - **Sound:** Volume, Music, Music volume.
     - **Help:** Controls, Reset view, Credits.
2. **Behaviour:**
   - The menu opens on the tab used last in this page session; the default is Town.
   - Clicking a tab or using the arrow keys, Home and End switches it, with roving `tabindex` per the WAI-ARIA tabs pattern.
   - Esc, `?` → Controls, and every sub-view (help, credits, confirm, name, file) behave as today. "Back" from a sub-view returns to the menu **on the same tab**.
   - The panel height must not jump between tabs: give it a min-height based on the tallest tab, or a fixed height with internal scroll on short phones.
   - It must fit 390 × 844 (Pixel 7 emulation) with no horizontal scroll. Tabs show icon plus label; the labels may shrink on phones.
3. **Graphics wiring:**
   - The radios render from the `graphics:changed` fact, never from the intent: a change emits `intent:set-graphics`.
   - The Reload button emits `intent:reload-graphics`.
   - The UI must not import three.js.
4. **Tests:**
   - Add a helper `openMenuTab(page, tab)` in `tests/helpers.ts`, and update every spec that clicks a menu control so it opens the right tab first.
   - Add a UI spec covering:
     - tab switching by mouse and by keyboard;
     - the last tab remembered on reopen;
     - Back from Controls returning to the Help tab;
     - Graphics radios reflecting a `graphics:changed` fact, and clicking one emitting the intent (check it through diagnostics once 25a is merged; until then assert `aria-checked` and the DOM);
     - the reload notice appearing when the fact says `reloadRequired`;
     - phone layout fits.
   - To test the Graphics tab before 25a lands, a spec may dispatch the fact through the UI's bus only if a hook already exists. Otherwise assert the DOM, and leave the end-to-end check to 25c.

### WP-25c — Integration and QA (after both merges, PORT 5303)
- Merge 25a, then 25b, into `wp-24-frame-budget`.
- Run `npm run verify` and the full e2e suite.
- Add the end-to-end Graphics spec: pick Low in the menu → the settings are saved → `reloadRequired` → Reload → the page boots with MSAA off and Lambert → pick Medium → reload → back.
- Review the mobile baselines and re-capture them only if the only differences are the intended Medium-on-phones changes; get the owner's approval via screenshots in the hand-off.
- Measure the mobile triangles against the budget.
- Update the docs: `03-architecture.md` (§Graphics presets, §Frame budget, budgets table, diagnostics), `02-interaction-and-ui.md` (the menu tabs), `progress.md` (WP-25 as built, the per-preset measurements), `PLAN.md` (the WP-25 section).

## 5. Acceptance
- `npm run verify` and the full e2e suite pass. The desktop baselines are unchanged; the mobile baselines are re-captured with a documented reason.
- Each preset measurably applies its row of the table (diagnostics), and Low/High survive a reload.
- The GPU utilisation per preset is recorded, and Low is clearly the cheapest.
- The menu works with mouse, touch and keyboard at 1280 × 720 and 390 × 844, with no clipped text.
