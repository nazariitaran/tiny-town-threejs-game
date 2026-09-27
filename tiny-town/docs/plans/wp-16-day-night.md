# WP-16 — Day/night cycle (plan; owner-approved 2026-09-27, revised by the integrator the same day)

> **Approved plan, being implemented on branch `v0.3-day-night`.** This is the pre-implementation contract. Day/night ships in **v0.3**, together with WP-15 (the owner's version naming; earlier drafts said v0.4). When it's built:
> - As-built facts go to `docs/design/03-architecture.md` (new §Day/night).
> - Deviations from this plan go to `docs/progress.md` under "WP-16 as built".
> - `v0.3-day-night` is merged into `main` only after the owner's final approval.

The town cycles between day and night. At night the town answers: windows light up house by house, street lamps glow and throw pools of light, traffic lights shine, and cars drive with headlights. Every number below is a starting value, tunable in the lil-gui `Daylight` / `Night lights` folders (`?debug`).

## Owner decisions (2026-09-27)
1. **Cycle:** one day lasts **10 minutes** of play, and **25%** of it (2.5 min) is night.
2. **How dark:** **cosy "blue hour"**, not black. Navy fog, a blue fill light and cool moonlight with shadows. Building at night must stay as easy as by day.
3. **Control:** a three-way **Auto / Day / Night** toggle. There is no pause-at-any-time slider.
4. **Extras** (the owner agreed to the proposal; the integrator set scope):
   - In scope: glowing traffic-light lenses, car head and tail lights with small beams on the road, fewer cars at night, a stronger grid overlay at night.
   - Stretch: church windows (cheap, see facts), fireflies over meadows, corner-shop windows (hand-made mask).
   - Deferred (follow-up, not in this swarm): night-time crickets. There is no CC0 cricket sound in `assets-src/`, and agents may not fetch or generate assets.
5. **Saving:** the time of day is **not saved**. Auto mode always starts in the morning. The chosen mode (`timeMode`) is a setting and persists.

## Revision after WP-15 merged (integrator, 2026-09-27)
The first draft was measured while WP-15 was still uncommitted. Since WP-15 merged (`ea54bb5`), the assets were re-measured from UVs in Node. This revision changes the draft as follows:
- **Atlas grid is 16 × 4, not 8 × 4.** Every Kenney atlas here is 512 × 512 in cells of 32 × 128 px, and columns 2k/2k+1 are usually a light/dark pair. Masks are therefore **16 × 4** `DataTexture`s, and every cell index below is in 16-column terms.
- **Traffic lenses do not glow by day.** The sample town has 2 traffic lights and the asset gallery has 1, so a daytime glow would break the "existing baselines unchanged" rule. Lens glow scales with `night` only.
- **The top-bar time button changes 4 baselines.** It sits in the building-phase top bar, so it changes the `sample-town` and `asset-gallery` baselines (desktop and mobile).
  - 16a and 16b must keep **all 6** existing baselines unchanged.
  - 16c regenerates only those 4 and must prove the pixel change lies **inside the top-bar rectangle**. `title` must stay unchanged.
- **Cars probably drive backwards today.** All four Car Kit models have headlights (yellow) and the raked windscreen at native **+Z**; the red tail lights are at −Z. `LifeSystem` turns them by π, assuming a −Z front.
  - 16b confirms this in the browser and fixes `FRONT_ROTATION`, in its own commit.
  - That fix may change the car pixels in `sample-town`. 16b may regenerate exactly those baselines, with before/after crops as evidence.
- **No roads-atlas tile samples the lamp or lens cells**, so "amber road markings" is not a risk. Road tiles, the roundabout, the pavement tile, the lamppost and both traffic lights still share **one** material in `ModelLibrary`, so glow still goes on private clones.
- **The integrator's contract commit is complete and compiles.** It adds working stubs, so the branch runs and looks exactly like v0.3 before any worker merges. It also takes the `timeMode` setting (SaveStore + test) and the `T` key (`ToolController`) off the workers' plates.
- **The clock runs only while building** (frozen on the title screen, in the menu and under reduced motion). **Test hooks apply the look at once**, even while paused for a screenshot.

## Why this design (facts measured 2026-09-27 on `ea54bb5`)
- **The build camera looks steeply down**, so players rarely see the sky; it mainly shows on the title screen. Night has to read from ground lighting, fog colour and light sources. Pools of lamplight on the ground carry most of the mood at the default zoom.
- **Kenney atlases:** 512 × 512, **16 columns × 4 rows** of 32 × 128 px cells, each a vertical 2-tone gradient. Suburban and commercial leave row 0 empty; roads, industrial and cars use it. The same cell index means different colours in different kits.

| Model(s) | Atlas | Cell (col 0–15, row 0–3 from top) | Colour | Triangles |
| --- | --- | --- | --- | --- |
| All 12 suburban houses (`building-type-a/c/d/e/i/k/m/n/o/r/s/u`) | `suburban/Textures/colormap.png` | window glass (11, 1) | (119,161,223)–(157,192,237) | 7–25 per house; wall height, except n (2) and o (4) with roof-lights facing up |
| Supermarket (`commercial/building-e`) | `commercial/Textures/colormap.png` | window glass (11, 1) | same | 20 |
| Lamppost (`roads/light-curved`) | `roads/Textures/colormap.png` | lamp face (8, 2) | (255,255,255) | 4, all normals (0,−1,0); area centroid native (0, 0.653, −0.155) ⇒ about (0, 0.653, +0.154) from the cell centre after the catalog transform (before the `MODEL_STYLES` scale) |
| Traffic lights (`roads/traffic-light`, `-hanging`) | roads | red (9, 1) (231,96,71), amber (11, 3) (255,179,73), green (15, 3) (61,166,121) | own colours | 6 each; lenses face native −X (+z after the catalog turn). The amber-looking housing is cell (13, 3): leave it dark |
| Garage (`composed/garage`) | industrial copy | glass (9, 3) | (134–138,173–176,228–230) | 2. Stays dark: garages aren't lived in |
| Cars (`sedan`, `hatchback-sports`, `van`, `taxi`) | `cars/Textures/colormap.png` | headlights (3, 3) (255,208,43) at native +z; tail lights (5, 3) (224,70,62) at native −z | — | 4–14 / 4 per car |
| Church (`composed/church`) | own 256² "1221 Church", 4 flat quadrants | windows + door: quadrant u 0.5–1, v 0–0.5, dark grey (86,86,86) | — | 90 (y 0.07–1.03 native). A 2 × 2 mask works; the door can only be told apart by height (stretch) |
| Corner shop (`composed/corner-shop`) | KayKit `citybits_texture` 1024², gradient palette | no reliable glass cell | — | needs a hand-made mask (stretch, lowest priority) |

  - No other catalog model samples the suburban/commercial glass cell. Checked: planter, trees, paths, the tall fence, and the pool's and bus stop's embedded copies.
  - No roads-atlas model other than the lamppost and the traffic lights samples cells (8,2), (9,1), (11,3) or (15,3). That includes the road tiles, crossroad-path, roundabout, pavement tile and the bus stop's copy.
  - `ModelLibrary.shareMaterial` dedupes by (image URL, params): one material for all roads GLBs, one for suburban (houses, planter, paths, non-sway trees), one for commercial.
- **Instancing:** everything in the town is drawn with shared instanced meshes, one pool per (model, part). So "lights on" is a **material** feature driven by a few shared uniforms, not per-object meshes or `PointLight`s.
  - Changing the number of real lights recompiles shaders, and a cap of 4 looks wrong in a town with 20 lamps.
- **Cars** are one `BatchedMesh` with one material (`LifeSystem`, `CAR_SCALE = 0.17`, ≤ 6 cars).
- **Moving the sun costs nothing extra:** the shadow map already re-renders every frame (`shadowMap.autoUpdate` is on).
  - Conflict: the backlog idea "`shadowMap.autoUpdate = false`" would then need a re-render whenever the key light moves.
- **Ghost preview is safe:** `GhostPreview` builds new materials that copy only `map` and `color`, so ghosts never inherit a window glow.
- **Icons are safe:** `IconStudio` imports `LIGHTING` from `Environment.ts` and builds through `ModelLibrary`/`TownRenderer` styles. So:
  - keep `LIGHTING` as the afternoon values;
  - keep glow intensity exactly 0 when `night = 0`, so icons and daytime pixels don't change.
- **Screenshot tests freeze the frame loop:** `setPausedForScreenshot(true)` skips `update()`. The contract therefore applies the day look directly from `setState` / `setTimeOfDay`.

## Design

### 1. Clock and keyframes — `src/world/dayCycle.ts` (pure, no three.js)
- **Contract:** the types, constants and signatures in the file's "Contract" section are fixed. See §Contract below; the file is on the branch.
- **Time:** `t ∈ [0, 1)` is the fraction of a day. `DAY_LENGTH_S = 600`.

| Phase | `t` | Real time | Notes |
| --- | --- | --- | --- |
| dawn | 0.00 → 0.10 | 1 min | night → sunrise |
| day | 0.10 → 0.65 | 5.5 min | morning 0.12, midday 0.35, **afternoon 0.55** (= today's look, exactly), golden hour 0.62 |
| dusk | 0.65 → 0.75 | 1 min | sunset; lights come on through this phase |
| night | 0.75 → 1.00 | 2.5 min | windows start to go dark after 0.90 |

- **Keyframes:** a keyframe is a `DaySample`, interpolated with smoothstep between neighbours. Colours are `Rgb` display-space (sRGB) components, since a `'#rrggbb'` literal means display space. Blend them in linear RGB (convert, blend, convert back), and wrap across 1 → 0.
  - `sampleDay(0.55, out)` must reproduce today's `LIGHTING` / `SKY_PALETTE` / `SUN_DIRECTION` **exactly** (unit test to 1e-6).
- **Starting colours:**
  - **afternoon** = the current `LIGHTING` and `SKY_PALETTE` values.
  - **midday:** key `#fff4e0` ×3.2, sky top `#4a9ae6`.
  - **golden:** key `#ffc98a` ×2.4, horizon `#f7d6a8`.
  - **dusk:** key `#ff9a5c` ×1.0, sky top `#4a5d9a`, horizon `#f3a26b`, glow `#ff8a4d`.
  - **night:** key (moon) `#9fb8ff` ×0.35, hemisphere `#3a4f86` / `#1e2a36` ×0.55, sky top `#0b1430`, horizon/fog `#1d2a4a`, env 0.04, stars 1.
  - **dawn:** key `#ffc8a0` ×1.0, sky top `#6d8fc9`, horizon `#f6c1a0`.
- **Sun path:** stylised. The azimuth sweeps east → west and the elevation peaks at about 55° at midday. It is anchored so that `t = 0.55` gives exactly today's `SUN_DIRECTION` (from the build camera's left).
  - **Moon:** a fixed, pleasant direction from the camera's right, about 40° up.
  - **One directional light plays both roles** (`keyDir`). Its intensity passes through about 0 around sunset and sunrise, and it swaps direction there, so the swap can't be seen.
  - `sunDir` / `moonDir` and their `sunVisible` / `moonVisible` drive the sky discs.
- **`DayClock`** (pure; signatures fixed):
  - Members: `mode`, `t`, `phase`, `isPinned`, `advance(delta)`, `setMode(mode, snap)`, `startDay()`, `pin(t | null)` and `sample(out)`. `sample` writes into a caller-owned object: no per-frame allocations.
  - **Auto:** `t` advances by `delta / DAY_LENGTH_S`, and `startDay()` (Start: New or Continue) sets `t = T_MORNING` (0.12).
  - **Day / Night:** the clock is fixed at `T_AFTERNOON` (0.55) or `T_NIGHT` (0.82, early night, when every lit house is on).
  - **Switching mode** sweeps `t` **forward** to the target over `MODE_SWEEP_S` (2.5 s), ease-in-out, so Night → Day plays a quick dawn. `snap = true` jumps straight there (Game passes it under reduced motion).
  - Switching to Auto continues from the current `t`.
- **Title screen:** always afternoon, whatever the mode (Game samples `T_AFTERNOON` outside building/menu unless pinned). The chosen mode takes effect on Start.
- **Reduced motion:** Game already passes `animDelta = 0`, so the clock freezes. Mode switches snap with no sweep.

### 2. World response — `Environment.ts`, `Sky.ts`, `GridOverlay.ts`
- **`Environment.applyDaylight(sample)`**, called every frame by Game and at once from the test hooks. It sets:
  - key light direction, colour and intensity;
  - hemisphere colours and intensity (the low-tier boost is kept, scaled by `1 − 0.5·night`);
  - fog colour = `skyHorizon`;
  - `scene.environmentIntensity = envIntensity` (high tier). The neutral white RoomEnvironment would otherwise make night look lit.
  - It must be cheap when nothing changed: skip the work when `t` is unchanged.
- **`fitSunShadow()`:** reuse scratch objects (today it allocates a camera, a `Box3` and vectors on every call). Refit only when `keyDir` has moved by more than about 0.2°.
- **Sky shader:**
  - New uniforms: `uCloudShade` (replaces the hard-coded bright `cloudCol`), `uStars`, `uMoonDir`, `uMoonVisible`, `uSunVisible`.
  - Hash-noise stars above the horizon, fading with `uStars` and hidden behind clouds.
  - A small moon disc and halo along `uMoonDir`.
  - The existing sun disc, halo and bloom fade with `uSunVisible`.
  - **At afternoon values the shader output must be unchanged:** `uStars = 0`, `uCloudShade = 1` and `uSunVisible = 1` reduce exactly to today's maths. The existing invariant stays: below the horizon the sky equals the fog colour.
- **`GridOverlay`:** line opacity × (1 + 0.6·night), so the grid stays readable. It may exceed `GRID_MAX_OPACITY` (0.14) only at night. The debug slider keeps its day clamp. Record the exception in `02-interaction-and-ui.md` (the integrator does this at merge).
- **`IconStudio`** keeps importing `LIGHTING`. Keep that export and its afternoon values.

### 3. Light sources — glow masks (`src/render/nightGlow.ts`, new)
- **Glow mask texture:** a mask is a **16 × 4 `DataTexture`**, one texel per atlas cell, `NearestFilter`, `flipY = false`, sRGB. The RGB of a texel **is** the glow colour of that cell; black means no glow.
  - The mask becomes the material's standard `emissiveMap`, with `emissive = #ffffff` and `emissiveIntensity` driven by `night`. **Intensity is exactly 0 when `night = 0`.**
  - It works on the lamppost too: its `MODEL_STYLES` colour clone drops `map`, but `clone()` keeps `emissiveMap` and the UVs remain. So the style clone must be registered for intensity updates as well.
  - A unit test pins the row order: row 0 = the atlas's top row, the same `flipY = false` convention as glTF. A second test pins the cell indices against the facts table.
- **Catalog field (contract, done):** `ModelSpec.glow?: 'windows' | 'lamp' | 'traffic'` in `catalog/models.ts`. It is set on the 12 houses and the supermarket (`windows`), the lamppost (`lamp`) and both traffic lights (`traffic`).
  - `ModelLibrary` gives glow models a **private material clone per (source material, glow kind)**, just as it does for `sway`. All suburban houses share one "windows" clone and the supermarket has its own, so draw calls don't change: pools are already per model.
  - Cars are not in `MODELS`. `LifeSystem` applies the `headlights` mask to its own car material.
- **Glow kinds:**

| Kind | Models | Mask texels (16-col) | Behaviour |
| --- | --- | --- | --- |
| `windows` | 12 suburban houses, supermarket | (11, 1) → `#ffc873` | Staggered per house (below). Intensity ≈ 1.6 so a 20 px house still reads |
| `lamp` | lamppost | (8, 2) → `#fff0c8` | On when `night > 0.3` (0.5 s fade), plus a pool and a halo (§4) |
| `traffic` | both traffic lights | red (9, 1), amber (11, 3), green (15, 3) → own colours ×0.8 | Scales with `night` only (0 by day: baselines). Stretch: cycle red → green → amber by time |
| headlights (LifeSystem) | the car material | (3, 3) → `#fff6d8`, tail (5, 3) → `#ff3a2a` | With `night`; beams in §4 |

- **Windows light up house by house.** A shader patch on the `windows` clones follows the `fx/windSway.ts` pattern: chained `onBeforeCompile`, `customProgramCacheKey`, idempotent.
  - Vertex shader: `vGlowSeed = hash(instanceMatrix[3].xz)` under `USE_INSTANCING`, otherwise `hash(modelMatrix[3].xz)` (ghost and icons use plain meshes). It is a per-house random number that survives reloads because it comes from the house's position.
  - Fragment shader: `totalEmissiveRadiance *= step(vGlowSeed, uLightsOn) * step(uLightsOff, 1.0 - vGlowSeed)`.
  - As dusk falls, houses switch on one by one; late at night about a third go dark again.
  - The uniforms `uLightsOn` and `uLightsOff` are **one shared object** referenced by every patched material, so a frame update is two number writes.
  - Stretch: a second hash on `floor(localY / storey)` so floors light separately.

### 4. Light on the ground — `src/render/NightLights.ts`
- **Contract (done):** `new NightLights(scene, library, town, bus, life, quality, debug)`, `populate()`, `update(sample)`, `getDiagnostics(): { lamps, drawCalls }`, `dispose()`. 16b owns the body.
- **Lamp registry:** listens to `town:changed` and keeps a list of lamps from `TownStateReader` objects and `cellToWorld`, so it is scale-agnostic after WP-12.
  - The lamp head's position in model space is measured **once at load** from the geometry: the centroid of the triangles whose UV lies in the lamp cell. Catalog scale changes can't break it. Apply `MODEL_STYLES.lamppost.scale`, which is exported.
- **Pools of light:** one `InstancedMesh` of flat quads under each lamp head.
  - Material: additive, soft radial gradient drawn by the shader, warm `#ffcf8a`, radius about 1.1 world units (2.2 cells), `depthWrite: false`, polygon offset over the ground.
  - Opacity follows the lamp glow. **+1 draw call** whatever the lamp count.
- **Halos:** one `InstancedMesh` of camera-facing sprites at the lamp heads, additive. **+1 draw call.** High tier only.
- **Headlight beams:** a short additive cone quad on the road ahead of each car (≤ 6). `LifeSystem` exposes the car matrices (16b owns both). **+1 draw call**, drawn only at night.
- **Visibility:** pools, halos and beams are `visible = false` whenever `night < 0.05`, so daytime draw calls and baselines are unchanged.
- **Upgrade path (not in WP-16):** make walls and cars catch lamplight by passing lamp positions as a uniform array (≤ 32) into the town materials, patched the same way.

### 5. Life
- **`LifeSystem.setNight(night)`** (contract, done) → `TrafficSim.setDensity(f)` with `f = 1 − 0.5·night`: target = `max(1, round(target × f))` when roads exist. Extra cars leave through the existing newest-first despawn. Pure and unit-tested.
- **Car front:** verify in the browser, then fix `FRONT_ROTATION` (see the revision note).
- **Stretch: fireflies.** Up to 24 soft points drifting over meadow cells at night, using the cosmetic rng; +1 draw call at night.
  - `fx/**` belongs to nobody in this swarm, so 16b builds them inside `NightLights.ts` or a new `src/render/fireflies.ts`.

### 6. Controls, settings, test hooks
- **HUD:** a **time button** in the top bar's action pill, left of the mute button.
  - Clicking it emits `intent:cycle-time-mode` (Auto → Day → Night → Auto).
  - Icons: sun + moon (Auto), sun (Day), moon (Night). New glyphs go in `ui/glyphs.ts`.
  - It has an `aria-label` and a tooltip ("Time: Auto (T)").
  - Test id `time-mode` (`UI_TEST_IDS.timeMode`).
  - The UI renders from `daytime:changed { mode, phase }`. Game emits it once at boot (from the stored setting) and whenever the mode or phase changes.
  - The top bar must stay one row at 390 px with ≥ 44 px targets.
  - The menu gets a matching "Time of day" row (a 3-way segmented control emitting `intent:set-time-mode`).
  - The help panel lists `T`.
- **Keyboard (contract, done):** `T` → `intent:cycle-time-mode` in `ToolController` (building phase only, like the other keys).
- **Settings (contract, done):** `GameSettings.timeMode: TimeMode` (default `'auto'`). Invalid stored values fall back to the default; the test is in `SaveStore.test.ts`.
- **Test hooks and states (contract, done):**
  - Hook `setTimeOfDay(t: number | null)`: it pins the clock and applies the look at once (even while paused); `null` releases the pin.
  - Every existing test state pins afternoon (0.55), so the **existing 3D look in baselines must not change**.
  - New test state `'night-town'`: the sample town pinned at `T_NIGHT` (every lit house on).
- **Diagnostics (contract, done):** `daytime: { mode, t, phase, pinned, night, lightsOn, lamps, drawCalls }`.

## Contract (landed by the integrator on `v0.3-day-night` before the workers start)
- **`src/game/events.ts`:**
  - `'intent:set-time-mode': { mode }`
  - `'intent:cycle-time-mode': void`
  - `'daytime:changed': { mode, phase }`, emitted once at boot and on a mode/phase change, never per frame.
- **`src/catalog/models.ts`:** `GlowKind`, `ModelSpec.glow`, and the values from §3.
- **`src/world/dayCycle.ts`:** the Contract section: types, constants, `createDaySample`, `phaseAt`, `modeTarget`, `sampleDay`, `DayClock`. The bodies are an afternoon-only stub.
- **`src/persistence/SaveStore.ts`:** `timeMode` in `GameSettings` / `DEFAULT_SETTINGS`, with validation; tests updated.
- **`src/interaction/ToolController.ts`:** the `T` key.
- **`src/vite-env.d.ts`:** diagnostics `daytime`; hook `setTimeOfDay`.
- **`src/game/Game.ts`:**
  - creates the `DayClock` (from `settings.timeMode`) and `NightLights`;
  - `'night-town'` is in `TEST_STATES`, and `tests/smoke.spec.ts` lists it;
  - in `update`: while building, `clock.advance(animDelta)`, then `applyDaylight()` → `environment.applyDaylight`, `nightLights.update`, `life.setNight`, `daytime:changed`;
  - Start → `clock.startDay()`; `applyTestState` pins the clock and applies it;
  - `intent:set-time-mode` / `intent:cycle-time-mode` → clock (snap under reduced motion) + settings.
- **Stubs for the workers to fill in:** `Environment.applyDaylight` (16a), `NightLights` (16b), `LifeSystem.setNight` (16b).

## Budgets
- **Draw calls, main pass:**
  - Day: +0.
  - Night: +2 (pools, halos) +1 (beams) +1 (fireflies, stretch). The stress town must stay ≤ 150 on desktop and ≤ 120 on mobile (32 / 32 today).
  - Windows, lamp heads and traffic lights: +0 (emissive on existing pools).
- **Triangles:** 2 per lamp pool, halo or beam. Negligible, but check against the ~10.9k mobile headroom (stress town 239.1k / 250k).
- **Per frame:** about 20 colour and number blends, a handful of uniform writes, no allocations, and a shadow refit only when the key light has moved.
- **Shader programs:** +1 per window-patched clone (suburban, commercial) and +1 each for the pool, halo and beam materials. Warm them (`renderer.compileAsync`, or a one-frame hidden render) when the pools are built, so the first dusk doesn't stutter.

## Work split
Three WPs run in parallel worktrees branched from `v0.3-day-night`. Each merges back into `v0.3-day-night` (not `main`), in the order 16a → 16b → 16c.

| WP | Branch / worktree / port | Owns | Depends on |
| --- | --- | --- | --- |
| **WP-16a Daylight** | `wp-16a-daylight` · `../ThreeJsGames-wt/wp-16a` · 5215 | `src/world/{dayCycle.ts,dayCycle.test.ts,Environment.ts,Sky.ts,GridOverlay.ts}` | contract commit |
| **WP-16b Night lights** | `wp-16b-night-lights` · `../ThreeJsGames-wt/wp-16b` · 5216 | `src/render/{nightGlow.ts,nightGlow.test.ts,NightLights.ts,NightLights.test.ts,ModelLibrary.ts,TownRenderer.ts}` (style clones and glow registration only), optional new `src/render/fireflies.ts`, `src/life/**`, the car baselines if the front fix changes them | contract commit. Tunes against the stub's afternoon look; uses `setTimeOfDay(0.82)` for night. Real night colours arrive with 16a |
| **WP-16c Controls & QA** | `wp-16c-controls` · `../ThreeJsGames-wt/wp-16c` · 5217 | `src/ui/**`, `src/styles.css`, `tests/*.spec.ts`, `tests/helpers.ts`, the new `night-town` baselines, and regenerating the 4 top-bar baselines | contract commit. The night look is filled in after 16a/16b merge: 16c is resumed for its final pass (baselines, night inspector checks, the 20 s capture) |

Integrator on merge: docs (`03-architecture.md` §Day/night, `02-interaction-and-ui.md`, `progress.md`, `CLAUDE.md`, `models.md` car front) and any contract change requests.

## Acceptance checks
- **`npm run verify` green.** New unit tests:
  - `dayCycle`: continuity at every keyframe and across the 1 → 0 wrap; phase boundaries; afternoon sample equals `LIGHTING`/`SKY_PALETTE`/`SUN_DIRECTION`; mode sweep (forward only) and snap; frozen at `delta = 0`; `startDay`; pin/unpin.
  - Mask row order and cell indices.
  - Lamp registry add/remove/reset.
  - `TrafficSim.setDensity`.
  - `timeMode` settings round-trip and bad-value fallback (done in the contract).
- **`npm run test:e2e` green.**
  - After 16a and after 16b: all 6 existing baselines pass unregenerated. The one exception is 16b's car-front fix, with crops as evidence.
  - After 16c: `title` is unchanged. `sample-town` / `asset-gallery` are regenerated for the time button, with a masked comparison proving no pixel changed outside the top bar. New `night-town` baselines for desktop and mobile.
- **Real input:**
  - Clicking the time button cycles the modes, the choice survives a reload, and `T` cycles too.
  - Night shows lit windows: `diagnostics.daytime.night` ≈ 1 and `lamps` equals the placed lampposts.
- **Inspector** `night-town` desktop and mobile:
  - `luminance.contrast` ≥ 25 (sample-town by day ≈ 48);
  - the ghost preview and grid stay visible (screenshot with a tool hovering);
  - draw calls and triangles within budget; 0 console errors.
- **Stress town at night** (`stress-town` + `setTimeOfDay(0.82)`): draw calls ≤ 150 / 120 and triangles ≤ 400k / 250k.
- **Evidence:** a 20 s capture of Auto mode at `DAY_LENGTH_S` = 20 (a debug-only override, e.g. `?debug&day=20` or the lil-gui `Daylight` folder), running day → dusk → night → dawn. Stills of dusk and night saved to `artifacts/wp-16/`.
- **Reduced motion:** the clock is frozen and mode switches snap.

## Risks
- **Night too dark on phones outdoors:** the contrast floor in the inspector check, and a lil-gui exposure trim.
- **Emissive windows on tiny houses may read as noise at the stress-town zoom:** tune intensity; the stagger keeps the view from looking uniform.
- **Additive pools over the lawn and meadow scatter may band:** use a smooth gradient and dither in the shader if needed.
- **Parallel e2e runs overload the machine.** On 2026-09-27 a full run on an idle-ish machine took 19 min and had 4 timeouts/launch failures that passed on re-run. Workers re-run failures in isolation before reporting them, and stagger full e2e runs.
