# Mobile backlog

Full phone support is not a priority; the existing phone infrastructure is left untouched (see `CLAUDE.md`). When a feature would need extra work to function on a phone, note it here: what to do if full phone support comes back. Delete an entry once it is done or dropped.

## Hands-free controls (`?gestures`)
- **Layout:** the panel sits at the top left, 260 px wide, and would cover a third of a phone screen; it needs a phone layout (a bottom sheet, or a small preview badge).
- **Camera and tracking on phones:** the front camera, portrait frames (the hand region and head gains assume 4:3 landscape), and MediaPipe's speed on phone CPUs / GPUs are untested; hands-free on a phone in the hand is also of doubtful use (one hand holds the phone).
- **Touch alongside:** the virtual pointer is a mouse with one button; with a finger on the screen as well, both drive the same hover and strokes.

## Test infrastructure
- **The `mobile-chrome` Playwright project is commented out** in `playwright.config.ts` (Pixel 7 emulation, touch). Re-enable it and run the suite on both projects.
- **Phone-only specs were deleted**: the touch tap and two-finger pan checks (`interaction.spec.ts`), the touch Move flow (`move.spec.ts`) and the phone-width Suburban chip targets (`variants.spec.ts`). Write them again, and expect the Move hint to read "Tap where it goes" there.
- **The `mobile-chrome` visual baselines** (`tests/visual-regression.spec.ts-snapshots/*-mobile-chrome-darwin.png`) are unused and will be stale when the project returns; re-capture them.
- **Desktop-only skips were dropped.** Tests that used to skip on the phone project (keyboard shortcuts, hover-based checks, budgets) now run unconditionally and would need their skips back.
- **`move.spec.ts` "pick up a cottage…" failed on `mobile-chrome`**: the Move hint read "Click where it goes" where the test expects "Tap where it goes". Decide which wording the emulated phone should show.
- **The `night-town` mobile visual baseline failed intermittently**: only the DOM UI differed (top bar, hint line and dock text shifted by a pixel), the canvas was identical. Find what the capture waits for (fonts or layout timing).
