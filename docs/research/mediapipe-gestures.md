# Hands-free building with Google MediaPipe: research and prototype

Can a player choose and place things in Tiny Town with their hands or their head, through a webcam, using Google MediaPipe? This report covers the options, what the prototype on branch `research/mediapipe-gestures` does, what was measured and what is still open. The prototype is behind a URL flag (`?gestures`) and changes nothing for players without it.

## Summary

- **It works end to end.** MediaPipe runs in a Web Worker, and its output drives the game through the same code paths as the mouse. In an automated run with real MediaPipe tracking (MediaPipe's own hand photos played as a fake camera), a pinch on the Road card picks the tool, a pinch-drag lays a road of 9 blocks, ✌ rotates, 👎 acts as Esc and a fist drags the map. Every check passed, and pinch presses landed within 3 px of their targets.
- **Three modes:** *Hand* (point with the hand, pinch to click and drag, fist to move the map), *Head* (the nose points; face triggers bound in the panel: by default a slow blink clicks, a left wink toggles a drag, a long blink pauses, resting on a button presses it) and *Head + hand* (the head points, a pinch with either hand clicks).
- **Cost to everyone else: almost nothing.** The main JS chunk grows by 2.0 kB (0.6 kB gzip), for the three new intent handlers. Everything else (a 27 kB panel chunk, the 156 kB worker, the 11.8 MB WASM runtime at 3.5 MB gzip, and 8.4 MB + 3.8 MB of models) loads only after the flag *and* a click on **Start camera**.
- **Recommendation:** worth taking further as an **accessibility and "party trick" input mode**, not as a replacement for the mouse. Hand mode is the most promising. Head mode is the most valuable for accessibility but needs testing with real people. Before it ships beyond a flag, the owner needs to decide on model hosting and licensing (§Decisions). Some interactions also need hands-free counterparts: file dialogs, sliders, and rotate in head mode.
- **Not yet tried with a real person on a real webcam.** This container has no camera or GPU. All tracking here ran on photos through Chromium's fake camera, on 4 slow CPU cores with software WebGL. Latency and comfort numbers from a real laptop are the first follow-up (§How to try it).

## What MediaPipe offers for this

MediaPipe's web API is `@mediapipe/tasks-vision` (Apache-2.0; 1.0.1 at the time of writing; the older `@mediapipe/hands` / `face_mesh` "solutions" packages are legacy). The relevant tasks:

| Task | Gives | Model (float16) | Used |
| --- | --- | --- | --- |
| Hand Landmarker | 21 points per hand (image and world space), handedness | 7.8 MB | via the Gesture Recognizer |
| **Gesture Recognizer** | Hand Landmarker's output **plus** one of 7 canned gestures per hand (Closed_Fist, Open_Palm, Pointing_Up, Thumb_Down, Thumb_Up, Victory, ILoveYou) with a score; custom gestures can be trained with Model Maker | 8.4 MB | **Hand and Head + hand modes** |
| **Face Landmarker** | 478 points, 52 ARKit-style blendshapes (`jawOpen`, `browInnerUp`, `mouthSmileLeft`…), an optional face transformation matrix | 3.8 MB | **Head and Head + hand modes** |
| Pose Landmarker | 33 body points | 3–9 MB | no: arms-up pointing is tiring and coarser than a hand |
| Holistic Landmarker | pose + face + hands in one graph | ~ all of the above | no: can't load only what a mode needs, heavier |

All tasks run in a WASM runtime (SIMD; about 11.8 MB) with a **CPU** (XNNPACK) or **GPU** (WebGL2) delegate. They take any `TexImageSource`, including an `ImageBitmap` or `VideoFrame`, so they also run in a worker.

**Prior art the design borrows from:**

- **Google Project Gameface** (open source, built on MediaPipe Face Landmarker): head movement drives the cursor and facial gestures (open mouth, raised eyebrows, smile) click. It lets each user bind gestures and set thresholds.
- **Apple Vision Pro:** look to point, pinch to click. Head + hand mode is the webcam version.
- **Ultraleap and Meta Quest hand tracking:** a stable "pinch point" between thumb and index, and pinch-and-hold to drag.
- **The One Euro filter** (Casiez et al., CHI 2012): the standard smoother for jittery pointing, lagging little when fast and steady when slow.

## Interaction design

### Mappings

| | Hand | Head | Head + hand |
| --- | --- | --- | --- |
| Point | the pinch point (between thumb and index tips, steadied by the index knuckle), mirrored | the nose's position inside the face outline, or the head's yaw / pitch; relative to a neutral pose taken in the first 0.6 s; direct or joystick; fitted per direction to the player's range | head |
| Click | pinch thumb and index | Low effort: close both eyes 0.35–1.5 s (a slow blink); Classic: open the mouth; or a switch / key | pinch with either hand (face triggers as Head) |
| Drag | hold the pinch (roads, fences, scatter) | Low effort: wink left to start, again to end; Classic: keep the mouth open; or hold the key | hold the pinch |
| Move the map | fist and move; two fists apart / together to zoom | (none) | fist and move |
| Rotate (R) | hold ✌ 0.35 s | bindable (Classic: hold a broad smile 0.9 s) | hold ✌ |
| Esc (put back, put tool away, close) | hold 👎 0.35 s | wink right, or raise the eyebrows 0.4 s | hold 👎 |
| Pause hands-free | (none) | Low effort: keep the eyes closed 1.5 s (again to resume) | as Head |
| DOM buttons | point + pinch | point + any click trigger, or rest on it 1 s (dwell) | point + pinch, or dwell |

### Head-mode triggers (face only)

The head modes aim at a player who can move only their head and face. Every face trigger can be bound to an action in the panel; two presets cover the common cases.

| Trigger | Signal | Fires | Low effort | Classic | Can be bound to |
| --- | --- | --- | --- | --- | --- |
| Slow blink | both `eyeBlink*` shut 0.35 s (0.2–1) to 1.5 s | on re-opening | click | off | one-shot actions |
| Long blink | both shut ≥ 1.5 s (1–3) | while still shut | pause / resume | off | pause, re-centre, Esc, rotate |
| Wink left / right | one eye shut ≥ 0.2 s, the other clearly open | on re-opening | drag on / off · Esc | off | one-shot actions, once the eye test has seen that wink |
| Open mouth | `jawOpen` ≥ 0.4, off < 0.2 | on opening | off | hold (click, drag) | anything, including hold |
| Eyebrows up | `browInnerUp` ≥ 0.55 held 0.4 s | once per hold | Esc | Esc | one-shot actions |
| Smile | mean `mouthSmile*` ≥ 0.7 held 0.9 s | once per hold | off | rotate | one-shot actions |
| Key / switch | a chosen key (Enter by default) | keydown / keyup | hold (click, drag) | hold | anything, including hold |

One-shot actions: click (a tap), drag on / off, rotate, Esc, pause, re-centre. Hold is offered only for the mouth and the key: you can't see where you drag with your eyes shut.

- **Blinks are classed by length.** An ordinary blink lasts 0.1–0.3 s, so anything under `blinkMinS` is ignored; a deliberate slow blink clicks on re-opening; holding the eyes shut fires pause at `pauseS` while still shut (the ring fills to show it), so it never also clicks.
- **Clicks with the eyes shut land where the eyes began to close.** The head drifts while the eyes are closed, so the pointer holds still once a closure is clearly deliberate, and the click is back-dated to the last frame with both eyes open (the pointer keeps ~3 s of history).
- **Left and right are the player's own eyes.** MediaPipe's `eyeBlinkLeft` is the subject's left eye: covering the eye on image-left (the subject's right, landmarks 33 / 133 / 159 / 145) raises `eyeBlinkRight` (0.29 → 0.64 on the portrait), and the smoke run's painted winks agree. The wink test also catches the wrong eye ("That looked like your right eye").
- **Winks are opt-in.** Many people can't close one eye cleanly, and a half-closed other eye is a misfire waiting to happen, so a wink binding stays off ("Needs eye test") until the one-eye test passes: 60 % of the samples must show the asked eye ≥ 60 % shut and the other ≤ 35 %.
- **The eye test** measures each eye open (1 s) and shut (1 s after closure is seen; a soft sound says when to open), and sets each eye's thresholds at 60 % (shut) and 40 % (open again) of that range. Without it the defaults are 0.5 / 0.35.
- **Gates:** eye triggers are off during a broad smile (the cheeks close the eyes; above `max(0.6, resting smile + 0.25)`, so a face that smiles at rest isn't gated forever), during the eye test, until the eyes have been seen open after any of these, while the face is lost, and while tracking runs under 15 results a second (blink timing needs it; the panel says so). A face counts as lost only after `max(0.3 s, 2.5 result intervals)`, so a 4-results-a-second machine doesn't drop a held drag on one missed detection.
- **Pause** releases any press, stops dwell and dims the cursor; only the trigger bound to pause does anything until it resumes.
- **The panel is hands-free too:** buttons only (presets, a cycle button per binding, − / + steppers for sensitivity and timings), one section open at a time; settings and calibration persist per browser in `localStorage`.

### The head pointer for a small or uneven range

Many people who play with their head can turn it only a little, or further one way than the other, or rest it on a headrest. The **Pointer** section adapts the mapping:

- **Source:** *Nose* (the nose tip inside the face outline, as before) or *Head angle* (yaw and pitch from the Face Landmarker's facial transformation matrix, `outputFacialTransformationMatrixes`). The angle uses the whole face mesh, so it should hold up when the nose is covered (a nasal ventilation mask); it hasn't been tried on such a mask yet.
- **Signs.** The matrix is column-major (the translation sits in elements 12–14, z ≈ −45 cm), camera space y up, the face's forward axis is the third column. On the smoke portrait warped in perspective (the side made nearer reads as a turn away from it), both sources moved the pointer the same way: right-side-nearer gave nose x +0.026 and yaw +0.020 rad, top-nearer nose y +0.027 and pitch +0.011 rad. So yaw = atan2(−fx, fz) and pitch = asin(−fy) are signed like the nose offset (x towards screen right in the mirror, y down).
- **Unfitted gains:** nose 5 / 7 viewport fractions per unit (as before), angle 2.5 / 3 per radian (the edge at about 11.5° of turn and 9.5° of tilt). The planar warps can't calibrate one against the other (a flat photo has no real nose depth), so the angle gains are a geometric estimate; the fit makes them matter less.
- **Fit to my movement:** centre, then left, right, up, down, each "as far as is comfortable, and hold". A step completes when the head is at least a minimum from neutral the asked way (nose 0.015 of the face, angle 0.05 rad ≈ 3°) and then held within max(a floor, 20 % of that distance) for 0.6 s. Each half-axis maps on its own, neutral to the centre and 90 % of the extreme to the edge. The pointer holds still during the fit (its Cancel sits under it), dwell is off, and a sound marks each step, since the player is looking away from the screen.
- **Style:** *Direct*, or *Joystick*: past a dead zone of 15 % of each extreme the pointer moves at up to 1 viewport fraction a second at 90 % of the extreme, the speed rising as the 1.5 power; it stays put back at neutral. Joystick suits very small ranges, at the cost of speed. Both are time-based, and clicks stay back-dated.

### Why these choices

- **Clicking must not move the pointer** (the "Heisenberg effect" of mid-air input). Closing a pinch drags the index tip several centimetres. The pointer therefore follows a point between the two tips, which barely moves as they meet, blended with the knuckle. A press is also **back-dated**: it lands where the pointer was 0.1 s earlier (0.15 s for the mouth) and holds there for 0.15–0.2 s. In the automated run, pinch presses landed within 3 px of the target.
- **No accidental clicks ("Midas touch").** Every signal has two thresholds (pinch closes at a ratio of 0.30 and opens at 0.45), needs 2 frames to press, and commands need a short hold. Dwell clicks only DOM buttons, never the map, where it would build wherever the head rested. A smile triggers rotate only after a 0.9 s hold, because people smile while playing a cosy game.
- **Distance from the camera doesn't matter.** The pinch is measured relative to the hand's own size (wrist to middle knuckle), so it reads the same at 40 cm or 1.5 m.
- **No reaching for the edges.** The middle 64 % × 60 % of the camera frame maps to the whole screen. Hands are detected poorly at the frame edge, and arms tire ("gorilla arm"). The preview draws this region as a dashed box.
- **A mirror.** The pointer moves the way the player sees themselves in the preview.
- **Head mode is translation-invariant.** The pointer follows the nose inside the face outline, not the face in the frame, so leaning or shifting in the chair doesn't move it. In the automated run, a face sliding 140 px (22 % of the frame) moved the pointer by at most 19 px (2 % of the screen).
- **A fist moves the map.** Grabbing and dragging is what a map invites, and a fist reads very differently from a pinch, so the two don't get confused. A fist never starts a click (its thumb rests on the index finger), and while grabbing, pinches are ignored.
- **Esc rather than Undo for 👎**: Esc never loses anything (it puts back, puts away or closes), and Undo is one pinch away on the top bar.

## Architecture

```
camera ─► <video> ─rVFC─► createImageBitmap ─transfer─► tracker.worker.ts (MediaPipe, GPU or CPU)
                                                              │ landmarks, gestures, 6 blendshapes
                                  HandsFree ◄────────────────┘
                                     │  HandInterpreter / HeadInterpreter   (pure: filters, thresholds, holds)
                                     ▼  GestureFrame { x, y, pressed, grab, zoom, command… }
                                  GestureRouter
             over the canvas ─► intent:virtual-pointer {down|move|up|leave} ─► ToolController (same strokes as a mouse)
             over a DOM control ─► element.click() on release over the same control ─► UiRoot's own handlers
             fist / two fists ─► intent:pan-camera / intent:zoom-camera ─► CameraController.dragGround / zoomBy
             ✌ ─► intent:rotate        👎 ─► a synthetic Escape keydown (all of Esc's existing meanings)
```

| File | Role |
| --- | --- |
| `src/main.ts` | `?gestures` → `import('./gesture/HandsFree')`; without the flag nothing below is fetched |
| `src/gesture/HandsFree.ts`, `handsFree.css` | composition, the panel (mode, preview with skeleton, status, Start/Stop, head settings) and the cursor |
| `src/gesture/Tracker.ts` | camera, worker lifecycle, frame pump (one frame in flight, extra frames dropped), delegate choice, GPU watchdog |
| `src/gesture/tracker.worker.ts` | MediaPipe in a module worker; posts only what the interpreters read |
| `src/gesture/handInterpreter.ts`, `headInterpreter.ts` | pure: landmarks → `GestureFrame` |
| `src/gesture/oneEuro.ts`, `pointerSmoother.ts`, `triggers.ts` | pure: One Euro filter, back-dated press, latches, hold triggers, two-threshold switches |
| `src/gesture/GestureRouter.ts` | where the frame goes: canvas, a DOM control, the camera |
| `src/gesture/protocol.ts` | shared types, worker messages |

**Changes to existing code** (small, additive):

- `events.ts` gains `intent:virtual-pointer`, `intent:pan-camera` and `intent:zoom-camera`. These are new entries only, which the shared-contract rule allows.
- `ToolController` handles the virtual pointer. Its pointer-up logic moved into `releaseStroke`, shared with the mouse, and the virtual pointer counts as "coarse" for picking fences to bulldoze.
- `CameraController` gains `dragGround(dx, dy)` and `zoomBy(factor)`.
- `Game` wires those intents (building phase only) and counts virtual-pointer input as activity for the frame budget.
- `UiRoot` places the invalid-placement tooltip by the virtual pointer.
- `vite.config.ts` pre-bundles MediaPipe for the dev server.
- `scripts/gen-licenses.mjs` supplies the Apache-2.0 text, since the package ships none.

**The rules hold:**

- Only `TownEditor` mutates the town, reached through ToolController exactly as the mouse reaches it.
- The UI still emits intents and renders facts.
- There is no randomness.
- Test hooks are untouched.
- The save format is untouched.

**One deliberate deviation:** the panel and cursor are DOM outside `UiRoot`, because the whole module is a lazy experiment. To productionise, fold the controls into the menu and keep only the cursor overlay separate (§Roadmap).

### Gotchas found on the way (all handled in the prototype)

1. **Two MediaPipe tasks in one module worker fail.** After creating a task, MediaPipe sets `self.ModuleFactory = undefined`. In a module worker it re-imports the loader with `import()`, which is cached and doesn't run again, so the second task throws "ModuleFactory not set". The worker re-arms the factory from its own import before each task (`armLoader`).
2. **The GPU delegate on software WebGL** (SwiftShader, llvmpipe: VMs, CI, blocklisted GPUs) was about 8× slower than the CPU delegate here, and beside the game's own software rendering its first frame never came back. The tracker now:
   - reads the WebGL renderer name and uses the CPU delegate on a software renderer;
   - otherwise, if the GPU gives no first frame within 4 s or averages over 120 ms over its first 10 frames, restarts on the CPU.
3. **A second hand steals tracking.** With `numHands: 1`, a hand in the background, a second person, or here the portrait's own crossed hands took the only slot, and the pinching hand was ignored. The tracker now asks for 2 hands. Hand mode follows the hand it already had; Head + hand mode lets the most-pinched hand click.
4. **Vite's dev server discovered the dependency at run time** (only the worker imports it) and reloaded the page on the first **Start camera**. Fixed with `optimizeDeps.include`.
5. **The models are not on npm.** They come from Google's model bucket, or are self-hosted (§Decisions). The npm package also ships no LICENSE file, so `gen-licenses` now takes the standard Apache-2.0 text from `scripts/data/`.
6. **MediaPipe logs from WASM to the console**, including through `console.error` ("INFO: Created TensorFlow Lite XNNPACK delegate"). The new spec filters these; `trackErrors()` in other specs would trip on them if a spec ever started the camera. There is no API switch; a production build could filter in the worker.
7. **Programmatic clicks carry no user activation.** Audio unlock still works, because Chromium only needs the sticky activation from the real click on **Start camera**. But anything that needs *transient* activation can't be done hands-free: **Open a town file** (the file picker), and possibly downloads in some browsers.
8. **Range inputs** (volume, music volume) can be focused but not dragged by gesture.

## Validation

All checks below ran in this cloud container: 4 Xeon cores at 2.1 GHz, no GPU (Chromium falls back to SwiftShader), Chromium 141, and a Chromium fake camera playing MJPEG files composed from MediaPipe's own test photos (Apache-2.0, downloaded by the scripts, never committed).

| Check | Result |
| --- | --- |
| `npm run verify` (local paths, licences, typecheck, unit tests, production build) | pass: 700 tests, 699 passed, 1 skipped (as on `main`) |
| Unit tests, `src/gesture/gesture.test.ts` | 23 pass: One Euro filter, back-dated press, triggers, pinch geometry and mirror mapping, pinch hysteresis and loss, fist grab deltas, two-fist zoom, held commands, hand picking, nose offset, head calibration, mouth / pinch press, eyebrow and smile commands, re-centring |
| `tests/gestures.spec.ts` (Chromium fake camera; no hand in view) | 3 pass: without the flag no gesture code or MediaPipe request at all; with it the panel starts the camera, frames go through the worker, Stop releases the camera; switching mode restarts with the face model |
| `scripts/gesture-smoke.mjs` (real tracking on photos; Low preset, 960 × 540) | all checks pass (table below) |
| `src/gesture/headPointer.test.ts` | fit mapping (asymmetric ranges, the edge at 90 %), the joystick (dead zone, speed, the same distance at 4 and 30 results a second, back-dated clicks), the fit wizard (holds, wobble, too small a move, timeout, lost face, cancel, back), yaw / pitch from a matrix, old settings without the pointer fields |
| Existing e2e specs (interaction, build-flow, move, smoke; 1 worker, 180 s timeout) | inconclusive on this machine: 4 pass, 9 fail, all on timeouts or wall-clock checks (a 1.5 s tooltip, the F-reset camera pose). `main` (`origin/main`) fails the same smoke and interaction tests here, the camera-pose assertion identically. **Re-run the full suite on a machine with a GPU before merging.** |

**Smoke journey, hand mode** (each step's check is read from `__THREE_GAME_DIAGNOSTICS__`):

| Step | Check | Result |
| --- | --- | --- |
| point at the Road card, pinch, release | tool = road | ✓ (a real DOM click through UiRoot) |
| point at cell A, pinch | a road block appears at once | ✓ cursor 529,182 for target 526,183 |
| pinch-drag A → B, release | ≥ 6 road blocks, one stroke | ✓ 9 blocks |
| hold ✌ | rotation changes | ✓ 0 → 3 |
| hold 👎 | tool put away | ✓ |
| fist moved 140 px across the frame | camera target moves > 0.5 units | ✓ |
| *Head mode:* face centred, then sliding 140 px | pointer stays within 10 % of the screen width of the centre | ✓ worst 19 px (2.0 %) |
| *Head mode:* a held smile (the portrait smiles) | rotation changes | ✓ |
| *Pointer:* the portrait warped right / left / down / up nearer, nose and head angle | right of left, down below up, both sources | ✓ nose x 601 vs 316, y 371 vs 171; angle x 524 vs 410, y 290 vs 161 (on a Mac, 30 results/s) |
| *Pointer:* Fit to my movement on the warped portraits (nose) | the wizard completes and the fit is saved | ✓ |

**Inference time** (`node scripts/gesture-bench.mjs --frames 30`: the real worker on its own, no game rendering beside it; 640 × 480 frames; renderer reported as SwiftShader):

| | CPU delegate: median / p90 | GPU delegate on software WebGL: median / p90 |
| --- | --- | --- |
| Gesture Recognizer (2 hands) | 79 / 86 ms | 637 / 686 ms |
| Face Landmarker (+ blendshapes) | 25 / 30 ms | 142 / 173 ms |
| Both (Head + hand) | 105 / 124 ms | 753 / 824 ms |
| Load (WASM + model, warm HTTP cache) | 0.3–0.6 s, first frame 0.2–0.3 s | 0.4–0.6 s, first frame 2.2–5.9 s |

In the game here, the worker shares the 4 cores with the game rendering through SwiftShader. The smoke run therefore got about 4 results a second (170–180 ms each) on the Low preset at 960 × 540, and under one a second (1.4–1.6 s each) on Medium at 1280 × 720. These are worst-case numbers from a machine with no GPU. **They say nothing about a real laptop**, where the game renders on the GPU and MediaPipe can use a real GPU delegate; expect it to be much faster, but it has not been measured. Measuring it is the first follow-up.

**Latency budget**, in the usual case: at most one camera frame waiting (≤ 33 ms) + inference + one message hop. The tracker never queues frames: while the worker is busy, newer frames are dropped, so lag doesn't grow on a slow machine; the result rate falls instead. The interpreters are time-based (seconds, not frames), so holds and filters behave the same at 4 or 30 results a second.

**Privacy:** frames go from the `<video>` to the worker as transferred bitmaps and never leave the page. Nothing is stored. The camera starts only on a click, the toggle shows a red dot while it is on, and **Stop camera**, a mode change or leaving the page releases it. The only network traffic is the WASM and model download: from the game's own host once the models are self-hosted, from Google's model bucket otherwise.

## Decisions for the owner

1. **Model hosting and licence.**
   - The models are Apache-2.0 per their MediaPipe model cards; check the cards before shipping.
   - `CLAUDE.md` lists CC0, CC-BY and owner-supplied as allowed *asset* sources. ML weights are arguably a software dependency, but the rule doesn't say.
   - The prototype's choice for now: the models are **not** committed. `node scripts/fetch-mediapipe-models.mjs` downloads them into the gitignored `public/assets/mediapipe/`; without them the game fetches them from `storage.googleapis.com`.
   - Options:
     - **(a)** Vendor them (12.2 MB in git and in `dist/`; under Cloudflare's 25 MiB per-file limit), with a `CREDITS.md` and `docs/assets.md` entry.
     - **(b)** Keep fetching from Google's bucket (third-party request, IP visible to Google, availability out of our hands).
     - **(c)** Download at build time.
   - Recommendation: **(a)**, once the licence fits the policy.
2. **How it is offered:**
   - keep it behind `?gestures` (today);
   - a menu entry (Menu → a "Controls" or "Accessibility" tab);
   - or a title-screen option.

   Opt-in only, never on by default: it asks for the camera.
3. **The panel's home.** It currently lives outside `UiRoot`. Moving it into the menu brings it under the UI rules and the menu's keyboard and focus handling.
4. **Whether to remember the mode.** It is not saved now, and nothing reopens the camera by itself. Saving the mode (not the camera) in settings would be fine.
5. **Head mode commands.** *Done:* every face trigger is bindable (§Head-mode triggers), with Low effort and Classic presets; smile-to-rotate is Classic only.

## Roadmap if it goes ahead

1. **Measure on real hardware:**
   - `node scripts/gesture-bench.mjs` on a laptop (GPU and CPU) and a desktop;
   - try each mode with a few people, in different lighting, with glasses, at different distances;
   - tune `DEFAULT_HAND_TUNING` / `DEFAULT_HEAD_TUNING` (thresholds, region, filters).

   The smoke and bench scripts make the numbers reproducible.
2. **Delegate choice from measurement.** Run both delegates for a few frames at start and keep the faster. Today: GPU unless the renderer is software, with a watchdog.
3. **Calibration UX:**
   - a short guided step ("hold your hand in the box", "look at the centre"); *done for the eyes:* the eye test; *done for the head pointer:* Fit to my movement (per direction, per source), with a head-angle source and a joystick style;
   - a region the player can resize;
   - per-player sensitivity, saved (*done*, with bindings, timings and the eye calibration).
4. **Hands-free gaps:**
   - rotate in head mode: *done*, any face trigger or the key can be bound to it;
   - a stepper for sliders: *done in the panel*; the game's volume sliders still can't be dragged;
   - a message on **Open a town file** that it needs a click;
   - fences: a straight-line drag works, but a "click" places the nearest edge, which is hard to aim with a head.
5. **Two-hand zoom feel:** it is direct now (the gap ratio per frame). It may need smoothing and a dead zone.
6. **Production polish:**
   - the controls in the menu and the cursor styled with the other HUD;
   - `aria-live` announcements of what is recognised (the panel's status, pause and eye-test notes are live regions);
   - reduced-motion behaviour;
   - quieter MediaPipe logs.
7. **Tests:**
   - a deterministic e2e for the virtual pointer (drive `intent:virtual-pointer` through a test-only path); *done for the interpreters:* replay recorded landmark streams (`replayHead` / `replayHands`);
   - keep `gesture-smoke.mjs` as a manual pre-release check, since it needs network, ffmpeg and about 3 minutes.
8. **Custom gestures** (Model Maker) only if the canned 7 and the pinch prove too few.
9. **Phones:** see `docs/mobile-backlog.md`.

## How to try it

```bash
git checkout research/mediapipe-gestures
npm install
node scripts/fetch-mediapipe-models.mjs     # optional: self-host the models (else they come from Google)
npm run dev
# open http://127.0.0.1:5188/?gestures        hand mode
#      http://127.0.0.1:5188/?gestures=head   head mode   (=head-hand for both; add ,cpu to skip the GPU)
```

Click **Start camera** (the browser asks for the camera), then:

- **Hand:** keep your hand inside the dashed box in the preview. Pinch the Road card, then pinch and drag on the map. Make a fist and move it to slide the map.
- **Head:** sit square to the camera and hold still for the first half second while it centres. **Re-centre** retakes the neutral pose, and **Sensitivity** scales the movement. **Pointer** → **Fit to my movement** fits it to how far you can turn each way; Source and Style switch to the head angle or a joystick. Run the **Eye test** (about 10 s) so blinks fit your eyes and winks can be bound; **Bindings** and **Timing** change what each face gesture does.

Reproducible checks (each needs a dev server running on `PORT`, default 5188):

```bash
npx playwright test tests/gestures.spec.ts --workers=1
node scripts/gesture-smoke.mjs     # needs ffmpeg; writes artifacts/gesture-smoke/ (screenshots, report.json)
node scripts/gesture-bench.mjs     # inference time per model and delegate
```

To tune on a real session, record one: start the camera, press **Record**, do the gesture, then **Stop and save** (or wait for the 120 s cap). Attach the `tiny-town-track-*.json` to the issue or the thread. It holds tracking numbers only (landmarks, face points, blendshapes, gesture names), never pictures. Check it with `parseTrack` and replay it into an interpreter in a unit test.

## Sources

- MediaPipe Tasks for web: https://ai.google.dev/edge/mediapipe/solutions/guide and the `@mediapipe/tasks-vision` package (README, `vision.d.ts`).
- Gesture Recognizer: https://ai.google.dev/edge/mediapipe/solutions/vision/gesture_recognizer/web_js
- Face Landmarker and blendshapes: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js
- Model files: `https://storage.googleapis.com/mediapipe-models/…/float16/1/…` (sizes above measured from the bucket); test photos: `https://storage.googleapis.com/mediapipe-assets/`.
- Project Gameface: https://github.com/google/project-gameface
- G. Casiez, N. Roussel, D. Vogel, "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems", CHI 2012.
