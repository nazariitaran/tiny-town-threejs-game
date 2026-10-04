# Failing e2e tests: investigation report

A hand-off for whoever picks this up next. It covers which e2e tests failed, why, what this branch changes, and the evidence. This folder is a one-off investigation record, not a living doc; delete it once the findings are absorbed.

- Base: `main` at `6517d96` (package 0.6.0). `npm run verify` was green before and after (typecheck, 560/560 unit tests, build). Every failure is in the Playwright suite.
- Measured in a GPU-less Ubuntu 24.04 container (4 CPUs, Chromium 141). Not re-run on the owner's Mac; see [Open items](#open-items).

## Summary

| | Tests | Verdict | On this branch |
|---|---|---|---|
| A | `audio.spec.ts` "music is not requested before Start…", "garbage or another track…" (and, exposed in the same way, "a broken sound file…", "music position is saved…") | **Real, platform-independent race in the test.** The long-standing "texture-load errors under load" flake | **Fixed** (`reloadWhenLoaded`) |
| B | `visual-regression.spec.ts` × 4 states × 2 projects | **Deterministic failure on every non-macOS machine** (darwin-only baselines) | **Fixed** (skipped off darwin) |
| C | 16 others (birds, bot playtest, daynight, fx, interaction, life, ui, variants) | **Environment only**: no GPU, so ~3 fps | No change needed |

Full run before the fixes: 210 tests, **157 passed, 25 skipped (by design), 28 failed** (4 in A, 8 in B, 16 in C).

## A. The audio reload race (fixed)

### What the tests do
`audio.spec.ts` checks sound and music through real input. Its `beforeEach` loads `/`, clears the settings and music-position keys, and reloads. Several tests attach a console collector (`collectConsole`) and finish with `expect(log.errors).toEqual([])` / `expect(log.audioWarnings()).toEqual([])`.

### Why they fail
1. `beforeEach` reloads **without waiting**. That page boots and starts fetching ~40 GLBs and their textures (`ModelLibrary.loadAll`). The game reaches `title` only after all of them load.
2. A test attaches its collector, then reloads again: `:180` music, `:145` broken sound, or the loop in `:354` garbage.
3. The reload aborts the first page's in-flight texture `fetch()`es (three.js uses `ImageBitmapLoader` in Chrome). GLTFLoader's `.catch` logs `console.error("THREE.GLTFLoader: Couldn't load texture …")`.
4. Playwright's `page.on('console')` outlives navigations, so the collector hears the **dying** page, and the assertion fails with 2–61 copies of that line.

A second form: reloading a page **after Start**, while AudioManager is still fetching its 23 SFX files, makes the dying page warn `[audio] 23 of 23 sound files failed to load/decode … (Failed to fetch)`. This hits the second iteration of the "garbage" loop, and in principle the reload in "music position is saved…".

### Evidence
- **Document of origin.** `probe-texture-origin.mjs` replays `beforeEach` plus the test's reload with every `console.error` tagged by the emitting document's `performance.timeOrigin` and game phase. In 6/6 runs, every error (2, 35, 52, 53, 58, 61 per run) came from the `beforeEach` document in phase `loading`, and **none** from the document under test.
- **`blob:` URLs fail too.** These are textures embedded in GLBs and served as object URLs. A `blob:` fetch never touches the network, so it can only fail when its document is torn down. That rules out "server under load".
- **Why it looked random.** The error count depends on how far the aborted load had got, which depends on machine speed and load. That is why `progress.md` recorded it repeatedly as "texture-load errors under load" and "audio.spec.ts:370 on mobile … the flake seen before" (line 370 was the "garbage" test before the comment clean-up), and why it passed on re-runs.

### The fix (`tests/audio.spec.ts`)
A test-only helper, `reloadWhenLoaded(page)`:
- Waits until the page has nothing left to load: `phase !== 'loading'`, and once audio is unlocked by Start, all `SFX_FILES` (23, derived from `SFX_TABLE`) are decoded.
- Then reloads, and waits for `title`.

It is used by `beforeEach` and at the two in-test reloads that leave a started or still-loading page. No game code changes.

Rejected alternatives:
- Filtering "Couldn't load texture" out of the collectors: it would hide real texture failures.
- Attaching collectors after the reload: the tests assert boot-time warnings.
- Suppressing the error in the game: three.js logs it inside GLTFLoader, and the game behaves correctly.

### Proof
Same container, llvmpipe, the repo's own timeouts:

| Run | Result |
|---|---|
| Before: `:145`, `:180`, `:354` × 2 projects × `--repeat-each=4` | **9/24 passed**; all 15 failures were this signature |
| `beforeEach` wait only | 22/24 (the in-loop reload still races) |
| + the in-loop reload | 34/36 (exposed the SFX variant) |
| **`reloadWhenLoaded`**: `:167`, `:202`, `:323`, `:376` × 2 projects × `--repeat-each=6` | **48/48 passed** |
| **The whole `audio.spec.ts`, both projects** | **26/26 passed** |

