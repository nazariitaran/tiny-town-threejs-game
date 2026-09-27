# Tiny Town — Swarm Handover

How to run a swarm of agents on Tiny Town. This reusable runbook was used for v0.1 (Waves 1–3, M1–M3) and v0.2 (WP-12/13/14). The current state is in `docs/progress.md`. It contains:

- **§1 Orchestrator prompt:** paste it into ONE Claude Code session. That session becomes the integrator (WP-01) and runs every wave.
- **§2 Worker prompt template:** the orchestrator uses it to brief each worker. You can also paste it into separate sessions yourself.
- **§3 Per-WP briefs:** branch, port, extra warnings.
- **§4 Merge & checkpoint runbook.**
- **§5 When to stop and ask the human.**

Source of truth for *what* to build: `docs/PLAN.md`. Source of truth for *how* to work: `CLAUDE.md`. This file only covers *orchestration*.

---

## 0. Before you start (human, one-time)

1. **Start from a clean, committed `main`** (`git status` clean in `ThreeJsGames/`). Worktrees branch from the latest commit, so anything uncommitted is invisible to workers. New WP sections must be committed to `docs/PLAN.md` before you fan out.
2. **Run the orchestrator where Chromium can launch.** Start that Claude Code session outside the nono sandbox, or with a profile that allows Chromium's profile directories. Subagents inherit the parent's sandbox, and almost every WP needs a browser for its acceptance checks.
3. **Start the session from the repo root:** `cd <repo-parent>/ThreeJsGames && claude`.
4. **Paste §1.** For a new iteration, first edit the wave list in the prompt and §3 to the new WPs. Expect a wave to take a few hours of agent time. The orchestrator reports back at each checkpoint.

---

## 1. Orchestrator prompt (paste everything in the box)

> The prompt was written for the v0.1 waves; the wave/WP names in PHASE 1–5 are that iteration's. For a later iteration, keep the procedure and STANDING RULES and swap in the new WPs and their §3 rows. Its facts were updated on 2026-09-27.

````text
You are the INTEGRATOR (WP-01) and orchestrator for "Tiny Town", a three.js sandbox city
builder in ./tiny-town. You coordinate a swarm of worker agents that implement the work
packages (WPs) in tiny-town/docs/PLAN.md in parallel, each in its own git worktree, then
merge, verify and run checkpoints until v1 is done. The human wants the finished game;
they will be consulted only at the moments listed in HANDOVER.md §5.

READ FIRST (in this order, fully): tiny-town/CLAUDE.md, tiny-town/docs/PLAN.md,
tiny-town/docs/HANDOVER.md, tiny-town/docs/progress.md, tiny-town/docs/design/03-architecture.md.
Skim tiny-town/docs/design/01-design-brief.md and 02-interaction-and-ui.md.
Load the skill `threejs-game-director` (it routes to the other threejs-* skills).

REPO FACTS
- Repo root: <repo-parent>/ThreeJsGames (branch main).
- Game: tiny-town/. Skills: .claude/skills/. npm cache: <repo-parent>/ThreeJsGames/.npm-cache
  (use `npm install --cache <that path>` if ~/.npm is not writable).
- node_modules/ and tiny-town/assets-src/ (raw asset packs, 179 MB) are gitignored and
  exist only in the main checkout. Worktrees must `npm install` and must read assets-src
  by absolute path from the main checkout.
- Dev server, Playwright, the canvas inspector and scripts/render-icons.mjs honour the PORT env var
  (default 5188; vite preview = PORT-1000). Ports 5203–5214 were used by v0.1/v0.2 WPs; start new ones at 5215.
