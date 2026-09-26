/**
 * Sky, lighting, surrounding terrain, fog and the plot's grid overlay.
 *
 * SCAFFOLD STUB — WP-04 (World & look) owns this file. The public API below is
 * the contract Game.ts relies on; the internals are a minimal baseline to replace.
 */
import * as THREE from 'three';
import type { DebugTools } from '../debug/DebugTools';
import { CELL_SIZE, PLOT_DEPTH, PLOT_WIDTH, type QualityTier } from '../game/config';
import type { ModelLibrary } from '../render/ModelLibrary';

export class Environment {
  readonly sun: THREE.DirectionalLight;
  private readonly root = new THREE.Group();
  private readonly gridOverlay: THREE.LineSegments;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    _debug?: DebugTools,
  ) {
    this.root.name = 'environment';
    scene.add(this.root);

    // --- Sky: gradient dome (see shader-cookbook "Gradient Sky Dome"). WP-04: add sun halo, clouds.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color('#5aa7e8') },
          uHorizon: { value: new THREE.Color('#dff1ff') },
        },
        vertexShader: /* glsl */ `varying vec3 vDir;
          void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `varying vec3 vDir; uniform vec3 uTop, uHorizon;
          void main(){ float h = clamp(vDir.y, 0.0, 1.0); gl_FragColor = vec4(mix(uHorizon, uTop, pow(h, 0.55)), 1.0); }`,
      }),
    );
    sky.name = 'sky';
    sky.frustumCulled = false;
    this.root.add(sky);
    this.scene.fog = new THREE.Fog('#dff1ff', 40, 140);

    // --- Lights: hemisphere fill + warm key sun with shadows sized to the plot.
    this.root.add(new THREE.HemisphereLight('#dff1ff', '#6d8f4e', 1.4));
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.4);
    this.sun.position.set(-14, 22, 10);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const half = (Math.max(PLOT_WIDTH, PLOT_DEPTH) * CELL_SIZE) / 2 + 4;
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 80 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0005;
    this.root.add(this.sun);

    // --- Ground: big surrounding meadow + the buildable plot (field). WP-04: textures, edge treatment, decor ring.
    const outer = new THREE.Mesh(
      new THREE.CircleGeometry(160, 48),
      new THREE.MeshStandardMaterial({ color: '#7fb45a', roughness: 1 }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    outer.receiveShadow = true;
    outer.name = 'terrain-outer';
    this.root.add(outer);

    const plot = new THREE.Mesh(
      new THREE.PlaneGeometry(PLOT_WIDTH * CELL_SIZE, PLOT_DEPTH * CELL_SIZE),
      new THREE.MeshStandardMaterial({ color: '#8cc063', roughness: 1 }),
    );
    plot.rotation.x = -Math.PI / 2;
    plot.position.y = -0.005;
    plot.receiveShadow = true;
    plot.name = 'plot-field';
    this.root.add(plot);

    this.gridOverlay = this.createGridOverlay();
    this.root.add(this.gridOverlay);
  }

  /**
   * Called once after models load: build decor that needs GLB templates (distant tree ring from
   * 'tree-a'/'tree-b'/'decor-bush'/'decor-rocks', instanced). TODO(WP-04).
   */
  populate(_library: ModelLibrary): void {}

  /** 'low': 1024 shadow map, no env map. Game applies the matching DPR cap (MAX_DPR[tier]). TODO(WP-04). */
  setQuality(_tier: QualityTier): void {}

  setGridVisible(visible: boolean): void {
    this.gridOverlay.visible = visible;
  }

  /** Ambient animation (clouds, water, etc.). `elapsed` is frozen under reduced motion. */
  update(_delta: number, _elapsed: number): void {}

  dispose(): void {
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.scene.remove(this.root);
    void this.renderer;
  }

  private createGridOverlay(): THREE.LineSegments {
    const points: number[] = [];
    const w = PLOT_WIDTH * CELL_SIZE;
    const d = PLOT_DEPTH * CELL_SIZE;
    for (let i = 0; i <= PLOT_WIDTH; i += 1) {
      const x = -w / 2 + i * CELL_SIZE;
      points.push(x, 0.01, -d / 2, x, 0.01, d / 2);
    }
    for (let i = 0; i <= PLOT_DEPTH; i += 1) {
      const z = -d / 2 + i * CELL_SIZE;
      points.push(-w / 2, 0.01, z, w / 2, 0.01, z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.18 }),
    );
    lines.name = 'grid-overlay';
    return lines;
  }
}