## B. Visual baselines off darwin (fixed)

`visual-regression.spec.ts` compares against `*-darwin.png` baselines only (by design: GPU raster and font hinting differ per OS). On any other OS every capture is "missing", so all 8 tests fail. Playwright also **writes untracked `tests/visual-regression.spec.ts-snapshots/*-<platform>.png` files** into the repo.

The fix is a file-level `test.skip(process.platform !== 'darwin', 'screenshot baselines exist for darwin only')`. On macOS nothing changes, and a missing baseline still fails. `docs/architecture.md` §Browser tests and the `CLAUDE.md` command list say so.

Proof (Linux): 8 skipped, and no files written. The darwin path is a one-line platform check and was not exercised here.

## C. Environment-only failures (no change)

In a GPU-less container:
- **Browser build.** `@playwright/test` 1.60 expects Chromium build 1223, but a container may ship a different build (here 1194). Every test then fails at launch in ~3 ms. `playwright.container.config.ts` points the projects at the installed binary.
- **Frame rate.** WebGL runs on SwiftShader (~1 fps) or, headed under Xvfb, on Mesa llvmpipe (~3 fps).
- **Game time.** `Loop` caps a frame's delta at 50 ms (`src/core/Loop.ts`), and birds cap their own step at 0.1 s (`src/life/BirdSystem.ts`). So game time runs at ~0.15× wall time, while the tests use wall-clock waits sized for a real GPU.

| Test | Failure here | Confirmed by |
|---|---|---|
| birds `:27`, `:87`, `:102` | flock never reaches the centre / never launches in time | pass with both caps raised (diagnostic only) |
| bot playtest `:62` (both) | 240 s test cap | uncapped: pass. Desktop: 127 placements, 23 undos, 0 stuck strokes, 0 errors |
| daynight `:101`, `:369` (both) | 2.5 s game-time sweep vs 5 s poll | pass with the cap raised |
| fx `:173`, interaction `:81`, `:312`, life `:54` | game-time waits / 30 s test cap | pass with the cap raised and timeouts ×4 |
| interaction `:411` | hover (53,28) instead of (24,20) | artefact of **headed Xvfb**: after a clip screenshot the real X cursor (screen centre) sends a `pointermove` at (950,443) = cell (53,28) (`probe-hover.mjs`). Passes headless |
| variants `:176` (mobile) | strip right edge 374 > 360 | artefact of headed Xvfb (real window; the `resize` that re-places the strip arrives late). Passes headless |
| ui `:347` | `#ui-hint` lost `is-visible` | latent wall-clock race: the hint hides after 3.5 s (`HINT_MS`), and the test's steps take ≳3.2 s here (`probe-hint-race.mjs`). The 64² plot scan is not the cause: 70 ms vs 37 ms for 48² |

The "diagnostic only" changes (cap raised to 1 s, bot cap lifted) were reverted and are **not** on this branch.

## Reproducing in a container
```bash
npm ci
# Repo timeouts, llvmpipe (closest to a real run; expect the C failures above):
LLVMPIPE=1 xvfb-run -a -s "-screen 0 1920x1080x24 +extension GLX" \
  npx playwright test -c docs/failing-tests/playwright.container.config.ts
# One spec, repeated (the audio fix):
LLVMPIPE=1 xvfb-run -a -s "-screen 0 1920x1080x24 +extension GLX" \
  npx playwright test -c docs/failing-tests/playwright.container.config.ts tests/audio.spec.ts --repeat-each=6
# Headless SwiftShader (the repo's own mode; slow, so raise timeouts):
SLOW=8 npx playwright test -c docs/failing-tests/playwright.container.config.ts tests/interaction.spec.ts:411
```
The probes need a dev server (`npm run dev`) on `PORT`; usage is in each file's first line.

## Open items
- **Run on the owner's Mac** before merging: `npx playwright test tests/audio.spec.ts --repeat-each=5` and `npx playwright test tests/visual-regression.spec.ts` (baselines must still run and pass there).
- **Optional `ui.spec.ts:347` hardening.** Run the `cellAboveDock` scan before the tool click, so the 3.5 s hint window only spans the taps. It passes on a normal machine, so this is margin, not a bug fix.
- **Cloud sessions.** A container whose Chromium doesn't match `@playwright/test` needs `executablePath` (as in the container config) or a matching browser. Software WebGL will keep the C tests red at the repo's timeouts.

## Files here
- `REPORT.md`: this report.
- `playwright.container.config.ts`: runs the suite in a GPU-less container.
- `probe-texture-origin.mjs`: which document logs the texture errors (A).
- `probe-hover.mjs`: the stray X-cursor `pointermove` (C, `interaction:411`).
- `probe-hint-race.mjs`: step timings vs the 3.5 s hint (C, `ui:347`).
