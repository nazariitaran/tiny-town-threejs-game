/**
 * Undo/redo over TownChange lists. One entry = one stroke (press → drag → release).
 *
 * WP-02 owns this file. Depth is capped at HISTORY_LIMIT entries (oldest dropped first);
 * TownEditor clears it on load and on reset (new town). Tested in History.test.ts.
 */
import type { TownChange } from './types';

/** Inverse of a change list: each change inverted, in reverse order. */
export function invertChanges(changes: readonly TownChange[]): TownChange[] {
  const inverted: TownChange[] = [];
  for (let i = changes.length - 1; i >= 0; i -= 1) {
    const change = changes[i];
    if (change.layer === 'ground') inverted.push({ ...change, before: change.after, after: change.before });
    else if (change.layer === 'object') inverted.push({ ...change, op: change.op === 'add' ? 'remove' : 'add' });
    else inverted.push({ ...change, op: change.op === 'add' ? 'remove' : 'add' });
  }
  return inverted;
}

/** Maximum number of undo entries kept (one entry = one stroke). */
export const HISTORY_LIMIT = 200;

export class History {
  private readonly undoStack: TownChange[][] = [];
  private readonly redoStack: TownChange[][] = [];

  constructor(readonly maxEntries = HISTORY_LIMIT) {}

  push(changes: readonly TownChange[]): void {
    if (changes.length === 0) return;
    this.undoStack.push([...changes]);
    while (this.undoStack.length > this.maxEntries) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Returns the changes to APPLY to undo the last entry, or null. */
  undo(): TownChange[] | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return invertChanges(entry);
  }

  /** Returns the changes to APPLY to redo, or null. */
  redo(): TownChange[] | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return [...entry];
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
