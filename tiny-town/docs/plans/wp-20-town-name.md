# WP-20 — Name your town (plan, 2026-09-29)

> **Approved plan, implemented and merged into `main`** (owner-approved 2026-09-29; built on the branch `wp-20-town-name` from `ac820b8`). This is the plan, not the as-built record. No version label (owner: "no version number for now"). As-built facts go to `03-architecture.md`, `02-interaction-and-ui.md` and `progress.md` ("WP-20 as built").

## Owner request (2026-09-29)
> As a user, I want to be able to name my town, so I can feel more personal connection to it.
- A **popup before starting a town** with a name field, **up to 30 characters**.
- The name is shown **in the top-left corner instead of the game name**.
- The name is used on the **photo card** (WP-19).
- The player can **edit** the name.
- The field is **pre-filled with a random name** from `public/data/default_town_names.json` (500 owner-supplied names, 5–20 characters, all unique).

## Decisions (made while planning; the owner can overrule any of them)
1. **The name belongs to the town, not to the settings.** It is saved in the town save as an optional `name` field of `SavedTownV4`. There is **no save version bump**: an older v4 save without a name loads as **"Tiny Town"** (what the corner shows today), and the player can rename it. "New town" starts a new name. Renaming is **not undoable** (it isn't a build action) and **autosaves** like an edit.
2. **When the popup appears:** before every *new* town.
   - Title, no save: **Start building** → "Name your town" → **Start building**.
   - Title, with a save: **New town** → the existing "Start a new town?" confirm → **Clear** → "Name your town" → **Start building**. The town is only cleared when the name is confirmed; Cancel at any step keeps it.
   - Menu → **New town** → confirm → Clear → "Name your town" → **Start building** (back to building with the empty plot).
   - **Continue** never shows the popup.
   - The destructive confirm stays a separate step (focus starts on Cancel), so pressing Enter in the name field can never clear a town by accident.
3. **Editing:** click/tap the **town name in the top-left pill**, or Menu → **Rename town**. Both open the same dialog ("Rename your town", pre-filled with the current name, **Save**). The pill is a real button (`aria-label` "Rename town: <name>"). From the pill, Cancel/Esc go straight back to building (like the photo view); from the menu, back to the menu.
4. **Name rules** (`src/town/townName.ts`, pure): leading/trailing spaces trimmed, runs of whitespace collapsed to one space, control characters removed, then **1–30 characters** (Unicode code points; the input's `maxlength` of 30 UTF-16 units is never looser). An empty name can't be submitted (the button is disabled). Any characters are allowed; the DOM uses `textContent` and the canvas uses `fillText`, so nothing is interpreted as markup.
5. **The dialog:** heading, the text field with a live "n / 30" counter, a **dice button** ("Another name") that draws a new random suggestion, and Cancel + the primary button. Enter submits; Esc cancels. On desktop the field is focused with the text selected, so typing replaces the suggestion; on touch the primary button gets focus, so the on-screen keyboard only opens when the player taps the field.
6. **Random names:** the list is **fetched at load** from `data/default_town_names.json` (through `assetUrl`), not bundled: the main JS chunk has ~1.8 kB of headroom under the 900 kB warning limit. A failed fetch is not fatal: the suggestion falls back to "Tiny Town". Suggestions come from a **dedicated seeded stream** in `Game` (never `Math.random()`): it is seeded **from `crypto.getRandomValues` at boot**, because the game's fixed default seed would give every new player the same first suggestion, and the `seed(n)` test hook re-seeds it, so tests stay deterministic. A re-roll never repeats the name in the field.
7. **Top-left pill:** house badge + the town name (bold, like the old mark), **ellipsised** when too long, full name in the tooltip. Desktop caps the pill at about 40 % of the width. Phones ≤ 440 px had an icon-only badge; they now show the name at a smaller size in the space left of the action pill, still one row with ≥ 44 px targets (the actual breakpoints are set from measurements at 360 / 390 / 412 px). *As built:* the name shows at 400–440 px (~7 characters at 412 px); below 400 px only 2–3 characters would fit, so the pill stays the icon-only badge there, and the menu's heading shows the full name instead. The **loading and title screens keep the "Tiny Town" game logo**: they show the game, not a town.
8. **Photo card:** the caption's title is the town name (was "Tiny Town"). A long name **shrinks to fit** the space between the badge and the sun/moon (down to 60 % of the size), then ellipsises. The preview's alt text names the town. The **file name** uses a slug of the name: `puddleton-2026-09-29-1432.jpg` (`tiny-town-…` when the slug is empty, e.g. a name with no Latin letters or digits). *(Small addition beyond the request; easy to drop.)*
9. **Tests and baselines:** every test state (`setState`) resets the name to "Tiny Town", so the desktop baselines don't change (the pill must render identically as a button). The phone baselines with a top bar change (the pill now shows text) and are regenerated with the masked diff (0 px changed outside the top bar).

## Design
**Contract changes (integrator):**
- `town/types.ts`: `SavedTownV4.name?: string`.
- `game/events.ts`:
  - `intent:start { mode, name? }` (the name for a `'new'` town);
  - `intent:new-town { name }` (was `void`);
  - `intent:rename-town { name }`;
  - fact `town:named { name, cause: 'load' | 'reset' | 'rename' }`.
- `vite-env.d.ts`: diagnostics `townName`.
- `Game.ts`: the names list (loaded with the models), the name stream, `suggestTownName()` handed to `UiRoot`; `intent:start` / `intent:new-town` pass the name to `editor.reset(name)`; `intent:rename-town` → `editor.rename(name)`; the photo gets `editor.name`.

**Town logic / persistence:**
- `TownEditor`: `name` getter; `reset(name = DEFAULT_TOWN_NAME)`, `load(save)` (the save's name or the default) and `rename(name)` set it and emit `town:named`; `serialize()` writes it. Invalid or unchanged renames are ignored.
- `serialize.ts`: `serializeTown(state, camera?, name?)`; `parseSave` keeps a valid name (sanitised) and drops a bad one.
- `SaveStore.attachAutosave`: a `town:named` with cause `rename` schedules a save, like an edit.

**UI (`UiRoot.ts`, `ui.css`, `testIds.ts`, `glyphs.ts`):**
- a new modal view `name` (mode `new` or `rename`), shown over the title or in the menu phase (the same pattern as help and the photo);
- the brand pill becomes a button showing the name; the menu gets **Rename town** next to New town;
- Esc inside the name field cancels the dialog (today the key handler ignores every key in a text field);
- new glyphs: dice (shuffle) and pencil (rename);
- new test ids: `btn-town-name`, `ui-town-name`, `input-town-name`, `btn-town-name-shuffle`, `btn-town-name-ok`, `btn-town-name-cancel`, `btn-rename-town`.

**Photo (`photo/**`):** `photoCaption(title, date)`, `photoFileName(date, townName)`, a pure `fitCaptionTitle` (shrink, then ellipsis, with an injected text measure) and `title.maxWidth` in the layout; `framePhoto(shot, phase, date, townName)`.

## Files
- new: `src/town/townName.ts` + `townName.test.ts` (rules, list parsing, pick, slug, and a check of the shipped JSON), `tests/town-name.spec.ts`;
- `public/data/default_town_names.json` (owner-supplied, first commit);
- contract: `town/types.ts`, `game/events.ts`, `vite-env.d.ts`, `game/Game.ts`;
- `town/TownEditor.ts`, `town/serialize.ts`, `persistence/SaveStore.ts` + their tests;
- `ui/UiRoot.ts`, `ui/ui.css`, `ui/testIds.ts`, `ui/glyphs.ts`;
- `photo/photoLayout.ts` + test, `photo/PhotoFrame.ts`;
- e2e specs that click Start (`helpers.ts`, `ui.spec.ts`, `audio.spec.ts`, `interaction.spec.ts`, `visual.spec.ts`) go through the name dialog; `photo.spec.ts` (file name); regenerated phone baselines.
- docs: `PLAN.md` (WP-20), `02-interaction-and-ui.md`, `03-architecture.md`, `progress.md`, `CLAUDE.md`.

## Acceptance
- `npm run verify` green, with unit tests for the name rules, list parsing, picking, the slug, the shipped JSON (500 valid unique names), save round-trip with and without a name, a bad name in a save, rename autosave (and not while autosave is off), the caption fit and the file name.
- `tests/town-name.spec.ts` (desktop + mobile), real input only:
  - fresh start: the dialog is pre-filled with a name from the JSON; the dice changes it; Start building uses the typed name; the pill shows it; `diagnostics.townName` matches;
  - a 31st character can't be typed; an empty/blank name disables the button;
  - reload → Continue skips the dialog and the name is back;
  - rename from the pill and from the menu; Esc/Cancel keep the old name; the new name survives a reload;
  - New town from the menu → confirm → name dialog → the new name, an empty plot;
  - a photo's file name and caption use the name (a long name still yields a valid JPEG);
  - no console errors.
- Full `npm run test:e2e` green; the top bar stays one row with ≥ 44 px targets at 360, 390 and 412 px with a 30-character name.
- Visual baselines: desktop unchanged; phone top-bar baselines regenerated, masked diff 0 px outside the top bar.
- Main JS chunk under the 900 kB warning limit (split first if it isn't).
- Looked at by a person (screenshots in `artifacts/wp-20/`): the dialog on desktop and phone, the pill with a short and a 30-character name, a photo card with a long name.
