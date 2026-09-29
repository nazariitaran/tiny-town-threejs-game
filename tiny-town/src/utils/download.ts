/**
 * A plain file download: the town photo (WP-19) and the town file (WP-21). Call it inside the
 * click that asked for it (user activation). No share sheet (owner decision); on iOS a download goes
 * to Files, and a long press on the photo preview still offers "Save to Photos".
 */

export function downloadBlob(blob: Blob, fileName: string): void {
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
