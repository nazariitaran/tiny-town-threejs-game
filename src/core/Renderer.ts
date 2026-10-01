import * as THREE from 'three';
import { effectivePixelRatio } from '../game/graphics';

/** `antialias` (MSAA) is fixed for the context's lifetime; changing it needs a page reload. */
export function createRenderer(canvas: HTMLCanvasElement, options: { antialias: boolean } = { antialias: true }): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: options.antialias,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // ShadowScheduler redraws the shadow map only when a caster changes.
  renderer.shadowMap.autoUpdate = false;
  return renderer;
}

/** Sizes the drawing buffer to the canvas at min(devicePixelRatio × renderScale, maxDpr). */
export function resizeRenderer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  maxDpr = 2,
  renderScale = 1,
): boolean {
  const canvas = renderer.domElement;
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const dpr = effectivePixelRatio(window.devicePixelRatio, { maxDpr, renderScale });
  const bufferWidth = Math.floor(width * dpr);
  const bufferHeight = Math.floor(height * dpr);
  const needsResize = canvas.width !== bufferWidth || canvas.height !== bufferHeight;

  if (needsResize) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return needsResize;
}
