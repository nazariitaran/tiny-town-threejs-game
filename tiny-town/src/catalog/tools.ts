/**
 * CONTRACT FILE — the build tools shown in the toolbar, in display order.
 * Adding a tool = add a ToolDef here (+ an ObjectDef in objects.ts for object tools,
 * + model entries in models.ts). UI, input, audio and rules all read from this table.
 */
import type { SfxEvent } from '../audio/sfx';
import type { BuildAction, Cell, Edge, EdgeKind, GroundKind, ObjectKind, Rotation } from '../town/types';

export type ToolId = Exclude<GroundKind, 'field'> | ObjectKind | EdgeKind | 'bulldoze';
export type ToolCategory = 'paths' | 'nature' | 'buildings' | 'other';
export type ToolLayer = 'ground' | 'object' | 'edge' | 'bulldoze';
/** paint: every crossed cell · scatter: each new valid cell while dragging · single: click only · line: straight edge run. */
export type DragMode = 'paint' | 'scatter' | 'single' | 'line';

export interface ToolDef {
  id: ToolId;
  label: string;
  category: ToolCategory | 'mode';
  layer: ToolLayer;
  drag: DragMode;
  /** Toolbar icon (Kenney preview render or UI svg), public URL. */
  icon: string;
  /** SFX played when this tool successfully places something. */
  sfx: SfxEvent;
  /** One-line gesture hint shown above the dock. */
  hint: string;
}

const icon = (id: string): string => `/assets/icons/${id}.png`;

export const TOOLS: readonly ToolDef[] = [
  // Paths
  { id: 'road', label: 'Road', category: 'paths', layer: 'ground', drag: 'paint', icon: icon('road-straight'), sfx: 'place-path', hint: 'Drag to lay road — it joins up automatically' },
  { id: 'pavement', label: 'Pavement', category: 'paths', layer: 'ground', drag: 'paint', icon: icon('pavement-tile'), sfx: 'place-path', hint: 'Drag to lay pavement alongside roads' },
  { id: 'walkway', label: 'Walkway', category: 'paths', layer: 'ground', drag: 'paint', icon: icon('walkway-path-long'), sfx: 'place-path', hint: 'Drag to lay a garden path' },
  // Nature
  { id: 'grass', label: 'Grass', category: 'nature', layer: 'ground', drag: 'paint', icon: icon('grass-tuft'), sfx: 'place-nature', hint: 'Drag to paint lawn' },
  { id: 'meadow', label: 'Wildflowers', category: 'nature', layer: 'ground', drag: 'paint', icon: icon('meadow-flowers'), sfx: 'place-nature', hint: 'Drag to sow a wildflower meadow' },
  { id: 'tree-a', label: 'Oak', category: 'nature', layer: 'object', drag: 'scatter', icon: icon('tree-a'), sfx: 'place-nature', hint: 'Click or drag to plant trees' },
  { id: 'tree-b', label: 'Pine', category: 'nature', layer: 'object', drag: 'scatter', icon: icon('tree-b'), sfx: 'place-nature', hint: 'Click or drag to plant trees' },
  { id: 'tree-c', label: 'Birch', category: 'nature', layer: 'object', drag: 'scatter', icon: icon('tree-c'), sfx: 'place-nature', hint: 'Click or drag to plant trees' },
  // Buildings
  { id: 'townhouse-a', label: 'Cottage', category: 'buildings', layer: 'object', drag: 'single', icon: icon('townhouse-a'), sfx: 'place-building', hint: 'Click to build · R to rotate' },
  { id: 'townhouse-b', label: 'Townhouse', category: 'buildings', layer: 'object', drag: 'single', icon: icon('townhouse-b'), sfx: 'place-building', hint: 'Click to build · R to rotate' },
  { id: 'townhouse-c', label: 'Family home', category: 'buildings', layer: 'object', drag: 'single', icon: icon('townhouse-c'), sfx: 'place-building', hint: 'Click to build · R to rotate' },
  { id: 'garage', label: 'Garage', category: 'buildings', layer: 'object', drag: 'single', icon: icon('garage'), sfx: 'place-building', hint: 'Click to build · R to rotate' },
  { id: 'bus-stop', label: 'Bus stop', category: 'buildings', layer: 'object', drag: 'single', icon: icon('bus-stop'), sfx: 'place-building', hint: 'Place next to a road · R to rotate' },
  { id: 'fence-tall', label: 'Tall fence', category: 'buildings', layer: 'edge', drag: 'line', icon: icon('fence-tall'), sfx: 'place-prop', hint: 'Drag along cell edges to build a fence' },
  { id: 'fence-small', label: 'Low fence', category: 'buildings', layer: 'edge', drag: 'line', icon: icon('fence-small'), sfx: 'place-prop', hint: 'Drag along cell edges to build a fence' },
  // Other
  { id: 'postbox', label: 'Postbox', category: 'other', layer: 'object', drag: 'single', icon: icon('postbox'), sfx: 'place-prop-metal', hint: 'Click to place · R to rotate' },
  { id: 'lamppost', label: 'Lamppost', category: 'other', layer: 'object', drag: 'scatter', icon: icon('lamppost'), sfx: 'place-prop-metal', hint: 'Click to place · R to rotate' },
  // Modes
  { id: 'bulldoze', label: 'Bulldoze', category: 'mode', layer: 'bulldoze', drag: 'paint', icon: '/assets/ui/bulldoze.svg', sfx: 'remove', hint: 'Click or drag to remove things' },
];

export const TOOL_CATEGORIES: ReadonlyArray<{ id: ToolCategory; label: string }> = [
  { id: 'paths', label: 'Paths' },
  { id: 'nature', label: 'Nature' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'other', label: 'Other' },
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
