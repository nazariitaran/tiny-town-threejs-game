/**
 * One-frame photo capture (WP-19). Renders the scene to the game canvas at a higher pixel ratio,
 * copies the pixels into a 2D canvas, then restores the ratio and re-renders, all in the same task,
 * so the browser never shows the big frame. Rendering to the canvas (not a render target) keeps the
 * game's tone mapping and sRGB output, so the photo looks exactly like the screen.
 *
 * The drawing buffer is not preserved (preserveDrawingBuffer: false), so the copy must follow the
 * render before this task yields.
 */
import type * as THREE from 'three';
import { photoPixelRatio } from './photoLayout';

/** The largest render edge this GPU supports (renderbuffer and viewport limits). */
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
