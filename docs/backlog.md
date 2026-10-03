# Backlog

Known gaps and follow-ups. An item stays until it is fixed or dropped; when it is fixed, delete it (history lives in git). Rules and mechanisms: [`architecture.md`](architecture.md). Budgets: [`release.md`](release.md).

## Failing or flaky tests
- **`tests/audio.spec.ts:180`** ("music is not requested before Start, then streams, plays and advances") and **`tests/audio.spec.ts:354`** ("garbage or another track in the stored position starts from 0 without warnings"), both projects, and **`tests/move.spec.ts:69`** ("pick up a cottage, a refused drop, turn it, put it down, undo / redo, reload"), mobile-chrome: fail on some full-suite runs and pass on others, on `main` as well. Unrelated to cars. Find the timing each depends on and make it deterministic.
- **Three visual baselines differ and await the owner's approval:** `asset-gallery` (desktop-chrome, mobile-chrome) and `sample-town` (mobile-chrome), from the car-park models. Re-capture once the look is approved.
- **`night-town` (mobile-chrome) visual baseline fails intermittently by environment:** it passed in two full runs and then failed repeatedly, on this branch and on the sources of the commit before the car work alike. The diff is only in the DOM UI (top bar, hint line and dock text shifted by a pixel); the canvas is identical. Likely font or layout timing at capture. Find what the capture waits for.
- **`tests/life.spec.ts` and the new car-park spec read `life` diagnostics one frame late.** `town` / `objects` are current at once, `life` is rewritten in the next `LifeSystem.sync`; specs wait a few frames before reading it. A diagnostics read that syncs first would remove the trap.

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

## Performance and release
- **`stress-town` triangles are above the mobile target** (322k–328k against 320k), the same on `main`. Trim the densest models or lower the target's scope to desktop.
- **`docs/release.md` "Latest"** was refreshed for draw calls and the main chunk only; CPU, GPU and download numbers are from the last release.
- **Uninvestigated:** in one capture of a plot packed with car parks the dock's Parking card still looked selected after Esc while diagnostics reported no tool.
