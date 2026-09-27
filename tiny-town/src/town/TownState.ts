/**
 * Authoritative town data store. Pure (no three.js). It stores and applies
 * changes; it does NOT decide whether a change is allowed — that is rules.ts.
 *
 * WP-02 owns this file (extend, don't rewrite the API). Only TownEditor calls the
 * mutating methods (applyChanges / clear / restoreNextObjectId / allocateObjectId).
 */
import { cellKey, edgeKey, footprintCells, ROAD_BLOCK } from './grid';
import { objectDef } from '../catalog/objects';
import type {
  Cell,
  Edge,
  GroundKind,
  PlacedEdge,
  PlacedObject,
  TownChange,
  TownStateReader,
  TownStats,
} from './types';

export class TownState implements TownStateReader {
  private ground: GroundKind[];
  private readonly objectsById = new Map<number, PlacedObject>();
  /** cellKey → object id, for every footprint cell. */
  private readonly occupancy = new Map<string, number>();
  private readonly edgesByKey = new Map<string, PlacedEdge>();
  private nextId = 1;

  constructor(
    readonly width: number,
    readonly depth: number,
  ) {
    this.ground = new Array<GroundKind>(width * depth).fill('field');
  }

  inBounds(cell: Cell): boolean {
    return cell.x >= 0 && cell.z >= 0 && cell.x < this.width && cell.z < this.depth;
  }

  getGround(cell: Cell): GroundKind {
    return this.inBounds(cell) ? this.ground[cell.z * this.width + cell.x] : 'field';
  }

  getObjectAt(cell: Cell): PlacedObject | undefined {
    const id = this.occupancy.get(cellKey(cell));
    return id === undefined ? undefined : this.objectsById.get(id);
  }

  getObject(id: number): PlacedObject | undefined {
    return this.objectsById.get(id);
  }

  getEdge(edge: Edge): PlacedEdge | undefined {
    return this.edgesByKey.get(edgeKey(edge));
  }

  objects(): Iterable<PlacedObject> {
    return this.objectsById.values();
  }

  edges(): Iterable<PlacedEdge> {
    return this.edgesByKey.values();
  }

  /** Reserve a fresh object id (used by rules when planning a placement). */
  allocateObjectId(): number {
    return this.nextId++;
  }

  get nextObjectId(): number {
    return this.nextId;
  }

  set nextObjectId(value: number) {
    this.nextId = Math.max(this.nextId, value);
  }

  /**
   * Set the id counter exactly (used when loading a save), but never below
   * (highest live id + 1), so ids stay unique.
   */
  restoreNextObjectId(value: number): void {
    let floor = 1;
    for (const id of this.objectsById.keys()) floor = Math.max(floor, id + 1);
    this.nextId = Math.max(floor, Math.floor(value));
  }

  /** Apply already-validated changes in order. Throws on inconsistent input (a bug upstream). */
  applyChanges(changes: readonly TownChange[]): void {
    for (const change of changes) {
      switch (change.layer) {
        case 'ground':
          if (!this.inBounds(change.cell)) throw new Error(`Ground change out of bounds: ${cellKey(change.cell)}`);
          this.ground[change.cell.z * this.width + change.cell.x] = change.after;
          break;
        case 'object':
          if (change.op === 'add') this.addObject(change.object);
          else this.removeObject(change.object.id);
          break;
        case 'edge': {
          const key = edgeKey(change.placed.edge);
          if (change.op === 'add') this.edgesByKey.set(key, { ...change.placed, edge: { ...change.placed.edge } });
          else this.edgesByKey.delete(key);
          break;
        }
      }
    }
  }

  /**
   * Clear everything back to an empty field and restart object ids at 1 (so rebuilt demo towns
   * are id-for-id deterministic). Returns the changes that did it (for the renderer).
   */
  clear(): TownChange[] {
    const changes: TownChange[] = [];
    for (const object of this.objectsById.values()) changes.push({ layer: 'object', op: 'remove', object });
    for (const placed of this.edgesByKey.values()) changes.push({ layer: 'edge', op: 'remove', placed });
    for (let z = 0; z < this.depth; z += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const before = this.ground[z * this.width + x];
        if (before !== 'field') changes.push({ layer: 'ground', cell: { x, z }, before, after: 'field' });
      }
    }
    this.applyChanges(changes);
    this.nextId = 1;
    return changes;
  }

  stats(): TownStats {
    const stats: TownStats = { homes: 0, residents: 0, trees: 0, roadTiles: 0, props: 0, fences: this.edgesByKey.size };
    // One road tile per aligned 2 × 2 road block (WP-12): count the blocks' min-corner cells.
    for (let z = 0; z < this.depth; z += ROAD_BLOCK) {
      for (let x = 0; x < this.width; x += ROAD_BLOCK) if (this.ground[z * this.width + x] === 'road') stats.roadTiles += 1;
    }
    for (const object of this.objectsById.values()) {
      const def = objectDef(object.kind);
      if (def.residents > 0) {
        stats.homes += 1;
        stats.residents += def.residents;
      }
      if (def.statGroup === 'tree') stats.trees += 1;
      if (def.statGroup === 'prop') stats.props += 1;
    }
    return stats;
  }

  private addObject(object: PlacedObject): void {
    if (this.objectsById.has(object.id)) throw new Error(`Duplicate object id ${object.id}`);
    const copy: PlacedObject = { ...object, anchor: { ...object.anchor } };
    this.objectsById.set(copy.id, copy);
    for (const cell of footprintCells(copy.anchor, objectDef(copy.kind).footprint, copy.rotation)) {
      this.occupancy.set(cellKey(cell), copy.id);
    }
    this.nextId = Math.max(this.nextId, copy.id + 1);
  }

  private removeObject(id: number): void {
    const object = this.objectsById.get(id);
    if (!object) throw new Error(`Unknown object id ${id}`);
    for (const cell of footprintCells(object.anchor, objectDef(object.kind).footprint, object.rotation)) {
      this.occupancy.delete(cellKey(cell));
    }
    this.objectsById.delete(id);
  }
}
