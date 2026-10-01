import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EDGE_MODELS, type ModelId } from '../catalog/models';
import { OBJECT_KINDS, objectDef } from '../catalog/objects';
import { WIND_SWAY_CACHE_KEY } from '../fx/windSway';
import { edgeToWorld, footprintCentreWorld } from '../game/config';
import type { ModelLibrary } from '../render/ModelLibrary';
import { edgeOrigin, hasJitter, objectOrigin, styleMatrix } from '../render/objectPose';
import type { Edge, EdgeKind, Rotation } from '../town/types';
import { GhostPreview, objectGhostPart, type GhostShowOptions } from './GhostPreview';

const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];
const SWAY_MODELS = new Set<ModelId>(['pine', 'oak']);

/** A model library stand-in: one box per model; models in SWAY_MODELS use a sway-patched material. */
function stubLibrary(): ModelLibrary {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const plain = new THREE.MeshStandardMaterial({ name: 'plain' });
  const swaying = new THREE.MeshStandardMaterial({ name: 'swaying' });
  swaying.userData.windSway = true;
  return {
    materialMode: 'standard',
    has: () => true,
    createObject: (id: ModelId) => {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(geometry, SWAY_MODELS.has(id) ? swaying : plain);
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      return group;
    },
  } as unknown as ModelLibrary;
}

function makeGhost(): { ghost: GhostPreview; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  return { ghost: new GhostPreview(scene, stubLibrary()), scene };
}

/** World matrix of the one visible model mesh inside the ghost. */
function shownMeshMatrix(ghost: GhostPreview, scene: THREE.Scene, options: GhostShowOptions): THREE.Matrix4 {
  ghost.show(options);
  ghost.update(0);
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  ghost.root.traverseVisible((object) => {
    if ((object as THREE.Mesh).isMesh && object.parent?.name.startsWith('ghost:')) meshes.push(object as THREE.Mesh);
  });
  expect(meshes).toHaveLength(1);
  return meshes[0].matrixWorld;
}

function expectSameMatrix(actual: THREE.Matrix4, expected: THREE.Matrix4, label: string): void {
  actual.elements.forEach((value, i) => expect(value, `${label} [${i}]`).toBeCloseTo(expected.elements[i], 6));
}

describe('GhostPreview lies exactly on what TownRenderer draws', () => {
  it('bulldoze: every object kind × variant × rotation, trees with their own yaw and size', () => {
    const { ghost, scene } = makeGhost();
    const anchor = { x: 10, z: 12 };
    for (const kind of OBJECT_KINDS) {
      const def = objectDef(kind);
      if (def.roadMarking) continue; // drawn by the road tile under it; its ghost is the marked tile
      def.models.forEach((model) => {
        for (const rotation of ROTATIONS) {
          for (const id of [7, 4242]) {
            const placed = { id, anchor, rotation };
            const centre = footprintCentreWorld(anchor, def.footprint, rotation);
            // As ToolController.showBulldozeTarget shows it.
            const actual = shownMeshMatrix(ghost, scene, {
              x: centre.x,
              z: centre.z,
              quarterTurns: 0,
              state: 'remove',
              parts: [objectGhostPart(def, model, rotation, id)],
              snap: true,
            });
            // As TownRenderer.addObject draws it (origin · style; the pop-in scale is 1 once settled).
            const expected = objectOrigin(placed, def, new THREE.Matrix4()).multiply(styleMatrix(model, new THREE.Matrix4()));
            expectSameMatrix(actual, expected, `${kind}/${model} r${rotation} id${id}`);
          }
        }
      });
    }
  });

  it('placing: the preview of a plain object matches the placed one at every rotation', () => {
    const { ghost, scene } = makeGhost();
    const anchor = { x: 20, z: 8 };
    for (const kind of OBJECT_KINDS) {
      const def = objectDef(kind);
      if (def.roadMarking || hasJitter(def)) continue; // a tree's jitter only exists once it has an id
      for (const rotation of ROTATIONS) {
        const centre = footprintCentreWorld(anchor, def.footprint, rotation);
        const actual = shownMeshMatrix(ghost, scene, {
          x: centre.x,
          z: centre.z,
          quarterTurns: rotation,
          state: 'valid',
          parts: [objectGhostPart(def, def.models[0], 0, null)],
          snap: true,
        });
        const expected = objectOrigin({ id: 1, anchor, rotation }, def, new THREE.Matrix4()).multiply(styleMatrix(def.models[0], new THREE.Matrix4()));
        expectSameMatrix(actual, expected, `${kind} r${rotation}`);
      }
    }
  });

  it('edges: hedge and fences both ways round, with their style scale', () => {
    const { ghost, scene } = makeGhost();
    for (const [kind, model] of Object.entries(EDGE_MODELS) as Array<[EdgeKind, ModelId]>) {
      for (const side of ['n', 'w'] as const) {
        const edge: Edge = { x: 9, z: 14, side };
        const world = edgeToWorld(edge);
        // As ToolController shows an edge ghost (placing and bulldozing alike).
        const actual = shownMeshMatrix(ghost, scene, {
          x: world.x,
          z: world.z,
          quarterTurns: world.alongX ? 0 : 1,
          state: 'remove',
          parts: [{ model }],
          snap: true,
        });
        const expected = edgeOrigin(edge, new THREE.Matrix4()).multiply(styleMatrix(model, new THREE.Matrix4()));
        expectSameMatrix(actual, expected, `${kind} ${side}`);
      }
    }
  });
});

