---
name: threejs-aaa-graphics-builder
description: "Upgrade Three.js games from prototype visuals to premium browser graphics: art-direction critique, procedural model building, material and texture libraries, world prop kits, shaders, VFX, lighting and render pipeline, LOD and instancing, render budgets, and a 10-category visual scorecard. Use when screenshots still look basic or the user asks for premium, AAA, high-fidelity, showcase, or less-basic graphics."
---

# Three.js AAA Graphics Builder

Own the production graphics pass: turn basic screenshots into authored, high-density, performance-aware visuals.

## References

| File | Read it when |
| --- | --- |
| `references/visual-scorecard.md` | scoring visuals or making any premium/AAA/showcase claim |
| `references/authoring-recipes.md` | building hero, obstacle, reward, world-kit, or prop models; changing lighting, tone mapping, shadows, fog, post, or graphics architecture |
| `references/technical-art.md` | render budgets, material kits, VFX systems, instancing/LOD, imported asset cleanup, anything that could affect browser performance |
| `references/asset-import.md` | loading user-supplied or licensed GLB/FBX models, animation clips, root motion, imported-asset cleanup |
| `references/shader-cookbook.md` | custom shaders, `onBeforeCompile`, skies, or post-processing; use recipes as tested starting points and verify them against the project's Three.js version |

For a broad "still looks basic" or premium pass, read the scorecard, authoring recipes, technical art, and shader cookbook before implementing; add `asset-import.md` when the project has imported models. A narrow graphics edit loads only its relevant references and checks; the requested style and scope override recipe defaults.

## Core rule

Glow does not make primitives look AAA. Build authored forms first, then materials, then lighting, then effects — in that order.

## Workflow

1. Capture or inspect active-play screenshots on the target viewports when a playable scene exists.
2. For an existing game, score the affected views and pick the weakest surfaces. For a new game, establish art direction, camera scale, material roles, and the hero target first; do not invent a before screenshot.
3. Add the graphics architecture the game is missing: material library, procedural textures and decals, model factories, world prop kit, VFX system, render pipeline, diagnostics.
4. Choose a source per high-value surface: an authored procedural model, or a user-supplied/licensed model imported through `references/asset-import.md`.
   Finish one representative playable scene with actual assets and feedback before expanding the content kit.
5. Upgrade every weak visible surface, not only the hero: hazards, rewards, ground and track, foreground props, background layers, telegraphs, material variation, state VFX.
6. Add lighting, tone mapping, and render polish once authored forms exist.
7. Add event-driven VFX tied to gameplay state.
8. Re-score against the calibration anchors, citing the inspector's measured metrics. Keep going until every premium category is at least 2, or name the exact blocker.

## Asset sourcing

Do not call external generation services. Hero surfaces — player, character, creature, boss, vehicle, ship, building, weapon, signature prop, hero environment piece — get the most authoring effort: layered procedural forms, material zones, and silhouette detail, or a user-supplied/licensed model when one is available in the project. High-value 2D — skies, backgrounds, trim sheets, decals, faction marks, icons — comes from canvas-generated textures, shaders, and SVG, or from user-supplied files. Procedural Three.js handles repeated props, kits, collision proxies, VFX geometry, and instanced volume. When a surface would clearly benefit from an asset you cannot author well procedurally, report the gap and name the file the user could supply.

For animated assets inspect motion as well as silhouettes: locomotion, blend transitions, foot contacts, hit timing, and secondary motion in real gameplay. A focused independent critique may identify defects after a substantial pass; the lead remains responsible for the final score and integration.

## Report

Score before and after with one line of evidence per category, the surfaces you upgraded, files changed, screenshots, renderer diagnostics against the budget table, imported asset paths and sources, and what is still weak. Include imported-asset diagnostics (scale, bounds, collision proxy, clips) when imported 3D was used.
