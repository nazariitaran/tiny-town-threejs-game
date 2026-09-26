/**
 * Owns the active tool + rotation, turns pointer gestures into TownEditor strokes, publishes
 * hover/validity for UI, and drives the GhostPreview. Tool keyboard shortcuts live here; camera
 * keys (WASD/arrows, Q/E, +/−) live in CameraController. WP-05 (Interaction) owns this file.
 *
 * Tool semantics (docs/design/02-interaction-and-ui.md §3):
 *  - paint   (ground tools, bulldoze): every crossed cell, gap-free; bulldoze samples the drag
 *            path and passes an edge only when the pointer is within 0.3 cell of it
 *  - scatter (trees, lamppost): each new valid cell the pointer visits
 *  - single  (buildings, props): click only
 *  - line    (fences): straight run of edges, axis locked by the first movement; a click places
 *            the nearest edge on release
 * Every stroke is one undo entry. Only a deliberate click reports build:invalid (throttled to one
 * per 400 ms per reason); drags skip blocked cells silently.
 *
 * Input: mouse/pen left button = tool (right/middle/Alt+left = camera). Touch: one finger = tool
 * (committed after 150 ms or 10 px so a second finger can still turn it into a camera gesture),
 * two fingers = camera. pointercancel, lostpointercapture, window blur and visibilitychange all end
 * strokes. Keys: B bulldoze · R / Shift+R rotate · Esc deselect (no tool → intent:open-menu) ·
 * F / Home reset camera · Ctrl/Cmd+Z undo · Shift+Ctrl/Cmd+Z / Ctrl+Y redo. Digits belong to WP-06.
 */
import * as THREE from 'three';
import { EDGE_MODELS, GROUND_MODELS, ROAD_PIECE_MODELS } from '../catalog/models';
import { objectDef } from '../catalog/objects';
import { actionForTool, toolDef, type DragMode, type ToolId } from '../catalog/tools';
import type { DebugTools } from '../debug/DebugTools';
import { CELL_SIZE, PLOT_DEPTH, PLOT_WIDTH, cellToWorld, edgeToWorld, worldToNearestEdge } from '../game/config';
import type { GameBus } from '../game/events';
import type { ModelLibrary } from '../render/ModelLibrary';
import { roadMask, roadTileFor } from '../render/roadTiles';
import { cellKey, cellsOnLine, edgeInBounds, edgeKey, footprintCells, NEIGHBOURS, nextRotation, rotatedFootprint, sameCell, sameEdge } from '../town/grid';
import type { TownEditor } from '../town/TownEditor';
import type { BuildAction, Cell, Edge, GroundKind, PlacedObject, PlanResult, Rotation } from '../town/types';
import type { CameraController } from './CameraController';
import { GhostPreview, type GhostPart, type GhostState } from './GhostPreview';
import type { GridPicker, PickResult } from './GridPicker';
import { isEditableTarget } from './keyboard';
import { clampCellNearPlot, isNearEdge, KeyedThrottle, lineEdges, lockAxis, segmentSamples, type GridPoint, type LineAxis } from './strokeMath';

/** Lawn/meadow slab top height in TownRenderer (tufts and flowers stand on it). */
const LAWN_TOP = 0.02;

/** What diagnostics `hover` publishes: the cell plus the validity the UI shows for it. */
export type HoverInfo = Cell & { valid: boolean; reason: string | null };

/** Touch: a single finger becomes a tool stroke after this long / this far (px). */
const TOUCH_COMMIT_MS = 150;
const TOUCH_COMMIT_PX = 10;
const BULLDOZE_EDGE_RANGE = 0.3;

interface Stroke {
  pointerId: number;
  mode: DragMode | 'bulldoze';
  lastCell: Cell;
  lastGrid: GridPoint;
  startGrid: GridPoint;
  startEdge: Edge;
  axis: LineAxis | null;
  visited: Set<string>;
  /** Bulldoze: the stroke started on a fence, so it only removes fences (never the road under them). */
  edgesOnly: boolean;
  removedAny: boolean;
}

interface PendingTouch {
  pointerId: number;
  clientX: number;
  clientY: number;
  startMs: number;
}

interface HoverState {
  cell: Cell | null;
  edge: Edge | null;
  valid: boolean;
  reason: string | null;
}

