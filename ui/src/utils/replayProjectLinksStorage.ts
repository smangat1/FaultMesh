import type { ProjectChoice } from '../spectate/types';

export const REPLAY_PROJECT_LINKS_STORAGE_KEY = 'faultmesh:replay:project_links:v1';

interface StoredProjectLink {
  handle: string;
  displayName: string;
}

interface ReplayProjectLinkState {
  homePromptDismissed?: boolean;
  dismissedSessionIds?: string[];
  links?: Record<string, StoredProjectLink>;
}

function readState(): ReplayProjectLinkState {
  try {
    const raw = window.localStorage.getItem(REPLAY_PROJECT_LINKS_STORAGE_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as ReplayProjectLinkState
      : {};
  } catch {
    return {};
  }
}

function writeState(state: ReplayProjectLinkState): void {
  try {
    window.localStorage.setItem(REPLAY_PROJECT_LINKS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Prompt persistence is best-effort when storage is unavailable.
  }
}

export function isHomeWatchPromptDismissed(): boolean {
  return readState().homePromptDismissed === true;
}

export function dismissHomeWatchPrompt(): void {
  writeState({ ...readState(), homePromptDismissed: true });
}

export function isSessionProjectLinked(sessionId: string): boolean {
  return Boolean(readState().links?.[sessionId]);
}

export function isSessionWatchPromptDismissed(sessionId: string): boolean {
  return readState().dismissedSessionIds?.includes(sessionId) ?? false;
}

export function dismissSessionWatchPrompt(sessionId: string): void {
  const state = readState();
  const dismissed = new Set(state.dismissedSessionIds ?? []);
  dismissed.add(sessionId);
  writeState({ ...state, dismissedSessionIds: [...dismissed] });
}

export function storeSessionProjectLink(sessionId: string, project: ProjectChoice): void {
  const state = readState();
  writeState({
    ...state,
    links: {
      ...state.links,
      [sessionId]: { handle: project.handle, displayName: project.displayName },
    },
  });
}
