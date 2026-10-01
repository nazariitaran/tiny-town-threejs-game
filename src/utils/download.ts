/** Call inside the click that asked for it (user activation). On iOS the file goes to Files. */
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
