// Gameplay definition of every placeable object; rows follow the dock order (catalog/tools.ts).
import type { ModelId } from './models';
import type { GroundKind, ObjectKind, PlacedObject } from '../town/types';

/**
 * What an object is, for stats and effects (not the dock): road = road feature · street = street furniture ·
 * home = has residents · amenity = shops and civic buildings · tree / plant = living things · garden = yard furniture.
 */
export type ObjectGroup = 'road' | 'street' | 'home' | 'amenity' | 'tree' | 'plant' | 'garden';

export interface ObjectDef {
  kind: ObjectKind;
  label: string;
  group: ObjectGroup;
  /** Cells covered at rotation 0: [width along x, depth along z]. Style 0's when `footprints` is set. */
  footprint: readonly [number, number];
  /** Per-style footprints, indexed like `models`, for kinds whose styles differ in size (read through footprintOf). */
  footprints?: ReadonlyArray<readonly [number, number]>;
  /** Ground kinds every footprint cell must have. Only road features and road markings may list 'road'. */
  allowedGround: readonly GroundKind[];
  /** At least one footprint cell must be 4-adjacent to this ground kind. */
  requiresAdjacent?: GroundKind;
  /**
   * Road feature (roundabout): the anchor must be block-aligned (even x, z) and the footprint a whole
   * number of road blocks. Placing paints every footprint cell to road; bulldozing turns them to field.
   * Drawn instead of the road tiles below it; roads join it only at its arms (`roadArms`).
   */
  roadFeature?: boolean;
  /**
   * Where neighbouring roads join a road feature: 'sides' (default) the middle block of each side;
   * 'front' every block along its front (+z at rotation 0), reached only from straight in front.
   */
  roadArms?: 'sides' | 'front';
  /** Cars never drive onto this road feature; it still joins roads and counts as road. */
  noTraffic?: boolean;
  /**
   * Road marking (zebra crossing): one block-aligned road block that must already be road (a straight
   * or a junction). It has no model of its own: the road tile under it draws its marked variant
   * (catalog ZEBRA_PIECE_MODELS). Bulldozing it leaves the road; roads and traffic ignore it.
   */
  roadMarking?: boolean;
  /** Residents counted in stats (>0 means it's a home). */
  residents: number;
  /** Vertical stretch of the drawn model (default 1); drawing only, never changes the footprint. */
  height?: number;
  /** Visual variants; PlacedObject.variant indexes into this list. */
  models: readonly ModelId[];
  variants: number;
}

const OPEN_GROUND: readonly GroundKind[] = ['field', 'grass', 'meadow'];
const PAVED_OK: readonly GroundKind[] = [...OPEN_GROUND, 'pavement'];
const PROP_GROUND: readonly GroundKind[] = [...OPEN_GROUND, 'pavement', 'walkway'];
const ANY_GROUND: readonly GroundKind[] = [...PROP_GROUND, 'road'];

/** ×2 in Y only, so the pine keeps its one cell and stays under the church (2.33). */
const PINE_HEIGHT = 2;

const def = (d: Omit<ObjectDef, 'variants'>): ObjectDef => ({ ...d, variants: d.models.length });

