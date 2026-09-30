# WP-22 — Birds over the town (plan, 2026-09-29)

> **Approved plan, implemented and merged into `main`** (owner-approved 2026-09-29 with every decision below; built on the branch `wp-22-birds` from `493635d`). This is the plan, not the as-built record. As-built facts go to `03-architecture.md` and `progress.md` ("WP-22 as built").

## Owner request (2026-09-29)
> For the birds — I envisage it as just occasionally some birds fly over the town.

The owner read the squirrels-and-birds analysis (Desktop, 2026-09-29), chose **birds only** ("forget about squirrels") and asked for a plan, an implementation and tests. The analysis's defaults are taken as decisions: no flocks at night, a little more often at dawn and dusk, birds also over the title screen, no sound for now. The owner can overrule any of them at review.

## Decisions
1. **Flocks, not single birds.** Every so often a small flock crosses the plot and flies off the far side. It is ambience only: no input, no save, and nothing in the town changes.
2. **When:**
   - The first flock comes 10–25 s after the page loads (so the title screen usually gets one).
   - After that, the wait between flocks is 45–110 s.
   - At dawn and dusk the wait is × 0.6.
   - Trees shorten it by up to 25 % (full effect at 40 trees): a greener town sees a few more birds.
   - **No new flock at night** (night > 0.5); a flock already in the air finishes its crossing.
   - At most 2 flocks in the air at once.
   - Seeded like everything else (never `Math.random`).
3. **Species** (one per flock). They are palette and behaviour on the same procedural bird:

   | Species | Colour | Size | Birds | Flight | Formation |
   | --- | --- | --- | --- | --- | --- |
   | Pigeons | blue-grey | 1.0 | 4–7 | flap ~4.5 Hz, short glides | loose cloud |
   | Starlings | dark slate | 0.8 | 6–9 | flap ~6 Hz, rare glides | tight cloud |
   | Geese | warm brown-grey | 1.35 | 5–9 | flap ~3 Hz, steady | **V** |
   | Gulls | off-white | 1.3 | 2–4 | flap ~2.5 Hz, long glides | loose line |

   Starlings are likelier at dusk, and pigeons and gulls by day.
4. **Path:** the flock enters about 34 units from the plot centre (the plot is 32 × 32), at a random compass angle. It flies a quadratic Bézier whose control point lies within 6 units of the centre, so it **passes over the town**, and leaves on the far side (the exit angle is within ±35° of opposite).
   - **Speed:** 2.4–3.2 units/s, so a crossing takes about 22–28 s.
   - **Altitude:** a low lane (2.8–3.0) or a high lane (3.3–3.5), and a second flock in the air takes the other lane, so crossing flocks never fly through each other. Birds stay within ±0.12 of their lane. That is above the church (2.33), and below `PLOT_CONTENT_HEIGHT` (4), so the birds stay inside the sun's shadow frustum and **their shadows glide over the roofs**.
   - Birds grow in and shrink out over the first and last 6 % of the path, so they never pop at the edge of a zoomed-out view.
5. **Motion per bird:**
   - its own flap phase and flap/glide rhythm (wings held slightly up in a glide);
   - a slow wander about its formation slot;
   - it banks into the flock's turn;
   - its outer wing lags the inner one, for a soft stroke.
6. **Look:** a **procedural low-poly bird** (18 triangles: a faceted body, a tail and two-segment wings), flat-shaded like the Kenney models. There is no asset and no licence. The wingspan is about 0.36 units × the species size, about 10 px at the default camera. Its only tunables are the global scale and the speed (lil-gui `Birds`).
7. **Rendering:**
   - One `InstancedMesh` (at most 16 birds) with a per-instance colour.
   - A per-instance `aFlap` (inner and outer wing angle) written by the CPU each frame; the wings are rotated in the vertex shader.
   - The same patch goes on the shadow depth material, so **the shadow flaps too**.
   - The mesh is hidden when no bird is in the air.
   - Cost: +1 main-pass and +1 shadow draw call while a flock is up, 0 otherwise; ≤ 16 × 18 = 288 triangles. No per-frame allocation.
