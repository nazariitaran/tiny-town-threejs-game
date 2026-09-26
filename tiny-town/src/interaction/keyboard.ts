/** Shared keyboard guards for ToolController / CameraController (WP-05). */

/** True when a key event should go to a text field / editable element, not the game. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  // Buttons-as-inputs don't take text; sliders/checkboxes still own arrow keys and space.
  const type = (element as HTMLInputElement).type;
  return type !== 'button' && type !== 'submit' && type !== 'reset';
}