describe('GhostPreview remove look', () => {
  function ghostMaterials(ghost: GhostPreview): THREE.MeshStandardMaterial[] {
    const materials = new Set<THREE.MeshStandardMaterial>();
    ghost.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh && mesh.parent?.name.startsWith('ghost:')) materials.add(mesh.material as THREE.MeshStandardMaterial);
    });
    return [...materials];
  }

  it('paints the object (polygon offset, mostly opaque) and goes back to a plain ghost when placing', () => {
    const { ghost } = makeGhost();
    ghost.show({ x: 0, z: 0, quarterTurns: 0, state: 'remove', parts: [{ model: 'cottage' }] });
    const [material] = ghostMaterials(ghost);
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBeLessThan(0);
    expect(material.opacity).toBeCloseTo(0.9);
    ghost.show({ x: 0, z: 0, quarterTurns: 0, state: 'valid', parts: [{ model: 'cottage' }] });
    expect(material.polygonOffset).toBe(false);
    expect(material.opacity).toBeCloseTo(ghost.tuning.modelOpacity);
  });

  it('recolours red states after the colour atlas, so green surfaces turn red rather than brown', () => {
    const { ghost } = makeGhost();
    ghost.show({ x: 0, z: 0, quarterTurns: 0, state: 'remove', parts: [{ model: 'cottage' }] });
    const [material] = ghostMaterials(ghost);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>\n#include <color_fragment>\n#include <opaque_fragment>',
    };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    const recolour = shader.fragmentShader.indexOf('mix(diffuseColor.rgb, uGhostRimColor, uGhostRecolor)');
    expect(recolour).toBeGreaterThan(shader.fragmentShader.indexOf('#include <color_fragment>'));
    expect(shader.uniforms.uGhostRecolor.value).toBeCloseTo(0.88);
    // The material colour itself is not tinted in red states (the texture would multiply it to brown).
    expect(material.color.getHex()).toBe(new THREE.MeshStandardMaterial().color.getHex());
    ghost.show({ x: 0, z: 0, quarterTurns: 0, state: 'valid', parts: [{ model: 'cottage' }] });
    expect(shader.uniforms.uGhostRecolor.value).toBe(0);
  });

  it('selected (Move tool): on the object like remove, a lighter blue wash', () => {
    const { ghost } = makeGhost();
    ghost.show({ x: 0, z: 0, quarterTurns: 0, state: 'selected', parts: [{ model: 'cottage' }] });
    const [material] = ghostMaterials(ghost);
    expect(material.polygonOffset).toBe(true);
    expect(material.opacity).toBeCloseTo(0.7);
    expect(material.emissive.getHexString()).toBe(new THREE.Color('#4a9be8').getHexString());
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>\n#include <opaque_fragment>',
    };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uGhostRecolor.value).toBeCloseTo(0.6);
  });

  it('sways ghosts of swaying models only', () => {
    const { ghost } = makeGhost();
    ghost.show({ x: 0, z: 0, quarterTurns: 0, state: 'remove', parts: [{ model: 'pine' }, { model: 'bench' }] });
    const materials = ghostMaterials(ghost);
    const sway = materials.filter((m) => m.userData.windSway);
    expect(sway).toHaveLength(1);
    expect(sway[0].customProgramCacheKey()).toContain(WIND_SWAY_CACHE_KEY);
    expect(sway[0].customProgramCacheKey()).toContain('tiny-town-ghost-rim');
    expect(materials.find((m) => !m.userData.windSway)?.customProgramCacheKey()).not.toContain(WIND_SWAY_CACHE_KEY);
  });
});
