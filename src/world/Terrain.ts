/**
 * Ground meshes, each one vertex-coloured mesh: the plot as a raised diorama slab (field, kerb, soil
 * faces) and the surrounding meadow disc rolling into distant hills. The field is a lighter, warmer
 * sibling of the ground-tile greens so painted lawns and meadows still read against it.
 */
import * as THREE from 'three';
import { CELL_SIZE, PLOT_DEPTH, PLOT_WIDTH } from '../game/config';
import { createLitMaterial, type MaterialMode } from '../render/materials';
import {
  FIELD_Y,
  KERB_TOP_Y,
  KERB_WIDTH,
  PLOT_HALF_X,
  PLOT_HALF_Z,
  SLAB_BOTTOM_Y,
  TERRAIN_RADIUS,
  fbm,
  smoothstep,
  terrainHeight,
} from './terrainShape';

const TERRAIN_PALETTE = {
  field: '#84c27c',
  fieldAlt: '#8dc882',
  kerbTop: '#e6cf9e',
  kerbSide: '#c4a674',
  soilTop: '#a0693f',
  soilBottom: '#6e4429',
  meadowA: '#55a765',
  meadowB: '#6cb468',
  meadowDry: '#9cc377',
  hillFar: '#8fbf8a',
};

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

class GeometryBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly colors: number[] = [];

  /** Quad a-b-c-d (counter-clockwise seen from the front), flat normal, one colour per vertex. */
  quad(
    a: THREE.Vector3Tuple,
    b: THREE.Vector3Tuple,
    c: THREE.Vector3Tuple,
    d: THREE.Vector3Tuple,
    colors: [THREE.Color, THREE.Color, THREE.Color, THREE.Color],
  ): void {
    const ab = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ad = new THREE.Vector3(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    const n = ab.cross(ad).normalize();
    // Two triangles: a b c, a c d. Front face = CCW (a→b→c) when seen along -n.
    const verts = [a, b, c, a, c, d];
    const cols = [colors[0], colors[1], colors[2], colors[0], colors[2], colors[3]];
    for (let i = 0; i < 6; i += 1) {
      this.positions.push(...verts[i]);
      this.normals.push(n.x, n.y, n.z);
      this.colors.push(cols[i].r, cols[i].g, cols[i].b);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** The plot slab: subtly mottled field, cream kerb, soil faces. */
export function createPlotBase(mode: MaterialMode = 'standard'): THREE.Mesh {
  const g = new GeometryBuilder();
  const field = new THREE.Color(TERRAIN_PALETTE.field);
  const fieldAlt = new THREE.Color(TERRAIN_PALETTE.fieldAlt);
  const fieldColor = (x: number, z: number): THREE.Color => {
    const n = fbm(x * 0.18 + 3.1, z * 0.18 - 1.7, 3, 5);
    return new THREE.Color().lerpColors(field, fieldAlt, smoothstep(0.3, 0.75, n));
  };

  // Field top: one quad per cell so the mottling is smooth and deterministic.
  const w = PLOT_WIDTH * CELL_SIZE;
  const dpt = PLOT_DEPTH * CELL_SIZE;
  for (let i = 0; i < PLOT_WIDTH; i += 1) {
    for (let j = 0; j < PLOT_DEPTH; j += 1) {
      const x0 = -w / 2 + i * CELL_SIZE;
      const z0 = -dpt / 2 + j * CELL_SIZE;
      const x1 = x0 + CELL_SIZE;
      const z1 = z0 + CELL_SIZE;
      g.quad([x0, FIELD_Y, z0], [x0, FIELD_Y, z1], [x1, FIELD_Y, z1], [x1, FIELD_Y, z0], [
        fieldColor(x0, z0),
        fieldColor(x0, z1),
        fieldColor(x1, z1),
        fieldColor(x1, z0),
      ]);
    }
  }

  const kerbTop = new THREE.Color(TERRAIN_PALETTE.kerbTop);
  const kerbSide = new THREE.Color(TERRAIN_PALETTE.kerbSide);
  const soilTop = new THREE.Color(TERRAIN_PALETTE.soilTop);
  const soilBottom = new THREE.Color(TERRAIN_PALETTE.soilBottom);
  const ix = PLOT_HALF_X;
  const iz = PLOT_HALF_Z;
  const ox = PLOT_HALF_X + KERB_WIDTH;
  const oz = PLOT_HALF_Z + KERB_WIDTH;
  const kerbBottom = KERB_TOP_Y - 0.13;

  // Walk the four sides; each side is described in its own local frame by corner points.
  const sides: Array<{ inner: [number, number][]; outer: [number, number][] }> = [
    { inner: [[-ix, iz], [ix, iz]], outer: [[-ox, oz], [ox, oz]] }, // +z (south)
    { inner: [[ix, iz], [ix, -iz]], outer: [[ox, oz], [ox, -oz]] }, // +x (east)
    { inner: [[ix, -iz], [-ix, -iz]], outer: [[ox, -oz], [-ox, -oz]] }, // -z (north)
    { inner: [[-ix, -iz], [-ix, iz]], outer: [[-ox, -oz], [-ox, oz]] }, // -x (west)
  ];
  for (const { inner, outer } of sides) {
    const [i0, i1] = inner;
    const [o0, o1] = outer;
    // Kerb top (mitred corners).
    g.quad([i0[0], KERB_TOP_Y, i0[1]], [o0[0], KERB_TOP_Y, o0[1]], [o1[0], KERB_TOP_Y, o1[1]], [i1[0], KERB_TOP_Y, i1[1]], [
      kerbTop, kerbTop, kerbTop, kerbTop,
    ]);
    // Kerb inner lip down to the field.
    g.quad([i0[0], FIELD_Y, i0[1]], [i0[0], KERB_TOP_Y, i0[1]], [i1[0], KERB_TOP_Y, i1[1]], [i1[0], FIELD_Y, i1[1]], [
      kerbSide, kerbSide, kerbSide, kerbSide,
    ]);
    // Kerb outer face.
    g.quad([o0[0], KERB_TOP_Y, o0[1]], [o0[0], kerbBottom, o0[1]], [o1[0], kerbBottom, o1[1]], [o1[0], KERB_TOP_Y, o1[1]], [
      kerbSide, kerbSide, kerbSide, kerbSide,
    ]);
    // Soil face below the kerb.
    g.quad([o0[0], kerbBottom, o0[1]], [o0[0], SLAB_BOTTOM_Y, o0[1]], [o1[0], SLAB_BOTTOM_Y, o1[1]], [o1[0], kerbBottom, o1[1]], [
      soilTop, soilBottom, soilBottom, soilTop,
    ]);
  }

  const geometry = g.build();
  const mesh = new THREE.Mesh(geometry, createLitMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }, mode));
  mesh.name = 'plot-field';
  mesh.receiveShadow = true;
  return mesh;
}

/** The meadow disc: polar grid, radial spacing growing with distance, vertex-coloured. */
export function createOuterTerrain(mode: MaterialMode = 'standard'): THREE.Mesh {
  const rings = 64;
  const segments = 128;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const meadowA = new THREE.Color(TERRAIN_PALETTE.meadowA);
  const meadowB = new THREE.Color(TERRAIN_PALETTE.meadowB);
  const dry = new THREE.Color(TERRAIN_PALETTE.meadowDry);
  const hill = new THREE.Color(TERRAIN_PALETTE.hillFar);

  for (let i = 0; i <= rings; i += 1) {
    // Quadratic spacing: dense near the plot, coarse at the horizon.
    const t = i / rings;
    const r = 6 + (TERRAIN_RADIUS - 6) * t * t;
    for (let s = 0; s < segments; s += 1) {
      const a = (s / segments) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      positions.push(x, terrainHeight(x, z), z);
      const patch = fbm(x * 0.05 + 9.2, z * 0.05 - 4.4, 3, 31);
      const dryness = fbm(x * 0.021 - 3.3, z * 0.021 + 8.1, 2, 41);
      tmpA.lerpColors(meadowA, meadowB, smoothstep(0.35, 0.7, patch));
      tmpA.lerp(dry, smoothstep(0.55, 0.8, dryness) * 0.55);
      tmpB.copy(tmpA).lerp(hill, smoothstep(80, 260, r));
      colors.push(tmpB.r, tmpB.g, tmpB.b);
    }
  }
  for (let i = 0; i < rings; i += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = i * segments + s;
      const b = i * segments + ((s + 1) % segments);
      const c = (i + 1) * segments + s;
      const d = (i + 1) * segments + ((s + 1) % segments);
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, createLitMaterial({ vertexColors: true, roughness: 1, metalness: 0 }, mode));
  mesh.name = 'terrain-outer';
  mesh.receiveShadow = true;
  return mesh;
}
