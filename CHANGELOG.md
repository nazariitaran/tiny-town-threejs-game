# Changelog

Player-facing release notes for Tiny Town. Budgets and measurements are in `docs/release.md`.

## Unreleased

### New
- **A stadium.** Town has a new Stadium card: a football ground with two tiers of red and white stands, a striped pitch inside a running track, a roofed main stand, a scoreboard, flags and four floodlight masts. It is by far the biggest thing you can build (14 × 11 cells) and the tallest, so leave it room; `R` turns it, and Move and Bulldoze work on it like any building. Birds fly a little higher to clear the masts. In Town, Bus stop, Postbox and Lamppost move to keys 7, 8 and 9.
- **Match nights.** Every other night there is a match at the stadium, starting with the first night you see. At sunset, half way through dusk, the floodlights come up: they light the pitch and the stands, glow on their masts and spill onto the ground around the stadium, and the scoreboard switches on. Thirty seconds into the night they fade out again. While they are on you can hear the crowd: loud when you look at the stadium, quieter as you move the view away, and silent from 20 units off (about two thirds of the plot), wherever the stadium stands. On the nights in between the stadium stays dark and quiet, and Day mode never has a match. In Night mode a match starts when you switch to night on a match night, and the next night comes round after as long as an Auto day. The crowd follows the Volume slider and Mute, and dips with the music while the menu is open.
- **Cars use the car parks.** Now and then a car turns off the street into a car park, noses into a free stall, sits there for a little while, then backs out and drives on. Other cars wait a moment while it turns in or backs out. It is the same few cars that drive round your town, so a car park is sometimes busy and sometimes empty. Parked cars aren't saved with the town, and bulldozing a car park (or the road it opens onto) sends its cars away.
- **Car parks.** Streets has a new Parking card with three sizes, picked from its style row (`V` / `Shift+V`): a small row of 4 bays straight off the street, a medium car park for 8 cars and a large one for 12 with two little planter islands. It snaps to the road grid like the roundabout, `R` turns it, and a road in front of its entrance joins it like a driveway: the street keeps its centre line, and no lane line runs into the car park. Saves stay on version 4.

## v0.6 — 2026-10-02
Package 0.6.0. Everything merged after `v0.5`, and the first public release, at https://tiny-town-threejs-game.nazariy-taran.workers.dev/. Saves stay on version 4, so v0.5 towns open unchanged.

### New
- **Choose the style you build.** Townhouse, Bungalow, Suburban, Big house, Traffic light, Birch and Tulips each come in more than one style. Selecting one of them opens a row of style pictures above its card. Pick one, and the preview shows exactly that style and every placement builds it. Press `V` / `Shift+V` to step through the styles with the keyboard. Each item remembers your pick until you reload. A small row of dots on a card shows how many styles it has.
- **Move things around.** The new Move button (`M`) picks up a placed building, tree or piece of furniture and puts it down somewhere else. Click (or tap) it, then click where it goes. `R` turns it on the way; Esc or a right-click puts it back. It slides and hops into place and is one undo step. The roundabout and zebra crossings stay with their road, and ground, hedges and fences don't move.
- **Made by Nazarii Taran, with Claude.** The Credits panel ends with links to the game's GitHub page and the author's LinkedIn and X. Credits is wider on desktop, and the music credit names ElevenLabs.
- The version shows in the title screen's bottom-right corner and under Menu → Help.
- A favicon, and a Credits panel grouped by kind (3D models, sound effects, music, font, software) with links to every source and licence. The open-source licences are in `licenses.txt`.

