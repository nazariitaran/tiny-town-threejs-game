/**
 * Owns the active tool and rotation, turns pointer gestures into TownEditor strokes, publishes hover
 * validity and drives the GhostPreview. Camera keys live in CameraController.
 *
 * Drag modes: paint (every crossed cell; roads once per 2 × 2 block), scatter (each new valid cell),
 * single (click only), line (fences: a straight edge run, axis locked by the first movement).
 * Every stroke is one undo entry; only a deliberate click reports build:invalid.
 *
 * Touch: one finger becomes the tool after TOUCH_COMMIT_MS or TOUCH_COMMIT_PX, so a second finger
 * can still turn it into a camera gesture.
 */
import * as THREE from 'three';
import { EDGE_MODELS, GROUND_MODELS, ZEBRA_PIECE_MODELS } from '../catalog/models';
import { footprintOf, objectDef, pickableVariants, placedFootprint, type ObjectDef } from '../catalog/objects';
import { pickWeighted } from '../utils/random';
import { actionForTool, RETIRED_TOOLS, toolDef, type DragMode, type ToolId } from '../catalog/tools';
import type { DebugTools } from '../debug/DebugTools';
import {
  CELL_SIZE,
  cellToWorld,
  edgeToWorld,
  footprintCentreWorld,
  GROUND_Y,
  PLOT_DEPTH,
  PLOT_WIDTH,
  roadBlockCentreWorld,
  worldToNearestEdge,
} from '../game/config';
import type { GameBus } from '../game/events';
import type { ModelLibrary } from '../render/ModelLibrary';
import { roadLook } from '../town/roadTiles';
import {
  anchorForPointer,
  cellKey,
  cellsOnLine,
  edgeInBounds,
  edgeKey,
  footprintCells,
  NEIGHBOURS,
  nextRotation,
  ROAD_BLOCK,
  roadBlockAnchor,
  rotatedFootprint,
  sameCell,
  sameEdge,
} from '../town/grid';
import type { TownEditor } from '../town/TownEditor';
import { isMovable, isTurnable } from '../town/rules';
import type { BuildAction, Cell, Edge, GroundKind, ObjectKind, PlacedObject, PlanResult, Rotation } from '../town/types';
import type { CameraController } from './CameraController';
import { GhostPreview, GROUND_GHOST_LIFT, objectGhostPart, type GhostPart, type GhostState } from './GhostPreview';
import type { GridPicker, PickResult } from './GridPicker';
import { isEditableTarget } from './keyboard';
import { clampCellNearPlot, isNearEdge, KeyedThrottle, lineEdges, lockAxis, segmentSamples, type GridPoint, type LineAxis } from './strokeMath';

/** Lawn/meadow slab top height in TownRenderer (tufts and flowers stand on it). */
const LAWN_TOP = GROUND_Y;
const ONE_TILE: readonly [number, number] = [1, 1];
const BLOCK_TILE: readonly [number, number] = [ROAD_BLOCK, ROAD_BLOCK];
/** Pavement tile top colour, for block ghosts. */
const PAVEMENT_FILL = '#c7c2b8';

/** What diagnostics `hover` publishes. */
export type HoverInfo = Cell & { valid: boolean; reason: string | null };

/** Touch: a single finger becomes a tool stroke after this long / this far (px). */
const TOUCH_COMMIT_MS = 150;
const TOUCH_COMMIT_PX = 10;
/** A right press that moves less than this before release is a click (deselect), not a camera pan. */
const RIGHT_CLICK_SLOP_PX = 5;
/** Bulldoze targets a fence when the pointer is within this many cells of it (touch: coarser). */
const BULLDOZE_EDGE_RANGE = 0.3;
const BULLDOZE_EDGE_RANGE_COARSE = 0.4;

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

/** Move tool: the object picked up and not yet put down. */
interface Carry {
  id: number;
  kind: ObjectKind;
  variant: number;
  /** The rotation it would be put down with. */
  rotation: Rotation;
  rotatable: boolean;
}

/** What diagnostics `selection` publishes. */
export type SelectionInfo = { id: number; kind: ObjectKind; rotation: Rotation };

/** What diagnostics `variant` publishes. */
export type VariantInfo = { choice: number; count: number };

