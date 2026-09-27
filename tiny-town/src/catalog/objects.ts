/**
 * CONTRACT FILE — gameplay definition of every placeable object (not its visuals).
 * Rules (town/rules.ts), stats (TownState.stats), FX and the renderer read this table.
 * Rows follow the dock order (catalog/tools.ts): Streets, Homes, Town, Nature, Garden.
 */
import type { ModelId } from './models';
import type { GroundKind, ObjectKind } from '../town/types';

/**
 * What an object is, for stats and effects (not for the dock, which is catalog/tools.ts):
 * road = road feature · street = street furniture · home = has residents · outbuilding = garage ·
 * amenity = shops and civic buildings · tree / plant = living things · garden = yard furniture.
 */
export type ObjectGroup = 'road' | 'street' | 'home' | 'outbuilding' | 'amenity' | 'tree' | 'plant' | 'garden';

export interface ObjectDef {
  kind: ObjectKind;
  label: string;
  group: ObjectGroup;
  /**
   * Cells covered at rotation 0: [width along x, depth along z] (0.5-unit cells; a road block is 2 × 2).
   */
  footprint: readonly [number, number];
  /** Ground kinds every footprint cell must have. Only road features may list 'road'. */
  allowedGround: readonly GroundKind[];
  /** Must at least one footprint cell be 4-adjacent to this ground kind? */
  requiresAdjacent?: GroundKind;
  /**
   * Road feature (roundabout): the anchor must be block-aligned (even x, z) and the footprint a whole
   * number of road blocks. Placing paints every footprint cell to road; bulldozing turns them to field.
   * Drawn instead of the road tiles below it; roads join it only at the middle of each side.
   */
  roadFeature?: boolean;
  /** Residents counted in stats (>0 means it's a home). */
  residents: number;
  /** Visual variants; PlacedObject.variant indexes into this list. */
  models: readonly ModelId[];
  /** Number of variants the rules pick from (== models.length). */
  variants: number;
}

const OPEN_GROUND: readonly GroundKind[] = ['field', 'grass', 'meadow'];
const PAVED_OK: readonly GroundKind[] = [...OPEN_GROUND, 'pavement'];
const PROP_GROUND: readonly GroundKind[] = [...OPEN_GROUND, 'pavement', 'walkway'];
const ANY_GROUND: readonly GroundKind[] = [...PROP_GROUND, 'road'];

const def = (d: Omit<ObjectDef, 'variants'>): ObjectDef => ({ ...d, variants: d.models.length });

export const OBJECTS: Readonly<Record<ObjectKind, ObjectDef>> = {
  // Streets
  roundabout: def({ kind: 'roundabout', label: 'Roundabout', group: 'road', footprint: [6, 6], allowedGround: ANY_GROUND, roadFeature: true, residents: 0, models: ['roundabout'] }),
  'traffic-light': def({ kind: 'traffic-light', label: 'Traffic light', group: 'street', footprint: [1, 1], allowedGround: PROP_GROUND, requiresAdjacent: 'road', residents: 0, models: ['traffic-light', 'traffic-light-hanging'] }),
  lamppost: def({ kind: 'lamppost', label: 'Lamppost', group: 'street', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['lamppost'] }),
  'bus-stop': def({ kind: 'bus-stop', label: 'Bus stop', group: 'street', footprint: [2, 1], allowedGround: PROP_GROUND, requiresAdjacent: 'road', residents: 0, models: ['bus-stop'] }),
  postbox: def({ kind: 'postbox', label: 'Postbox', group: 'street', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['postbox'] }),
  // Homes
  cottage: def({ kind: 'cottage', label: 'Cottage', group: 'home', footprint: [3, 3], allowedGround: OPEN_GROUND, residents: 2, models: ['cottage'] }),
  townhouse: def({ kind: 'townhouse', label: 'Townhouse', group: 'home', footprint: [2, 3], allowedGround: OPEN_GROUND, residents: 3, models: ['townhouse', 'townhouse-alt'] }),
  bungalow: def({ kind: 'bungalow', label: 'Bungalow', group: 'home', footprint: [3, 3], allowedGround: OPEN_GROUND, residents: 2, models: ['bungalow', 'bungalow-l'] }),
  'family-home': def({ kind: 'family-home', label: 'Family home', group: 'home', footprint: [3, 3], allowedGround: OPEN_GROUND, residents: 4, models: ['family-home'] }),
  'garage-house': def({ kind: 'garage-house', label: 'Suburban', group: 'home', footprint: [3, 3], allowedGround: OPEN_GROUND, residents: 4, models: ['garage-house-c', 'garage-house-o', 'garage-house-s', 'garage-house-u'] }),
  'big-house': def({ kind: 'big-house', label: 'Big house', group: 'home', footprint: [4, 3], allowedGround: OPEN_GROUND, residents: 5, models: ['big-house-d', 'big-house-n'] }),
  garage: def({ kind: 'garage', label: 'Garage', group: 'outbuilding', footprint: [1, 2], allowedGround: PAVED_OK, residents: 0, models: ['garage'] }),
  // Town
  'corner-shop': def({ kind: 'corner-shop', label: 'Corner shop', group: 'amenity', footprint: [2, 2], allowedGround: PAVED_OK, residents: 0, models: ['corner-shop'] }),
  supermarket: def({ kind: 'supermarket', label: 'Supermarket', group: 'amenity', footprint: [4, 3], allowedGround: PAVED_OK, residents: 0, models: ['supermarket'] }),
  church: def({ kind: 'church', label: 'Church', group: 'amenity', footprint: [2, 3], allowedGround: PAVED_OK, residents: 0, models: ['church'] }),
  'swimming-pool': def({ kind: 'swimming-pool', label: 'Pool', group: 'amenity', footprint: [4, 3], allowedGround: PROP_GROUND, residents: 0, models: ['swimming-pool'] }),
  fountain: def({ kind: 'fountain', label: 'Fountain', group: 'amenity', footprint: [2, 2], allowedGround: PROP_GROUND, residents: 0, models: ['fountain'] }),
  // Nature
  oak: def({ kind: 'oak', label: 'Oak', group: 'tree', footprint: [1, 1], allowedGround: PAVED_OK, residents: 0, models: ['oak'] }),
  pine: def({ kind: 'pine', label: 'Pine', group: 'tree', footprint: [1, 1], allowedGround: PAVED_OK, residents: 0, models: ['pine'] }),
  birch: def({ kind: 'birch', label: 'Birch', group: 'tree', footprint: [1, 1], allowedGround: PAVED_OK, residents: 0, models: ['birch', 'birch-small'] }),
  bush: def({ kind: 'bush', label: 'Bush', group: 'plant', footprint: [1, 1], allowedGround: PAVED_OK, residents: 0, models: ['bush'] }),
  // Garden
  planter: def({ kind: 'planter', label: 'Planter', group: 'garden', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['planter'] }),
  bench: def({ kind: 'bench', label: 'Bench', group: 'garden', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['bench'] }),
  swing: def({ kind: 'swing', label: 'Swing', group: 'garden', footprint: [2, 1], allowedGround: OPEN_GROUND, residents: 0, models: ['swing'] }),
  barbecue: def({ kind: 'barbecue', label: 'Barbecue', group: 'garden', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['barbecue'] }),
};

export const objectDef = (kind: ObjectKind): ObjectDef => OBJECTS[kind];

export const OBJECT_KINDS = Object.keys(OBJECTS) as ObjectKind[];
