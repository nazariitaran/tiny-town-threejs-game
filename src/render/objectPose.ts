/**
 * Where a placed object's or edge's model is drawn: the one definition shared by TownRenderer and
 * the ghost preview, so the bulldoze highlight lies exactly on what it will remove.
 *
 *  - Pose: plain objects turn by their quarter turn at size 1. Trees and plants get a stable yaw
 *    (any angle) and ±12 % size from hash(id) (never the RNG, so it survives reloads), and
 *    ObjectDef.height stretches Y only, so a tall tree keeps its crown inside its cell. A preview
 *    (no id yet) has no jitter.
 *  - Matrices: object origin = T(footprint centre) · R(yaw) · S(scale, scale · scaleY, scale);
 *    edge origin = T(edge centre) · R(0 or a quarter turn); then MODEL_STYLES' non-uniform scale
 *    on the model itself (instance = origin · S(pop-in) · style).
 */
import * as THREE from 'three';
import type { ModelId } from '../catalog/models';
import { heightScale, type ObjectDef } from '../catalog/objects';
import { edgeToWorld, footprintCentreWorld } from '../game/config';
import type { Edge, PlacedObject, Rotation } from '../town/types';
import { MODEL_STYLES } from './modelStyles';
import { hash01 } from './tween';

const QUARTER = Math.PI / 2;
const NO_SCALE: readonly [number, number, number] = [1, 1, 1];

export interface ObjectPose {
  /** Yaw in radians. */
  yaw: number;
  /** Uniform size. */
  scale: number;
  /** Extra vertical stretch on top of `scale`. */
  scaleY: number;
}

/** True for objects drawn with the per-id jitter (trees and plants). */
export function hasJitter(def: ObjectDef): boolean {
  return def.group === 'tree' || def.group === 'plant';
}

/** The pose of an object of `def` turned `rotation`; `id` null = a placement preview (no jitter). */
export function objectPose(def: ObjectDef, rotation: Rotation, id: number | null, out: ObjectPose = { yaw: 0, scale: 1, scaleY: 1 }): ObjectPose {
  out.scaleY = heightScale(def);
  if (id !== null && hasJitter(def)) {
    out.yaw = hash01(id, 11) * Math.PI * 2;
    out.scale = 0.88 + hash01(id, 12) * 0.24;
  } else {
    out.yaw = rotation * QUARTER;
    out.scale = 1;
  }
  return out;
}

const scratchPose: ObjectPose = { yaw: 0, scale: 1, scaleY: 1 };
const scratchCentre = { x: 0, z: 0 };
const scratchScale = new THREE.Vector3();

/** World transform of a placed object's model before its style scale. */
export function objectOrigin(placed: Pick<PlacedObject, 'id' | 'anchor' | 'rotation'>, def: ObjectDef, out: THREE.Matrix4): THREE.Matrix4 {
  const pose = objectPose(def, placed.rotation, placed.id, scratchPose);
  const centre = footprintCentreWorld(placed.anchor, def.footprint, placed.rotation, scratchCentre);
  out.makeRotationY(pose.yaw).scale(scratchScale.set(pose.scale, pose.scale * pose.scaleY, pose.scale));
  return out.setPosition(centre.x, 0, centre.z);
}

/** World transform of a hedge or fence model before its style scale (models run along x). */
export function edgeOrigin(edge: Edge, out: THREE.Matrix4): THREE.Matrix4 {
  const world = edgeToWorld(edge);
  return out.makeRotationY(world.alongX ? 0 : QUARTER).setPosition(world.x, 0, world.z);
}

/** MODEL_STYLES' non-uniform scale of a model (1, 1, 1 when it has none). */
export function styleScale(model: ModelId): readonly [number, number, number] {
  return MODEL_STYLES[model]?.scale ?? NO_SCALE;
}

export function styleMatrix(model: ModelId, out: THREE.Matrix4): THREE.Matrix4 {
  const [x, y, z] = styleScale(model);
  return out.makeScale(x, y, z);
}
