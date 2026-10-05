# Changelog

Player-facing release notes for Tiny Town. How things behave is in `docs/design.md`; budgets and measurements are in `docs/release.md`.

## Unreleased

### Changed
- The pool has a paved terrace under its parasols and fills its whole plot.

### Fixed
- No strip of field shows round the stadium or the cinema.
- Ground painted under the stadium, the cinema or the pool no longer flickers through them.
- The tiered fountain and the pool keep their water on pavement and grass.
- Postboxes and traffic lights sit cleanly on pavement.

## v0.7 — 2026-10-04

### Added
- Car parks in three sizes, under Streets. Cars pull in, park for a while and drive off.
- A stadium, with floodlit match nights and a crowd you can hear every other night.
- A cinema.
- Pavement on the corners of a roundabout.
- Postboxes carry a royal cypher, picked at random when placed.

### Changed
- Lighter models for the donut shop, the roundabout and the cars, so busy towns draw faster.
- Phones and other touch screens are no longer tested; new features are checked on desktop only.

### Fixed
- Cars keep to the outer lane on a roundabout.

## v0.6 — 2026-10-02
The first public release: https://tiny-town-threejs-game.nazariy-taran.workers.dev/

### Added
- Styles: seven items come in more than one style, picked from a row above the card or with `V` / `Shift+V`.
- A Move tool (`M`) that picks up a building, tree or piece of furniture and puts it down elsewhere.
- The version number, on the title screen and under Menu → Help.
- A favicon.
- Credits grouped by kind, with links to every source and licence, and to the author.

### Changed
- Bus stop, postbox and lamppost are under Town; the mailbox is under Homes.
- Homes can be built on pavement. Trees and bushes need open ground.
- In Auto, a day lasts 5 minutes and a night 2, with a minute each of dawn and dusk.
- The Rotate button only shows on touch screens; `R` / `Shift+R` work everywhere else.
- The Bulldoze highlight and the placement previews match the real size and shape of each item.
- Wildflowers grow on the lawn colour, and a lamppost's light comes from its lamp.
- A new title tagline: "Build your own cosy dream town".

### Removed
- Fountain and Garden path are no longer in the dock. Towns that have them keep them.
- The Reset view button. `F` / `Home` still reset the camera; touch screens have no reset.

## v0.5 — 2026-09-30

### Added
- Name your town, and rename it at any time. The name shows on the town photo and in the file name.
- Town files: download your town and open it again in any browser.
- Birds: a flock flies over the town now and then, by day only.
- Seven new items: mailbox, tiered fountain, donut shop, tulips, long bench, garden table and slide.
- Graphics presets under Menu → Graphics: Low, Medium (the default) and High.
- A tabbed menu: Town · Graphics · Sound · Help.

### Changed
- Lighter on the GPU: 60 fps while you build, 30 fps when idle.
- Phones get the same look as desktops.
- The swimming pool is under Garden.
- Car shadows no longer trail behind moving cars.

### Removed
- The garage. Towns saved with garages open without them.

### Known issues
- A completely full town is slightly over the triangle budget on phones.
- Not tested on real iOS or Android devices.

## v0.4 — 2026-09-28

### Added
- A Zebra crossing tool.
- Town photo: the camera button or `P` saves the current view as a Polaroid-style picture.
- Right-click puts the tool away.

### Changed
- A bigger plot: 64 × 64 cells.
- Bigger homes and town buildings, taller pines, a big 2 × 2 oak and a smaller swing.
- Only homes light up at night.
- Centre lines join up at junctions, and the grid is tinted at night.
- The music picks up where it left off.
- Towns saved in v0.3 or earlier no longer open.

## v0.3 — 2026-09-27

### Added
- A day and night cycle with Auto, Day and Night modes (`T`): lit windows, street lamps, headlights and fireflies.
- Many new items, including roundabouts and traffic lights.

### Changed
- Five dock categories: Streets, Homes, Town, Nature and Garden (`Shift+1`–`5`).
- Towns saved in v0.2 or earlier no longer open.

### Fixed
- Cars face the way they drive.

## v0.2 — 2026-09-27

### Added
- Background music, with its own settings.

### Changed
- A finer grid of half-size cells: roads are two cells wide and houses span several.
- The stats pill is gone, leaving a one-row top bar.

## v0.1 — 2026-09-26
- The first complete build: paint roads, place homes, trees and props, undo and redo, autosave, cars, sound effects and touch controls.
