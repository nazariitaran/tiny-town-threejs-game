/**
 * Pure digit-shortcut mapping (WP-06 owns digits; see 03-architecture.md "Keyboard ownership").
 *   1–9          select the Nth tool of the ACTIVE category (pressing the active tool's digit
 *                again deselects it, like clicking its card again)
 *   Shift + 1–5  switch category (Streets / Homes / Town / Nature / Garden)
 * Uses `event.code` (Digit1…/Numpad1…) so Shift and keyboard layouts don't change the mapping.
 * No DOM here so it can be unit-tested.
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

/** 1..9 for Digit1..Digit9 / Numpad1..Numpad9, else null. */
export function digitOf(code: string): number | null {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return match ? Number(match[1]) : null;
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