8. **Reduced motion and tests:**
   - `setReducedMotion(true)` and the OS "reduce motion" setting: no new flocks, and the test hook clears any in flight. (A bird frozen in mid-air would look broken; the fx system clears its particles the same way.)
   - **Test states switch spontaneous flocks off until a reload**, as they do autosave. Screenshot baselines and draw-call tests therefore never meet a surprise flock.
   - A new test hook, `spawnFlock(species?)`, launches one on demand. It returns the number of birds, or 0 when the cap is reached.
   - `?debug&flock=N` sets an N-second wait between flocks, for evidence and playtesting (debug only, like `?debug&day=N`).
9. **Photo:** a flock in view is in the photo. That's intended: a lucky postcard.

## Design
- **Pure sim `src/life/FlockSim.ts`** (no three.js; unit-tested):
  - the scheduler (`auto` on/off, `setNight(night, phase)`, `setTrees(n)`);
  - `spawn(species?)`, `step(dt)` and `reset(seed)`;
  - flocks and birds with world position, yaw, bank and wing angles;
  - its own mulberry32 stream: it never draws from `Game.fxRng`, so cars, sounds and fx don't shift;
  - `step(0)` changes nothing.
- **Renderer `src/life/BirdSystem.ts`:**
  - owns the sim, the procedural geometry (`createBirdGeometry`), the material patch plus the depth material, and the instanced mesh;
  - `update(animDelta)`, `setDaylight(night, phase)`, `settle()`, `reset(seed)`, `setAuto(on)`, `spawnFlock(species?)`, `getDiagnostics()`, `dispose()`;
  - the lil-gui `Birds` folder;
  - it listens to `town:changed` for the tree count.
- **Contract changes (integrator = this WP):**
  - `Game.ts`: construct, update after `LifeSystem.update`, `setDaylight` in `applyDaylight`, and reset plus auto-off in `applyTestState`; settle under reduced motion; the `seed` hook re-seeds; also dispose, diagnostics `birds`, the `spawnFlock` hook, `?debug&flock=N`, and the OS reduced-motion check;
  - `vite-env.d.ts`: `ThreeGameDiagnostics.birds` and `ThreeGameTestHooks.spawnFlock`.
- **Diagnostics `birds`:** `{ auto, flocks, birds, spawned, nextFlockIn, species[], drawCalls, shadowDrawCalls, positions: [{x, y, z}] }` (rounded, for the e2e checks).

## Files
- new: `src/life/FlockSim.ts`, `src/life/BirdSystem.ts`, `src/life/birds.test.ts`, `tests/birds.spec.ts`, this plan;
- contract: `src/game/Game.ts`, `src/vite-env.d.ts`;
- docs: `PLAN.md` (WP-22), `03-architecture.md` (module map, frame order, rendering, day/night, budgets, hooks, diagnostics), `01-design-brief.md` (reward hooks line), `progress.md`.

## Acceptance
- `npm run verify` green. The unit tests cover:
  - the scheduler: first flock and interval bounds, dawn/dusk and trees shortening, no spawns at night or with auto off, the 2-flock and 16-bird caps;
  - determinism by seed;
  - `step(0)` freezes;
  - every bird stays in the altitude band;
  - the path passes within about 6 units of the centre, and every flock is removed after it exits;
  - birds in a flock never overlap;
  - the geometry's triangle count;
  - wing angles bounded.
- `tests/birds.spec.ts` (desktop + mobile):
  - `spawnFlock` over the sample town gives birds in diagnostics, in the altitude band, moving, and +1 draw call exactly. A desktop run watches a whole crossing until the flock is gone and saves screenshots to `artifacts/wp-22/`;
  - test states never spawn by themselves;
  - `?debug&flock=3` spawns spontaneously on the title and while building;
  - at night nothing spawns;
  - reduced motion clears the sky.
- Full e2e green; **visual baselines unchanged** (no bird can be in them).
- Budgets: stress town +0 calls with no flock; +1 / +1 shadow with a flock.
