/**
 * Saving a town photo (WP-19): a plain download. It runs inside the preview's Download click (user
 * activation). No share sheet (owner decision); on iOS a download goes to Files, and a long press on
 * the preview image still offers "Save to Photos".
 */

export function downloadPhoto(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers read the URL after click() returns; free it well after.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
