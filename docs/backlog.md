# Backlog

Known gaps and follow-ups. An item stays until it is fixed or dropped; when it is fixed, delete it (history lives in git). Rules and mechanisms: [`architecture.md`](architecture.md). Budgets: [`release.md`](release.md).

## Failing or flaky tests
- **`tests/life.spec.ts` and the car-park spec read `life` diagnostics one frame late.** `town` / `objects` are current at once, `life` is rewritten in the next `LifeSystem.sync`; specs wait a few frames before reading it. A diagnostics read that syncs first would remove the trap.
- **`ui.spec.ts` "stress-town screenshots" can lose its hint on a slow machine.** The refusal hint hides after 3.5 s of wall time (`HINT_MS`) and the test's steps can take longer than that without a GPU. Running the `cellAboveDock` scan before the tool click would keep the 3.5 s window to the taps.

## Match nights at the stadium
- **Nobody has listened to it.** The crowd's level against the music and the placement sounds (`CROWD_TRIM`), the distance curve and the loop seam are set by measurement and tests, not by ear. Play a match night with sound on and adjust `CROWD_TRIM`, `CROWD_FULL_DISTANCE` and `CROWD_CUTOFF_DISTANCE`.
- **The crowd file's credit wording** in `CREDITS.md` says "supplied by the project owner"; if it was generated with a service (as the music was), name it there and decide whether the Credits panel should carry a line.
- **The first match's crowd starts a moment after the lights**: the file is fetched and decoded when it is first audible. A failed fetch is not retried until a reload. Fetching it when a stadium is first on the plot at dusk would close the gap.
- **A sweep to Day mode takes the lights with the sky** (a few frames, like the street lamps and windows), while the crowd fades over its 5 s. Every other change fades.
- **Mast halos show from behind the lamp banks too**; fading them by the angle to the pitch would read better up close.
- **The floodlights light only the stadium and a spill on the ground.** Houses, trees and cars next to it stay unlit, and nothing casts a shadow inside the bowl.
- **Gain ramps are untested outside Chromium**: during fades the crowd gain is re-targeted (`cancelScheduledValues` + `setTargetAtTime`) on every change of 0.01; check Firefox and Safari for zipper noise.
- **Held Night mode lights the stadium for about 30 s per match, Auto for about 60 s** (Auto adds the half of dusk before the night). Decide whether Night mode should match.

## Cars in car parks
Liveness holds (no deadlock or stuck car in the harness or in four review rounds; `stats.unstuck` stays 0). What is left is fairness, polish and test depth.

