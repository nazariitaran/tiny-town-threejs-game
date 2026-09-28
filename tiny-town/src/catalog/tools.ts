/**
 * CONTRACT FILE — the build tools shown in the toolbar, in display order.
 * Adding a tool = add a ToolDef here (+ an ObjectDef in objects.ts for object tools,
 * + model entries in models.ts). UI, input, audio and rules all read from this table.
 */
import type { SfxEvent } from '../audio/sfx';
import type { BuildAction, Cell, Edge, EdgeKind, GroundKind, ObjectKind, Rotation } from '../town/types';

export type ToolId = Exclude<GroundKind, 'field'> | ObjectKind | EdgeKind | 'bulldoze';
/**
 * Dock categories — each answers "what am I building?":
 *   streets: the road network and everything that belongs to the kerb
 *   homes:   where people live (and their garages)
 *   town:    shops and civic places everyone shares
 *   nature:  things that grow on their own (ground cover, trees, bushes)
 *   garden:  things people build in a yard or park (paths, hedges, fences, furniture)
 * Inside a category tools run surfaces → lines → objects (ground paint, then edges, then placed
 * items); catalog.test.ts keeps that order. Each category holds at most 9 tools (digit shortcuts).
 */
export type ToolCategory = 'streets' | 'homes' | 'town' | 'nature' | 'garden';
export type ToolLayer = 'ground' | 'object' | 'edge' | 'bulldoze';
/** paint: every crossed cell · scatter: each new valid cell while dragging · single: click only · line: straight edge run. */
export type DragMode = 'paint' | 'scatter' | 'single' | 'line';

export interface ToolDef {
  id: ToolId;
  label: string;
  category: ToolCategory | 'mode';
  layer: ToolLayer;
  drag: DragMode;
  /** Toolbar icon (rendered from the in-game model by scripts/render-icons.mjs, or a UI svg), public URL. */
  icon: string;
  /** SFX played when this tool successfully places something. */
  sfx: SfxEvent;
  /** One-line gesture hint shown above the dock. */
  hint: string;
}

/** Tool icons are rendered per tool id (scripts/render-icons.mjs → public/assets/icons/tool-<id>.png). */
const icon = (id: ToolId): string => `/assets/icons/tool-${id}.png`;

type ToolRow = Omit<ToolDef, 'icon'>;
const BUILD = 'Click to build · R to rotate';
const PLACE = 'Click to place · R to rotate';
const SCATTER = 'Click or drag to place · R to rotate';
const PLANT = 'Click or drag to plant';
const PLANT_TREE = 'Click or drag to plant · H for height';
const EDGE = 'Drag along cell edges';

