# Tiny Town — agent guide

A cosy browser city-builder sandbox: three.js + TypeScript + Vite. The game lives at the repo root.

## Where facts live
- `docs/architecture.md`: module map, data flow, grid, placement rules, save format, rendering, test hooks, diagnostics. If it disagrees with the code, the code wins; fix the doc.
- `docs/game-design.md`: what the game is and isn't, and how the camera, tools and UI behave.
- `docs/assets.md`: where models and sounds come from, scale and orientation conventions, how to rebuild them. `CREDITS.md`: every asset's source and licence.
- `docs/release.md`: build, deploy, debug and test-hook policy, budgets.
- `docs/backlog.md`: known gaps and follow-ups, open until fixed or dropped.
- `docs/mobile-backlog.md`: what a new feature would need if full phone support comes back.
- `CHANGELOG.md`: player-facing notes; "Unreleased" is what's merged on `main` since the last tag.
- History lives in git, not in docs.

Agents live in `.claude/agents/`: `town-modeller` designs and builds models in Blender; `town-visual-inspector` stages objects in the running game and reports visual defects (gaps, flicker, sunk or clipping parts). Run the inspector after adding or changing a model, ground kind or anything in how the town is drawn.

Skills are user-level, in `~/.claude/skills/` (not in this repo). `threejs-game-director` routes to the others: `threejs-gameplay-systems`, `threejs-aaa-graphics-builder`, `threejs-game-ui-designer`, `threejs-qa-release`, `threejs-debug-profiler`. `webgpu-threejs-tsl` covers WebGPU and TSL.

## Phone support
The game was first built with some phone support (touch input, phone layouts, a `mobile-chrome` Playwright project). It is not a priority now: leave that infrastructure as it is, and don't extend or remove it. The `mobile-chrome` project is commented out in `playwright.config.ts`, so no spec runs on a phone.
When a new feature would need extra work to function on a phone, add a short entry to `docs/mobile-backlog.md`: what would have to be done if full phone support comes back. Concise and specific, one entry per feature.

## Commands
```bash
npm run dev            # http://127.0.0.1:5188  (add ?debug for the lil-gui tuning panels)
npm run verify         # local-path check + licences check + typecheck + unit tests + production build  ← must pass before hand-off
npm run typecheck      # tsc --noEmit
npm run test:unit      # vitest, src/**/*.test.ts (pure logic, Node)
npm run test:e2e -- --workers=6   # playwright, tests/*.spec.ts, desktop-chrome only (starts its own dev server)
npm test               # test:unit then test:e2e
npm run verify:visual  # ONLY tests/visual.spec.ts (the load → Start → road-drag smoke journey), NOT the screenshot baselines
npx playwright test tests/visual-regression.spec.ts   # screenshot baselines (darwin only, skipped elsewhere; a missing baseline FAILS)
npm run build && npm run preview   # production build, served on PORT−1000 (default 4188)
npm run inspect:canvas -- --state sample-town --run-id <id> --out artifacts/<id> [--mobile]   # needs a dev server; --mobile = 390×844
npm run inspect:object -- --kind <kind> [--variant all] [--out artifacts/inspect/<kind>]   # stage a kind in the game and photograph it (contact sheets + z-fight counts); also --sweep (against every other kind), scene flags (--ground / --neighbour / --edge), --recipe / --town; needs a dev server, not preview
npm run inspect:models # re-measure/verify the GLBs in public/assets/models (prints a report; add --three to load them via GLTFLoader)
npm run gen:sfx        # regenerate src/audio/sfxTable.ts from scripts/data/audio.json
npm run gen:licenses   # regenerate public/licenses.txt (runtime dependencies + licence texts; verify fails if stale)
node scripts/render-icons.mjs [--size 128] [--only pond,reeds]   # re-render the tool icons (tool-<id>.png, + tool-<id>-v<n>.png per extra model) from in-game models (needs a dev server on PORT)
node scripts/compose-models.mjs              # rebuild public/assets/models/composed/*.glb (needs assets-src/, incl. assets-src/polypizza/)
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-parking.py   # rebuild public/assets/models/parking/*.glb
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-stadium.py   # rebuild public/assets/models/stadium/stadium.glb
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-cars.py   # rebuild public/assets/models/cars/*.glb from the Kenney originals in assets-src/car-kit/
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-pond.py   # rebuild public/assets/models/pond/*.glb
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-road-verges.py   # rebuild the grass fillers in public/assets/models/roads/ (road-end-verge, roundabout-corner-grass, roundabout-island-grass)
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/build-roundabout.py   # rebuild public/assets/models/roads/road-roundabout.glb from the Kenney original in assets-src/city-kit-roads/
```
- **E2E workers.** `playwright.config.ts` sets no worker count, so always pass `--workers=N`. Use 6 on a normal machine: the full suite (117 tests) then takes about 3–4 minutes. In an agent cloud environment with limited hardware use 1–2 workers, and expect it to take much longer.
- If `npm install` fails with EACCES on `~/.npm`, add `--cache .npm-cache`.
- Browser checks (Playwright, `inspect:canvas`, `inspect:object`, `render-icons`) need a session where Chromium can launch; inside a nono sandbox it segfaults. If that happens, say so in your hand-off; don't skip the check.
- **Ports.** The dev server, Playwright, the canvas and object inspectors and `render-icons` honour the `PORT` env var (default 5188, strict); `vite preview` uses `PORT − 1000`. Parallel agents each use their own port (`PORT=5220 npm run test:e2e`). Never kill a dev server you didn't start.
- **Worktrees.** `node_modules/`, `assets-src/` and `artifacts/` are gitignored, so a fresh worktree has none of them: install with the main checkout's `.npm-cache`, read raw assets from the main checkout, and copy `artifacts/` out before `git worktree remove --force` deletes it.

