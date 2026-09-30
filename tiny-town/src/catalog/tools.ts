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
 *   streets: the road network (roads, pavement, roundabout, zebra, traffic lights)
 *   homes:   where people live (and their mailbox)
 *   town:    shops, civic places and the street furniture everyone shares
 *   nature:  things that grow on their own (ground cover, trees, bushes)
 *   garden:  things people build in a yard or park (hedges, fences, furniture)
 * Inside a category tools run surfaces → lines → objects (ground paint, then edges, then placed
 * items); catalog.test.ts keeps that order. Digits 1–9 pick the first nine tools of a category; a category
 * holds at most 12 (WP-23, owner: tools past the ninth have no digit, and ~12 cards fill a desktop row).
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
const EDGE = 'Drag along cell edges';

const ROWS: readonly ToolRow[] = [
  // Streets
  { id: 'road', label: 'Road', category: 'streets', layer: 'ground', drag: 'paint', sfx: 'place-path', hint: 'Drag to lay road — it joins up automatically' },
  { id: 'pavement', label: 'Pavement', category: 'streets', layer: 'ground', drag: 'paint', sfx: 'place-path', hint: 'Drag to lay pavement alongside roads' },
  { id: 'roundabout', label: 'Roundabout', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-path', hint: 'Click to build a roundabout — roads join its four arms' },
  { id: 'zebra-crossing', label: 'Zebra', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-path', hint: 'Click a straight road or a junction to paint a zebra crossing' },
  { id: 'traffic-light', label: 'Traffic light', category: 'streets', layer: 'object', drag: 'single', sfx: 'place-prop-metal', hint: 'Place next to a road · R to rotate' },
  // Homes (the mailbox moved here from Streets, owner 2026-09-30)
  { id: 'cottage', label: 'Cottage', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'townhouse', label: 'Townhouse', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'bungalow', label: 'Bungalow', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'family-home', label: 'Family home', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'garage-house', label: 'Suburban', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'big-house', label: 'Big house', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'mailbox', label: 'Mailbox', category: 'homes', layer: 'object', drag: 'single', sfx: 'place-prop-metal', hint: PLACE },
  // Town
  { id: 'tiered-fountain', label: 'Tiered fountain', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: PLACE },
  { id: 'corner-shop', label: 'Corner shop', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'donut-shop', label: 'Donut shop', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'church', label: 'Church', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  { id: 'supermarket', label: 'Supermarket', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  // Street furniture is civic (owner, 2026-09-30): moved here from Streets.
  { id: 'bus-stop', label: 'Bus stop', category: 'town', layer: 'object', drag: 'single', sfx: 'place-building', hint: 'Place next to a road · R to rotate' },
  { id: 'postbox', label: 'Postbox', category: 'town', layer: 'object', drag: 'single', sfx: 'place-prop-metal', hint: PLACE },
  { id: 'lamppost', label: 'Lamppost', category: 'town', layer: 'object', drag: 'scatter', sfx: 'place-prop-metal', hint: SCATTER },
  // Nature
  { id: 'grass', label: 'Grass', category: 'nature', layer: 'ground', drag: 'paint', sfx: 'place-nature', hint: 'Drag to paint lawn' },
  { id: 'meadow', label: 'Wildflowers', category: 'nature', layer: 'ground', drag: 'paint', sfx: 'place-nature', hint: 'Drag to sow a wildflower meadow' },
  { id: 'tulips', label: 'Tulips', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT },
  { id: 'bush', label: 'Bush', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT },
  { id: 'oak', label: 'Oak', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT },
  { id: 'pine', label: 'Pine', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT },
  { id: 'birch', label: 'Birch', category: 'nature', layer: 'object', drag: 'scatter', sfx: 'place-nature', hint: PLANT },
  // Garden
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
  // Owner review (WP-23): the pool is a garden thing, not a civic one.
  { id: 'swimming-pool', label: 'Pool', category: 'garden', layer: 'object', drag: 'single', sfx: 'place-building', hint: BUILD },
  // Modes
  { id: 'bulldoze', label: 'Bulldoze', category: 'mode', layer: 'bulldoze', drag: 'paint', sfx: 'remove', hint: 'Click or drag to remove things' },
];

/**
 * Retired tools (owner, 2026-09-30): no longer in the dock, but their kinds stay in the catalog
 * (objects.ts / GROUND_MODELS) so towns that already have them (saves, town files, the demo towns)
 * still load and draw them, and the player can bulldoze them. Placing new ones is not possible.
 */
export const RETIRED_TOOLS: ReadonlySet<Exclude<ToolId, 'bulldoze'>> = new Set(['fountain', 'walkway']);

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
export function actionForTool(toolId: ToolId, cell: Cell, edge: Edge, rotation: Rotation): BuildAction {
  const def = toolDef(toolId);
  switch (def.layer) {
    case 'ground':
      return { type: 'paint-ground', kind: toolId as Exclude<GroundKind, 'field'>, cell };
    case 'object':
      return { type: 'place-object', kind: toolId as ObjectKind, cell, rotation };
    case 'edge':
      return { type: 'place-edge', kind: toolId as EdgeKind, edge };
    case 'bulldoze':
      return { type: 'bulldoze', cell, edge };
  }
}