interface HoverState {
  cell: Cell | null;
  edge: Edge | null;
  valid: boolean;
  reason: string | null;
}

export class ToolController {
  private toolId: ToolId | null = null;
  /** Right button press awaiting release: a click without a drag deselects the tool. */
  private rightPress: { pointerId: number; clientX: number; clientY: number } | null = null;
  private rotation: Rotation = 0;
  /** Each multi-model object tool's chosen model this session (unset → model 0). */
  private readonly variantChoices = new Map<ObjectKind, number>();
  /** The model the active tool's ghost shows and its placements build (0 for one-model tools). */
  private chosenVariant = 0;
  private enabled = false;
  private stroke: Stroke | null = null;
  private pendingTouch: PendingTouch | null = null;
  private readonly touchPointers = new Set<number>();
  /** Last known pointer position over the canvas (null when outside / touch lifted). */
  private pointer: { x: number; y: number } | null = null;
  /** The last pointer was a finger (coarse): wider fence pick range for bulldoze. */
  private coarsePointer = false;
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
  /** Move tool: the carried object, painted blue where it stands until it is put down. */
  private readonly selectionGhost: GhostPreview;
  private carry: Carry | null = null;
  /**
   * Move tool: the object just put down. It isn't hover-highlighted until the pointer leaves it, so
   * the blue overlay doesn't sit at its new place while the object is still hopping there.
   */
  private settlingId: number | null = null;
  private readonly invalidThrottle = new KeyedThrottle(400);
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly picker: GridPicker,
    private readonly editor: TownEditor,
    private readonly cameraController: CameraController,
    private readonly bus: GameBus,
    scene: THREE.Scene,
    /** Templates are ready once the phase leaves 'loading'. */
    library: ModelLibrary,
    /** The gameplay RNG: models rolled by weight (the postbox's cypher) come from it. */
    private readonly rng: () => number,
    debug?: DebugTools,
  ) {
    this.ghost = new GhostPreview(scene, library);
    this.selectionGhost = new GhostPreview(scene, library);
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
      bus.on('intent:select-variant', ({ choice }) => this.selectVariant(choice)),
      bus.on('intent:undo', () => {
        this.putBack();
        this.cancelGesture();
        this.justPlaced.clear();
        this.editor.undo();
      }),
      bus.on('intent:redo', () => {
        this.putBack();
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

  /** Diagnostics `selection`; null when nothing is carried. */
  get selection(): SelectionInfo | null {
    const carry = this.carry;
    return carry ? { id: carry.id, kind: carry.kind, rotation: carry.rotation } : null;
  }

  /** Diagnostics `variant`; null unless the active tool has several models. */
  get variant(): VariantInfo | null {
    const def = this.variantDef();
    return def ? { choice: this.chosenVariant, count: def.variants } : null;
  }

  /** Diagnostics `hover`; null off-plot. */
  get hovered(): HoverInfo | null {
    return this.hoverInfo;
  }

  /** Input is only live in the 'building' phase. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.cameraController.setInputEnabled(enabled);
    if (!enabled) {
      this.putBack();
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
    this.putBack();
    this.cancelGesture();
    this.toolId = this.toolId === toolId ? null : toolId;
    this.justPlaced.clear();
    this.cameraController.setToolActive(this.toolId !== null);
    this.chosenVariant = this.choiceFor(this.variantDef());
    this.rollWeightedVariant();
    this.hoverDirty = true;
    this.emitToolChanged();
  }

  /** A kind that rolls its model by weight shows the next roll on the ghost, and a placement builds exactly that. */
  private rollWeightedVariant(): void {
    const weights = this.toolId && toolDef(this.toolId).layer === 'object' ? objectDef(this.toolId as ObjectKind).variantWeights : undefined;
    if (weights) this.chosenVariant = pickWeighted(this.rng, weights);
  }

  /** Build model `choice` with the active tool from now on. */
  selectVariant(choice: number): void {
    const def = this.variantDef();
    if (!def || !Number.isInteger(choice) || choice < 0 || choice >= def.variants || choice === this.chosenVariant) return;
    this.variantChoices.set(def.kind, choice);
    this.chosenVariant = choice;
    this.hoverDirty = true;
    this.emitToolChanged();
  }

  /** V / Shift+V: style 1 → … → style n → style 1 (and back). */
  cycleVariant(direction: 1 | -1): void {
    const def = this.variantDef();
    if (def) this.selectVariant((this.chosenVariant + direction + def.variants) % def.variants);
  }

  /** The active tool's object definition when it has more than one model, else null. */
  private variantDef(): ObjectDef | null {
    if (!this.toolId || toolDef(this.toolId).layer !== 'object') return null;
    const def = objectDef(this.toolId as ObjectKind);
    return pickableVariants(def) > 1 ? def : null;
  }

  private choiceFor(def: ObjectDef | null): number {
    return def ? (this.variantChoices.get(def.kind) ?? 0) : 0;
  }

  private emitToolChanged(): void {
    const def = this.variantDef();
    const variant = def ? { choice: this.chosenVariant, count: def.variants } : null;
    this.bus.emit('tool:changed', { toolId: this.toolId, rotation: this.rotation, variant });
  }

  /** direction 1 = clockwise from above. Rotation values count CCW quarter turns, hence the minus. */
  rotate(direction: 1 | -1): void {
    const carry = this.carry;
    if (carry) {
      // Carrying: R turns the carried object, not the tools' shared rotation.
      if (!carry.rotatable) return;
      carry.rotation = nextRotation(carry.rotation, direction === 1 ? -1 : 1);
      this.hoverDirty = true;
      this.bus.emit('build:rotated', { rotation: carry.rotation });
      this.emitSelection();
      return;
    }
    this.rotation = nextRotation(this.rotation, direction === 1 ? -1 : 1);
    this.hoverDirty = true;
    this.bus.emit('build:rotated', { rotation: this.rotation });
    this.emitToolChanged();
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
    this.selectionGhost.update(delta);
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
    this.selectionGhost.dispose();
  }

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
    // A right click (no drag) drops the tool like Escape; a right drag is the camera pan, so the
    // decision waits for pointerup. Alt+left orbits the camera.
    if (event.button === 2 && event.pointerType !== 'touch') {
      this.rightPress = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
      return;
    }
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
    const right = this.rightPress;
    if (right && right.pointerId === event.pointerId && event.button === 2) {
      this.rightPress = null;
      const moved = Math.hypot(event.clientX - right.clientX, event.clientY - right.clientY);
      if (this.enabled && this.toolId && moved < RIGHT_CLICK_SLOP_PX) {
        // A right click puts a carried object back first; the next one puts the tool away.
        if (this.carry) this.putBack(true);
        else this.selectTool(null);
      }
    }
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
    if (this.rightPress?.pointerId === event.pointerId) this.rightPress = null;
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
    this.coarsePointer = event.pointerType === 'touch';
    this.lastPick = this.picker.pick(event.clientX, event.clientY);
    this.hoverDirty = true;
  }

  private commitPendingTouch(): void {
    const pending = this.pendingTouch;
    if (!pending) return;
    this.pendingTouch = null;
    this.beginStroke(pending.pointerId, pending.clientX, pending.clientY);
  }

  private beginStroke(pointerId: number, clientX: number, clientY: number): void {
    if (!this.toolId) return;
    const pick = this.picker.pick(clientX, clientY);
    if (!pick || !this.editor.state.inBounds(pick.cell)) return;
    const def = toolDef(this.toolId);
    if (def.layer === 'move') {
      this.moveClick(pick);
      return;
    }
    const mode: Stroke['mode'] = def.layer === 'bulldoze' ? 'bulldoze' : def.drag;

    const target = this.targetCell(pick);
    if (mode === 'single') {
      this.editor.beginStroke();
      this.applyAction(actionForTool(this.toolId, target, pick.edge, this.rotation, this.chosenVariant), target, true);
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
      stroke.visited.add(this.strokeKey(target));
      this.applyAction(actionForTool(this.toolId, target, pick.edge, this.rotation, this.chosenVariant), target, true);
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
          // Road: one action per 2 × 2 block per stroke (the first touch converts the whole block).
          if (this.toolId === 'road') {
            const key = this.strokeKey(cell);
            if (stroke.visited.has(key)) continue;
            stroke.visited.add(key);
          }
          this.applyAction(actionForTool(this.toolId, cell, pick.edge, this.rotation, this.chosenVariant), cell, false);
        }
        stroke.lastCell = target;
        return;
      }
      case 'scatter': {
        if (!state.inBounds(pick.cell)) return;
        const cell = this.targetCell(pick);
        const key = this.strokeKey(cell);
        if (stroke.visited.has(key)) return;
        stroke.visited.add(key);
        this.applyAction(actionForTool(this.toolId, cell, pick.edge, this.rotation, this.chosenVariant), cell, false);
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

  /** One bulldoze sample: the cell under the point, plus the nearest edge when within range. */
  private bulldozeAt(point: GridPoint, fromPress: boolean): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const state = this.editor.state;
    const cell = { x: Math.floor(point.x), z: Math.floor(point.z) };
    const nearest = this.nearestEdge(point);
    const edge = isNearEdge(point, nearest, this.edgeRange) ? nearest : null;
    const object = state.inBounds(cell) ? state.getObjectAt(cell) : undefined;
    const fence = edge ? state.getEdge(edge) : undefined;
    if (stroke.edgesOnly && (!fence || object)) return;
    // One removal per object (any footprint cell) and per road block (bulldozing one cell clears it).
    const ground = state.inBounds(cell) ? state.getGround(cell) : 'field';
    const key = object
      ? `o:${object.id}`
      : fence
      ? `e:${edgeKey(edge!)}`
      : ground === 'road'
      ? `g:${cellKey(roadBlockAnchor(cell))}`
      : `g:${cellKey(cell)}`;
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
    this.applyAction(actionForTool(this.toolId, cell, edge, this.rotation, this.chosenVariant), cell, fromPress);
  }

  private applyAction(action: BuildAction, cell: Cell, fromPress: boolean): PlanResult {
    const toolId = this.toolId!;
    const result = this.editor.apply(action, toolId);
    if (result.ok && action.type !== 'bulldoze') this.rememberPlaced(result);
    if (result.ok && action.type === 'place-object') {
      this.rollWeightedVariant();
      this.hoverDirty = true;
    }
    // Only a deliberate click reports invalid; drags silently skip blocked cells.
    if (!result.ok && fromPress) this.reportInvalid(result, cell);
    return result;
  }

  /** Invalid click feedback: the ghost shakes and build:invalid (tooltip + sound) is throttled per reason. */
  private reportInvalid(result: Extract<PlanResult, { ok: false }>, cell: Cell): void {
    if (result.reason === 'no-change') return;
    this.ghost.shake();
    if (this.invalidThrottle.shouldEmit(result.reason, performance.now())) {
      this.bus.emit('build:invalid', { toolId: this.toolId, cell: { ...cell }, reason: result.message });
    }
  }

  /** Move tool click: pick up the object under the pointer, or put the carried one down. */
  private moveClick(pick: PickResult): void {
    const state = this.editor.state;
    const carry = this.carry;
    if (!carry) {
      const object = state.getObjectAt(pick.cell);
      if (!object) return;
      // Asking the rules about "move it where it is" answers "can it move at all?" (roundabout, parking, zebra).
      const check = this.editor.preview({ type: 'move-object', id: object.id, cell: object.anchor, rotation: object.rotation });
      if (!check.ok && check.reason === 'cannot-move') {
        this.reportInvalid(check, pick.cell);
        return;
      }
      const def = objectDef(object.kind);
      this.carry = { id: object.id, kind: object.kind, variant: object.variant, rotation: object.rotation, rotatable: isTurnable(def) };
      this.settlingId = null;
      this.hoverDirty = true;
      this.bus.emit('ui:sfx', { event: 'ui-open' });
      this.emitSelection();
      return;
    }
    const target = this.carryAnchor(pick, carry);
    this.editor.beginStroke();
    // The drop sounds and puffs like placing that item (a retired kind has no tool: Move's own sound).
    const toolId: ToolId = RETIRED_TOOLS.has(carry.kind) ? 'move' : carry.kind;
    const result = this.editor.apply({ type: 'move-object', id: carry.id, cell: target, rotation: carry.rotation }, toolId);
    this.editor.endStroke();
    if (result.ok) {
      this.carry = null;
      this.settlingId = carry.id;
      this.hoverDirty = true;
      this.emitSelection();
    } else if (result.reason === 'no-change') {
      this.putBack(true); // put down where it already stood
    } else {
      this.reportInvalid(result, pick.cell);
    }
  }

  /** The anchor a carried object would be put down at: its footprint centred on the pointer. */
  private carryAnchor(pick: PickResult, carry: Carry): Cell {
    const state = this.editor.state;
    return anchorForPointer(pick.grid.x, pick.grid.z, placedFootprint(carry), carry.rotation, state.width, state.depth, { x: 0, z: 0 }, 1);
  }

  /** Drop the carried object back where it stands (Esc, right-click, another tool, undo…). */
  private putBack(withSound = false): void {
    if (!this.carry) return;
    this.carry = null;
    this.hoverDirty = true;
    if (withSound) this.bus.emit('ui:sfx', { event: 'ui-close' });
    this.emitSelection();
  }

  private emitSelection(): void {
    const carry = this.carry;
    this.bus.emit('selection:changed', {
      id: carry?.id ?? null,
      kind: carry?.kind ?? null,
      rotation: carry?.rotation ?? this.rotation,
      rotatable: carry?.rotatable ?? false,
    });
  }

  /** The carried object, painted blue where it stands; hidden when nothing is carried. */
  private syncSelectionGhost(): void {
    const carry = this.carry;
    const object = carry ? this.editor.state.getObject(carry.id) : undefined;
    if (carry && !object) {
      // It went away under us (undo of its placement, a loaded town): nothing to carry any more.
      this.carry = null;
      this.emitSelection();
    }
    if (!object) {
      this.selectionGhost.hide();
      return;
    }
    this.showOnObject(this.selectionGhost, object, 'selected');
  }

  /** Paint `object` exactly where the town draws it (bulldoze target, Move selection). */
  private showOnObject(ghost: GhostPreview, object: PlacedObject, state: GhostState): void {
    const def = objectDef(object.kind);
    const footprint = placedFootprint(object);
    const centre = footprintCentreWorld(object.anchor, footprint, object.rotation);
    const marking = def.roadMarking ? this.markingPart(object.anchor) : null;
    // Posed exactly as the town draws it (root unturned; the part carries the turn or tree yaw).
    ghost.show({
      x: centre.x,
      z: centre.z,
      quarterTurns: 0,
      state,
      parts: [marking ?? objectGhostPart(def, def.models[object.variant % def.models.length], object.rotation, object.id)],
      solid: marking !== null, // lies on the road tile: no z-fighting (the tint stays)
      tileScale: rotatedFootprint(footprint, object.rotation),
      snap: true,
    });
  }

  /** Move tool hover: the carry ghost (mint / red) at the pointer, or blue on the movable object under it. */
  private showMoveTarget(cell: Cell, pick: PickResult): void {
    const state = this.editor.state;
    const carry = this.carry;
    if (carry) {
      const def = objectDef(carry.kind);
      const target = this.carryAnchor(pick, carry);
      const preview = this.editor.preview({ type: 'move-object', id: carry.id, cell: target, rotation: carry.rotation });
      const home = !preview.ok && preview.reason === 'no-change';
      const valid = preview.ok || home;
      const footprint = placedFootprint(carry);
      const centre = footprintCentreWorld(target, footprint, carry.rotation);
      this.ghost.show({
        x: centre.x,
        z: centre.z,
        // Turnable objects turn on the ghost's root (R animates); trees keep their own yaw on the part.
        quarterTurns: carry.rotatable ? carry.rotation : 0,
        state: valid ? 'valid' : 'invalid',
        // Back on its own spot the blue highlight already shows it: just the frame (a model here
        // would sit exactly on the real one and z-fight).
        parts: home ? [] : [objectGhostPart(def, def.models[carry.variant % def.models.length], 0, carry.id)],
        tileScale: rotatedFootprint(footprint, carry.rotation),
      });
      this.publishHover({ cell, edge: null, valid, reason: valid || preview.ok ? null : preview.message });
      return;
    }
    const object = state.getObjectAt(cell);
    if (object?.id !== this.settlingId) this.settlingId = null;
    if (object && object.id !== this.settlingId && isMovable(objectDef(object.kind))) {
      this.showOnObject(this.ghost, object, 'selected');
    } else {
      const world = cellToWorld(cell);
      this.ghost.show({ x: world.x, z: world.z, quarterTurns: 0, state: 'neutral', parts: [] });
    }
    this.publishHover({ cell, edge: null, valid: true, reason: null });
  }

  /**
   * A road marking's ghost: the marked variant of the road piece under it, turned like that tile (a
   * zebra follows the road, so R does nothing). Off a straight or junction it shows the plain crossing.
   */
  private markingPart(anchor: Cell): GhostPart {
    const state = this.editor.state;
    if (!state.inBounds(anchor) || state.getGround(anchor) !== 'road') return { model: 'road-crossing' };
    const look = roadLook(state, anchor, true);
    return { model: ZEBRA_PIECE_MODELS[look.piece] ? look.model : 'road-crossing', quarterTurns: look.rotation };
  }

  /** Where the active tool acts for this pick: objects centre their footprint on the pointer. */
  private targetCell(pick: PickResult): Cell {
    if (!this.toolId || toolDef(this.toolId).layer !== 'object') return pick.cell;
    const def = objectDef(this.toolId as PlacedObject['kind']);
    const state = this.editor.state;
    const snap = def.roadFeature || def.roadMarking ? ROAD_BLOCK : 1;
    return anchorForPointer(pick.grid.x, pick.grid.z, footprintOf(def, this.chosenVariant), this.rotation, state.width, state.depth, { x: 0, z: 0 }, snap);
  }

  /** Stroke de-duplication key: road strokes visit blocks, everything else cells. */
  private strokeKey(cell: Cell): string {
    return this.toolId === 'road' ? `b:${cellKey(roadBlockAnchor(cell))}` : cellKey(cell);
  }

  private get edgeRange(): number {
    return this.coarsePointer ? BULLDOZE_EDGE_RANGE_COARSE : BULLDOZE_EDGE_RANGE;
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
        for (const cell of footprintCells(change.object.anchor, placedFootprint(change.object), change.object.rotation)) {
          this.justPlaced.add(`c:${cellKey(cell)}`);
        }
      }
    }
  }

  private refreshHover(): void {
    this.hoverDirty = false;
    this.syncSelectionGhost();
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
    if (def.layer === 'move') {
      this.showMoveTarget(cell, pick);
      return;
    }

    const edge = def.layer === 'edge' && edgeInBounds(pick.edge, state.width, state.depth) ? { ...pick.edge } : null;
    const target = this.targetCell(pick);

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

    const preview = this.editor.preview(actionForTool(toolId, target, edge ?? pick.edge, this.rotation, this.chosenVariant));
    const valid = preview.ok || preview.reason === 'no-change';
    const reason = preview.ok || preview.reason === 'no-change' ? null : preview.message;
    const ghostState: GhostState = !valid ? 'invalid' : preview.ok ? 'valid' : 'neutral';

    if (def.layer === 'ground') {
      const kind = toolId as Exclude<GroundKind, 'field'>;
      // Road paints (and repaints of a road) change the whole 2 × 2 block: the ghost covers it.
      const block = kind === 'road' || state.getGround(cell) === 'road';
      const world = block ? roadBlockCentreWorld(cell) : cellToWorld(cell);
      const look = this.groundLook(kind, cell);
      this.ghost.show({
        x: world.x,
        z: world.z,
        quarterTurns: 0,
        state: ghostState,
        parts: ghostState === 'invalid' ? [] : block && kind !== 'road' ? [] : look.parts,
        fillColor: ghostState === 'valid' ? look.fill ?? (block && kind !== 'road' ? this.groundFill(kind) : undefined) : undefined,
        // Model tiles (road/pavement/walkway) show themselves; only lawns use the flat fill.
        fillOpacity: ghostState === 'invalid' ? undefined : look.fill || (block && kind !== 'road') ? 0.8 : 0,
        solid: true,
        tileScale: block ? BLOCK_TILE : ONE_TILE,
      });
    } else if (def.layer === 'object') {
      const objectDefinition = objectDef(toolId as PlacedObject['kind']);
      const footprint = footprintOf(objectDefinition, this.chosenVariant);
      const centre = footprintCentreWorld(target, footprint, this.rotation);
      const marking = objectDefinition.roadMarking ? this.markingPart(target) : null;
      this.ghost.show({
        x: centre.x,
        z: centre.z,
        quarterTurns: marking ? 0 : this.rotation,
        state: ghostState,
        parts: [marking ?? objectGhostPart(objectDefinition, objectDefinition.models[this.chosenVariant % objectDefinition.models.length], 0, null)],
        // A road marking previews the marked road tile in its real colours inside the frame (like the
        // road tool), without the mint fill washing out the stripes; invalid keeps the red fill.
        solid: marking !== null,
        fillOpacity: marking && ghostState !== 'invalid' ? 0 : undefined,
        tileScale: rotatedFootprint(footprint, this.rotation),
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
    const nearEdge = isNearEdge(pick.grid, pick.edge, this.edgeRange) && edgeInBounds(pick.edge, state.width, state.depth);
    const edge = nearEdge ? { ...pick.edge } : null;
    const fence = edge ? state.getEdge(edge) : undefined;
    if (object) {
      this.showOnObject(this.ghost, object, 'remove');
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
      const ground = state.getGround(cell);
      // Bulldozing a road cell clears its whole block.
      const world = ground === 'road' ? roadBlockCentreWorld(cell) : cellToWorld(cell);
      this.ghost.show({
        x: world.x,
        z: world.z,
        quarterTurns: 0,
        state: ground !== 'field' ? 'remove' : 'neutral',
        parts: [],
        tileScale: ground === 'road' ? BLOCK_TILE : ONE_TILE,
      });
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
      const look = roadLook(state, cell);
      return { parts: [{ model: look.model, quarterTurns: look.rotation, y: GROUND_GHOST_LIFT }] };
    }
    if (kind === 'walkway') {
      let mask = 0;
      NEIGHBOURS.forEach((offset, i) => {
        const ground = state.getGround({ x: cell.x + offset.x, z: cell.z + offset.z });
        if (ground === 'walkway' || ground === 'pavement') mask |= 1 << i;
      });
      const arms = mask === 0 ? 0b0101 : mask; // a lone walkway reads as a short north–south path
      // The hub piece (the walkway width, half a cell) at the centre, plus one more hub per connected
      // side, shifted a quarter cell so it overlaps the centre and ends on the cell edge.
      const parts: GhostPart[] = [{ model: 'walkway-hub' }];
      NEIGHBOURS.forEach((offset, i) => {
        if (arms & (1 << i)) parts.push({ model: 'walkway-hub', x: offset.x * 0.25 * CELL_SIZE, z: offset.z * 0.25 * CELL_SIZE });
      });
      return { parts };
    }
    const visual = GROUND_MODELS[kind];
    if (visual.type === 'model') return { parts: [{ model: visual.model }] };
    // One clump per cell, like the renderer's meadow scatter.
    if (kind === 'meadow') return { fill: visual.color, parts: [{ model: 'meadow-flowers', y: LAWN_TOP }] };
    // Water: the fill alone (the shore joins up once it is dug).
    if (kind === 'pond') return { fill: visual.color, parts: [] };
    return { fill: visual.color, parts: [{ model: 'grass-tuft', y: LAWN_TOP, scale: 0.9 }] };
  }

  /** Flat fill colour of a ground kind (for block ghosts that show no model). */
  private groundFill(kind: Exclude<GroundKind, 'field'>): string | undefined {
    if (kind === 'road') return undefined;
    const visual = GROUND_MODELS[kind];
    return visual.type === 'flat' ? visual.color : PAVEMENT_FILL;
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
      case 'KeyM':
        if (!event.repeat) this.selectTool('move');
        break;
      case 'KeyV':
        if (!event.repeat) this.cycleVariant(event.shiftKey ? -1 : 1);
        break;
      case 'Escape':
        if (event.repeat) break;
        if (this.carry) this.putBack(true);
        else if (this.toolId) this.selectTool(null);
        else this.bus.emit('intent:open-menu');
        break;
      case 'KeyT':
        if (!event.repeat) this.bus.emit('intent:cycle-time-mode');
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
