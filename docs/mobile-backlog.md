# Mobile backlog

Full phone support is not a priority; the existing phone infrastructure is left untouched (see `CLAUDE.md`). When a feature would need extra work to function on a phone, note it here: what to do if full phone support comes back. Delete an entry once it is done or dropped.

## Hands-free controls (`?gestures`)
- **Layout:** the panel sits at the top left, 260 px wide, and would cover a third of a phone screen; it needs a phone layout (a bottom sheet, or a small preview badge).
- **Camera and tracking on phones:** the front camera, portrait frames (the hand region and head gains assume 4:3 landscape), and MediaPipe's speed on phone CPUs / GPUs are untested; hands-free on a phone in the hand is also of doubtful use (one hand holds the phone).
- **Face triggers and the switch key:** blink and wink timing needs about 15 tracking results a second (they switch off below 13, back on at 15), which a phone may not reach (the triggers then stay off with a note); the eye test assumes the face fills a steady frame, not a hand-held phone; the switch key needs a hardware keyboard or a Bluetooth switch paired to the phone. The panel's Bindings, Timing and Eye test sections need the phone layout above.
- **Palms:** two hands in front of a phone's camera need the phone propped up, not held, and in a portrait frame both hands fit only far from the camera; check the side band and the palm gains there.
- **Touch alongside:** the virtual pointer is a mouse with one button; with a finger on the screen as well, both drive the same hover and strokes.

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
- **Town size**: the Small / Large control sits in the name dialog under the name field, which on a phone shares the screen with the keyboard; check it stays reachable. A Large town is fitted like a Small one (`SAFE_INSETS.narrow`), so at the phone start pose it is about 4 × the screen width and its cells about 8 px; decide whether phones should start closer in or on Small only.
- **On-screen camera controls** (`ui/CameraPad.ts`): the View and Aim pads are 64 px buttons at the right edge, laid out for a desktop window; on a phone they would cover a large part of the map, and the narrow-screen row layout puts them over the tray's height band. A phone layout would need smaller or collapsible pads (or a bottom sheet) and a check against the full-width dock and the safe areas.
- **Ponds and ducks**: pond plants are 1 × 1 and small; at the phone start pose (a cell ≈ 10.6 px) lily pads and ducks are a few pixels and need a pinch-zoom. Check the pond ghost and shore read at that size.

## Rain
- **The top bar's Rain button is hidden at phone width** (≤ 440 px, like Town file); the menu's Town tab carries the Auto / On / Off control. Rain's cost on a phone GPU is unmeasured.
