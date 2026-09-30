# Tiny Town — agent guide

A cosy browser city-builder sandbox (three.js + TypeScript + Vite). Start here. If you were given a work package (WP), read its section in `docs/PLAN.md` next.

## Current state (v0.5 cut on `main`, package 0.5.0, tag `v0.5`)
- **v0.5** (2026-09-30) = WP-20 to WP-25 (each listed below): town names, town files, birds, new build items, the frame budget, graphics presets and the tabbed menu. Player-facing notes: `CHANGELOG.md`. Release measurements: `docs/release.md` (v0.5 column).
- **v0.4** (2026-09-28): WP-17 (bigger buildings, save v4), the 64 × 64 plot (with the Zebra crossing tool and right-click deselect), WP-18 (music resumes where it left off), tall trees (taller pine, big 2 × 2 oak) and **WP-19 town photo** (top-bar camera / `P` → a Polaroid JPEG via a preview with Download; `src/photo/**`, `03-architecture.md` §Town photo). Release measurements: `docs/release.md`.
- **v0.2**: v1 (checkpoint M3) plus WP-12, WP-13 and WP-14.
  - WP-12: 48 × 48 grid of 0.5-unit cells, roads in 2 × 2 blocks, multi-cell houses, save v2 with migration. (The plot is **64 × 64** cells since 2026-09-28; see `docs/design/03-architecture.md` §Grid.)
  - WP-13: streamed background music.
  - WP-14: stats pill removed; the top bar is one row.
- **v0.3, part 1: WP-15 "New building blocks & categories"**, merged on `main` (`2e4604f`).
  - Five dock categories: Streets / Homes / Town / Nature / Garden (Shift+1–5); 33 placing tools plus Bulldoze (34 with the Zebra crossing, 2026-09-28: a road marking drawn by the road tile under it; see `03-architecture.md` §Grid).
  - New items, among them the roundabout (a block-aligned "road feature" object), traffic lights, more homes, town buildings and garden items.
  - Renamed ids (`oak`, `pine`, `birch`, `cottage`, `townhouse`, `family-home`, `fence-low`); tool icons are `public/assets/icons/tool-<id>.png`.
  - Save v3 with **no migrations** (now v4 after WP-17): older saves are rejected and the game starts a fresh town.
  - The first CC-BY assets (Poly Pizza church, swing and barbecue); see `docs/assets/CREDITS.md`.
- **v0.3, part 2: WP-16 "Day/night cycle"**, merged on `main` (owner-approved; built on the integration branch `v0.3-day-night`).
  - Auto / Day / Night: the time button, `T` and the menu row.
  - Lit house windows, lamp pools, traffic lights, headlights, fireflies, fewer cars at night. Shops and the church stay dark (WP-17).
  - `night-town` test state and hook `setTimeOfDay`.
  - Current facts: `docs/design/03-architecture.md` §Day/night. The plan (historical) is `docs/plans/wp-16-day-night.md`.
