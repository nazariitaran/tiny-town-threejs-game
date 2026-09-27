/**
 * Night light sources (WP-16b): glow masks on windows / lamps / traffic lights (via ModelLibrary's
 * glow clones, render/nightGlow.ts), pools of lamplight on the ground, lamp halos and headlight
 * beams (instanced additive quads, visible only at night). No real PointLights.
 *
 * Game.ts wiring (integrator, contract commit):
 *   new NightLights(scene, library, town, bus, life, quality, debug)
 *   load():   nightLights.populate()                 (after library.loadAll + life.load)
 *   update(): nightLights.update(daySample)          (every frame, after environment.applyDaylight)
 *             and at once from setTimeOfDay / setState while paused for screenshots
 *   diagnostics: daytime.lamps / daytime.drawCalls ← getDiagnostics()
 *   dispose()
 *
 * STUB (contract commit): does nothing yet; WP-16b implements it.
 */
import type * as THREE from 'three';
import type { DebugTools } from '../debug/DebugTools';
import type { QualityTier } from '../game/config';
import type { GameBus } from '../game/events';
import type { LifeSystem } from '../life/LifeSystem';
import type { TownStateReader } from '../town/types';
import type { DaySample } from '../world/dayCycle';
import type { ModelLibrary } from './ModelLibrary';

export interface NightLightsDiagnostics {
  /** Lampposts currently tracked. */
  lamps: number;
  /** Main-pass draw calls this layer adds (0 by day). */
  drawCalls: number;
}

export class NightLights {
  private readonly diag: NightLightsDiagnostics = { lamps: 0, drawCalls: 0 };

  constructor(
    scene: THREE.Scene,
    library: ModelLibrary,
    town: TownStateReader,
    bus: GameBus,
    life: LifeSystem,
    quality: QualityTier,
    debug?: DebugTools,
  ) {
    void [scene, library, town, bus, life, quality, debug];
  }

  /** Once, after models load (measures lamp heads, builds the instanced pools). */
  populate(): void {}

  /** Per frame and from test hooks: drive every light source from the day sample. */
  update(_sample: Readonly<DaySample>): void {}

  getDiagnostics(): NightLightsDiagnostics {
    return this.diag;
  }

  dispose(): void {}
}
