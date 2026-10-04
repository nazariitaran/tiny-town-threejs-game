# Mobile backlog

Full phone support is not a priority; the existing phone infrastructure is left untouched (see `CLAUDE.md`). When a feature would need extra work to function on a phone, note it here: what to do if full phone support comes back. Delete an entry once it is done or dropped.

## Test infrastructure
- **The `mobile-chrome` Playwright project is commented out** in `playwright.config.ts` (Pixel 7 emulation, touch). Re-enable it and run the suite on both projects.
- **Phone-only specs were deleted**: the touch tap and two-finger pan checks (`interaction.spec.ts`), the touch Move flow (`move.spec.ts`) and the phone-width Suburban chip targets (`variants.spec.ts`). Write them again, and expect the Move hint to read "Tap where it goes" there.
- **The `mobile-chrome` visual baselines** (`tests/visual-regression.spec.ts-snapshots/*-mobile-chrome-darwin.png`) are unused and will be stale when the project returns; re-capture them.
- **Desktop-only skips were dropped.** Tests that used to skip on the phone project (keyboard shortcuts, hover-based checks, budgets) now run unconditionally and would need their skips back.
