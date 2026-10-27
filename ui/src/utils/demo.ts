/**
 * Check if demo mode is enabled via the URL query parameter ?demo=1.
 * Ordinary startup (including dev mode) is real-project-first.
 */
export function isDemoMode(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('demo') === '1';
  } catch {
    return false;
  }
}
