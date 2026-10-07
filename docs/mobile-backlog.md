# Mobile backlog

Full phone support is not a priority; the existing phone infrastructure is left untouched (see `CLAUDE.md`). When a feature would need extra work to function on a phone, note it here: what to do if full phone support comes back. Delete an entry once it is done or dropped.

## Test infrastructure
- **The `mobile-chrome` Playwright project is commented out** in `playwright.config.ts` (Pixel 7 emulation, touch). Re-enable it and run the suite on both projects.
- **Phone-only specs were deleted**: the touch tap and two-finger pan checks (`interaction.spec.ts`), the touch Move flow (`move.spec.ts`) and the phone-width Suburban chip targets (`variants.spec.ts`). Write them again, and expect the Move hint to read "Tap where it goes" there.
- **The `mobile-chrome` visual baselines** (`tests/visual-regression.spec.ts-snapshots/*-mobile-chrome-darwin.png`) are unused and will be stale when the project returns; re-capture them.
- **Desktop-only skips were dropped.** Tests that used to skip on the phone project (keyboard shortcuts, hover-based checks, budgets) now run unconditionally and would need their skips back.
- **`move.spec.ts` "pick up a cottage…" failed on `mobile-chrome`**: the Move hint read "Click where it goes" where the test expects "Tap where it goes". Decide which wording the emulated phone should show.
- **The `night-town` mobile visual baseline failed intermittently**: only the DOM UI differed (top bar, hint line and dock text shifted by a pixel), the canvas was identical. Find what the capture waits for (fonts or layout timing).

## Features
- **FPS counter** (`.ui-fps`): it shares the row under the top bar with the centred hint line; on a narrow screen a long hint runs under it. Give the counter its own spot or shorten the hint's width there.
- **Tray arrows** (`.ui-tray-arrow`): they show on phones too, over the swipeable tray, 44 × 44 px in the touch layout, so they cover part of the end cards. Decide whether phones keep them or hide them under a coarse pointer and rely on the swipe.
- **Ponds and ducks**: pond plants are 1 × 1 and small; at the phone start pose (a cell ≈ 10.6 px) lily pads and ducks are a few pixels and need a pinch-zoom. Check the pond ghost and shore read at that size.

## Rain
- **The top bar's Rain button is hidden at phone width** (≤ 440 px, like Town file); the menu's Town tab carries the Auto / On / Off control. Rain's cost on a phone GPU is unmeasured.
