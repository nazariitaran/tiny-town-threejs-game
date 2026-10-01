/**
 * Keyboard shortcuts:
 *   1–9          select the Nth tool of the active category; the active tool's digit deselects it
 *   Shift + 1–5  switch category
 *   P            take a photo (no modifiers, so Ctrl/Cmd+P still prints)
 * Uses `event.code` so Shift and keyboard layouts don't change the mapping.
 */
import { TOOL_CATEGORIES, toolsInCategory, type ToolCategory, type ToolId } from '../catalog/tools';

export type DigitAction =
  | { type: 'category'; category: ToolCategory }
  | { type: 'tool'; toolId: ToolId | null }
  | null;

export interface KeyLike {
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export function digitOf(code: string): number | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return match ? Number(match[1]) : null;
}

export function isPhotoKey(key: KeyLike): boolean {
  return key.code === 'KeyP' && !key.ctrlKey && !key.metaKey && !key.altKey && !key.shiftKey;
}

export function digitAction(key: KeyLike, category: ToolCategory, activeTool: ToolId | null): DigitAction {
  if (key.ctrlKey || key.metaKey || key.altKey) return null;
  const digit = digitOf(key.code);
  if (digit === null) return null;
  if (key.shiftKey) {
    const target = TOOL_CATEGORIES[digit - 1];
    return target ? { type: 'category', category: target.id } : null;
  }
  const tool = toolsInCategory(category)[digit - 1];
  if (!tool) return null;
  return { type: 'tool', toolId: tool.id === activeTool ? null : tool.id };
}
