# Imported Asset Integration

Use this when a game loads GLB/GLTF/FBX models supplied by the user or taken from a licensed/CC0 library. Build everything else procedurally.

## Preferred Formats

- Three.js runtime: GLB with PBR materials first.
- Animation interchange: FBX when a source only ships FBX; convert to GLB offline (Blender import/export or FBX2glTF) for final material parity.
- STL/3MF are print formats and USDZ is Apple AR; neither belongs in a textured game runtime.

## Import Pattern

```ts
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const gltf = await loader.loadAsync('/assets/models/asset/model.glb');
scene.add(gltf.scene);
```

For animation:

```ts
const mixer = new THREE.AnimationMixer(gltf.scene);
const action = mixer.clipAction(gltf.animations[0]);
action.play();

// in loop
mixer.update(deltaSeconds);
```

## Animation Intake

- Log `gltf.animations.map(c => `${c.name} ${c.tracks.length} tracks`)` after load. Clip names from external tools are often meaningless (`NlaTrack.001`, `Armature|mixamo.com`); rename after load (`clip.name = 'walk'`) and select by your own names.
- A humanoid clip that drives only a handful of tracks points at a broken rig upstream; fix the source asset, not the runtime.
- Prefer baked root motion and convert to in-place at import. Touch only the top root bone's position track and zero the horizontal components only — keep Y, because vertical root motion is the jump and the gait bob:

```ts
for (const clip of clips) {
  for (const tr of clip.tracks) {
    if (tr.name !== 'Root.position') continue; // use the asset's actual root bone name
    const v = tr.values, x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  }
}
```

- Do not strip twist-bone or helper-bone tracks without checking skinning; many rigs skin limb mesh to them.
- Retargeting between skeleton conventions (e.g. Mixamo clips onto another rig) happens in a DCC tool or at runtime with `SkeletonUtils.retargetClip`; expect bone-name mappings and bind-pose orientation checks.

## FBX Specifics

- `FBXLoader` lives at `three/addons/loaders/FBXLoader.js` and imports `fflate`; bundler projects get it from npm automatically, while import-map pages must map it.
- `FBXLoader` can emit the same take twice under different node-path prefixes (`Armature.001|walk` and `Armature|Armature.001|walk`). Keep the variant with the shallower path.
- FBXLoader produces Phong materials, darker than GLB PBR. Convert to GLB for final art.

## Asset Intake Checklist

File size · triangle, mesh, material, and texture counts · texture dimensions · PBR behavior under the game's lighting rig · scale in meters · pivot/origin and bounds · collision proxy separate from the detailed mesh · clip names, durations, root motion · mobile memory and performance impact · license and attribution recorded.

## Performance Discipline

- One high-fidelity hero asset plus instanced/procedural supporting detail beats many unique heavy models.
- Decimate heavy models offline, keep textures compressed and reasonably sized, share geometry and materials, and dispose assets when leaving scenes.
- Run renderer diagnostics after importing: calls, triangles, geometries, textures, materials, file sizes.

## Common Fixes

- Wrong size: normalize bounds in an asset wrapper group.
- Wrong orientation: rotate a wrapper group, not the source mesh.
- Animation drifts out of place: keep root motion baked, strip only horizontal root position as above.
- Too expensive: decimate offline, reduce texture size, add LOD.
- Materials too dark or bright: check color space, tone mapping, environment, and exposure.
- Collision too complex: build primitive proxies in Three.js and keep the imported mesh visual-only.

## Report

Asset source and license, local paths, import files changed, renderer diagnostics before and after import, and screenshots in active gameplay.
