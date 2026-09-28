/**
 * Saving a town photo (WP-19): a plain download everywhere, plus the system share sheet where the
 * browser can share files (iOS Safari saves to Photos only through "Share → Save Image").
 * Both must run inside a click handler (user activation), which is why the preview has buttons.
 */
import { PHOTO_MIME } from './photoLayout';

export function photoFile(blob: Blob, fileName: string): File {
  return new File([blob], fileName, { type: PHOTO_MIME });
}

export function canSharePhoto(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

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

/** 'cancelled' when the player closed the share sheet (not an error). */
export async function sharePhoto(file: File): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await navigator.share({ files: [file], title: 'Tiny Town' });
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