- artifacts/ is gitignored: a worker's evidence lives only in its worktree. Copy it into the main
  checkout BEFORE `git worktree remove --force` (WP-07's audio recording was lost that way).

PHASE 0 — PREFLIGHT (you, on main, before spawning anyone)
1. cd tiny-town && npm run verify   (must pass: tsc, unit tests (294 at v0.2), build).
2. Browser smoke: `npm run test:e2e` and
   `npm run dev` + `npm run inspect:canvas -- --state asset-gallery --run-id m0 --out artifacts/m0`.
   Look at artifacts/m0/*.png yourself. If Chromium cannot launch, STOP and tell the human
   (HANDOVER §5) — do not fan out browser-dependent work into a sandbox that can't run it.
3. Fix only BLOCKERS yourself (blank canvas, load errors, crash). Everything cosmetic goes
   to the owning WP. Commit any fix on main before creating worktrees.

PHASE 1 — WAVE 1 (7 workers in parallel)
For each WP in HANDOVER §3 table "Wave 1" (WP-02, 03, 04, 05, 06, 07, 09a):
  a. git worktree add ../ThreeJsGames-wt/<wp> -b <branch>     (branch names from §3)
  b. Spawn ONE background worker agent (Agent tool, subagent_type general-purpose,
     run_in_background true — all 7 in a single message so they run concurrently).
     Its prompt = HANDOVER §2 template with the placeholders filled from §3, plus the
     WP's "extra brief" line from §3 verbatim. Do not paraphrase PLAN.md into the prompt;
     point the worker at its section — the plan is the contract.
  c. Record in tiny-town/docs/progress.md: WP → branch → worktree → status "running".
While they run: do NOT edit contract files or Game.ts on main (workers build against the
committed versions). Answer worker questions only via SendMessage. Don't poll — you'll be
notified when each finishes.

PHASE 2 — COLLECT & MERGE (as each worker finishes)
Follow HANDOVER §4 "Merging a worker" exactly. Key rules:
- Reject (send back via SendMessage, same agent) any hand-off that edited files outside
  its ownership, skipped an acceptance check without saying why, or fails `npm run verify`
  on its own branch.
- Merge order when several are ready: 02 → 03 → 04 → 05 → 06 → 07 → 09a.
- After EACH merge: npm install (if lockfile changed) → npm run verify → npm run test:e2e.
  If main breaks, fix forward only if trivial and owned by you; otherwise revert the merge
  and send the failure back to the worker.
- Collect every "Contract change request". Apply them yourself on main after the wave's
  merges (they are yours to own), then re-run verify.

PHASE 3 — CHECKPOINT M1 (vertical slice)
Run PLAN.md §5 "M1" in full, plus:
- Wire SaveStore (from WP-02) into Game.ts: autosave, Continue on title, camera pose.
- Capture evidence: inspect:canvas for title, sample-town, stress-town on desktop and
  --mobile, run id m1, into artifacts/m1. Write artifacts/evidence.json per
  .claude/skills/threejs-game-director/references/evidence-manifest.md and run
  python3 ../.claude/skills/threejs-game-director/scripts/check_evidence.py . --manifest artifacts/evidence.json
- Actually play it through real input for ~5 minutes using a Playwright script you write
  in artifacts/ (not committed): build a street with houses, pavement, lamps, trees,
  fences, bus stop; undo/redo; reload; Continue. List every friction point.
- Self-score the visual scorecard (PLAN §6) with one line of evidence per category.
- Turn findings into fix-up tasks for the OWNING WP (reuse the same worker agent via
  SendMessage if it still has context, otherwise a fresh worker on a new branch
  `<branch>-fix1`). Fix-ups run in parallel with Wave 2 where ownership doesn't overlap.
- Report to the human (HANDOVER §5 — M1 is a mandatory check-in): screenshots paths,
  scorecard, diagnostics numbers, what's next. Continue to Wave 2 unless they object
  within the same turn — do not wait indefinitely.

PHASE 4 — WAVE 2
Spawn WP-08, WP-09b, WP-10 (stretch — skip if M1 found major gaps in core WPs) and the
M1 fix-ups, same worktree procedure. Merge per §4. Then run checkpoint M2 (PLAN §5).

PHASE 5 — WAVE 3 → M3
Spawn WP-11. Merge. Run M3: PLAN §0 definition of done, every quality gate, final
artifacts/final-evidence.md, evidence manifest check green, scorecard filled with
measured metrics. Report to the human with the local URL, controls, and remaining limits.

STANDING RULES
- You own: contract files, Game.ts, main.ts, index.html, vite-env.d.ts, sfxTable.ts
  (regen via npm run gen:sfx), docs/**, CLAUDE.md, merges, docs/progress.md.
- Never let two workers own the same file. If a task needs a file another WP owns,
  YOU decide: move the task, or do the integration yourself after both merge.
- Keep docs/progress.md current after every merge/decision (it's the recovery point if
  your context is compacted — re-read it and HANDOVER.md after any interruption).
- Report faithfully: if a check couldn't run, say so; never relabel old evidence.
- Commit on main with clear messages after each merge/contract change. Do not push
  anywhere or open PRs unless the human asks.
- Budget: at most 7 concurrent workers. Don't spawn reviewers for every WP; spawn one
  independent reviewer at M1 and at M3 (give it raw screenshots + diagnostics + the
  scorecard file, ask for concrete defects, not approval).
- Clean up after each checkpoint: first copy <worktree>/tiny-town/artifacts/<wp>/ into the main
  checkout's tiny-town/artifacts/<wp>/, then `git worktree remove` + delete merged branches.
````

---

## 2. Worker prompt template

The orchestrator fills `<…>` from §3. You can also paste a filled copy into a separate session yourself (Option B), after creating the worktree by hand.

````text
You are a worker on "Tiny Town", a three.js + TypeScript sandbox city builder, assigned
to <WP-ID> — <WP title>. Other agents are building the other parts of the game in
parallel in their own worktrees; you must stay inside your own files so everything merges.

WORKSPACE
- Your worktree: <ABSOLUTE WORKTREE PATH>   (branch <BRANCH>). Work ONLY here.
  The game lives in <ABSOLUTE WORKTREE PATH>/tiny-town. Never edit the main checkout.
- First: cd into it, then `cd tiny-town && npm install --cache <repo-parent>/ThreeJsGames/.npm-cache`
  (node_modules is not in git). Then `npm run verify` to confirm a green baseline.
- Your port: <PORT>. Always prefix: `PORT=<PORT> npm run dev` / `PORT=<PORT> npm run test:e2e`
  / `PORT=<PORT> npm run inspect:canvas -- --run-id <wp-id-lower> --out artifacts/<wp-id-lower> ...`.
  Never kill a server you didn't start; stop yours when done.
- Raw asset packs (if you need them): <repo-parent>/ThreeJsGames/tiny-town/assets-src/ (read by absolute path; don't copy the whole folder).

READ BEFORE CODING
1. tiny-town/CLAUDE.md (commands, hard rules, hand-off checklist)
2. tiny-town/docs/PLAN.md — your section "<WP-ID>" is your CONTRACT: Owns / Reads /
   Depends on / Skills / Tasks / Acceptance checks. Also read §1 "Asset facts".
3. tiny-town/docs/design/03-architecture.md (data flow, rules, budgets) and whichever of
   01-design-brief.md / 02-interaction-and-ui.md your WP references.
4. The header comment of every file you own — baseline files list their TODOs.
5. Load the skills your WP section names (from .claude/skills/ in your worktree) and read
   the specific references it lists.

RULES
- Edit ONLY files listed under your WP's "Owns". Contract files (header says CONTRACT FILE),
  src/game/Game.ts, src/main.ts, index.html, src/vite-env.d.ts belong to the integrator.
  If you need one changed, put it under "Contract change requests" in your hand-off and,
  if necessary, add a clearly marked local shim inside YOUR files meanwhile.
- Keep the public APIs Game.ts uses (constructors, methods) compatible, or list the exact
  change as a contract request.
- No Math.random (use the injected rng). No three.js/DOM in src/town/**, src/catalog/**,
  src/render/roadTiles.ts runtime code. Keep test hooks real.
- Build in small verified increments; keep the game runnable at every step.
<EXTRA BRIEF>

DONE MEANS
- Every acceptance check in your PLAN section was RUN, with its actual output captured
  (command output, screenshot paths under tiny-town/artifacts/<wp-id-lower>/, diagnostics
  numbers). artifacts/ is gitignored: leave the files in your worktree; the integrator copies
  them to the main checkout before removing it. If a check could not run (e.g. Chromium can't launch), say exactly why —
  never silently skip or fake it.
- `npm run verify` passes in your worktree.
- Commit your work on your branch (several commits are fine), message prefix "<WP-ID>: ".
  End each commit message with:
  Co-Authored-By: Claude <noreply@anthropic.com>
  Do not merge into main, push, or touch other branches.

FINAL MESSAGE (your hand-off to the integrator) — use exactly these headings:
## Summary            (what you built, 3–6 bullets)
## Acceptance checks  (each check from your PLAN section → PASS/FAIL/NOT RUN + evidence)
## Files changed      (must all be inside your ownership; flag any exception)
## Contract change requests   (exact file + change + why; "none" if none)
## Follow-ups / known gaps
## Branch & last commit       (branch name + short SHA)
````

---

## 3. Per-WP briefs

> Rows for Waves 1–3 are **historical (v0.1)**. The v0.2 rows are at the bottom. All of these WPs are merged and their worktrees removed. Reuse the pattern: branch `wp-NN-<slug>`, worktree `../ThreeJsGames-wt/wp-NN`, and a unique PORT (next free: 5215).

| Wave | WP | Title | Branch | Worktree | PORT |
| --- | --- | --- | --- | --- | --- |
| 1 | WP-02 | Town logic & persistence | `wp-02-town-logic` | `../ThreeJsGames-wt/wp-02` | — (no browser) |
| 1 | WP-03 | Rendering: instancing, road tiles, pop-in | `wp-03-rendering` | `../ThreeJsGames-wt/wp-03` | 5203 |
| 1 | WP-04 | World & look | `wp-04-world` | `../ThreeJsGames-wt/wp-04` | 5204 |
| 1 | WP-05 | Interaction: camera, tools, ghost, touch | `wp-05-interaction` | `../ThreeJsGames-wt/wp-05` | 5205 |
| 1 | WP-06 | UI | `wp-06-ui` | `../ThreeJsGames-wt/wp-06` | 5206 |
| 1 | WP-07 | Audio polish | `wp-07-audio` | `../ThreeJsGames-wt/wp-07` | 5207 |
| 1 | WP-09a | QA harness (smoke + build-flow) | `wp-09a-qa` | `../ThreeJsGames-wt/wp-09a` | 5209 |
| 2 | WP-08 | Feel & VFX | `wp-08-fx` | `../ThreeJsGames-wt/wp-08` | 5208 |
| 2 | WP-09b | Visual baselines + bot playtest | `wp-09b-qa` | `../ThreeJsGames-wt/wp-09b` | 5210 |
| 2 | WP-10 | Ambient life (stretch) | `wp-10-life` | `../ThreeJsGames-wt/wp-10` | 5211 |
| 3 | WP-11 | Release, performance & evidence | `wp-11-release` | `../ThreeJsGames-wt/wp-11` | 5212 |
| v0.2 | WP-12 | Scale, proportions & grid density | `wp-12-scale` | `../ThreeJsGames-wt/wp-12` | 5212 (reused after WP-11) |
| v0.2 | WP-13 | Background music + settings | (not recorded) | `../ThreeJsGames-wt/wp-13` | 5213 |
| v0.2 | WP-14 | Remove the stats pill | `wp-14-no-stats` | `../ThreeJsGames-wt/wp-14` | 5214 |

Fix-up rounds reused the WP's branch or a suffixed one (e.g. `wp-05-ghost-fix3`, `wp-06-ui-fix2`, `wp-08-fx-fix1`).

Paths are relative to the repo root; give workers the absolute path:
`<repo-parent>/ThreeJsGames-wt/<wp>`.

**Extra brief lines** (v0.1; paste verbatim into `<EXTRA BRIEF>`, or write new ones in the same style):

- **WP-02:**
  > You are the only Wave-1 WP with no browser work. Be exhaustive with unit tests: one per rule-table row, valid and invalid. Keep the primary change LAST in every change list, because TownEditor derives build events from it. `buildSampleTown` must stay at zero rejections; the existing `sampleTown.test.ts` guards this.
- **WP-03:**
  > Start with orientation calibration in the `asset-gallery` state. A unit test already proves each gallery cluster has the intended road mask, so any wrong-looking piece is a `rotationOffset` or model issue, not logic. Only tune numbers in `catalog/models.ts`, and report every change as a contract request. Measure draw calls in `stress-town` before and after instancing. The naive baseline is the "before".
- **WP-04:**
  > The horizon is only visible from `TITLE_POSE` (the `title` state), so make that shot the showcase. You own the plot field and terrain colours; WP-03 owns the ground-tile colours; both must harmonise with the kit greens `#4ab480`/`#3da679`. Build distant decor in `Environment.populate(library)`, which runs after models load.
- **WP-05:**
  > Digits 1–9 are NOT yours; they belong to WP-06. `getPose`, `setPose`, `setMode`, `reset` and `TITLE_POSE` already exist; keep their signatures. For mobile two-finger gestures use CDP `Input.dispatchTouchEvent` on the `mobile-chrome` project. Use diagnostics `invalidCount`, `history.undoDepth` and `camera` for assertions.
- **WP-06:**
  > You own category state and the digit shortcuts. Tool buttons only exist while their category is active, so tests must click `cat-<id>` first. Keep every `UI_TEST_IDS` id stable; only add new ones. Bundle the font via npm (no CDN). Screenshots use the `stress-town` state for the longest real stats.
- **WP-07:**
  > You must actually listen: run the game with sound, trigger every event, and judge each file (describe what you heard in the hand-off). Originals and the rebuild script are in the MAIN checkout's `assets-src/`. If you change `docs/assets/audio.json`, don't edit `sfxTable.ts`; request `npm run gen:sfx` as a contract change.
- **WP-09a:**
  > Only use real input for gameplay (clicks and drags via `cellToClient`). Use `setState` only for setup, never to fake a step you're asserting. `tests/visual.spec.ts` already exists as the smoke journey. Write specs against the current baseline; other WPs will change the UI look, so select by `UI_TEST_IDS` and assert diagnostics, not pixels.
- **WP-08:**
  > Start after M1. `build:placed` carries `layer` and `strokeIndex`, and `build:removed` carries `layer` and `kind`; size effects from those. `windSway.ts` is called by ModelLibrary (WP-03) for `sway: true` models, so implement it instancing-aware per the shader cookbook.
- **WP-09b:**
  > Baselines only after the M1 look is approved. Seed, pause, reduced motion and hide debug before every capture. Report the bot metrics JSON.
- **WP-10:**
  > Stretch. Needs a contract request for the integrator to construct your system in `Game.ts`; propose the exact constructor and update call. Cars are already in `public/assets/models/cars/` (scale 0.14, facing −Z).
- **WP-11:**
  > Test the production preview (`PORT=5212 npm run build && npm run preview`, which serves on PORT−1000), not just dev. Every runtime URL goes through `assetUrl()`; verify that with a relative `base`.

---

## 4. Merge & checkpoint runbook (integrator)

**Merging a worker** (from the repo root, on `main`):
1. Read the hand-off. Check the reported files against the WP's *Owns* list: `git diff --stat main...<branch>`. Out-of-ownership edits mean it goes back to the worker, unless the edit is a trivial, clearly correct contract request you choose to accept.
2. Run `git merge --no-ff <branch> -m "Merge <WP-ID>: <title>"`.
3. `cd tiny-town`. If `package-lock.json` changed, run `npm install --cache …/.npm-cache`. On a lockfile conflict, take either side, then run `npm install` to regenerate it.
4. Run `npm run verify && npm run test:e2e`. If it's red: fix it if it's trivial and in your files, otherwise `git revert -m 1 HEAD` and send the failure output to the worker.
5. Apply the contract change requests (after all of this wave's merges, not in between). Re-run verify and commit.
6. Update `docs/progress.md`: status, decisions, open defects, next actions.
7. Once no fix-ups are pending: **copy `../ThreeJsGames-wt/<wp>/tiny-town/artifacts/<wp>/` into the main checkout's `tiny-town/artifacts/`** (it's gitignored, so `git worktree remove --force` deletes it; WP-07's audio evidence was lost this way), then `git worktree remove ../ThreeJsGames-wt/<wp>` and `git branch -d <branch>`.

**Checkpoint evidence** (fresh run id per checkpoint; never reuse old reports):
```bash
cd tiny-town && PORT=5188 npm run dev &   # stop it afterwards
for s in title sample-town stress-town; do
  npm run inspect:canvas -- --state $s --seed 42 --run-id m1 --out artifacts/m1
  npm run inspect:canvas -- --state $s --seed 42 --run-id m1 --out artifacts/m1 --mobile
done
python3 ../.claude/skills/threejs-game-director/scripts/check_evidence.py . --manifest artifacts/evidence.json
```
In each report, check `gpu.softwareRendered` is false before quoting any FPS, and compare `renderBudget` against the budgets in `03-architecture.md`.

---

## 5. When to stop and ask the human

The orchestrator should stop and ask only for:
- **Chromium can't launch** in its environment, so browser checks are impossible.
- **Checkpoint M1 report.** This is a mandatory check-in with screenshots and scorecard. Continue unless the human redirects.
- **A design decision the plan doesn't settle** that changes what the player sees or does: new tools, economy or goals, changing the plot or grid (currently 48 × 48 cells of 0.5 units on a 24 × 24-unit plot), dropping a requested tool.
- **Licences:** any asset that isn't CC0 (or CC-BY with credits, or owner-supplied), or anything that would need an external service or account.
- **Destructive git operations** beyond reverting its own merge (force-push, history rewrite, deleting unmerged branches).
- **Final M3 report.**

Everything else, including routine implementation calls, fix-up routing and tuning values, the orchestrator decides itself and records in `docs/progress.md`.