- **WP-20 "Name your town"**, merged on `main` (owner-approved 2026-09-29; part of v0.5): a name dialog before every new town (30 characters, a random suggestion from `public/data/default_town_names.json`), rename from the top-left pill or the menu, the name in the save (`SavedTownV4.name`) and on the photo card. three.js is now its own vendor chunk. Plan: `docs/plans/wp-20-town-name.md`.
- **WP-21 "Town file"**, merged on `main` (owner-approved 2026-09-29; part of v0.5): download the town as a `.tinytown.json` file and open one again (the top-bar folder, Menu → Town file on phones, or the title link), with a confirm before replacing. **Save-format changes now need a `SAVE_MIGRATIONS` step**, or downloaded towns stop opening. Plan: `docs/plans/wp-21-town-file.md`.
- **WP-22 "Birds over the town"**, merged on `main` (owner-approved 2026-09-29; part of v0.5): now and then a flock (pigeons, starlings, geese in a V, gulls) crosses the plot, none at night; a procedural 18-triangle bird in one `InstancedMesh` with flapping wings and shadows (`src/life/FlockSim.ts` + `BirdSystem.ts`). Test states switch spontaneous flocks off until a reload; hook `spawnFlock(species?)`, `?debug&flock=N`. Current facts: `03-architecture.md` §Birds; plan: `docs/plans/wp-22-birds.md`.
- **WP-23 "New build items"**, merged on `main` (owner-approved 2026-09-29; part of v0.5): 7 new tools (mailbox, tiered fountain, donut shop, tulips, long bench, table, slide; 40 placing tools in all), the garage removed, the pool moved to Garden, up to 12 tools per category (digits for the first nine); the Kenney Nature Kit is usable through a compose-script material fix. Plan: `docs/plans/wp-23-new-items.md`.
- **WP-24 "Frame budget"** and **WP-25 "Graphics settings + tabbed menu"**, merged on `main` together (owner-approved 2026-09-30; part of v0.5).
  - WP-24: the loop is capped at 60 fps while the player interacts and 30 fps when idle (`core/FrameBudget.ts`, `core/Loop.ts` `paceFrame`); the sun's shadow map is redrawn on demand (`render/ShadowScheduler.ts`: town changes, sun refits, tweens; cars and birds 30 Hz); the `town:stats` event is gone. Diagnostics `perf`.
  - WP-25: Menu → Graphics Low / Medium / High (`game/graphics.ts`, saved in the settings, Medium default on every device; `?graphics=` override). MSAA and the material (Lambert on Low) need a reload; the rest applies live. Low also renders at 0.75 of the screen's density on DPR-1 screens (`renderScale`). The menu is tabbed: Town · Graphics · Sound · Help (`openMenuTab` in `tests/helpers.ts`). Diagnostics `graphics`.
  - Current facts: `03-architecture.md` §Frame budget and §Graphics presets; plan: `docs/plans/wp-25-graphics-and-menu-tabs.md`. **Open owner decision:** mobile triangles on Medium (324.1k on the WP-25 dev server, 328.3k on the v0.5 production preview, vs the 320k budget), options in `docs/progress.md`.
- Status, decisions, open issues and the backlog are in `docs/progress.md`, the integrator's recovery point. Read it before planning anything.
- Current facts (grid, rules, save format, modules, diagnostics, budgets) are in `docs/design/03-architecture.md`.
- Some docs are historical snapshots, and each says so in a banner at the top:
  - `docs/checkpoints/*`;
  - the v0.1 sections of `docs/PLAN.md`;
  - `docs/plans/wp-12-scale.md` and `docs/plans/wp-16-day-night.md`, which are approved plans and not the as-built record.

