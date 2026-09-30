# WP-21 — Download and open a town file (plan, 2026-09-29)

> **Approved plan, implemented and merged into `main`** (owner-approved 2026-09-29 with every decision below; built on the branch `wp-21-town-file` from `aab1865`). This is the plan, not the as-built record. As-built facts go to `03-architecture.md`, `02-interaction-and-ui.md` and `progress.md` ("WP-21 as built").

## Owner request (2026-09-29)
> As a user, I want to be able to download and restore my town, so I can store my favourite towns on my drive and can resume build for any of them at any time on any machine.
- A **new button in the top-right stack**. It offers **Download town** and **Open (upload) a town**.
- Opening a town asks for **confirmation that the current town will be replaced**.

**Owner answers to the planning questions:**
- **Phones** (≤ 440 px): a seventh 44 px button doesn't fit the one-row top bar (six take 291 px; seven need ~337 px, and the bar has 336–388 px minus the town badge). So on phones the same actions sit in the **Menu** as a "Town file" row, and wider screens get the top-bar button.
- **Title screen:** an **"Open a town file"** link next to Credits, so a new machine can go straight into a saved town.

## Decisions (made while planning; the owner can overrule any of them)
1. **The file** is JSON: `{ "app": "tiny-town", "kind": "town", "format": 1, "exportedAt": "<ISO date>", "town": <SavedTown> }`. It holds exactly what the autosave holds: the town, its name and the camera pose. The time of day and the settings are not in it. The wrapper says what the file is and leaves room for later metadata. A **bare save** (the JSON the game keeps in localStorage) is accepted too.
2. **File name:** `<town-slug>-YYYY-MM-DD-HHMM.tinytown.json` (e.g. `puddleton-2026-09-29-1432.tinytown.json`), the same stem as the town photo. The double extension keeps it a plain `.json` for every OS and file picker, while the name says what it is.
3. **Download** serialises the **live town** (not the stored autosave, which can trail edits by 1 s), in the same click, so the browser allows the download.
4. **Opening a file:** a file picker (`.json`), at most 2 MB, then the same validation as the autosave (`parseSave`: never trusted, clamped to the plot). Before anything changes, a confirm shows the file's town name and date:
   - in the game: "Open Bumbleford? Puddleton will be replaced. Download it first if you want to keep it." with **Cancel** / **Replace town** (and a "Download Puddleton first" link);
   - on the title with a save: "Your saved town will be replaced", same buttons;
   - on the title with no save: nothing is replaced, so **Open town**.

   The confirm click is also what starts the game from the title, so audio unlocks as it does for Start.
5. **After opening:** the town, its name and its camera view are loaded (not undoable; history is cleared, like Continue), and **the save is written at once**, so a reload continues the opened town. Opening a file is a deliberate player action, so it also turns autosave back on after a test state. From the title it starts the morning like Start; in the game the time of day carries on.
6. **Errors** are shown in the panel, and the current town is untouched:
   - "That file isn't a Tiny Town town." (not JSON, wrong shape, unreadable);
   - "This town was saved by a newer version of Tiny Town.";
   - "This town is from an older version of Tiny Town that can't be opened any more.";
   - "That file is too big to be a Tiny Town town." (> 2 MB).
7. **Save-format promise (flag for the owner):** until now a save-format bump shipped **without migrations** (owner decision for v0.3/v0.4: old saves start a fresh town). With towns kept on drives, a future bump would make every downloaded file unopenable. From WP-21 on, **a save-format change should ship a `SAVE_MIGRATIONS` step** (the hook exists), or accept that old files stop opening. This WP changes nothing in the format (still v4).
8. **The top-bar button:** a folder glyph, "Town file", between the separator and the camera (`↶ ↷ | 🗂 📷 ☀ 🔊 ☰`). It opens a **Town file** panel in the menu phase (like the photo view) with **Download** (primary) and **Open a town file…**, a status line (errors, "Saved as …") and **Back to town**. The menu row (phones) opens the same panel; Back returns to the menu there.

## Design
**Contract changes (integrator):**
- `game/events.ts`: `intent:export-town` (void), fact `town-file:ready { blob, fileName }`, and `intent:open-town { save }` (a `SavedTown` that has already been through `parseSave`).
- `Game.ts`: export (serialise with the camera pose, then `town-file:ready` in the same task); open (from the title: audio unlock, load, write, building, camera, morning; from the menu: load, write, camera, building).

**Pure module** `src/persistence/townFile.ts` + test: `encodeTownFile(save, date)`, `decodeTownFile(text)` → `{ town, exportedAt }` or a player-facing `Error`, `townFileName(name, date)`, and the 2 MB limit. A shared `townFileStem(name, date)` in `town/townName.ts` gives both this and `photoFileName` the same `<slug>-YYYY-MM-DD-HHMM` stem.

**UI** (`UiRoot.ts`, `ui.css`, `testIds.ts`, `glyphs.ts`):
- the top-bar button (hidden ≤ 440 px), the menu row (shown only ≤ 440 px) and the title link;
- two modal views, `file` and `file-confirm`, with a hidden `<input type="file">`;
- `photo/savePhoto.ts` `downloadPhoto` becomes a general `downloadBlob`, used for both.

## Files
- new: `src/persistence/townFile.ts` + test, `tests/town-file.spec.ts`, this plan;
- contract: `game/events.ts`, `Game.ts`;
- `town/townName.ts` + test (`townFileStem`), `photo/photoLayout.ts` (the file name uses it), `photo/savePhoto.ts`;
- `ui/UiRoot.ts`, `ui/ui.css`, `ui/testIds.ts`, `ui/glyphs.ts`;
- `tests/daynight.spec.ts` (top-bar order and targets count visible buttons only); regenerated top-bar and title baselines;
- docs: `PLAN.md` (WP-21), `02-interaction-and-ui.md`, `03-architecture.md`, `progress.md`, `CLAUDE.md`.

## Acceptance
- `npm run verify` green. Unit tests for the file: round trip, a bare save, not JSON, a wrong app or kind, a newer or older version, over the limit, a smaller plot (centred), and the file name.
- `tests/town-file.spec.ts` (desktop + mobile), real input only (the top-bar button or the menu row, the file chooser, the buttons):
  - download the sample town: the file is valid, named after the town, and its town equals the live one;
  - start a new empty town, open the file → the confirm names the file's town → Replace → the stats, name and camera are the sample town's; reload → Continue gives it back;
  - Cancel in the confirm keeps the current town;
  - an invalid file, and a file from a newer version, show their messages and change nothing;
  - the title link, with and without a save;
  - no console errors.
- Full `npm run test:e2e` green; the top bar stays one row with ≥ 44 px targets at 360, 390, 412 and 1280 px.
- Baselines: only the top bar (desktop) and the title's link row change (masked diff, 0 px elsewhere).
- Looked at by a person (`artifacts/wp-21/`): the panel and the confirm on desktop and phone, and the title link.
