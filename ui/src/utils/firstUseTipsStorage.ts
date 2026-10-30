/**
 * Storage utility for first-use tutorial tips seen-state.
 * Stored per screen in localStorage under a single namespaced key.
 * Missing or corrupt values are treated strictly as "not seen".
 */

export type ScreenId = 'home' | 'entrance' | 'replay' | 'replayHistory';

export const FIRST_USE_TIPS_STORAGE_KEY = 'faultmesh:first_use_tips:seen';

export interface SeenState {
  home?: boolean;
  entrance?: boolean;
  replay?: boolean;
  replayHistory?: boolean;
}

export function getSeenState(): SeenState {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {};
    }
    const raw = window.localStorage.getItem(FIRST_USE_TIPS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SeenState;
    }
    return {};
  } catch {
    // Missing or corrupt value means not seen
    return {};
  }
}

export function isScreenTipSeen(screen: ScreenId): boolean {
  const state = getSeenState();
  return Boolean(state[screen] === true);
}

export function markScreenTipSeen(screen: ScreenId): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const current = getSeenState();
    current[screen] = true;
    window.localStorage.setItem(FIRST_USE_TIPS_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Graceful fallback if storage fails
  }
}

export function resetScreenTipSeen(screen: ScreenId): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const current = getSeenState();
    delete current[screen];
    window.localStorage.setItem(FIRST_USE_TIPS_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Graceful fallback
  }
}