export class ToolController {
  private toolId: ToolId | null = null;
  private rotation: Rotation = 0;
  private enabled = false;
  private stroke: Stroke | null = null;
  private pendingTouch: PendingTouch | null = null;
  private readonly touchPointers = new Set<number>();
  /** Last known pointer position over the canvas (null when outside / touch lifted). */
  private pointer: { x: number; y: number } | null = null;
  private lastPick: PickResult | null = null;
  private hoverDirty = true;
  private hover: HoverState = { cell: null, edge: null, valid: true, reason: null };
  private hoverInfo: HoverInfo | null = null;
  /**
   * Cells ('c:x,z') / edges ('e:…') this tool just filled. Hovering them is not "invalid"
   * (no red ghost, no "Something is already here") until the pointer moves to another target.
   */
  private readonly justPlaced = new Set<string>();
  private readonly ghost: GhostPreview;
  private readonly invalidThrottle = new KeyedThrottle(400);
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly picker: GridPicker,
    private readonly editor: TownEditor,
    private readonly cameraController: CameraController,
    private readonly bus: GameBus,
    scene: THREE.Scene,
    /** For GhostPreview models. Templates are ready once phase leaves 'loading'. */
    library: ModelLibrary,
    debug?: DebugTools,
  ) {
    this.ghost = new GhostPreview(scene, library);
    this.cameraController.setInputEnabled(false);

    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('lostpointercapture', this.onLostCapture);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.unsubscribers.push(
      bus.on('intent:select-tool', ({ toolId }) => this.selectTool(toolId)),
      bus.on('intent:rotate', ({ direction }) => this.rotate(direction)),
      bus.on('intent:undo', () => {
        this.cancelGesture();
        this.justPlaced.clear();
        this.editor.undo();
      }),
      bus.on('intent:redo', () => {
        this.cancelGesture();
        this.justPlaced.clear();
        this.editor.redo();
      }),
      bus.on('town:changed', () => {
        this.hoverDirty = true;
      }),
    );

    const folder = debug?.folder('Ghost');
    if (folder) {
      folder.add(this.ghost.tuning, 'followRate', 4, 60, 1);
      folder.add(this.ghost.tuning, 'rotateDuration', 0.02, 0.5, 0.01);
      folder.add(this.ghost.tuning, 'shakeAmplitude', 0, 0.2, 0.01);
      folder.add(this.ghost.tuning, 'shakeDuration', 0.05, 0.5, 0.01);
      folder.close();
    }
  }

  get activeTool(): ToolId | null {
    return this.toolId;
  }

  get activeRotation(): Rotation {
    return this.rotation;
  }

  /** Hovered cell plus its validity (diagnostics `hover`); null off-plot. */
  get hovered(): HoverInfo | null {
    return this.hoverInfo;
  }

  /** Input is only live in the 'building' phase. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.cameraController.setInputEnabled(enabled);
    if (!enabled) {
      this.cancelGesture();
      this.touchPointers.clear();
      this.pointer = null;
      this.lastPick = null;
      this.ghost.hide();
      this.publishHover({ cell: null, edge: null, valid: true, reason: null });
    } else {
      this.hoverDirty = true;
    }
  }

  /** Selecting the active tool again deselects it (dock behaviour). */
  selectTool(toolId: ToolId | null): void {
    this.cancelGesture();
    this.toolId = this.toolId === toolId ? null : toolId;
    this.justPlaced.clear();
    this.cameraController.setToolActive(this.toolId !== null);
    this.hoverDirty = true;
    this.bus.emit('tool:changed', { toolId: this.toolId, rotation: this.rotation });
  }

  /** direction 1 = clockwise from above. Rotation values count CCW quarter turns, hence the minus. */
  rotate(direction: 1 | -1): void {
    this.rotation = nextRotation(this.rotation, direction === 1 ? -1 : 1);
    this.hoverDirty = true;
    this.bus.emit('build:rotated', { rotation: this.rotation });
    this.bus.emit('tool:changed', { toolId: this.toolId, rotation: this.rotation });
  }

  update(delta: number): void {
    if (!this.enabled) return;
    const pending = this.pendingTouch;
    if (pending && performance.now() - pending.startMs >= TOUCH_COMMIT_MS) this.commitPendingTouch();

    // Camera moved under a still pointer (keys, damping, tweens): re-pick, and keep painting if held.
    if (this.picker.consumeCameraChange() && this.pointer) {
      this.lastPick = this.picker.pick(this.pointer.x, this.pointer.y);
      this.hoverDirty = true;
      if (this.stroke && this.lastPick) this.continueStroke(this.lastPick);
    }
    if (this.hoverDirty) this.refreshHover();
    this.ghost.update(delta);
  }

  dispose(): void {
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('lostpointercapture', this.onLostCapture);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    for (const off of this.unsubscribers) off();
    this.ghost.dispose();
  }

  // ---- pointer ----------------------------------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    if (event.pointerType === 'touch') {
      this.touchPointers.add(event.pointerId);
      if (this.touchPointers.size > 1) {
        // Second finger: this is a camera gesture. Drop the pending tap; keep what a committed stroke painted.
        this.cancelGesture();
        this.pointer = null;
        this.lastPick = null;
        this.ghost.hide();
        this.hoverDirty = true;
        return;
      }
    }
    // Right-click never builds; Alt+left orbits the camera.
    if (event.button !== 0 || event.altKey || !this.toolId || this.stroke) return;
    this.trackPointer(event);
    if (event.pointerType === 'touch') {
      this.pendingTouch = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, startMs: performance.now() };
      return;
    }
    this.beginStroke(event.pointerId, event.clientX, event.clientY);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    if (event.pointerType === 'touch') {
      // With two fingers down the camera owns the gesture; only the tool finger drives the hover.
      if (this.touchPointers.size !== 1 || !this.touchPointers.has(event.pointerId)) return;
      const pending = this.pendingTouch;
      if (pending && pending.pointerId === event.pointerId) {
        if (Math.hypot(event.clientX - pending.clientX, event.clientY - pending.clientY) < TOUCH_COMMIT_PX) return;
        this.commitPendingTouch();
      }
    } else if (this.stroke && this.stroke.pointerId === event.pointerId && (event.buttons & 1) === 0) {
      // The release happened somewhere we never heard about (outside the window): end the stroke.
      this.finishStroke();
    }
    this.trackPointer(event);
    if (this.stroke && this.stroke.pointerId === event.pointerId && this.lastPick) this.continueStroke(this.lastPick);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') this.touchPointers.delete(event.pointerId);
    const pending = this.pendingTouch;
    if (pending && pending.pointerId === event.pointerId) {
      // A tap: place at the touch point.
      this.commitPendingTouch();
    }
    if (this.stroke && this.stroke.pointerId === event.pointerId) {
      if (this.stroke.mode === 'line' && this.stroke.axis === null) {
        // A click (no drag) with a fence tool: place the edge nearest the press point.
        this.applyEdge(this.stroke.startEdge, true);
      }
      this.finishStroke();
    }
    if (event.pointerType === 'touch' && this.touchPointers.size === 0) {
      // No hover on touch screens: tidy the ghost away once the finger lifts.
      this.pointer = null;
      this.lastPick = null;
      this.hoverDirty = true;
    }
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.touchPointers.delete(event.pointerId);
    if (this.pendingTouch?.pointerId === event.pointerId) this.pendingTouch = null;
    if (this.stroke?.pointerId === event.pointerId) this.finishStroke();
  };

  private readonly onLostCapture = (event: PointerEvent): void => {
    if (this.stroke?.pointerId === event.pointerId) this.finishStroke();
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || this.stroke) return;
    this.pointer = null;
    this.lastPick = null;
    this.hoverDirty = true;
  };

  private readonly onBlur = (): void => {
    this.cancelGesture();
    this.touchPointers.clear();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.cancelGesture();
      this.touchPointers.clear();
    }
  };

  private trackPointer(event: PointerEvent): void {
    this.pointer = { x: event.clientX, y: event.clientY };
    this.lastPick = this.picker.pick(event.clientX, event.clientY);
    this.hoverDirty = true;
  }

  private commitPendingTouch(): void {
    const pending = this.pendingTouch;
    if (!pending) return;
    this.pendingTouch = null;
    this.beginStroke(pending.pointerId, pending.clientX, pending.clientY);
  }

  // ---- strokes ----------------------------------------------------------------------------

  private beginStroke(pointerId: number, clientX: number, clientY: number): void {
    if (!this.toolId) return;
    const pick = this.picker.pick(clientX, clientY);
    if (!pick || !this.editor.state.inBounds(pick.cell)) return;
    const def = toolDef(this.toolId);
    const mode: Stroke['mode'] = def.layer === 'bulldoze' ? 'bulldoze' : def.drag;

    if (mode === 'single') {
      this.editor.beginStroke();
      this.applyAction(actionForTool(this.toolId, pick.cell, pick.edge, this.rotation), pick.cell, true);
      this.editor.endStroke();
      return;
    }

    this.editor.beginStroke();
    const stroke: Stroke = {
      pointerId,
      mode,
      lastCell: pick.cell,
      lastGrid: pick.grid,
      startGrid: pick.grid,
      startEdge: pick.edge,
      axis: null,
      visited: new Set(),
      edgesOnly: false,
      removedAny: false,
    };
    this.stroke = stroke;
    try {
      if (!this.canvas.hasPointerCapture(pointerId)) this.canvas.setPointerCapture(pointerId);
    } catch {
      // Synthetic or already-released pointers can't be captured; blur/visibility still end the stroke.
    }

    if (mode === 'paint' || mode === 'scatter') {
      stroke.visited.add(cellKey(pick.cell));
      this.applyAction(actionForTool(this.toolId, pick.cell, pick.edge, this.rotation), pick.cell, true);
    } else if (mode === 'bulldoze') {
      this.bulldozeAt(pick.grid, true);
    }
    // 'line' waits for the first movement (axis lock) or the release (single edge).
  }

  private continueStroke(pick: PickResult): void {
    const stroke = this.stroke;
    if (!stroke || !this.toolId) return;
    const state = this.editor.state;
    switch (stroke.mode) {
      case 'paint': {
        const target = clampCellNearPlot(pick.cell, state.width, state.depth);
        if (sameCell(target, stroke.lastCell)) return;
        for (const cell of cellsOnLine(stroke.lastCell, target).slice(1)) {
          if (!state.inBounds(cell)) continue;
          this.applyAction(actionForTool(this.toolId, cell, pick.edge, this.rotation), cell, false);
        }
        stroke.lastCell = target;
        return;
      }
      case 'scatter': {
        const key = cellKey(pick.cell);
        if (!state.inBounds(pick.cell) || stroke.visited.has(key)) return;
        stroke.visited.add(key);
        this.applyAction(actionForTool(this.toolId, pick.cell, pick.edge, this.rotation), pick.cell, false);
        return;
      }
      case 'bulldoze': {
        for (const point of segmentSamples(stroke.lastGrid, pick.grid)) this.bulldozeAt(point, false);
        stroke.lastGrid = pick.grid;
        return;
      }
      case 'line': {
        if (stroke.axis === null) stroke.axis = lockAxis(stroke.startGrid, pick.grid);
        if (stroke.axis === null) return;
        for (const edge of lineEdges(stroke.startGrid, pick.grid, stroke.axis, state.width, state.depth)) {
          const key = edgeKey(edge);
          if (stroke.visited.has(key)) continue;
          stroke.visited.add(key);
          this.applyEdge(edge, false);
        }
        return;
      }
      case 'single':
        return;
    }
  }

  /** One bulldoze sample: cell under the point, plus the nearest edge when within 0.3 cell. */
  private bulldozeAt(point: GridPoint, fromPress: boolean): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const state = this.editor.state;
    const cell = { x: Math.floor(point.x), z: Math.floor(point.z) };
    const nearest = this.nearestEdge(point);
    const edge = isNearEdge(point, nearest, BULLDOZE_EDGE_RANGE) ? nearest : null;
    const hasObject = state.inBounds(cell) && !!state.getObjectAt(cell);
    const fence = edge ? state.getEdge(edge) : undefined;
    if (stroke.edgesOnly && (!fence || hasObject)) return;
    const key = hasObject ? `o:${cellKey(cell)}` : fence ? `e:${edgeKey(edge!)}` : `g:${cellKey(cell)}`;
    if (stroke.visited.has(key)) return;
    stroke.visited.add(key);
    if (!state.inBounds(cell) && !fence) return;
    const result = this.applyAction({ type: 'bulldoze', cell, edge }, cell, fromPress);
    if (result.ok) {
      if (!stroke.removedAny && result.changes[result.changes.length - 1]?.layer === 'edge') stroke.edgesOnly = true;
      stroke.removedAny = true;
    }
  }

  private applyEdge(edge: Edge, fromPress: boolean): void {
    if (!this.toolId) return;
    const cell = { x: Math.min(edge.x, this.editor.state.width - 1), z: Math.min(edge.z, this.editor.state.depth - 1) };
    this.applyAction(actionForTool(this.toolId, cell, edge, this.rotation), cell, fromPress);
  }

  private applyAction(action: BuildAction, cell: Cell, fromPress: boolean): PlanResult {
    const toolId = this.toolId!;
    const result = this.editor.apply(action, toolId);
    if (result.ok && action.type !== 'bulldoze') this.rememberPlaced(result);
    // Only a deliberate click reports invalid; drags silently skip blocked cells.
    if (!result.ok && fromPress && result.reason !== 'no-change') {
      this.ghost.shake();
      if (this.invalidThrottle.shouldEmit(result.reason, performance.now())) {
        this.bus.emit('build:invalid', { toolId, cell: { ...cell }, reason: result.message });
      }
    }
    return result;
  }

  private finishStroke(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    this.editor.endStroke();
    try {
      if (this.canvas.hasPointerCapture(stroke.pointerId)) this.canvas.releasePointerCapture(stroke.pointerId);
    } catch {
      // Pointer already gone.
    }
  }

  /** End any stroke (keeping what it painted) and drop a pending touch tap. */
  private cancelGesture(): void {
    this.pendingTouch = null;
    this.finishStroke();
  }

  private rememberPlaced(result: Extract<PlanResult, { ok: true }>): void {
    for (const change of result.changes) {
      if (change.layer === 'ground') this.justPlaced.add(`c:${cellKey(change.cell)}`);
      else if (change.layer === 'edge' && change.op === 'add') this.justPlaced.add(`e:${edgeKey(change.placed.edge)}`);
      else if (change.layer === 'object' && change.op === 'add') {
        const def = objectDef(change.object.kind);
        for (const cell of footprintCells(change.object.anchor, def.footprint, change.object.rotation)) {
          this.justPlaced.add(`c:${cellKey(cell)}`);
        }
      }
    }
  }

  // ---- hover + ghost ----------------------------------------------------------------------

  private refreshHover(): void {
    this.hoverDirty = false;
    const pick = this.enabled ? this.lastPick : null;
    const state = this.editor.state;
    const cell = pick && state.inBounds(pick.cell) ? { ...pick.cell } : null;
    if (!pick || !cell) {
      this.ghost.hide();
      this.publishHover({ cell: null, edge: null, valid: true, reason: null });
      return;
    }
    const toolId = this.toolId;
    if (!toolId) {
      const world = cellToWorld(cell);
      this.ghost.show({ x: world.x, z: world.z, quarterTurns: 0, state: 'neutral', parts: [] });
      this.publishHover({ cell, edge: null, valid: true, reason: null });
      return;
    }

    const def = toolDef(toolId);
    if (def.layer === 'bulldoze') {
      this.showBulldozeTarget(cell, pick);
      return;
    }

    const edge = def.layer === 'edge' && edgeInBounds(pick.edge, state.width, state.depth) ? { ...pick.edge } : null;

    // Just filled by this tool (click or current stroke): calm, never "invalid".
    const targetKey = def.layer === 'edge' ? (edge ? `e:${edgeKey(edge)}` : null) : `c:${cellKey(cell)}`;
    if (targetKey && this.justPlaced.has(targetKey)) {
      if (def.layer === 'edge') this.ghost.hide();
      else {
        const world = cellToWorld(cell);
        this.ghost.show({ x: world.x, z: world.z, quarterTurns: 0, state: 'neutral', parts: [] });
      }
      this.publishHover({ cell, edge, valid: true, reason: null });
      return;
    }
    if (!this.stroke) this.justPlaced.clear();

    const preview = this.editor.preview(actionForTool(toolId, cell, edge ?? pick.edge, this.rotation));
    const valid = preview.ok || preview.reason === 'no-change';
    const reason = preview.ok || preview.reason === 'no-change' ? null : preview.message;
    const ghostState: GhostState = !valid ? 'invalid' : preview.ok ? 'valid' : 'neutral';

    if (def.layer === 'ground') {
      const world = cellToWorld(cell);
      const kind = toolId as Exclude<GroundKind, 'field'>;
      const look = this.groundLook(kind, cell);
      this.ghost.show({
        x: world.x,
        z: world.z,
        quarterTurns: 0,
        state: ghostState,
        parts: ghostState === 'invalid' ? [] : look.parts,
        fillColor: ghostState === 'valid' ? look.fill : undefined,
        // Model tiles (road/pavement/walkway) show themselves; only lawns use the flat fill.
        fillOpacity: ghostState === 'invalid' ? undefined : look.fill ? 0.8 : 0,
        solid: true,
      });
    } else if (def.layer === 'object') {
      const objectDefinition = objectDef(toolId as PlacedObject['kind']);
      const centre = this.footprintCentre(cell, objectDefinition.footprint, this.rotation);
      this.ghost.show({
        x: centre.x,
        z: centre.z,
        quarterTurns: this.rotation,
        state: ghostState,
        parts: [{ model: objectDefinition.models[0] }],
      });
    } else if (edge) {
      const world = edgeToWorld(edge);
      this.ghost.show({
        x: world.x,
        z: world.z,
        quarterTurns: world.alongX ? 0 : 1,
        state: ghostState,
        parts: [{ model: EDGE_MODELS[toolId as keyof typeof EDGE_MODELS] }],
        // A thin mint strip + frame along the edge, so the fence target reads on the field.
        tileScale: world.alongX ? [1, 0.36] : [0.36, 1],
      });
    } else {
      this.ghost.hide();
    }
    this.publishHover({ cell, edge, valid, reason });
  }

  /** Bulldoze hover: highlight exactly what a click would remove (object > near fence > ground). */
  private showBulldozeTarget(cell: Cell, pick: PickResult): void {
    const state = this.editor.state;
    const object = state.getObjectAt(cell);
    const nearEdge = isNearEdge(pick.grid, pick.edge, BULLDOZE_EDGE_RANGE) && edgeInBounds(pick.edge, state.width, state.depth);
    const edge = nearEdge ? { ...pick.edge } : null;
    const fence = edge ? state.getEdge(edge) : undefined;
    if (object) {
      const def = objectDef(object.kind);
      const centre = this.footprintCentre(object.anchor, def.footprint, object.rotation);
      this.ghost.show({
        x: centre.x,
        z: centre.z,
        quarterTurns: object.rotation,
        state: 'remove',
        parts: [{ model: def.models[object.variant % def.models.length] }],
        snap: true,
      });
    } else if (fence && edge) {
      const world = edgeToWorld(edge);
      this.ghost.show({
        x: world.x,
        z: world.z,
        quarterTurns: world.alongX ? 0 : 1,
        state: 'remove',
        parts: [{ model: EDGE_MODELS[fence.kind] }],
        tileScale: world.alongX ? [1, 0.4] : [0.4, 1],
        snap: true,
      });
    } else {
      const world = cellToWorld(cell);
      const hasGround = state.getGround(cell) !== 'field';
      this.ghost.show({ x: world.x, z: world.z, quarterTurns: 0, state: hasGround ? 'remove' : 'neutral', parts: [] });
    }
    this.publishHover({ cell, edge, valid: true, reason: null });
  }

  /**
   * What a ground tile of `kind` would look like at `cell`, built from the same library models the
   * renderer uses: the auto-tiled road piece for the current neighbours, the pavement tile, the
   * walkway hub + arms, or a lawn fill with a few tufts / flowers.
   */
  private groundLook(kind: Exclude<GroundKind, 'field'>, cell: Cell): { parts: GhostPart[]; fill?: string } {
    const state = this.editor.state;
    if (kind === 'road') {
      const tile = roadTileFor(roadMask(state, cell));
      return { parts: [{ model: ROAD_PIECE_MODELS[tile.piece], quarterTurns: tile.rotation }] };
    }
    if (kind === 'walkway') {
      let mask = 0;
      NEIGHBOURS.forEach((offset, i) => {
        const ground = state.getGround({ x: cell.x + offset.x, z: cell.z + offset.z });
        if (ground === 'walkway' || ground === 'pavement') mask |= 1 << i;
      });
      const arms = mask === 0 ? 0b0101 : mask; // a lone walkway reads as a short north–south path
      const parts: GhostPart[] = [{ model: 'walkway-hub' }];
      NEIGHBOURS.forEach((offset, i) => {
        if (arms & (1 << i)) {
          parts.push({ model: 'walkway-arm', x: offset.x * 0.25 * CELL_SIZE, z: offset.z * 0.25 * CELL_SIZE, quarterTurns: offset.x !== 0 ? 1 : 0 });
        }
      });
      return { parts };
    }
    const visual = GROUND_MODELS[kind];
    if (visual.type === 'model') return { parts: [{ model: visual.model }] };
    const q = CELL_SIZE / 4;
    if (kind === 'meadow') {
      return {
        fill: visual.color,
        parts: [
          { model: 'meadow-flowers', x: -q, z: -q, y: LAWN_TOP },
          { model: 'meadow-flowers-tall', x: q, z: -q, y: LAWN_TOP, quarterTurns: 1 },
          { model: 'grass-tuft', x: -q, z: q, y: LAWN_TOP },
          { model: 'meadow-flowers', x: q, z: q, y: LAWN_TOP, quarterTurns: 2 },
        ],
      };
    }
    return {
      fill: visual.color,
      parts: [
        { model: 'grass-tuft', x: -q, z: -q * 0.6, y: LAWN_TOP, scale: 0.9 },
        { model: 'grass-tuft', x: q * 0.8, z: q, y: LAWN_TOP, scale: 0.8, quarterTurns: 1 },
      ],
    };
  }

  private footprintCentre(anchor: Cell, footprint: readonly [number, number], rotation: Rotation): { x: number; z: number } {
    const first = cellToWorld(footprintCells(anchor, footprint, rotation)[0]);
    const [w, d] = rotatedFootprint(footprint, rotation);
    return { x: first.x + ((w - 1) * CELL_SIZE) / 2, z: first.z + ((d - 1) * CELL_SIZE) / 2 };
  }

  private nearestEdge(point: GridPoint): Edge {
    return worldToNearestEdge((point.x - PLOT_WIDTH / 2) * CELL_SIZE, (point.z - PLOT_DEPTH / 2) * CELL_SIZE);
  }

  private publishHover(next: HoverState): void {
    const previous = this.hover;
    const changed =
      !sameCellOrNull(previous.cell, next.cell) ||
      !sameEdgeOrNull(previous.edge, next.edge) ||
      previous.valid !== next.valid ||
      previous.reason !== next.reason;
    if (!changed) return;
    this.hover = next;
    this.hoverInfo = next.cell ? { x: next.cell.x, z: next.cell.z, valid: next.valid, reason: next.reason } : null;
    this.bus.emit('hover:changed', { cell: next.cell, edge: next.edge, valid: next.valid, reason: next.reason });
  }

  // ---- keyboard -----------------------------------------------------------------------------

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || isEditableTarget(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey) {
      if (event.code === 'KeyZ') {
        event.preventDefault();
        this.bus.emit(event.shiftKey ? 'intent:redo' : 'intent:undo');
      } else if (event.code === 'KeyY') {
        event.preventDefault();
        this.bus.emit('intent:redo');
      }
      return;
    }
    if (mod || event.altKey) return;
    switch (event.code) {
      case 'KeyR':
        this.rotate(event.shiftKey ? -1 : 1);
        break;
      case 'KeyB':
        if (!event.repeat) this.selectTool('bulldoze');
        break;
      case 'Escape':
        if (event.repeat) break;
        if (this.toolId) this.selectTool(null);
        else this.bus.emit('intent:open-menu');
        break;
      case 'KeyF':
      case 'Home':
        if (!event.repeat) {
          event.preventDefault();
          this.bus.emit('intent:reset-camera');
        }
        break;
    }
  };
}

function sameCellOrNull(a: Cell | null, b: Cell | null): boolean {
  return a === b || sameCell(a, b);
}

function sameEdgeOrNull(a: Edge | null, b: Edge | null): boolean {
  return a === b || sameEdge(a, b);
}
