# Tiny Town — agent guide

A cosy browser city-builder sandbox (three.js + TypeScript + Vite). Start here. If you were given a work package (WP), read its section in `docs/PLAN.md` next.

## Current state (v0.4 cut on `main`, package 0.4.0, tag `v0.4`; v0.2 released)
- **v0.4** (2026-09-28): WP-17 (bigger buildings, save v4), the 64 × 64 plot (with the Zebra crossing tool and right-click deselect), WP-18 (music resumes where it left off), tall trees (taller pine, big 2 × 2 oak) and **WP-19 town photo** (top-bar camera / `P` → a Polaroid JPEG via a preview with Download; `src/photo/**`, `03-architecture.md` §Town photo). Release measurements: `docs/release.md`.
- **v0.2**: v1 (checkpoint M3) plus WP-12, WP-13 and WP-14.
  - WP-12: 48 × 48 grid of 0.5-unit cells, roads in 2 × 2 blocks, multi-cell houses, save v2 with migration. (The plot is **64 × 64** cells since 2026-09-28; see `docs/design/03-architecture.md` §Grid.)
  - WP-13: streamed background music.
  - WP-14: stats pill removed; the top bar is one row.
- **v0.3, part 1: WP-15 "New building blocks & categories"**, merged on `main` (`ea54bb5`).
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
- **WP-20 "Name your town"**, merged on `main` (owner-approved 2026-09-29; no version label): a name dialog before every new town (30 characters, a random suggestion from `public/data/default_town_names.json`), rename from the top-left pill or the menu, the name in the save (`SavedTownV4.name`) and on the photo card. three.js is now its own vendor chunk. Plan: `docs/plans/wp-20-town-name.md`.
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
npm run verify         # typecheck + unit tests + production build  ← must pass before hand-off
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
node scripts/render-icons.mjs [--size 128]   # re-render the 34 tool icons (tool-<id>.png) from in-game models (needs a dev server on PORT)
node scripts/compose-models.mjs              # rebuild public/assets/models/composed/*.glb (needs assets-src/, incl. assets-src/polypizza/)
```
- **`inspect:models` and `docs/assets/models.json`.** By default the script only prints; it doesn't touch `models.json`. **Never run it with `--json docs/assets/models.json`.** That flag writes the script's raw report, which has a different schema, and would clobber the hand-maintained manifest: ids, `suggestedScale`, `footprintCells` (hand-edited for WP-12 and v0.3), notes and icons. If a scale or footprint changes in `catalog/`, edit `models.json` and `models.md` by hand.
- If `npm install` fails with EACCES on `~/.npm`, add `--cache ../.npm-cache`.
- Browser checks (Playwright, `inspect:canvas`, `render-icons`) need a session where Chromium can launch. Inside a nono sandbox Chromium segfaults. If that happens, say so in your hand-off; don't skip the check.
- **Ports.** The dev server, Playwright, the canvas inspector and `render-icons` all honour the `PORT` env var (default 5188, strict). `vite preview` uses `PORT − 1000`. Parallel agents each use their assigned port: `PORT=5203 npm run dev`, `PORT=5203 npm run test:e2e`, `PORT=5203 npm run inspect:canvas -- ...`. Never kill a dev server you didn't start.
- **Worktrees.** `node_modules/`, `assets-src/` and `artifacts/` are gitignored, so none of them exist in a fresh worktree.
  - Run `npm install --cache <repo-parent>/ThreeJsGames/.npm-cache`.
  - Read raw assets from the main checkout's `tiny-town/assets-src/` by absolute path.
  - Evidence under `artifacts/` is local only. **Copy `artifacts/<wp>/` into the main checkout before `git worktree remove --force`, which deletes it.** WP-07's audio recording was lost this way.

## Hard rules
- **Stay inside your WP's owned files.** Contract files (marked `CONTRACT FILE` at the top: `game/events.ts`, `game/config.ts`, `catalog/*.ts`, `town/types.ts`, `town/grid.ts`, `audio/sfx.ts`, `vite-env.d.ts`), plus `src/game/Game.ts`, `src/main.ts`, `index.html` and the generated `audio/sfxTable.ts`, belong to the integrator. If you need a contract change, write it under "Contract change requests" in your hand-off; don't edit these files. The integrator may delegate named contract files to one WP for one change, as it did for WP-12; the WP section must say so.
- Only `TownEditor` mutates town state. UI emits `intent:*` events and renders facts.
- No three.js or DOM in runtime code under `src/town/**`, `src/catalog/**` or `src/render/roadTiles.ts`. Tests may use three; for example, `src/catalog/catalog.test.ts` loads GLBs in Node.
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
