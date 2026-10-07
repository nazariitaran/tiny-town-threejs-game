# Rain — prototype findings and plan

A working paper for the `feature/rain` branch. It goes when the feature lands: the lasting facts move to `architecture.md`, `game-design.md` and `CHANGELOG.md`.

## The idea

Rain is ambient, like match nights, birds and ducks: nothing is saved, `TownEditor` never sees it, it never blocks or punishes. Mostly the town is dry. Now and then clouds gather, it rains for a minute or two, and the sky clears. A shower is one of three kinds:

| Kind | Share | Rain | Sky and light | Extras |
| --- | --- | --- | --- | --- |
| Light rain | 45 % | sparse, slow streaks | half cloud, sun dimmed, shadows soften | a soft hiss |
| Rain | 35 % | steady streaks, splashes on the ground | grey sky, no sun, faint shadows, haze over the far side of the plot | fuller sound, trees sway harder |
| Storm | 20 % | builds from rain to a heavy peak and back | dark sky; street lamps, windows and headlights come on by day | lightning (a double flash) and thunder after it, the further the later and quieter |

## Try the prototype

```bash
npm run dev
# http://127.0.0.1:5188/?debug&rain=storm      hold a kind from boot: light | rain | storm
# http://127.0.0.1:5188/?debug                 lil-gui → Weather: hold a kind, start a shower as the schedule would, tune the streaks
```
Without `?debug` the schedule runs for real: the first shower comes 6–16 minutes after Start. Tests and scripts use `__THREE_GAME_TEST_HOOKS__.setWeather('light' | 'rain' | 'storm' | 'clear' | null)` and read `__THREE_GAME_DIAGNOSTICS__.weather`.

Sound needs Start (audio unlock) and is synthesised; see *What is not good yet*.

## What the prototype is

| Part | File | State |
| --- | --- | --- |
| Schedule (pure): dry spell → clouds gather → rain → clear; a storm's heavy peak; lightning strikes and their thunder; targets with fixed fade rates, so nothing snaps | `src/weather/weatherSchedule.ts` (+ 11 unit tests) | close to final |
| Light and sky under weather: `shadeDaySample` rewrites the frame's `DaySample` in place (hidden sun, grey sky and fog, dim flat light, flash); `gloomAt` is the storm's darkness for the town's lights | same file | shape final, numbers need an eye |
| Streaks and splashes: two `InstancedBufferGeometry` meshes animated in the vertex shader, 2 draw calls, none while dry | `src/weather/RainLayer.ts` | works, needs hardening |
| Cloud cover, rain haze (fog), lightning in the sky shader | `src/world/Environment.ts` `applyWeather`, `src/world/Sky.ts` `uFlash` | works |
| Gusts: a multiplier on the foliage breeze | `src/fx/windSway.ts` `setWindGust` | works |
| Sound: filtered-noise rain and a noise-burst thunder, no files | `src/audio/RainSound.ts` | placeholder |
| Wiring, debug panel, hook, diagnostics | `src/game/Game.ts`, `src/vite-env.d.ts` | prototype-grade |

**Streaks.** Each streak has a random seed; its position is the seed plus fall and wind over time, wrapped in a box centred on the view's ground target. The box, the streak size and the fall speed all scale with the camera's distance, so rain covers the screen equally at every zoom (6 to 60 units). The wrap is done in box units and anchored to the world: panning slides the view through the rain, zooming scales it. Streaks are depth-tested, so buildings hide the rain behind them. Count = 2600 × strength (728 in light rain, 1560 in rain, 2600 in a storm), 900 × strength splashes.

**Light.** No new lights and no shadow redraw: the sun's key light drops to 15 %, so shadows fade on their own; the hemisphere light turns grey and dims; the sky colours go grey at their own brightness (so a wet dusk or night keeps its mood); fog comes in to 16–150 units. A flash adds hemisphere light and lifts the sky for under half a second.

## What the prototype showed