const ROWS: readonly ToolRow[] = [
  // Streets
  { id: 'road', label: 'Road', category: 'streets', layer: 'ground', drag: 'paint', sfx: 'place-path', hint: 'Drag to lay road — it joins up automatically' },
  { id: 'pavement', label: 'Pavement', category: 'streets', layer: 'ground', drag: 'paint', sfx: 'place-path', hint: 'Drag to lay pavement alongside roads' },
  { id: 'roundabout', label: 'Roundabout', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-path', hint: 'Click to build a roundabout — roads join its four arms' },
  { id: 'zebra-crossing', label: 'Zebra', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-path', hint: 'Click a straight road or a junction to paint a zebra crossing' },
  { id: 'traffic-light', label: 'Traffic light', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-prop-metal', hint: 'Place next to a road · R to rotate' },
  { id: 'lamppost', label: 'Lamppost', category: 'streets', layer: 'object', drag: 'scatter', sfx: 'place-prop-metal', hint: SCATTER },
  { id: 'bus-stop', label: 'Bus stop', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-building', hint: 'Place next to a road · R to rotate' },
  { id: 'postbox', label: 'Postbox', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-prop-metal', hint: PLACE },
  // Homes
  { id: 'cottage', label: 'Cottage', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'townhouse', label: 'Townhouse', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'bungalow', label: 'Bungalow', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'family-home', label: 'Family home', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'garage-house', label: 'Suburban', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'big-house', label: 'Big house', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'garage', label: 'Garage', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  // Town
  { id: 'fountain', label: 'Fountain', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: PLACE },
  { id: 'corner-shop', label: 'Corner shop', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'church', label: 'Church', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'supermarket', label: 'Supermarket', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'swimming-pool', label: 'Pool', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  // Nature
  { id: 'grass', label: 'Grass', category: 'nature', layer: 'ground', drag: 'paint', sfx: 'place-nature', hint: 'Drag to paint lawn' },
  { id: 'meadow', label: 'Wildflowers', category: 'nature', layer: 'ground', drag: 'paint', sfx: 'place-nature', hint: 'Drag to sow a wildflower meadow' },
  { id: 'bush', label: 'Bush', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT },
  { id: 'oak', label: 'Oak', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT_TREE },
  { id: 'pine', label: 'Pine', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT_TREE },
  { id: 'birch', label: 'Birch', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT_TREE },
  // Garden
  { id: 'walkway', label: 'Garden path', category: 'garden', layer: 'ground', drag: 'paint', sfx: 'place-path', hint: 'Drag to lay a garden path' },
  { id: 'hedge', label: 'Hedge', category: 'garden', layer: 'edge', drag: 'line', sfx: 'place-nature', hint: `${EDGE} to grow a hedge` },
  { id: 'fence-low', label: 'Low fence', category: 'garden', layer: 'edge', drag: 'line', sfx: 'place-prop', hint: `${EDGE} to build a fence` },
  { id: 'fence-tall', label: 'Tall fence', category: 'garden', layer: 'edge', drag: 'line', sfx: 'place-prop', hint: `${EDGE} to build a fence` },
  { id: 'planter', label: 'Planter', category: 'garden', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: SCATTER },
  { id: 'bench', label: 'Bench', category: 'garden', layer: 'object', drag: 'single', sfx: 'place-prop', hint: PLACE },
  { id: 'barbecue', label: 'Barbecue', category: 'garden', layer: 'object', drag: 'single', sfx: 'place-prop-metal', hint: PLACE },
  { id: 'swing', label: 'Swing', category: 'garden', layer: 'object', drag: 'single', sfx: 'place-prop', hint: PLACE },
  // Modes
  { id: 'bulldoze', label: 'Bulldoze', category: 'mode', layer: 'bulldoze', drag: 'paint', sfx: 'remove', hint: 'Click or drag to remove things' },
];

export const TOOLS: readonly ToolDef[] = ROWS.map((row) => ({ ...row, icon: row.id === 'bulldoze' ? '/assets/ui/bulldoze.svg' : icon(row.id) }));

export const TOOL_CATEGORIES: ReadonlyArray<{ id: ToolCategory; label: string }> = [
  { id: 'streets', label: 'Streets' },
  { id: 'homes', label: 'Homes' },
  { id: 'town', label: 'Town' },
  { id: 'nature', label: 'Nature' },
  { id: 'garden', label: 'Garden' },
];

const byId = new Map<ToolId, ToolDef>(TOOLS.map((tool) => [tool.id, tool]));

export function toolDef(id: ToolId): ToolDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown tool: ${id}`);
  return def;
}

export const toolsInCategory = (category: ToolCategory): ToolDef[] =>
  TOOLS.filter((tool) => tool.category === category);

/** Translate "tool used at this cell/edge" into a BuildAction for TownEditor. */
export function actionForTool(toolId: ToolId, cell: Cell, edge: Edge, rotation: Rotation, height = 0): BuildAction {
  const def = toolDef(toolId);
  switch (def.layer) {
    case 'ground':
      return { type: 'paint-ground', kind: toolId as Exclude<GroundKind, 'field'>, cell };
    case 'object':
      return { type: 'place-object', kind: toolId as ObjectKind, cell, rotation, height };
    case 'edge':
      return { type: 'place-edge', kind: toolId as EdgeKind, edge };
    case 'bulldoze':
      return { type: 'bulldoze', cell, edge };
  }
}
