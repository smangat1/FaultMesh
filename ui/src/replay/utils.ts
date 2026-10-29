/**
 * Safe in-memory decoding and formatting utilities for Replay exports.
 * Strictly offline, zero cloud, zero execution.
 */

/**
 * Safely decodes base64 encoded bytes to UTF-8 text in memory.
 * Does not write to disk or access filesystem.
 */
export function decodeBase64ToUtf8(b64: string): string {
  if (!b64) return '';
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(b64, 'base64').toString('utf-8');
    }
    const binString = atob(b64);
    const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0) || 0);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

/**
 * Computes SHA-256 hex digest of raw base64 string bytes.
 */
export async function computeBase64Sha256(b64: string): Promise<string> {
  const binString = atob(b64);
  const bytes = Uint8Array.from(binString, (m) => m.codePointAt(0) || 0);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Escapes untrusted text to prevent XSS / HTML injection.
 */
export function escapeUntrustedText(text: string | null | undefined): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Formats ISO timestamp to quiet time format (e.g. HH:MM:SS).
 */
export function formatReplayTime(isoString: string | null | undefined): string {
  if (!isoString) return '--:--:--';
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return isoString;
  }
}

/**
 * Formats bytes into human-readable size (e.g. 1.2 KB, 4.5 MB).
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