Captures are in `artifacts/rain/` (local, gitignored): `day-clear`, `day-light`, `day-rain`, `day-storm`, `day-storm-flash`, `close-rain`, `close-storm`, `far-storm`, `low-storm`, `low-storm-flash`, `night-rain`, `night-storm-flash`, `dusk-rain`. Sample town, Medium preset, 1280 × 720.

**Works**
- The three kinds read as different at a glance, by the light as much as by the streaks.
- A storm by day with the lamps, windows and headlights on is the best picture of the lot: cosy, not threatening. It costs nothing new (the night lights are fed a darker `night`).
- Rain looks the same close up and zoomed right out; the haze gives the far view depth.
- A dry town is untouched: `shadeDaySample(…, 0, 0)` is bit-identical (unit-tested), the sky's flash term is a sum of zero, the rain meshes are hidden. See *Checks*.
- Cost in a storm: +2 draw calls and +7.0k triangles for the rain; +3 draw calls by day for the night-light layers a storm switches on. No textures, no shadow passes, no per-frame allocations.
- Over 4 hours of simulated play (three seeds): 17 showers, raining 12.5 % of the time, about one storm in five showers.

**What is not good yet**
- **Nobody has watched it move or listened to it.** Everything above was judged on stills. Fall speed, flicker at the 30 fps idle cap (and on Low), the slide while zooming and all of the sound need a person at `?debug&rain=storm`.
- **Sound is a placeholder.** Synthesised noise is passable for a rain hiss; synthesised thunder rarely is. See decision 2.
- **The flash washes the picture out**: it lifts the fog with the horizon, so the whole plot goes pale and the streaks vanish. Lighting the hemisphere and the sky only would give contrast instead. There is no visible bolt.
- **Night rain is dark.** Clouds take the moonlight, which is most of the night's light; tuned once, needs an eye. The grid overlay also reads stronger under gloom and should dim with the cloud.
- **Rain falls through roofs.** Streaks are hidden behind a building but pass through it, so they show inside the stadium bowl (correct) and would show under any future canopy (wrong). Splashes are drawn at ground level only: none on roofs or roads' kerbs, and they float 0.018 above pond water.
- **Reduced motion freezes the streaks mid-air** (`setReducedMotion(true)` stops their clock). They should be hidden there. The OS setting only removes the flashes for now; see decision 3.
- **The Low preset draws the full count.** `RainLayer.density` exists but no preset sets it.
- **Photos** take the rain as it is; unchecked at the photo's raised pixel ratio. The Polaroid still stamps a sun or moon.
- **`Game.ts` wiring is rough**: the weather filter, the lights' darker sample and the rain update sit inline in `applyDaylight` and `update`.

## Decisions for the owner

1. **How often.** Prototype: a dry spell of 6–16 minutes (an Auto day is 9), so about four showers an hour and a storm roughly every 75 minutes. Rarer (say 12–30 minutes) is one constant.
2. **Sound source.** (a) Keep it synthesised: no files, no licence, but it will take tuning by ear and the thunder may never convince. (b) CC0 recordings (one rain loop, three thunderclaps) built by a script like `build-crowd.py`: about 300–400 kB, fetched on first use like the crowd. Recommended: (b), at least for thunder. Someone has to pick the recordings; agents may not call generation services.
3. **Player control.** Recommended: Menu → a "Rain" switch (a setting, default on; settings are not the save format, so no version bump). Under the OS "reduce motion" setting: no flashes and no streaks, but the grey sky, lamps and sound stay.
4. **Lamps and windows on in a daytime storm.** Prototype: yes. It is the cosiest part, but it also means homes "wake up" at midday.
5. **What the town does in the rain.** Prototype: no new flocks of birds, foliage sways harder, cars get headlights in a storm. Not done, each a small choice: fireflies stay in (cheap), ducks carry on (they like it), the stadium crowd plays on, cars slow a little.
6. **Telling the player.** Prototype: nothing in the UI. Options: the time-of-day button's glyph gains a cloud while it rains; the photo stamps a cloud. Recommended: the photo stamp only; the sky is the indicator.
7. **Title screen.** Prototype: always dry (the clock does not run there either).

