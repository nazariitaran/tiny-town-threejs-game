# Changelog

Player-facing release notes for Tiny Town. The engineering record (status, decisions, as-built notes) is `docs/progress.md`; measured budgets per release are in `docs/release.md`.

## v0.5 — 2026-09-30
Tag `v0.5`, package 0.5.0. Everything merged after `v0.4`: WP-20 to WP-25. Saves stay on version 4, so v0.4 towns open unchanged.

### New
- **Name your town** (WP-20). New towns get a name before you start building, with a random suggestion you can keep. Rename the town at any time from the name pill at the top left or from the menu. The name is saved with the town and appears on the town photo and in its file name.
- **Town files** (WP-21). Download your town as a `.tinytown.json` file and open it again in any browser: the folder button in the top bar, Menu → Town file on phones, or "Open a town file" on the title screen. The game asks before it replaces your current town.
- **Birds** (WP-22). Every so often a flock of pigeons, starlings, gulls or geese (in a V) flies over the town, casting flapping shadows. No birds at night.
- **Seven new things to build** (WP-23). Mailbox, tiered fountain, donut shop, tulips, long bench, garden table and slide. The garage is gone, and the swimming pool is now under Garden. A category can hold up to 12 tools (digit keys cover the first nine). That makes 40 tools in all.
- **Graphics settings** (WP-25). Menu → Graphics has three presets:
  - **Low**: simpler lighting, no anti-aliasing, 30 fps, and a lower render resolution on standard (non-Retina) screens. About 4× cheaper per frame than Medium on a 1080p laptop.
  - **Medium** (the default on every device): the usual look.
  - **High**: full Retina resolution.

  The choice is saved. Switching to or from Low asks for a reload ("Reload now"); every other change applies at once.
- **Tabbed menu** (WP-25): Town · Graphics · Sound · Help.

### Changed
- **Lighter on the GPU** (WP-24). The game runs at 60 fps while you build and drops to 30 fps when idle, and the sun's shadows are redrawn only when something moves. On a 120 Hz MacBook Pro the default now uses about half the GPU while building and under a third at idle.
- **Phones get the same look as desktops.** Earlier releases quietly gave touch screens a cheaper look with fewer decor trees and different lighting. Every device now starts on Medium, and you can pick Low yourself.
- Car shadows update 30 times a second, so they no longer trail behind moving cars.

### Known issues
- On Medium, phones draw about 324–328k triangles in a completely full town, slightly over the 320k mobile budget. This is an open decision, not a bug; the options are in `docs/progress.md` ("WP-25 as built").
- Not tested on real iOS or Android devices.

## v0.4 — 2026-09-28
- Bigger homes and town buildings, a smaller swing; only homes light up at night (WP-17, save v4).
- A 64 × 64-cell plot, a Zebra crossing tool, joined centre lines at junctions, a night-tinted grid, and right-click to deselect.
- The music picks up where it left off (WP-18).
- Taller pines and a big 2 × 2 oak.
- **Town photo** (WP-19): the camera button or `P` saves the current view as a Polaroid-style JPEG.

## v0.3 — 2026-09-27
- Five dock categories (Streets / Homes / Town / Nature / Garden; Shift+1–5) and many new items, including roundabouts and traffic lights (WP-15, save v3).
- A day/night cycle with Auto / Day / Night (`T`): lit windows, street-lamp pools, headlights and fireflies (WP-16).

## v0.2 — 2026-09-27
- A finer grid of half-size cells, roads laid as 2 × 2 blocks, and houses spanning several cells (WP-12).
- Background music with its own settings (WP-13).
- The stats pill is gone, leaving a one-row top bar (WP-14).

## v0.1 — 2026-09-26
- The first complete build (checkpoint M3): paint roads, place homes, trees and props, undo/redo, autosave, cars, sound effects, and touch controls.
