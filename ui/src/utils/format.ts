/**
 * Formats a duration in milliseconds consistently across all FaultMesh views.
 * Rounds to 1 decimal place if fractional, or integer if whole.
 * e.g., 2.207335 -> "2.2ms", 0 -> "0ms", 420 -> "420ms"
 */
export function formatDurationMs(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || isNaN(ms)) return '0ms';
  if (Number.isInteger(ms)) return `${ms}ms`;
  return `${Number(ms.toFixed(1))}ms`;
}

/**
 * Formats a duration in human-readable units (ms, s, m, h).
 * e.g., 1800000 -> "30m", 900000 -> "15m", 1500 -> "1.5s", 420 -> "420ms"
 */
export function formatDuration(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || isNaN(ms) || ms === 0) return '0ms';
  if (ms >= 3600000) {
    const hours = Math.floor(ms / 3600000);
    const mins = Math.round((ms % 3600000) / 60000);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  if (ms >= 60000) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  if (ms >= 1000) {
    const secs = ms / 1000;
    return `${Number(secs.toFixed(1))}s`;
  }
  if (Number.isInteger(ms)) return `${ms}ms`;
  return `${Number(ms.toFixed(1))}ms`;
}
