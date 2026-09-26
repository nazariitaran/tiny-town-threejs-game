# Tiny Town — agent guide

A cosy browser city-builder sandbox (three.js + TypeScript + Vite). Start here, then read the work package you were assigned in `docs/PLAN.md`.

## Read before coding
1. `docs/PLAN.md` — work packages, ownership, dependencies, acceptance checks. **Your WP section is your contract.**
2. `docs/design/01-design-brief.md` — what the game is (and isn't).
3. `docs/design/02-interaction-and-ui.md` — camera, gestures, tool behaviour, UI layout/states.
4. `docs/design/03-architecture.md` — module map, data flow, grid conventions, placement rules, budgets.
5. `docs/assets/models.md`, `docs/assets/audio.md` — what assets exist, their scale/orientation, licences.

Skills in `../.claude/skills/` (load them when your WP says so): `threejs-gameplay-systems`, `threejs-aaa-graphics-builder`, `threejs-game-ui-designer`, `threejs-qa-release`, `threejs-debug-profiler`.

## Commands
```bash
npm run dev            # http://127.0.0.1:5188  (add ?debug for lil-gui tuning)
npm run verify         # typecheck + unit tests + production build  ← must pass before hand-off
npm run test:unit      # vitest, src/**/*.test.ts (pure logic)
npm run test:e2e       # playwright, tests/*.spec.ts (starts its own dev server)
npm run inspect:canvas -- --state sample-town --run-id <id> --out artifacts/<id>   # needs dev server running
npm run inspect:models # re-measure GLBs in public/assets/models
npm run gen:sfx        # regenerate src/audio/sfxTable.ts from docs/assets/audio.json
```
If `npm install` fails with EACCES on `~/.npm`, add `--cache ../.npm-cache`.
Browser checks (Playwright, `inspect:canvas`) need a session where Chromium can launch. Inside a nono sandbox it segfaults; say so in your hand-off rather than skipping the check.
Port 5188 is `strictPort`: if it's taken, another agent's dev server is running — use `npx vite --port <free port>` and pass `--url` to the inspector rather than killing it.

## Hard rules
- **Stay inside your WP's owned files.** Contract files (marked `CONTRACT FILE` at the top) and `src/game/Game.ts` belong to the integrator. If you need a contract change, write it under "Contract change requests" in your hand-off. Don't edit them.
- Only `TownEditor` mutates town state. UI emits `intent:*` events and renders facts. No three.js or DOM in runtime code under `src/town/**`, `src/catalog/**`, `src/render/roadTiles.ts` (tests may use three, e.g. `catalog.test.ts` loads GLBs in Node).
- No `Math.random()` — use the seeded `rng` you're given.
- Keep `__THREE_GAME_TEST_HOOKS__` real; don't stub them to make a test pass.
- Assets: only CC0 (or CC-BY with a CREDITS.md entry). Record every new asset in `docs/assets/*.json|md` and `docs/assets/CREDITS.md`. Never call external generation services.
- Match surrounding style: strict TS, small classes, explicit `dispose()`, no per-frame allocations in hot paths.

## Hand-off checklist (put this in your final message / PR description)
- What you built and which acceptance checks you ran, with their output (tests, screenshots paths, diagnostics numbers).
- Files changed (should all be inside your WP's ownership).
- Contract change requests, if any.
- Known gaps / follow-ups.