## Read before coding
1. `docs/progress.md` — current state, open issues, next actions.
2. `docs/PLAN.md` — WP ownership, dependencies and acceptance checks. **Your WP section is your contract.**
3. `docs/design/01-design-brief.md` — what the game is (and isn't).
4. `docs/design/02-interaction-and-ui.md` — camera, gestures, tool behaviour, UI layout/states.
5. `docs/design/03-architecture.md` — module map, data flow, grid, placement rules, save format, budgets, test hooks.
6. `docs/assets/models.md`, `docs/assets/audio.md`, `docs/assets/CREDITS.md` — which assets exist, their scale/orientation and their licences.
7. `docs/HANDOVER.md` — how a swarm is orchestrated: worktrees, ports, merge runbook, hand-off format.
8. `docs/release.md` — build, deploy, debug/test-hook policy, measured budgets.

Skills live in `../.claude/skills/`. Load them when your WP says so: `threejs-gameplay-systems`, `threejs-aaa-graphics-builder`, `threejs-game-ui-designer`, `threejs-qa-release`, `threejs-debug-profiler`.

## Commands
```bash
npm run dev            # http://127.0.0.1:5188  (add ?debug for the lil-gui tuning panels)
npm run verify         # local-path check + licences check + typecheck + unit tests + production build  ← must pass before hand-off
npm run typecheck      # tsc --noEmit
npm run test:unit      # vitest, src/**/*.test.ts (pure logic, Node)
npm run test:e2e       # playwright, tests/*.spec.ts, desktop-chrome + mobile-chrome (starts its own dev server)
npm test               # test:unit then test:e2e
npm run verify:visual  # ONLY tests/visual.spec.ts (the load → Start → road-drag smoke journey), NOT the screenshot baselines
npx playwright test tests/visual-regression.spec.ts   # screenshot baselines (darwin only; a missing baseline FAILS)
npm run build && npm run preview   # production build, served on PORT−1000 (default 4188)
npm run inspect:canvas -- --state sample-town --run-id <id> --out artifacts/<id> [--mobile]   # needs a dev server; --mobile = 390×844
npm run inspect:models # re-measure/verify the GLBs in public/assets/models (prints a report; add --three to load them via GLTFLoader)
npm run gen:sfx        # regenerate src/audio/sfxTable.ts from docs/assets/audio.json
npm run gen:licenses   # regenerate public/licenses.txt (runtime dependencies + licence texts; verify fails if stale)
node scripts/render-icons.mjs [--size 128]   # re-render the 38 tool icons (tool-<id>.png) from in-game models (needs a dev server on PORT)
node scripts/compose-models.mjs              # rebuild public/assets/models/composed/*.glb (needs assets-src/, incl. assets-src/polypizza/)
```
- **`inspect:models` and `docs/assets/models.json`.** By default the script only prints; it doesn't touch `models.json`. **Never run it with `--json docs/assets/models.json`.** That flag writes the script's raw report, which has a different schema, and would clobber the hand-maintained manifest: ids, `suggestedScale`, `footprintCells` (hand-edited for WP-12 and v0.3), notes and icons. If a scale or footprint changes in `catalog/`, edit `models.json` and `models.md` by hand.
- If `npm install` fails with EACCES on `~/.npm`, add `--cache ../.npm-cache`.
- Browser checks (Playwright, `inspect:canvas`, `render-icons`) need a session where Chromium can launch. Inside a nono sandbox Chromium segfaults. If that happens, say so in your hand-off; don't skip the check.
- **Ports.** The dev server, Playwright, the canvas inspector and `render-icons` all honour the `PORT` env var (default 5188, strict). `vite preview` uses `PORT − 1000`. Parallel agents each use their assigned port: `PORT=5203 npm run dev`, `PORT=5203 npm run test:e2e`, `PORT=5203 npm run inspect:canvas -- ...`. Never kill a dev server you didn't start.
- **Worktrees.** `node_modules/`, `assets-src/` and `artifacts/` are gitignored, so none of them exist in a fresh worktree.
  - Run `npm install --cache "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.npm-cache"`. It resolves to the main checkout's shared cache from any worktree.
  - Read raw assets from the main checkout's `tiny-town/assets-src/` by absolute path.
  - Evidence under `artifacts/` is local only. **Copy `artifacts/<wp>/` into the main checkout before `git worktree remove --force`, which deletes it.** WP-07's audio recording was lost this way.

## Hard rules
- **Stay inside your WP's owned files.** Contract files (marked `CONTRACT FILE` at the top: `game/events.ts`, `game/config.ts`, `catalog/*.ts`, `town/types.ts`, `town/grid.ts`, `audio/sfx.ts`, `vite-env.d.ts`), plus `src/game/Game.ts`, `src/main.ts`, `index.html` and the generated `audio/sfxTable.ts`, belong to the integrator. If you need a contract change, write it under "Contract change requests" in your hand-off; don't edit these files. The integrator may delegate named contract files to one WP for one change, as it did for WP-12; the WP section must say so.
- Only `TownEditor` mutates town state. UI emits `intent:*` events and renders facts.
- No three.js or DOM in runtime code under `src/town/**` (including the road autotile, `town/roadTiles.ts`) or `src/catalog/**`. Tests may use three; for example, `src/catalog/catalog.test.ts` loads GLBs in Node.
- No `Math.random()`. Use the seeded `rng` you're given.
- Keep `__THREE_GAME_TEST_HOOKS__` real; don't stub them to make a test pass. Installing the hooks must have no side effects (see `docs/release.md`).
- **Assets.** Allowed sources:
  - CC0;
  - CC-BY, with a `CREDITS.md` entry and a line in the in-game Credits panel (`src/ui/UiRoot.ts`);
  - assets owned and supplied by the project owner (e.g. the background music, which the owner made with ElevenLabs).

  Record every new asset in `docs/assets/*.json|md` and `docs/assets/CREDITS.md`. Agents must never call external generation services.
- Every runtime asset URL goes through `assetUrl()` (`src/game/config.ts`); the build uses a relative `base`.
- Match the surrounding style: strict TS, small classes, explicit `dispose()`, no per-frame allocations in hot paths.

## Hand-off checklist (put this in your final message / PR description)
- What you built, and which acceptance checks you ran, with their output: tests, screenshot paths under `artifacts/<wp>/` (local only, gitignored), diagnostics numbers.
- Files changed. All of them should be inside your WP's ownership; flag any exception.
- Contract change requests, if any.
- Known gaps and follow-ups.
- Branch and last commit SHA.
