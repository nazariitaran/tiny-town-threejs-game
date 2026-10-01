import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyWindSway, patchShader } from '../fx/windSway';
import { createLitMaterial, litMaterial, materialFamily, toLambert } from './materials';
import { GlowRegistry, patchWindowShader } from './nightGlow';

function richStandard(): THREE.MeshStandardMaterial {
  const map = new THREE.Texture();
  const emissiveMap = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const alphaMap = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({
    name: 'atlas',
    color: '#336699',
    map,
    emissive: '#ffcc00',
    emissiveMap,
    emissiveIntensity: 1.7,
    vertexColors: true,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    alphaTest: 0.25,
    alphaMap,
    flatShading: true,
    roughness: 0.9,
    metalness: 0,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  material.userData = { glowKind: 'windows', gltf: { index: 3 } };
  return material;
}

describe('toLambert (Low preset)', () => {
  it('keeps every field the game relies on', () => {
    const source = richStandard();
    const out = toLambert(source);
    expect(out).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(out.name).toBe('atlas');
    expect(out.color.getHexString()).toBe(source.color.getHexString());
    expect(out.map).toBe(source.map); // shared, not cloned
    expect(out.emissive.getHexString()).toBe('ffcc00');
    expect(out.emissiveMap).toBe(source.emissiveMap);
    expect(out.emissiveIntensity).toBe(1.7);
    expect(out.vertexColors).toBe(true);
    expect(out.transparent).toBe(true);
    expect(out.opacity).toBe(0.4);
    expect(out.side).toBe(THREE.DoubleSide);
    expect(out.alphaTest).toBe(0.25);
    expect(out.alphaMap).toBe(source.alphaMap);
    expect(out.flatShading).toBe(true);
    expect(out.depthWrite).toBe(false);
    expect(out.toneMapped).toBe(false);
    expect(out.fog).toBe(false);
    expect(out.userData).toEqual({ glowKind: 'windows', gltf: { index: 3 } });
    expect(out.userData).not.toBe(source.userData);
    // Lambert-only fields keep their own defaults (not `undefined` read off the standard material).
    expect(out.combine).toBe(THREE.MultiplyOperation);
    expect(out.specularMap).toBeNull();
    expect(out.reflectivity).toBe(1);
  });

  it('litMaterial converts only lit standard materials, and only in lambert mode', () => {
    const standard = new THREE.MeshStandardMaterial();
    expect(litMaterial(standard, 'standard')).toBe(standard);
    const basic = new THREE.MeshBasicMaterial();
    expect(litMaterial(basic, 'lambert')).toBe(basic);
    const shader = new THREE.ShaderMaterial();
    expect(litMaterial(shader, 'lambert')).toBe(shader);
    let disposed = false;
    const source = new THREE.MeshStandardMaterial({ color: '#ff0000' });
    source.addEventListener('dispose', () => {
      disposed = true;
    });
    const lambert = litMaterial(source, 'lambert');
    expect(materialFamily(lambert)).toBe('lambert');
    expect(disposed).toBe(true);
    expect(litMaterial(lambert, 'lambert')).toBe(lambert);
  });

  it('createLitMaterial builds either family from the same parameters', () => {
    const params = { color: '#84c27c', vertexColors: true, roughness: 1 } as const;
    const standard = createLitMaterial(params, 'standard');
    const lambert = createLitMaterial(params, 'lambert');
    expect(materialFamily(standard)).toBe('standard');
    expect(materialFamily(lambert)).toBe('lambert');
    expect(lambert.color.getHexString()).toBe(standard.color.getHexString());
    expect(lambert.vertexColors).toBe(true);
    expect(materialFamily(new THREE.MeshBasicMaterial())).toBeNull();
  });

  it('the Lambert shader has the chunks the wind-sway and window-glow patches hook into', () => {
    const lambert = THREE.ShaderLib.lambert;
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: lambert.vertexShader, fragmentShader: lambert.fragmentShader };
    patchShader(shader);
    expect(shader.vertexShader).toContain('uWindTime');
    patchWindowShader(shader, { uLightsOn: { value: 0 }, uLightsOff: { value: 0 } });
    expect(shader.vertexShader).toContain('vGlowSeed = glowHash12');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= step(vGlowSeed, uLightsOn)');
    // The ghost rim reads vViewPosition and normal in the fragment stage; birds hook <common>/<begin_vertex>.
    expect(lambert.fragmentShader).toContain('#include <opaque_fragment>');
    expect(lambert.fragmentShader).toContain('#include <lights_lambert_pars_fragment>');
    expect(THREE.ShaderChunk.lights_lambert_pars_fragment).toContain('varying vec3 vViewPosition');
    expect(lambert.vertexShader).toContain('#include <common>');
  });

  it('glow clones and wind sway work on a converted material', () => {
    const glow = new GlowRegistry();
    const base = toLambert(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }));
    const clone = glow.createClone(base, 'windows');
    expect(clone).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(clone.emissiveMap).toBe(glow.mask('windows'));
    expect(clone.userData.windowGlow).toBe(true);
    glow.update({ night: 1, lightsOn: 1, lightsOff: 0 });
    expect(clone.emissiveIntensity).toBeGreaterThan(0);
    const sway = base.clone();
    applyWindSway(sway);
    expect(sway.userData.windSway).toBe(true);
    expect(sway.customProgramCacheKey()).toContain('wind-sway');
    glow.dispose();
  });
});