## Hard rules
- Only `TownEditor` mutates town state. UI emits `intent:*` events and renders facts.
- No three.js or DOM in runtime code under `src/town/**` or `src/catalog/**`. Tests may use three (`src/catalog/catalog.test.ts` loads GLBs in Node).
- No `Math.random()`. Use the seeded `rng` you're given.
- Keep `__THREE_GAME_TEST_HOOKS__` real; don't stub them to make a test pass. Installing the hooks must have no side effects (see `docs/release.md`).
- **Save format.** A change to the saved town needs a version bump and a `SAVE_MIGRATIONS` step in `src/town/serialize.ts`, or downloaded town files stop opening.
- **Shared contracts.** These files define the types and constants the whole game builds against: `src/game/events.ts`, `src/game/config.ts`, `src/game/graphics.ts`, `src/catalog/{tools,objects,models}.ts`, `src/town/types.ts`, `src/town/grid.ts`, `src/audio/sfx.ts`, `src/vite-env.d.ts`, and the exported API of `src/world/dayCycle.ts`. Adding an optional field, event or entry is fine. A rename, removal or signature change updates every caller in the same change and is called out in the hand-off. In a multi-agent run, only the integrating agent edits these files.
- **Generated files** are never edited by hand: `src/audio/sfxTable.ts` (`npm run gen:sfx`) and `public/licenses.txt` (`npm run gen:licenses`).
- **Assets.** Allowed sources:
  - CC0;
  - CC-BY, with a `CREDITS.md` entry and a line in the in-game Credits panel (`src/ui/UiRoot.ts`);
  - assets owned and supplied by the project owner (e.g. the background music).

  Record every new asset in `docs/assets.md` and `CREDITS.md`. Agents must never call external generation services.
- Every runtime asset URL goes through `assetUrl()` (`src/game/config.ts`); the build uses a relative `base`.
- Match the surrounding style: strict TS, small classes, explicit `dispose()`, no per-frame allocations in hot paths.
- **Code comments** are rare, short and in the present tense: a non-obvious why, a unit or convention, a gotcha. Public JSDoc is one line unless there is a real gotcha. Never reference tickets, versions, plans, owners or dates in code (comments or test titles), and never narrate what the code used to do.

## Workflow
- One branch per change, off `main`. Agree a plan with the owner before a non-trivial change.
- Merge to `main` only after the owner approves. The owner sets version numbers and tags.
- Before hand-off: `npm run verify`, plus the e2e specs that cover the change (the full `npm run test:e2e` for wide changes). Re-capture visual baselines only for an approved look change.
- With the change: update `CHANGELOG.md` (Unreleased) and whichever of `docs/architecture.md`, `docs/game-design.md`, `docs/assets.md` it makes stale.
- Multi-agent work runs on an integration branch with one worktree per worker, merged into `main` only after the owner approves the whole.

## Hand-off checklist (final message / PR description)
- What changed, and the checks you ran with their output: tests, screenshot paths under `artifacts/<topic>/` (local only, gitignored), diagnostics numbers.
- Shared-contract changes, if any.
- Known gaps and follow-ups.
- Branch and last commit SHA.
