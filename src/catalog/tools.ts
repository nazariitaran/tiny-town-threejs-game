/**
 * The build tools, in dock order. Adding a tool = a ToolDef here (+ an ObjectDef in objects.ts for
 * object tools, + model entries in models.ts).
 */
import type { SfxEvent } from '../audio/sfx';
import type { BuildAction, Cell, Edge, EdgeKind, GroundKind, ObjectKind, Rotation } from '../town/types';

export type ToolId = Exclude<GroundKind, 'field'> | ObjectKind | EdgeKind | ModeToolId;
/** The dock's mode buttons (not in a category). */
export type ModeToolId = 'move' | 'bulldoze';
/**
 * Dock categories — each answers "what am I building?":
 *   streets: the road network (roads, pavement, roundabout, parking, zebra, traffic lights)
 *   homes:   where people live (and their mailbox)
 *   town:    shops, civic places and the street furniture everyone shares
 *   nature:  things that grow on their own (ground cover, ponds, trees, bushes, pond plants)
 *   garden:  things people build in a yard or park (hedges, fences, furniture)
 * Inside a category tools run surfaces → lines → objects (ground paint, then edges, then placed items);
 * the pond is the exception: it sits right before the items that go in it.
 * Digits 1–9 pick the first nine tools of a category; a category holds at most 12 (~12 cards fill a desktop row).
 */
export type ToolCategory = 'streets' | 'homes' | 'town' | 'nature' | 'garden';
export type ToolLayer = 'ground' | 'object' | 'edge' | 'move' | 'bulldoze';
/** paint: every crossed cell · scatter: each new valid cell while dragging · single: click only · line: straight edge run. */
export type DragMode = 'paint' | 'scatter' | 'single' | 'line';

export interface ToolDef {
  id: ToolId;
  label: string;
  category: ToolCategory | 'mode';
  layer: ToolLayer;
  drag: DragMode;
  /** Public URL: rendered from the in-game model by scripts/render-icons.mjs, or a UI svg. */
  icon: string;
  sfx: SfxEvent;
  /** One-line gesture hint shown above the dock. */
  hint: string;
}

const icon = (id: ToolId): string => `/assets/icons/tool-${id}.png`;

type ToolRow = Omit<ToolDef, 'icon'>;
const BUILD = 'Click to build · R to rotate';
const PLACE = 'Click to place · R to rotate';
const SCATTER = 'Click or drag to place · R to rotate';
const PLANT = 'Click or drag to plant';
const POND_PLANT = 'Click or drag across a pond to plant';
const EDGE = 'Drag along cell edges';

