/**
 * Event-driven placement VFX: dust puff on place, poof on remove, small sparkle on
 * buildings, invalid "shake" handled by GhostPreview (WP-05).
 *
 * SCAFFOLD STUB — WP-08 (Feel & VFX) owns src/fx/**. TODO(WP-08): pooled particle
 * bursts (InstancedMesh or Points, ≤ 2 draw calls total), sized by tool category,
 * seeded RNG only, reduced-motion fallback, zero allocations per frame.
 */
import type * as THREE from 'three';
import type { GameBus } from '../game/events';

export class PlacementFx {
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly scene: THREE.Scene,
    bus: GameBus,
    private readonly rng: () => number,
  ) {
    this.unsubscribers.push(
      bus.on('build:placed', () => {}),
      bus.on('build:removed', () => {}),
    );
  }

  /** Advance particles. `delta` is 0 while reduced motion is on. */
  update(_delta: number): void {}

  /** Snap all effects to a stable end state (for screenshots). */
  stabilize(): void {}

  dispose(): void {
    for (const off of this.unsubscribers) off();
    void this.scene;
    void this.rng;
  }
}