export const OBJECTS: Readonly<Record<ObjectKind, ObjectDef>> = {
  roundabout: def({ kind: 'roundabout', label: 'Roundabout', group: 'road', footprint: [6, 6], allowedGround: ANY_GROUND, roadFeature: true, residents: 0, models: ['roundabout'] }),
  // Small (one row of bays off the street), medium and large; cars don't park in them yet.
  parking: def({
    kind: 'parking',
    label: 'Parking',
    group: 'road',
    footprint: [4, 2],
    footprints: [[4, 2], [4, 4], [4, 6]],
    allowedGround: ANY_GROUND,
    roadFeature: true,
    roadArms: 'front',
    noTraffic: true,
    residents: 0,
    models: ['parking-small', 'parking-medium', 'parking-large'],
  }),
  // models[0] is only the ghost / icon look; the tile under it draws the real zebra per road piece.
  'zebra-crossing': def({ kind: 'zebra-crossing', label: 'Zebra crossing', group: 'road', footprint: [2, 2], allowedGround: ['road'], roadMarking: true, residents: 0, models: ['road-crossing'] }),
  'traffic-light': def({ kind: 'traffic-light', label: 'Traffic light', group: 'street', footprint: [1, 1], allowedGround: PROP_GROUND, requiresAdjacent: 'road', residents: 0, models: ['traffic-light', 'traffic-light-hanging'] }),
  lamppost: def({ kind: 'lamppost', label: 'Lamppost', group: 'street', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['lamppost'] }),
  'bus-stop': def({ kind: 'bus-stop', label: 'Bus stop', group: 'street', footprint: [2, 1], allowedGround: PROP_GROUND, requiresAdjacent: 'road', residents: 0, models: ['bus-stop'] }),
  postbox: def({ kind: 'postbox', label: 'Postbox', group: 'street', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['postbox'] }),
  mailbox: def({ kind: 'mailbox', label: 'Mailbox', group: 'street', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['mailbox'] }),
  cottage: def({ kind: 'cottage', label: 'Cottage', group: 'home', footprint: [4, 4], allowedGround: PAVED_OK, residents: 2, models: ['cottage'] }),
  townhouse: def({ kind: 'townhouse', label: 'Townhouse', group: 'home', footprint: [3, 4], allowedGround: PAVED_OK, residents: 3, models: ['townhouse', 'townhouse-alt'] }),
  bungalow: def({ kind: 'bungalow', label: 'Bungalow', group: 'home', footprint: [4, 4], allowedGround: PAVED_OK, residents: 2, models: ['bungalow', 'bungalow-l'] }),
  'family-home': def({ kind: 'family-home', label: 'Family home', group: 'home', footprint: [4, 4], allowedGround: PAVED_OK, residents: 4, models: ['family-home'] }),
  'garage-house': def({ kind: 'garage-house', label: 'Suburban', group: 'home', footprint: [4, 4], allowedGround: PAVED_OK, residents: 4, models: ['garage-house-c', 'garage-house-o', 'garage-house-s', 'garage-house-u'] }),
  'big-house': def({ kind: 'big-house', label: 'Big house', group: 'home', footprint: [5, 4], allowedGround: PAVED_OK, residents: 5, models: ['big-house-d', 'big-house-n'] }),
  'corner-shop': def({ kind: 'corner-shop', label: 'Corner shop', group: 'amenity', footprint: [3, 3], allowedGround: PAVED_OK, residents: 0, models: ['corner-shop'] }),
  'donut-shop': def({ kind: 'donut-shop', label: 'Donut shop', group: 'amenity', footprint: [3, 3], allowedGround: PAVED_OK, residents: 0, models: ['donut-shop'] }),
  supermarket: def({ kind: 'supermarket', label: 'Supermarket', group: 'amenity', footprint: [5, 4], allowedGround: PAVED_OK, residents: 0, models: ['supermarket'] }),
  church: def({ kind: 'church', label: 'Church', group: 'amenity', footprint: [3, 4], allowedGround: PAVED_OK, residents: 0, models: ['church'] }),
  fountain: def({ kind: 'fountain', label: 'Fountain', group: 'amenity', footprint: [2, 2], allowedGround: PROP_GROUND, residents: 0, models: ['fountain'] }),
  'tiered-fountain': def({ kind: 'tiered-fountain', label: 'Tiered fountain', group: 'amenity', footprint: [3, 3], allowedGround: PROP_GROUND, residents: 0, models: ['tiered-fountain'] }),
  oak: def({ kind: 'oak', label: 'Oak', group: 'tree', footprint: [2, 2], allowedGround: OPEN_GROUND, residents: 0, models: ['oak'] }),
  pine: def({ kind: 'pine', label: 'Pine', group: 'tree', footprint: [1, 1], allowedGround: OPEN_GROUND, height: PINE_HEIGHT, residents: 0, models: ['pine'] }),
  birch: def({ kind: 'birch', label: 'Birch', group: 'tree', footprint: [1, 1], allowedGround: OPEN_GROUND, residents: 0, models: ['birch', 'birch-small'] }),
  bush: def({ kind: 'bush', label: 'Bush', group: 'plant', footprint: [1, 1], allowedGround: OPEN_GROUND, residents: 0, models: ['bush'] }),
  tulips: def({ kind: 'tulips', label: 'Tulips', group: 'plant', footprint: [1, 1], allowedGround: OPEN_GROUND, residents: 0, models: ['tulips-a', 'tulips-b', 'tulips-c'] }),
  planter: def({ kind: 'planter', label: 'Planter', group: 'garden', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['planter'] }),
  bench: def({ kind: 'bench', label: 'Bench', group: 'garden', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['bench'] }),
  'long-bench': def({ kind: 'long-bench', label: 'Long bench', group: 'garden', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['long-bench'] }),
  'garden-table': def({ kind: 'garden-table', label: 'Table', group: 'garden', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['garden-table'] }),
  swing: def({ kind: 'swing', label: 'Swing', group: 'garden', footprint: [2, 1], allowedGround: OPEN_GROUND, residents: 0, models: ['swing'] }),
  slide: def({ kind: 'slide', label: 'Slide', group: 'garden', footprint: [2, 1], allowedGround: OPEN_GROUND, residents: 0, models: ['slide'] }),
  // In the Garden dock but counted as an amenity (stats, building FX).
  'swimming-pool': def({ kind: 'swimming-pool', label: 'Pool', group: 'amenity', footprint: [4, 3], allowedGround: PROP_GROUND, residents: 0, models: ['swimming-pool'] }),
  barbecue: def({ kind: 'barbecue', label: 'Barbecue', group: 'garden', footprint: [1, 1], allowedGround: PROP_GROUND, residents: 0, models: ['barbecue'] }),
};

export const objectDef = (kind: ObjectKind): ObjectDef => OBJECTS[kind];

/** Cells covered at rotation 0 by style `variant`; an unknown style covers style 0's. */
export const footprintOf = (def: ObjectDef, variant = 0): readonly [number, number] => def.footprints?.[variant] ?? def.footprint;

/** The rotation-0 footprint of a placed object's own style. */
export const placedFootprint = (object: Pick<PlacedObject, 'kind' | 'variant'>): readonly [number, number] =>
  footprintOf(OBJECTS[object.kind], object.variant);

export const OBJECT_KINDS = Object.keys(OBJECTS) as ObjectKind[];

export const heightScale = (def: ObjectDef): number => def.height ?? 1;
