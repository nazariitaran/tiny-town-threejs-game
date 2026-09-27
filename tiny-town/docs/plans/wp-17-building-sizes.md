# WP-17 — Bigger buildings, smaller swing, dark shops at night (plan, owner-approved 2026-09-27)

> **Approved plan, being implemented on the integration branch `building-sizes`.** That branch merges into `main` only after the owner's final approval. The version label is the owner's call. As-built facts go to `03-architecture.md`, `models.md` and `progress.md` ("WP-17 as built").

## Owner requests (2026-09-27)
1. **Buildings are still a bit too small.**
   - Every **home** and **town building** grows by **one cell in each direction**, and the model scales up to fill the bigger lot. The owner chose this over "same footprint, bigger model".
   - Homes: cottage, townhouse, bungalow, family home, suburban, big house. Town buildings: corner shop, supermarket, church.
   - Unchanged: garage, pool, fountain, street furniture, trees, garden items and roads.
2. **The swing should be a little smaller.** Keep its 2 × 1 footprint and scale the model down about 10–15%.
3. **Shops and the church don't work at night,** so the supermarket, corner shop and church must **not** light up. House windows, lamps, traffic lights and cars keep their night lights.

## Footprints (cells of 0.5 world units)

| Kind | Now | New |
| --- | --- | --- |
| cottage, bungalow, family-home, garage-house | 3 × 3 | **4 × 4** |
| townhouse | 2 × 3 | **3 × 4** |
| big-house | 4 × 3 | **5 × 4** |
| corner-shop | 2 × 2 | **3 × 3** |
| supermarket | 4 × 3 | **5 × 4** |
| church | 2 × 3 | **3 × 4** |

- **Parity:** odd and even sizes swap, so `anchorForPointer` centring changes: odd sizes centre on a cell, even sizes on a cell corner. The rules and the pointer code already handle both; the tests must cover the new sizes.
- **Model scale:** use a uniform scale, so a building fills its new lot like today with the same "front yard" feel. That is roughly ×(new/old) on the depth axis: 3 → 4 gives ×1.33, and 2 → 3 wide keeps the depth ratio. Re-tune the z-offset nudge that leaves a front yard. The final numbers are the WP's call, judged in screenshots.
- **Save format → v4, no migration.** Old saves with smaller footprints would overlap and be rejected by `parseSave` anyway. This follows the owner's v0.3 rule of no backward compatibility: a v3 save starts a fresh town. `SAVE_MIGRATIONS` stays empty.

## Work split (integration branch `building-sizes`, from `main` `29c782b`)
- **Integrator contract commit (done):** removed `glow` from `supermarket` and `church` in `catalog/models.ts`. The corner shop never glowed.
- **Wave 1, in parallel:**

| WP | Branch / worktree / port | Owns | Notes |
| --- | --- | --- | --- |
| **WP-17a Scale & layouts** | `wp-17a-scale` · `../ThreeJsGames-wt/wp-17a` · 5218 | Delegated for this change: `catalog/objects.ts` (footprints only) and `catalog/models.ts` (scale/offset of the listed models and the swing; not `glow`). Also `town/sampleTown.ts` + test, `town/serialize.ts` + test (v4), `town/**` tests, `render/TownRenderer.ts` (only if needed for footprint-centred drawing), `catalog/catalog.test.ts`, and `docs/assets/models.md` + `models.json` (scales and `footprintCells`) | The sample town must place every tool with zero rejections; the asset gallery must place every object kind; the stress town must stay within budget (mobile ≤ 250k triangles, ≤ 120 calls) |
| **WP-17b Shop lights** | `wp-17b-shop-lights` · `../ThreeJsGames-wt/wp-17b` · 5219 | `render/nightGlow.ts` + test, `render/NightLights.ts` (only if needed), and the one line `GlowKind` in `catalog/models.ts` (delegated: drop `'church'`) | Remove the church mask kind and its code/tests. Prove at night that the supermarket, corner shop and church stay dark while houses, lamps, traffic lights and cars still glow |

- **Wave 2, after 17a and 17b merge:**

| WP | Branch / worktree / port | Owns | Notes |
| --- | --- | --- | --- |
| **WP-17c QA** | `wp-17c-qa` · `../ThreeJsGames-wt/wp-17c` · 5221 | `tests/**` | Re-map the e2e specs to the new footprints (build-flow, fx, interaction, ui, daynight). Regenerate the baselines that must change (sample-town, asset-gallery, night-town × desktop/mobile), look at each, and prove `title` doesn't change unless the title scene shows buildings. Run the inspector: stress-town day and night within budget. Take close-up screenshots of a street with every building type at the default zoom, with a car and a person-scale prop next to them for scale |

- **The integrator** owns docs (`03-architecture.md`, `02-interaction-and-ui.md` footprint table, `progress.md`, `PLAN.md`), merges and the final full e2e.

## Acceptance
- `npm run verify` and `npm run test:e2e` are green on `building-sizes` after every merge.
- Unit tests cover:
  - the new footprints (rules: placement, overlap, bounds at plot edges, rotation of non-square footprints);
  - the sample town with zero rejections;
  - v4 accepted and v3 rejected.
- Screenshots show:
  - buildings visibly bigger, but still in proportion with cars, lamps, trees and the road width;
  - the swing slightly smaller;
  - at night, the supermarket, corner shop and church dark and house windows lit.
- Budgets: stress town ≤ 150 / 120 draw calls and ≤ 400k / 250k triangles, day and night.
