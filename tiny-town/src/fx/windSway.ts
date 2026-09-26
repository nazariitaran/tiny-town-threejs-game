/**
 * Wind sway for foliage materials (trees, meadow flowers). ModelLibrary (WP-03) calls
 * applyWindSway() on the private material clone of every model with `sway: true`;
 * PlacementFx/Game updates the shared time uniform via updateWindSway(elapsed).
 *
 * SCAFFOLD STUB — WP-08 owns this file. Implement with the instancing-aware
 * onBeforeCompile recipe in shader-cookbook.md "(c) Wind sway". Keep it a no-op-safe API.
 */
import type * as THREE from 'three';

export function applyWindSway(_material: THREE.Material): void {}

export function updateWindSway(_elapsed: number): void {}