### Behaviour
- **A parked car loses its turn while its own lot is busy.** `stepParked` zeroes `asking` whenever another car of the lot is manoeuvring, so in a busy lot a car that is ready to go never reaches the 3 s ask or the 6 s priority. Seen: up to 37 s past its dwell on default tuning, 161 s with dwell 0. It always leaves in the end. Fix: keep `asking` (don't add to it) while the lot is busy, or have `tryPark` skip a lot that holds a car well past its dwell.
- **A car on a left or U-turn can stop twice for one asked block** (up to about 6 s in all): after its 3 s of patience at the start of the arc it moves, `still` resets, and it is gated again mid-junction. Fix: latch "patience spent" per block visit and clear it in `advance`.
- **A lot whose front block is a dead end** can keep a leaving aisle car at its hold point for about 23 s: each queued car U-turns in the block (about 4.5 s) before the block empties. Bounded by the queue length; a longer patience for dead-end blocks would shorten it.
- **A car driving off a bay can brush a car standing in a queue** when its gridlock breaker fires (4 times in 2 h of forced constant parking, depth up to 0.15; once, 0.03, on default tuning). A just-exited aisle car can likewise face a turning car for 1.6 s and then pass through it. Both are the street's existing push-through; overall junction contact is no worse than without car parks.
- **`asking` carries over when a parked car's way out is re-chosen** after an edit, including towards the 60 s guard. Reset it in `chooseWayOut`.
- **A car just out of an aisle lot keeps `locks`** if a roundabout or car park is placed over its block; it clears at its next `advance`. Drop the lock in `onTownChanged` when the block is no longer plain road.
- **Some entries are never offered** because the only route is a hairpin: the small lot's inner bays (1, 2) from the far front block, and an aisle lot's first two right-hand stalls from the right-hand gate. Those stalls fill from the other side. A wider apron or a moved sign in `scripts/build-parking.py` would open them.
- **Last-stall exits pivot.** The last stall of each aisle column backs straight out and turns on a 0.17 radius (the rear kerb leaves no aisle behind it); small-lot K-turns look similar. It reads as a turn on the spot. A deeper lot or one stall fewer per column would allow a normal reverse arc.
- **Parked cars keep their lamps on at night.** The glow is one material uniform for the whole batch, so only the ground beam is off. Per-instance emissive needs a `BatchedMesh` shader patch.
- **Car parks start empty** after a load, reset or redo and fill as cars pass. Spawning a share of the cars already parked would make a loaded town look lived in at once (it changes what the demo states and their baselines show).
- **Tuning** (`TrafficSim.parking`: chance 0.55, stay 10–30 s, at most half the cars in car parks) has only been judged on the sample town and the test towns. Play with it in `?debug` → Life on real towns.

### Tests
- **No repo test would catch a broken long-asker tie-break.** Putting the old comparison back in `canLeave` leaves `life.test.ts` green; it only shows in long forced-parking runs. Add a directed test: two parked neighbours within two blocks with equal `asking` ≥ 6 s, one must leave within a few seconds.
- **"No other leaver within two blocks" and "the next block is not held" in `canLeave` are not pinned** by a unit test either (removing both passes the suite). Add the two-leavers-facing case as a directed test.
- **The liveness bound on a stay is close**: `dwellMax + 45` against 43 s seen with forced parking. It moves with the first item under Behaviour.
- **The test harness is not in the repo.** It lives under the gitignored `artifacts/parking-cars/harness/` (scenario generators, per-step invariants, churn, replay, golden trajectories of the pre-parking simulation). Decide whether to keep a slim version under `scripts/` or `tests/` so the long runs can be repeated after the next traffic change. Run: `node artifacts/parking-cars/harness/cli.mjs preset quick|long|churn [--jobs N]`.
- **The full e2e suite has not been run against a production preview** for this change (dev server only), and no real phone has been checked.

## Traffic (before car parks, still there)
- **Cars pass through each other at junctions.** A left-turner stopped mid-junction is not seen by a car crossing it (the look-ahead is a lane band along the heading), and the gridlock breaker drives through a car after 1.6 s. Car parks add stops, so it shows a little more often near them.
- **Two cars can chase each other round a 2 × 2 loop of road blocks** in near contact for seconds (a two-block-wide road makes such loops).
- **`TrafficSim.stats` and `LifeSystem.publish` allocate every frame** (a stats object; the `carCells` callback), about 50 kB/s of short-lived garbage at 30 fps. Reuse one object and an indexed loop.

## Visual inspection
- **The object inspector only sees a settled town.** `scripts/inspect-object.mjs` and the `town-visual-inspector` agent photograph stills, so nothing covers the ghost preview, the pop-in, a move in flight or a bulldoze. One known case: when a `coversGround` building is bulldozed, the tiles under it come back at once while the building is still shrinking, so pavement may flicker against its slab for that moment. A script mode that plays a short action sequence through real input and captures frames mid-animation would cover these.
- **Two short diagonal patches on the stadium's rim change under the inspector's sub-pixel pan** (`--kind stadium`, the `top` view, about 40 pixels). Not checked: a real coplanar pair at the bowl's corners, or aliasing.

## Performance and release
- **`stress-town` triangles are above the mobile target** (330.9k on desktop against 320k). Trim the densest models or lower the target's scope to desktop.
- **`docs/release.md` "Latest"** was refreshed for the desktop draw calls, triangles and textures, the main chunk and the download sizes only; the night and mobile figures and the CPU and GPU numbers are from before the cinema, the postbox cyphers and the roundabout corners.
- **Uninvestigated:** in one capture of a plot packed with car parks the dock's Parking card still looked selected after Esc while diagnostics reported no tool.

## Ponds
- **The bank's land wall:** facing the camera the 0.022-high wall shows as a darker line along the square cell boundary, and against road and pavement the bank is still a grass lip (a kerb-height stone wall might suit better). Both go away if the ground is made flush.
- **Big ponds still read as rectangles from above:** the corner and edge variants soften the shore, but a quarter-cell piece can't round a corner over several cells. A mirrored cove edge and a larger inner notch would add variety.
- **A corner piece is one colour:** where lawn and field meet at a pond corner, a quarter cell of bank is the wrong green for one of its sides.
- **Ducks rest on lily pads** (lily cells count as open water), overlapping them.
- **Hens** are the drake model under a brown instance tint, so they keep a dark olive head and a yellow bill. A real hen needs a second model and one more draw call in `DuckSystem`.
- **Fireflies** rise over meadows only; a pond at dusk could have them too.
- **Still water:** no ripple, sparkle or reflection, and no splash sound (ponds use `place-nature`).
- **Ducks pop in and out** instead of flying or swimming in, and ignore the camera and nearby placements.
- **The catalog's 12-tools-per-category cap** (Nature is at 12) predates the tray arrows; decide whether to lift it.