### Changed
- **Dock:** the street furniture (bus stop, postbox, lamppost) is under Town and the mailbox under Homes. Fountain and Garden path are retired: towns that have them still show them, and you can bulldoze them. The category row is centred, and the Rotate button only appears on touch screens (`R` / `Shift+R` elsewhere). On phones narrower than 390 px the dock uses two rows so every button stays easy to tap.
- **Where things go:** homes can be built on pavement; oak, pine, birch and bush now need open ground (field, grass or wildflowers).
- **Day and night:** in Auto, a day is 5 minutes and a night 2, with a minute each of dawn and dusk.
- The Bulldoze highlight sits exactly on the thing it will remove and reads red on every model. The previews of the bush, fences, lamppost and pavement are the right size.
- The Zebra crossing preview shows the marked road in its real colours.
- Wildflowers grow on the grass lawn colour, and the lamppost's light comes from the lamp itself.
- Menu → Help no longer has a Reset view button; `F` / `Home` still reset the camera.

## v0.5 — 2026-09-30
Tag `v0.5`, package 0.5.0. Everything merged after `v0.4`. Saves stay on version 4, so v0.4 towns open unchanged.

### New
- **Name your town**. New towns get a name before you start building, with a random suggestion you can keep. Rename the town at any time from the name pill at the top left or from the menu. The name is saved with the town and appears on the town photo and in its file name.
- **Town files**. Download your town as a `.tinytown.json` file and open it again in any browser: the folder button in the top bar, Menu → Town file on phones, or "Open a town file" on the title screen. The game asks before it replaces your current town.
- **Birds**. Every so often a flock of pigeons, starlings, gulls or geese (in a V) flies over the town, casting flapping shadows. No birds at night.
- **Seven new things to build**. Mailbox, tiered fountain, donut shop, tulips, long bench, garden table and slide. The garage is gone, and the swimming pool is now under Garden. A category can hold up to 12 tools (digit keys cover the first nine). That makes 40 tools in all.
- **Graphics settings**. Menu → Graphics has three presets:
  - **Low**: simpler lighting, no anti-aliasing, 30 fps, and a lower render resolution on standard (non-Retina) screens. About 4× cheaper per frame than Medium on a 1080p laptop.
  - **Medium** (the default on every device): the usual look.
  - **High**: full Retina resolution.

  The choice is saved. Switching to or from Low asks for a reload ("Reload now"); every other change applies at once.
- **Tabbed menu**: Town · Graphics · Sound · Help.

### Changed
- **Lighter on the GPU**. The game runs at 60 fps while you build and drops to 30 fps when idle, and the sun's shadows are redrawn only when something moves. On a 120 Hz MacBook Pro the default now uses about half the GPU while building and under a third at idle.
- **Phones get the same look as desktops.** Earlier releases quietly gave touch screens a cheaper look with fewer decor trees and different lighting. Every device now starts on Medium, and you can pick Low yourself.
- Car shadows update 30 times a second, so they no longer trail behind moving cars.

### Known issues
- On Medium, phones draw about 324–328k triangles in a completely full town, slightly over the 320k mobile budget.
- Not tested on real iOS or Android devices.

## v0.4 — 2026-09-28
- Bigger homes and town buildings, a smaller swing; only homes light up at night (save v4).
- A 64 × 64-cell plot, a Zebra crossing tool, joined centre lines at junctions, a night-tinted grid, and right-click to deselect.
- The music picks up where it left off.
- Taller pines and a big 2 × 2 oak.
- **Town photo**: the camera button or `P` saves the current view as a Polaroid-style JPEG.

## v0.3 — 2026-09-27
- Five dock categories (Streets / Homes / Town / Nature / Garden; Shift+1–5) and many new items, including roundabouts and traffic lights (save v3).
- A day/night cycle with Auto / Day / Night (`T`): lit windows, street-lamp pools, headlights and fireflies.

## v0.2 — 2026-09-27
- A finer grid of half-size cells, roads laid as 2 × 2 blocks, and houses spanning several cells.
- Background music with its own settings.
- The stats pill is gone, leaving a one-row top bar.

## v0.1 — 2026-09-26
- The first complete build (checkpoint M3): paint roads, place homes, trees and props, undo/redo, autosave, cars, sound effects, and touch controls.
