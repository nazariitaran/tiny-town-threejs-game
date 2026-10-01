/**
 * One-frame photo capture: renders to the game canvas at a higher pixel ratio, copies the pixels, then
 * restores the ratio and re-renders in the same task, so the big frame is never shown. Rendering to the
 * canvas rather than a render target keeps the game's tone mapping and sRGB output.
 *
 * preserveDrawingBuffer is false, so the copy must follow the render before this task yields.
 */
import type * as THREE from 'three';
import { photoPixelRatio } from './photoLayout';

/** Largest render edge the GPU supports (renderbuffer and viewport limits). */
export function maxRenderEdge(renderer: THREE.WebGLRenderer): number {
  const gl = renderer.getContext();
  const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
  const renderbuffer = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number | null;
  return Math.min(renderbuffer ?? 4096, viewport?.[0] ?? 4096, viewport?.[1] ?? 4096);
}

export interface Capture {
  canvas: HTMLCanvasElement;
  pixelRatio: number;
}

export function captureView(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Capture {
  const target = renderer.domElement;
  const screenRatio = renderer.getPixelRatio();
  const pixelRatio = photoPixelRatio(target.clientWidth, target.clientHeight, screenRatio, maxRenderEdge(renderer));
  const shot = document.createElement('canvas');
  try {
    // setPixelRatio re-applies the current CSS size (updateStyle false): only the buffer grows.
    renderer.setPixelRatio(pixelRatio);
    renderer.render(scene, camera);
    shot.width = target.width;
    shot.height = target.height;
    const ctx = shot.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas for the photo');
    ctx.drawImage(target, 0, 0);
  } finally {
    renderer.setPixelRatio(screenRatio);
    renderer.render(scene, camera);
  }
  return { canvas: shot, pixelRatio };
}