const ROWS: readonly ToolRow[] = [
  { id: 'road', label: 'Road', category: 'streets', layer: 'ground', drag: 'paint', sfx: 'place-path', hint: 'Drag to lay road — it joins up automatically' },
  { id: 'pavement', label: 'Pavement', category: 'streets', layer: 'ground', drag: 'paint', sfx: 'place-path', hint: 'Drag to lay pavement alongside roads' },
  { id: 'roundabout', label: 'Roundabout', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-path', hint: 'Click to build a roundabout — roads join its four arms' },
  { id: 'parking', label: 'Parking', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-path', hint: 'Click to build a car park — roads join its entrance · R to rotate' },
  { id: 'zebra-crossing', label: 'Zebra', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-path', hint: 'Click a straight road or a junction to paint a zebra crossing' },
  { id: 'traffic-light', label: 'Traffic light', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-prop-metal', hint: 'Place next to a road · R to rotate' },
  { id: 'cottage', label: 'Cottage', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'townhouse', label: 'Townhouse', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'bungalow', label: 'Bungalow', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'family-home', label: 'Family home', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'garage-house', label: 'Suburban', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'big-house', label: 'Big house', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'mailbox', label: 'Mailbox', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-prop-metal', hint: PLACE },
  { id: 'tiered-fountain', label: 'Tiered fountain', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: PLACE },
  { id: 'corner-shop', label: 'Corner shop', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'donut-shop', label: 'Donut shop', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'church', label: 'Church', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'supermarket', label: 'Supermarket', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'stadium', label: 'Stadium', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'cinema', label: 'Cinema', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'bus-stop', label: 'Bus stop', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: 'Place next to a road · R to rotate' },
  { id: 'postbox', label: 'Postbox', category: 'town', layer: 'object', drag: 'single', sfx: 'place-prop-metal', hint: PLACE },
  { id: 'lamppost', label: 'Lamppost', category: 'town', layer: 'object', drag: 'scatter', sfx: 'place-prop-metal', hint: SCATTER },
  { id: 'grass', label: 'Grass', category: 'nature', layer: 'ground', drag: 'paint', sfx: 'place-nature', hint: 'Drag to paint lawn' },
  { id: 'meadow', label: 'Wildflowers', category: 'nature', layer: 'ground', drag: 'paint', sfx: 'place-nature', hint: 'Drag to sow a wildflower meadow' },
  { id: 'tulips', label: 'Tulips', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT },
  { id: 'bush', label: 'Bush', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT },
  { id: 'oak', label: 'Oak', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT },
  { id: 'pine', label: 'Pine', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT },
  { id: 'birch', label: 'Birch', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT },
  { id: 'pond', label: 'Pond', category: 'nature', layer: 'ground', drag: 'paint', sfx: 'place-nature', hint: 'Drag to dig a pond — neighbouring cells join into one' },
  { id: 'lily-pads', label: 'Lily pads', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: POND_PLANT },
  { id: 'reeds', label: 'Reeds', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: POND_PLANT },
  { id: 'cattails', label: 'Cattails', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: POND_PLANT },
  { id: 'bird-house', label: 'Bird house', category: 'nature', layer: 'object', drag: 'single', sfx: 'place-prop', hint: 'Click a pond to float a bird house · R to rotate' },
  { id: 'hedge', label: 'Hedge', category: 'garden', layer: 'edge', drag: 'line', sfx: 'place-nature', hint: `${EDGE} to grow a hedge` },
  { id: 'fence-low', label: 'Low fence', category: 'garden', layer: 'edge', drag: 'line', sfx: 'place-prop', hint: `${EDGE} to build a fence` },
  { id: 'fence-tall', label: 'Tall fence', category: 'garden', layer: 'edge', drag: 'line', sfx: 'place-prop', hint: `${EDGE} to build a fence` },
  { id: 'planter', label: 'Planter', category: 'garden', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: SCATTER },
  { id: 'bench', label: 'Bench', category: 'garden', layer: 'object', drag: 'single', sfx: 'place-prop', hint: PLACE },
  { id: 'long-bench', label: 'Long bench', category: 'garden', layer: 'object', drag: 'single', sfx: 'place-prop', hint: PLACE },
  { id: 'garden-table', label: 'Table', category: 'garden', layer: 'object', drag: 'single', sfx: 'place-prop', hint: PLACE },
  { id: 'barbecue', label: 'Barbecue', category: 'garden', layer: 'object', drag: 'single', sfx: 'place-prop-metal', hint: PLACE },
  { id: 'swing', label: 'Swing', category: 'garden', layer: 'object', drag: 'single', sfx: 'place-prop', hint: PLACE },
  { id: 'slide', label: 'Slide', category: 'garden', layer: 'object', drag: 'single', sfx: 'place-prop', hint: PLACE },
  { id: 'swimming-pool', label: 'Pool', category: 'garden', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  // Move carries placed objects only (not the roundabout, parking or a zebra; never ground, hedges or fences);
  // its drop plays the moved item's own place sound.
  { id: 'move', label: 'Move', category: 'mode', layer: 'move', drag: 'single', sfx: 'place-prop', hint: 'Click something to pick it up' },
  { id: 'bulldoze', label: 'Bulldoze', category: 'mode', layer: 'bulldoze', drag: 'paint', sfx: 'remove', hint: 'Click or drag to remove things' },
];

/** Not in the dock, but their kinds stay in the catalog so existing towns still load, draw and bulldoze them. */
export const RETIRED_TOOLS: ReadonlySet<Exclude<ToolId, ModeToolId>> = new Set(['fountain', 'walkway']);

/** The dock shows GLYPHS; these svgs are for anything else that lists TOOLS with icons. */
const MODE_ICONS: Readonly<Record<ModeToolId, string>> = { move: '/assets/ui/move.svg', bulldoze: '/assets/ui/bulldoze.svg' };

export const TOOLS: readonly ToolDef[] = ROWS.map((row) => ({ ...row, icon: row.category === 'mode' ? MODE_ICONS[row.id as ModeToolId] : icon(row.id) }));

export const TOOL_CATEGORIES: ReadonlyArray<{ id: ToolCategory; label: string }> = [
  { id: 'streets', label: 'Streets' },
  { id: 'homes', label: 'Homes' },
  { id: 'town', label: 'Town' },
  { id: 'nature', label: 'Nature' },
  { id: 'garden', label: 'Garden' },
];

/** Model 0 uses the tool's own icon; the others are tool-<id>-v<n>.png. */
export const variantIcon = (id: ToolId, variant: number): string => (variant === 0 ? icon(id) : `/assets/icons/tool-${id}-v${variant}.png`);

const byId = new Map<ToolId, ToolDef>(TOOLS.map((tool) => [tool.id, tool]));

export function toolDef(id: ToolId): ToolDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown tool: ${id}`);
  return def;
}

export const toolsInCategory = (category: ToolCategory): ToolDef[] =>
  TOOLS.filter((tool) => tool.category === category);

/** `variant`: the model an object tool builds; ignored by other layers, and when omitted the rules roll one. */
export function actionForTool(toolId: ToolId, cell: Cell, edge: Edge, rotation: Rotation, variant?: number): BuildAction {
  const def = toolDef(toolId);
  switch (def.layer) {
    case 'ground':
      return { type: 'paint-ground', kind: toolId as Exclude<GroundKind, 'field'>, cell };
    case 'object':
      return variant === undefined
        ? { type: 'place-object', kind: toolId as ObjectKind, cell, rotation }
        : { type: 'place-object', kind: toolId as ObjectKind, cell, rotation, variant };
    case 'edge':
      return { type: 'place-edge', kind: toolId as EdgeKind, edge };
    case 'bulldoze':
      return { type: 'bulldoze', cell, edge };
    case 'move':
      // ToolController builds move-object actions from the picked object; a cell alone says nothing.
      throw new Error('The Move tool has no per-cell action');
  }
}
