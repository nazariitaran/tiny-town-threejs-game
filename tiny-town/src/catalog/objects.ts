/**
 * CONTRACT FILE — gameplay definition of every placeable object (not its visuals).
 * Rules (town/rules.ts), stats (TownState.stats) and the renderer read this table.
 */
import type { ModelId } from './models';
import type { GroundKind, ObjectKind } from '../town/types';

export interface ObjectDef {
  kind: ObjectKind;
  label: string;
  /**
   * Cells covered at rotation 0: [width along x, depth along z]. WP-12 (0.5-unit cells): cottage and
   * family home 3×3, townhouse 2×3, garage 1×2, bus stop 2×1, trees/postbox/lamppost 1×1.
   */
  footprint: readonly [number, number];
  /** Ground kinds every footprint cell must have. Roads are never allowed. */
  allowedGround: readonly GroundKind[];
  /** Must at least one footprint cell be 4-adjacent to this ground kind? */
  requiresAdjacent?: GroundKind;
  /** Residents counted in stats (>0 means it's a home). */
  residents: number;
  statGroup: 'home' | 'tree' | 'prop' | 'building';
  /** Visual variants; PlacedObject.variant indexes into this list. */
  models: readonly ModelId[];
  /** Number of variants the rules pick from (== models.length). */
  variants: number;
}

const OPEN_GROUND: readonly GroundKind[] = ['field', 'grass', 'meadow'];
const PROP_GROUND: readonly GroundKind[] = ['field', 'grass', 'meadow', 'pavement', 'walkway'];

const def = (d: Omit<ObjectDef, 'variants'>): ObjectDef => ({ ...d, variants: d.models.length });

export const OBJECTS: Readonly<Record<ObjectKind, ObjectDef>> = {
  'tree-a': def({ kind: 'tree-a', label: 'Oak', footprint: [1, 1], allowedGround: [...OPEN_GROUND, 'pavement'], residents: 0, statGroup: 'tree', models: ['tree-a'] }),
  'tree-b': def({ kind: 'tree-b', label: 'Pine', footprint: [1, 1], allowedGround: [...OPEN_GROUND, 'pavement'], residents: 0, statGroup: 'tree', models: ['tree-b'] }),
  'tree-c': def({ kind: 'tree-c', label: 'Birch', footprint: [1, 1], allowedGround: [...OPEN_GROUND, 'pavement'], residents: 0, statGroup: 'tree', models: ['tree-c', 'tree-c-small'] }),
  'townhouse-a': def({ kind: 'townhouse-a', label: 'Cottage', footprint: [3, 3], allowedGround: OPEN_GROUND, residents: 2, statGroup: 'home', models: ['townhouse-a'] }),
  'townhouse-b': def({ kind: 'townhouse-b', label: 'Townhouse', footprint: [2, 3], allowedGround: OPEN_GROUND, residents: 3, statGroup: 'home', models: ['townhouse-b', 'townhouse-b-alt'] }),
  'townhouse-c': def({ kind: 'townhouse-c', label: 'Family home', footprint: [3, 3], allowedGround: OPEN_GROUND, residents: 4, statGroup: 'home', models: ['townhouse-c', 'townhouse-c-alt'] }),
  garage: def({ kind: 'garage', label: 'Garage', footprint: [1, 2], allowedGround: [...OPEN_GROUND, 'pavement'], residents: 0, statGroup: 'building', models: ['garage'] }),
  'bus-stop': def({ kind: 'bus-stop', label: 'Bus stop', footprint: [2, 1], allowedGround: PROP_GROUND, requiresAdjacent: 'road', residents: 0, statGroup: 'prop', models: ['bus-stop'] }),
  postbox: def({ kind: 'postbox', label: 'Postbox', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, statGroup: 'prop', models: ['postbox'] }),
  lamppost: def({ kind: 'lamppost', label: 'Lamppost', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, statGroup: 'prop', models: ['lamppost'] }),
};

export const objectDef = (kind: ObjectKind): ObjectDef => OBJECTS[kind];
