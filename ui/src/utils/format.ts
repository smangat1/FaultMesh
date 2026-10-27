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
