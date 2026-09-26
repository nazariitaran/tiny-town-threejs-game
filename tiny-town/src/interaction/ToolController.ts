/**
 * Owns the active tool + rotation, turns pointer gestures into TownEditor strokes,
 * and publishes hover/validity for UI + ghost preview. Keyboard shortcuts live here too.
 *
 * SCAFFOLD BASELINE — WP-05 (Interaction) owns this file. Baseline: click/drag paint,
 * R rotate, Esc deselect, Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z redo, a flat cell highlight.
 * TODO(WP-05): GhostPreview (translucent model, valid/invalid tint, rotate tween, shake on
 * invalid), edge highlight + axis-locked 'line' drags for fences, 'single' vs 'scatter'
 * semantics, B bulldoze, F/Home reset camera, touch (one finger tool / two finger camera), pointer
 * cancel/blur safety, throttled build:invalid tooltips, Esc with no tool → intent:open-menu.
 * Number keys 1–9 belong to the UI (WP-06), which owns the active category.
 */
import * as THREE from 'three';
import { actionForTool, toolDef, type ToolId } from '../catalog/tools';
import { CELL_SIZE, cellToWorld } from '../game/config';
import type { GameBus } from '../game/events';
import { cellsOnLine, nextRotation, sameCell } from '../town/grid';
import type { TownEditor } from '../town/TownEditor';
import type { Cell, Edge, Rotation } from '../town/types';
import type { DebugTools } from '../debug/DebugTools';
import type { ModelLibrary } from '../render/ModelLibrary';
import type { CameraController } from './CameraController';
import type { GridPicker } from './GridPicker';

export class ToolController {
  private toolId: ToolId | null = null;
  private rotation: Rotation = 0;
  private hoverCell: Cell | null = null;
  private hoverEdge: Edge | null = null;
  private stroking = false;
  private lastStrokeCell: Cell | null = null;
  private enabled = false;
  private readonly highlight: THREE.Mesh;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly picker: GridPicker,
    private readonly editor: TownEditor,
    private readonly cameraController: CameraController,
    private readonly bus: GameBus,
    scene: THREE.Scene,
    /** For GhostPreview models (WP-05). Templates are ready once phase leaves 'loading'. */
    private readonly library: ModelLibrary,
    _debug?: DebugTools,
  ) {
    this.highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL_SIZE * 0.96, CELL_SIZE * 0.96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.highlight.position.y = 0.03;
    this.highlight.visible = false;
    this.highlight.name = 'hover-highlight';
    scene.add(this.highlight);

    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    this.unsubscribers.push(
      bus.on('intent:select-tool', ({ toolId }) => this.selectTool(toolId)),
      bus.on('intent:rotate', ({ direction }) => this.rotate(direction)),
      bus.on('intent:undo', () => this.editor.undo()),
      bus.on('intent:redo', () => this.editor.redo()),
    );
  }

  get activeTool(): ToolId | null {
    return this.toolId;
  }

  get activeRotation(): Rotation {
    return this.rotation;
  }

  get hovered(): Cell | null {
    return this.hoverCell;
  }

  /** Input is only live in the 'building' phase. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.finishStroke();
      this.setHover(null, null);
    }
  }

  selectTool(toolId: ToolId | null): void {
    this.toolId = this.toolId === toolId ? null : toolId;
    this.cameraController.setToolActive(this.toolId !== null);
    this.bus.emit('tool:changed', { toolId: this.toolId, rotation: this.rotation });
  }

  /** direction 1 = clockwise from above. Rotation values count CCW quarter turns, hence the minus. */
  rotate(direction: 1 | -1): void {
    this.rotation = nextRotation(this.rotation, direction === 1 ? -1 : 1);
    this.bus.emit('build:rotated', { rotation: this.rotation });
    this.bus.emit('tool:changed', { toolId: this.toolId, rotation: this.rotation });
  }

  update(_delta: number): void {}

  dispose(): void {
    void this.library;
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    for (const off of this.unsubscribers) off();
    this.highlight.removeFromParent();
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    const pick = this.picker.pick(event.clientX, event.clientY);
    const cell = pick && this.editor.state.inBounds(pick.cell) ? pick.cell : null;
    this.setHover(cell, pick?.edge ?? null);
    if (this.stroking && cell && this.lastStrokeCell && !sameCell(cell, this.lastStrokeCell)) {
      for (const step of cellsOnLine(this.lastStrokeCell, cell).slice(1)) this.applyAt(step, pick!.edge);
      this.lastStrokeCell = cell;
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0 || event.altKey || !this.toolId) return;
    const pick = this.picker.pick(event.clientX, event.clientY);
    if (!pick || !this.editor.state.inBounds(pick.cell)) return;
    this.editor.beginStroke();
    this.stroking = toolDef(this.toolId).drag !== 'single';
    this.lastStrokeCell = pick.cell;
    this.applyAt(pick.cell, pick.edge, true);
    if (!this.stroking) this.editor.endStroke();
  };

  private readonly onPointerUp = (): void => {
    this.finishStroke();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.target instanceof HTMLInputElement) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.code === 'KeyZ') {
      event.preventDefault();
      this.bus.emit(event.shiftKey ? 'intent:redo' : 'intent:undo');
    } else if (mod && event.code === 'KeyY') {
      event.preventDefault();
      this.bus.emit('intent:redo');
    } else if (event.code === 'KeyR' && !mod) {
      this.rotate(event.shiftKey ? -1 : 1);
    } else if (event.code === 'Escape') {
      if (this.toolId) this.selectTool(null);
    }
  };

  private finishStroke(): void {
    if (!this.stroking) return;
    this.stroking = false;
    this.lastStrokeCell = null;
    this.editor.endStroke();
  }

  private applyAt(cell: Cell, edge: Edge, fromPress = false): void {
    if (!this.toolId) return;
    const result = this.editor.apply(actionForTool(this.toolId, cell, edge, this.rotation), this.toolId);
    // Only a deliberate click reports invalid; drags silently skip blocked cells.
    if (!result.ok && fromPress && result.reason !== 'no-change') {
      this.bus.emit('build:invalid', { toolId: this.toolId, cell, reason: result.message });
    }
  }

  private setHover(cell: Cell | null, edge: Edge | null): void {
    const changed = !sameCell(cell, this.hoverCell);
    this.hoverCell = cell;
    this.hoverEdge = edge;
    this.highlight.visible = !!cell;
    if (cell) {
      const world = cellToWorld(cell);
      this.highlight.position.x = world.x;
      this.highlight.position.z = world.z;
    }
    if (!changed) return;
    let valid = true;
    let reason: string | null = null;
    if (cell && this.toolId) {
      const preview = this.editor.preview(actionForTool(this.toolId, cell, edge ?? { x: cell.x, z: cell.z, side: 'n' }, this.rotation));
      valid = preview.ok || preview.reason === 'no-change';
      reason = preview.ok ? null : preview.message;
    }
    (this.highlight.material as THREE.MeshBasicMaterial).color.set(valid ? '#ffffff' : '#e0674f');
    this.bus.emit('hover:changed', { cell, edge: this.hoverEdge, valid, reason });
  }
}