## Implementation plan

Each step ends green on `npm run verify`; steps 2–4 end with the visual baselines unchanged.

1. **Schedule** (`src/weather/weatherSchedule.ts`). Settle the numbers from decision 1. Weather gets its own seeded stream (entropy per page load, `seed()` pins it; test states switch spontaneous showers off until a reload, like flocks). Keep the unit tests; add the reduce-motion and reset cases.
2. **`WeatherSystem`** (`src/weather/WeatherSystem.ts`, new): owns the schedule and the `RainLayer`, exposes `advance`, `shade(daySample)`, `update(camera)`, `settle()`, `getDiagnostics()`. `Game` shrinks to three calls. Frame order: `stepWeather` after `stepMatch` (building only, `animDelta`); the shade inside `applyDaylight` before any consumer reads the sample; the rain layer after `applyDaylight`.
3. **Rain layer hardening.** Density per graphics preset (`GRAPHICS_PROFILES.rainDensity`: Low 0.5, others 1 — a shared-contract addition in `game/graphics.ts`). Hide streaks under reduced motion; pin the streak clock under `setPausedForScreenshot` so a capture is repeatable. Splashes: on the pond's water level over pond cells, or dropped there. Check the photo path.
4. **Light, sky and lights.** Flash on the hemisphere and sky only, not the fog. Night numbers. Grid dims with cloud. `NightLights.update` already takes just `night / lightsOn / lightsOff`; pass the storm-darkened values through a named sample instead of the inline object. Run the `town-visual-inspector` on a storm by day and by night.
5. **Sound** per decision 2: `audio/RainLoop.ts` on the `CrowdLoop` pattern (lazy fetch, gain per frame, duck in menus, silent when muted or hidden) plus thunder one-shots through the SFX table (`scripts/data/audio.json` → `npm run gen:sfx`), or the synthesised `RainSound` cleaned up. Assets recorded in `docs/assets.md` and `CREDITS.md`.
6. **Setting and UI** per decisions 3 and 6: `settings.rain`, `intent:set-rain` and a fact event (additions to `game/events.ts`), the menu switch in `UiRoot`, the photo glyph.
7. **Town reactions** per decision 5: birds (`FlockSim` takes a `raining` flag instead of the `setAuto` hack), anything else chosen.
8. **Hooks, diagnostics, tests.** `setWeather` and `diagnostics.weather` become required in `vite-env.d.ts`. `tests/weather.spec.ts`: a forced storm draws streaks and adds exactly 2 calls; `clear` removes them; a test state never rains; lamps come on in a daytime storm; the audio state follows; reduced motion shows no streaks or flashes. One `storm-town` visual baseline once the streak clock can be pinned.
9. **Budgets and docs.** Measure CPU per frame and GPU busy in a storm on the stress town, Low and Medium (`docs/release.md` method). Then `architecture.md` (module map, frame order, a Weather section, hooks, diagnostics), `game-design.md`, `release.md`, `CHANGELOG.md`, and one line in `mobile-backlog.md` (rain cost is unmeasured on a phone GPU). Delete this file.

**Shared contracts touched:** `vite-env.d.ts` (hook and diagnostics, added), `game/graphics.ts` (`rainDensity`, added), `game/events.ts` (setting intent and fact, added). No renames or removals. `world/dayCycle.ts` is not changed: weather filters a `DaySample`, it does not extend it. **Save format:** untouched.

## Later, if wanted
A visible lightning bolt on the horizon; wet ground (darker, glossier roads, puddles that dry); rings on pond water; a rainbow as the sky clears; rain on the title screen; snow by the same machinery.

## Checks run on the prototype
- `npm run verify`: passes (43 files, 724 unit tests, production build; main chunk 392 kB).
- `npm run test:e2e -- --workers=6`: 117 passed, including the four desktop visual baselines (title, sample town, asset gallery, night town), so a dry town draws as before.
- Not run: any spec of rain itself (none exists yet), a production preview, CPU / GPU timing, the visual inspector.
