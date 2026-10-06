# Game design

What Tiny Town is, and how it behaves. Rules, numbers and modules: [`architecture.md`](architecture.md). Tools: `src/catalog/tools.ts`.

## The game

**Player promise:** "I start with an empty green field under a big sky and, one satisfying click at a time, grow a cosy little town that feels alive."

**Scope:** a relaxed sandbox builder in the spirit of Townscaper, Islanders and Kenney dioramas. No fail state, no money, no timer. Desktop browsers first (mouse and keyboard); phones and tablets are supported and must be usable.

**Core loop:** pick a tool → place or drag-paint it on the grid → watch it pop in. Placement rules (roads block buildings, fences sit on edges, footprints can't overlap, some items need a road next to them) make light spatial puzzles. A valid placement lands with a springy pop, a dust puff, a sound and auto-joining roads. A blocked one shows a red ghost, a soft "nope" and a tooltip naming the reason. Undo makes every mistake free.

**The town answers back:** cars drive on connected roads and round roundabouts, now and then pull into a car park, sit in a stall for a while and drive off again, trees and meadows sway, flocks of birds cross the sky now and then (more often over a leafy town, never at night), and at night windows, lamps, traffic lights and headlights glow, and fireflies rise over the wildflower meadows. Shops and the church stay dark at night; the stadium switches its floodlights and scoreboard on with the street lamps, and its pitch glows under them.

**Target feeling:** calm, tactile, cute. Nothing ever punishes the player.

**Non-goals:** economy, traffic simulation, pedestrians, terrain height, multiplayer, cloud saves, custom asset import.

**Art direction:** a bright, saturated low-poly diorama. Kenney CC0 kits share one palette and flat shading; the few Poly Pizza models are normalised to the same flat materials. Warm key light with soft shadows, a cool sky fill, a gradient sky dome with a sun halo, light fog at the field edge. The plot is a crisp grass field; beyond it the world fades into soft rolling green with scattered distant trees, so the plot reads as a diorama, not a floating tile. The UI is cream rounded panels with the models' own renders as icons: cosy, not a web dashboard.

## Camera
A perspective camera (FOV 35°) orbits a target on the ground through three.js `MapControls`, remapped so the left button is free for building.

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Pan | Right-drag · WASD / arrows · left-drag with no tool | Two-finger drag; one finger with no tool |
| Orbit | Middle-drag · Alt + left-drag (also tilts) · Q / E (animated 45° steps) | Two-finger twist (8° dead zone) |
| Zoom | Wheel (to the cursor) · + / − | Pinch |
| Reset view | F / Home | — |

- Polar angle 30°–70° from vertical; distance 6–60 (at least 1.2 × the fitted start distance); the target stays over the plot; damping 0.12. Tunable under `?debug`.
- **Start / reset pose** (`defaultPoseFor`): 45° yaw, 52° polar (58° in portrait), fitted so the plot's width fills the screen with its centre between the top bar and the dock. On desktop the plot is slightly wider than the screen (a cell ≈ 12.5 px); on phones it is ~3 × the screen width (a cell ≈ 10.6 px), so small props need a pinch-zoom.
- **Title pose:** a low 78° hero angle that shows the horizon, sky and sun, with a slow auto-orbit and no input.

## Pointer → grid
- The pointer is raycast against the ground plane on pointer move and camera change only, never per idle frame. Outside the plot there is no hover and no ghost.
- The hit becomes a **cell** (64 × 64 half-unit cells); for edge tools the **nearest cell edge**; for multi-cell objects a footprint **anchor** centred on the pointer (odd sizes on the hovered cell, even sizes on the nearest corner, clamped into the plot).
- Roads, and bulldozing a road, work on the aligned 2 × 2 **road block** under the pointer. The roundabout, car parks and the zebra crossing snap to the road-block grid.

## Tools

### The dock

| Category (Shift+n) | Holds | Tools, in tray order |
| --- | --- | --- |
| Streets (1) | the road network | Road, Pavement, Roundabout, Parking, Zebra, Traffic light |
| Homes (2) | where people live | Cottage, Townhouse, Bungalow, Family home, Suburban, Big house, Mailbox |
| Town (3) | shops, civic places, shared street furniture | Tiered fountain, Corner shop, Donut shop, Church, Supermarket, Stadium, Cinema, Bus stop, Postbox, Lamppost |
| Nature (4) | things that grow on their own | Grass, Wildflowers, Tulips, Bush, Oak, Pine, Birch |
| Garden (5) | things people build in a yard or park | Hedge, Low fence, Tall fence, Planter, Bench, Long bench, Table, Barbecue, Swing, Slide, Pool |

- Inside a category the tools run surfaces → lines → objects. A category holds at most 12 tools; digits 1–9 reach the first nine, later ones have no key.
- **Retired tools** (`RETIRED_TOOLS`: Fountain, Garden path) are out of the dock, but their kinds stay in the catalog, so existing towns still load, draw and bulldoze them.
- Footprints and allowed ground: `src/catalog/objects.ts`; the full placement rules: `architecture.md` §Placement rules.

### Behaviour

| Tool kind | Hover | Press | Drag | Release |
| --- | --- | --- | --- | --- |
| Ground paint (road, pavement, grass, wildflowers) | Cell highlight + flat ghost tile (road: the whole block) | Paint the cell (road: its block) | Paint every cell crossed, no gaps (road: each block once) | The stroke is **one** undo step |
| Object | Translucent ghost + a frame round the whole footprint, centred on the pointer and rotated; mint when valid, brick when not | Place, or the invalid feedback | Lamppost, planter, tulips, bush and trees scatter (one per new valid cell; oaks two cells apart); everything else places once | Commit |
| Edge (hedge, fences) | Ghost piece on the nearest edge | Place | A straight run of edges, axis locked by the first move | Commit |
| Bulldoze | What will go is painted red where it stands (object > edge > ground; a whole footprint or road block), with a red frame | Remove | Remove along the drag | Commit |
| Move | Nothing carried: the movable object under the pointer turns sky blue with a blue frame. Carrying: it stays blue in place and a ghost follows the pointer, mint or red | Pick up; then put down (one undo step, its own place sound and dust, a 0.3 s slide-and-hop) or the reason it can't go there | — (click, click; tap, tap) | Commit on the drop |
| None | Subtle cell highlight | Left-drag pans | — | — |

- **Rotate:** `R` clockwise, `Shift+R` counter-clockwise, or the dock's Rotate button on touch screens (hidden with a mouse and keyboard). A turn swaps the footprint's width and depth, re-centres the ghost on the pointer and animates in 100 ms. The rotation persists until changed.
- **Styles:** the object tools with several models (Parking, Townhouse, Bungalow, Suburban, Big house, Traffic light, Birch, Tulips) open a strip of icon-only chips above the dock, one per model. The ghost and every placement use the chosen model; there is no random option. Each tool starts on its first model and remembers the choice for the session. `V` / `Shift+V` step through the styles. The strip hides with the tool, while another category's tray is open and outside the build phase. A moved object keeps its model. Parking's styles are its sizes, so switching style re-centres the ghost's footprint.
- **Postbox cyphers:** the postbox is the one tool with several models and no strip: each new postbox is built with a small raised royal cypher below its yellow plate, rolled by chance: Elizabeth II (E II R) 60 %, George V 16 %, George VI 8 %, Victoria 7 %, Edward VII 5 %, Edward VIII 2 %, Charles III 2 %. The ghost shows the postbox that the next click builds, and a new one is rolled after every placement. A postbox saved before the cyphers is an Elizabeth II one, and a moved postbox keeps its cypher.
- **Move** carries any placed object except the roundabout, car parks and zebra crossings (clicking one says "{label} can't be moved"); ground, hedges and fences never move. The drop follows the placing rules, except that the object's own old footprint doesn't count as occupied. `R` turns what is carried from its own rotation; trees and plants can't be turned. Esc, a right-click, another tool, undo/redo, the menu or leaving the build phase put it back.
- **Zebra crossing:** a click on a straight road, tee or crossroad; the road tile under it draws the zebras. `R` does nothing. Bulldozing it leaves the road. Cars ignore it.
- **Roundabout:** 6 × 6 cells (3 × 3 road blocks) on any ground. Placing it paints its footprint to road; bulldozing turns it back to field (corners you paved stay pavement). Roads join only at the middle of each side. Its four corners, the grass wedges, can be paved: the Pavement tool paves a whole corner, Grass or Road puts the wedge back. Cars go round counter-clockwise on the outer lane, like the right-hand traffic on every other road.
- **Parking:** a car park in three sizes (styles): small, 4 × 2 cells, a row of 4 nose-in bays straight off the street; medium, 4 × 4 cells, 8 stalls along an aisle; large, 4 × 6 cells, 12 stalls with two planter islands. Like the roundabout it snaps to the road-block grid, stands on any ground, paints its footprint to road and turns back to field when bulldozed. `R` turns it; the entrance is its front. A road block straight in front of the entrance joins it like a driveway: the road tile tees into the lot without a centre line on that side, so the street's own line stays unbroken. Roads along its other sides pass by. Cars use it on their own (next point).
- **Trees:** the pine stands twice its kit height, the birch at its natural height; both stay in one cell. The oak is the big tree on a 2 × 2 lot.
- **Match nights (ambient life, nothing to manage).** A match is on at the stadium every other night: the first night of a session, then the third, and so on. Every stadium on the plot plays on the same nights.
  - **When:** a night begins at sunset, the middle of dusk (clock 0.70). On a match night the floodlights and the crowd fade in there over 4 s, stay through the first 30 s of the night and fade out over 5 s; in Auto that is about a minute, from half way through dusk to a quarter of the way into the night. On the other nights the stadium is dark and silent all night.
  - **Day mode** has no nights and no matches. **Night mode** holds the clock, so a night there lasts as long as a whole Auto day (9 minutes) and then the next one begins: the switch into Night mode starts a night (a match on every other switch), its lights go off 30 s later, and after that a match comes every 18 minutes, as often as in Auto. A switch that only passes dusk on the way to Day mode counts for nothing; switching to Day mid-match ends the match: the crowd fades out over its 5 s and the lights go with the night sky, as the street lamps do. However the mode is switched, lights and crowd only ever fade.
  - **Light:** the four masts light the stadium itself (pitch, track, stands and the inside of the bowl, each in its own colour, brighter where it faces a mast), their lamp banks and the scoreboard digits glow, each mast head has a halo (not on the Low preset) and a soft spill lies on the ground around the lot. Nothing else is lit and nothing casts a shadow.
  - **Sound:** a looping crowd. "The player" is the point on the ground the camera looks at: full volume within 3.5 units of the stadium's centre, falling as (1 − x)² to silence at 20 units, one fixed distance for every stadium. A stadium in the middle of the 32-unit plot is faintly audible at the plot's edges (about 5 %) and silent in its corners; one by an edge is silent on the far side. With several stadiums only the nearest counts. The crowd goes through the master volume and Mute, ducks 3 dB with the music while a menu or the photo view is open, and stops on the title screen. Zoom does not change it.
  - **Not saved:** the night count starts again on every Start or Continue, so the first night after loading is always a match night. The menu, the photo view and reduced motion pause the match with the clock. Bulldozing the stadium takes its light and its crowd with it at once; a moved stadium carries them along.
- **Cars in car parks (ambient life, nothing to manage).** A car driving past a car park's entrance sometimes turns in, takes a free stall nose-in, stays 10–30 s, reverses out and rejoins the street. It is the same handful of cars as on the roads (at most 6 in a town, at most half of them in car parks at once), so a town never fills with parked cars and an empty car park is normal. One car manoeuvres per car park at a time, and while it crosses or backs into the street the other cars wait a little way back; nothing honks, nothing crashes. A car park with no road at its entrance stays empty. Bulldozing a car park, or the road it opens onto, removes its cars at once, like bulldozing the road under a car; undo brings the car park back empty. Parked cars are not part of the town: they are not saved, and a loaded town starts with empty car parks. At night parked cars keep their lamps on but light no patch of road.
- **Deselect:** Esc, clicking the active card again, pressing its digit again, or a right-click without a drag (a right drag still pans). Esc with no tool opens the menu. A right-click never places.
- **Feedback:** placing pops in (easeOutBack, ~220 ms) with a dust puff and the item's sound; removing shrinks out (~150 ms) with a poof and a crunch. An invalid click shakes the ghost (150 ms), plays a soft "nope" and shows the reason by the pointer for ~1.5 s.

### Keyboard
Letter and digit keys use `event.code`, so layouts and Shift don't change the mapping. No game key fires while a text field has focus.

| Key | Action | Handled by |
| --- | --- | --- |
| 1–9 | The Nth tool of the active category; the active tool's digit deselects it | `ui/uiKeys.ts` |
| Shift + 1–5 | Switch category | `ui/uiKeys.ts` |
| R / Shift+R | Rotate | `ToolController` |
| V / Shift+V | Next / previous style | `ToolController` |
| M · B | Move · Bulldoze | `ToolController` |
| Ctrl/Cmd+Z · Ctrl/Cmd+Shift+Z · Ctrl+Y | Undo · redo · redo | `ToolController` |
| T | Time of day: Auto → Day → Night | `ToolController` |
| F / Home | Reset the camera | `ToolController` |
| Esc | Put back what is carried · put the tool away · open the menu | `ToolController` |
| WASD / arrows · Q / E · + / − | Pan · orbit · zoom | `CameraController` |
| P | Take a photo (building only; no modifiers, so Ctrl/Cmd+P still prints) | `UiRoot` |
| ? | Controls help | `UiRoot` |

## Screen

```
┌──────────────────────────────────────────────────────────────────────┐
│ [🏡 Puddleton]                       [↶][↷] │ [🗂][📷][☀][🔊][☰]  │  top bar: town name pill · action pill
│            "Drag to lay road — it joins up automatically"            │  hint pill (fades)
│                                                                      │
│                          3D  TOWN  VIEW                              │
│                                                                      │
│                       [chip][chip][chip]                             │  style strip (multi-model tools)
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │ [img][img][img][img]  … item tray for the active category …  │   │  item cards: icon, label, key
│   ├──────────────────────────────────────────────────────────────┤   │
│   │ (Streets)(Homes)(Town)(Nature)(Garden) │ [Rotate][Move][Bulldoze]│  tab row, centred
│   └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** one row, 48 px (52 px on phones). Left: the **town name pill** (house badge + name, ellipsised; a button that renames). Right: Undo, Redo, **Town file**, **Photo**, **Time of day** (sun + moon / sun / moon glyph, rendered from `daytime:changed`), mute and Menu. Volume and music live in the menu.
- **Dock** (bottom centre, ≤ 150 px tall on desktop): the active category's item tray above one centred row of category tabs and mode buttons. The build starts on Streets. An item card is a 44 px icon, a short label and a digit badge; the selected card is raised with an accent outline. A multi-model card has one dot per model and shows the chosen model's icon. The style strip floats above the dock with a caret at its card, outside the scrolling tray.
- **Mode buttons:** Rotate (touch only, shows the current rotation), Move (sky blue when active), Bulldoze (brick when active).
- **Hint line:** a one-liner for the active tool's gesture, 10 px under the top bar. It fades after 3.5 s and stops after a tool's third use. While carrying: "Click where it goes · R to rotate · Esc to cancel" / "Tap where it goes · tap Rotate to turn it".
- **Cursor tooltip:** the invalid reason, near the pointer but never under it, and never over the dock, the style strip or the top bar.
- Nothing covers the centre of the view.
- **Grid overlay** (Menu → Graphics → Show grid): line opacity ≤ `GRID_MAX_OPACITY` (0.14) by day, × (1 + 0.25 · night) at night, so the grid, the ghost and the footprint frame stay clear in the dark.

### Phones (≤ 760 px wide or a coarse pointer)
- The dock is full width (safe-area padded); the tray scrolls sideways with scroll-snap. Cards are 80 × 78 px with 50 px icons; at ≤ 380 px they shrink to 64 px and lose their labels.
- Tabs and modes fit one row from 390 px up; below that the categories take one row and the modes a second. Every target is ≥ 44 px.
- At ≤ 440 px the Town file button leaves the top bar (Menu → Town tab has a Town file row instead) and the name gets smaller; below 400 px the pill is the icon-only badge. The menu heading always shows the full name.
- One finger builds; two fingers move the camera. With no tool, one finger pans.

## UI states

| State | Content | Enter / exit |
| --- | --- | --- |
| Loading | Title mark, progress bar and one line for the current step: "Unpacking the toy box…" (also shown before the scripts arrive), "Gathering roads, houses and trees…", "Waking up the townsfolk…", "Setting the scene…" | App start → assets ready |
| Title | "Tiny Town" logo over the slowly orbiting scene. **Start building** (reads **Continue** when a save exists), **New town** (only with a save), links **Open a town file** and **Credits**. The version (`v0.7.1`) sits in the bottom-right corner | Continue goes straight in; Start building and New town (after its confirm) open Name your town. The click that enters the game unlocks audio and starts the music |
| Name your town | A text field (≤ 30 characters, "n / 30" counter) pre-filled with a random name from `public/data/default_town_names.json`, or the current name when renaming; a die for another name; Cancel and **Start building** / **Save**. Enter submits, Esc cancels, a blank name can't be submitted. Desktop focuses the field with the text selected; touch focuses the button | New town: nothing is cleared until the name is confirmed. Rename: the name pill (Cancel → building) or Menu → Rename town (Cancel → menu). Renaming is autosaved, not undoable |
| Building | Top bar, dock, hint line | Main state |
| Menu | Headed by the town's name; **Resume**; tabs Town · Graphics · Sound · Help. The scene keeps rendering, the music ducks −3 dB, the day clock pauses | ☰, or Esc with no tool |
| Photo | A white flash (none under reduced motion), then a tilted Polaroid with washi tape: "Developing…" on a warm grey print, then the picture fades up from pale sepia. **Download** and **Back to town** | Camera button or `P` while building; Esc / Back returns with the tool still selected |
| Town file | **Download this town** (`<slug>-YYYY-MM-DD-HHMM.tinytown.json`), **Open a town file…** (`.json`, ≤ 2 MB), a status line (saved as …, or why a file can't open), Back | The top-bar folder, or Menu → Town file on phones; the title link opens the file picker directly |
| Town file confirm | "Open Bumbleford?", the date it was saved, then "Puddleton will be replaced. Download it first if you want to keep it." (in game) or "Your saved town will be replaced." (title). **Cancel** (focused) and **Replace town**, or **Open town** when nothing is replaced; in game a **Download Puddleton first** link. The file's town, name and camera replace the current ones and are saved at once (not undoable) | After a valid file is picked; Cancel / Esc return to the panel |
| Confirm | "Start a new town? Your current town will be cleared." Cancel / Clear (Clear opens Name your town) | Menu → New town, or the title's New town |
| Controls help | Two columns: mouse + keys, touch | Menu → Help → Controls, or `?` |
| Credits | Model, sound, music, font and software credits, then "Made by Nazarii Taran, with Claude" with the author's GitHub, LinkedIn and X links | Title link, or Menu → Help → Credits |
| Error | A friendly message with Try again | WebGL or asset load failure |

### Menu tabs
- **Town:** Time of day (Auto / Day / Night); Town file (phones ≤ 440 px); Rename town · New town.
- **Graphics:** Quality (Low / Medium / High) with the preset's one-line description; "Some changes apply after a reload" with **Reload now** when the choice changes MSAA or the material from what the page booted with; Show grid; Show FPS (off by default): a small frame-rate pill under the town name, top left, while building and in the menu. It never takes pointer input and is not in photos. The game caps its own frame rate (60 while you interact, 30 when idle on Medium and High; 30 on Low), so the counter reads the cap on a machine that keeps up.
- **Sound:** Volume, Music on/off, Music volume.
- **Help:** Controls, Credits, and the version (`Tiny Town v0.7.1`).
- The graphics controls render only from the last `graphics:changed` fact. Picking a preset emits `intent:set-graphics` and applies the live parts at once; Reload now emits `intent:reload-graphics`, which flushes the save and reloads to the title.
- **Keyboard** (WAI-ARIA tabs, automatic activation): the tab bar is one Tab stop; ←/→ move and wrap, Home / End jump; Tab enters the panel. Arrow keys never reach the camera while the menu is open.
- The menu reopens on the last tab of this page session (Town after a load). Back or Esc from a sub-view (Controls, Credits, Confirm, Rename, Town file) returns to the same tab with focus on the control that opened it.
- Every panel shares one grid cell, so the menu keeps the height of its tallest tab; on short screens the panel area scrolls.

## Visual language
- **Panels:** warm off-white `#FFF9EF` at 92 % opacity, 16 px radius, soft shadow, a 1 px warm border; text `#3B3A36`.
- **Accents:** grass green `#5DB36A` (selected, valid), sky blue `#4A9BE8` (focus, info, Move), brick `#E0674F` (bulldoze, invalid), sun yellow `#F4C44E` (highlights). Invalid is never colour alone: it also gets a ✕ and a shake.
- **Font:** Nunito (variable), bundled through `@fontsource-variable/nunito`; no runtime CDN.
- **Icons:** item icons are renders of the in-game models (`docs/assets.md` §Icons); UI glyphs are inline SVG (`src/ui/glyphs.ts`).
- **Motion:** 120–200 ms ease-out on hover and press; the tray slides in 180 ms; `prefers-reduced-motion` is respected.
- Every control has hover, pressed, focus-visible and disabled states, a sensible tab order and an `aria-label` where it has no text.

## State wiring
The UI never mutates town or game state. It **emits intents** on the event bus and **renders facts** it receives (`src/game/events.ts`). One owner per concern: `TownEditor` (town and history), `ToolController` (active tool, rotation, hover, carry), `AudioManager` (mute, volume, music; persisted through `SaveStore` settings), `UiRoot` (active dock category, menu tab), `Game` (phase, graphics preset, time-of-day mode).
