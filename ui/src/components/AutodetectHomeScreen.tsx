import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  FolderOpen as FolderOpenIcon,
  ArrowRight,
  ArrowLeft,
  Terminal,
  Copy,
  Check,
  AlertCircle,
  FileText,
  Layers,
  Info,
  Search,
  X,
} from 'lucide-react';
import type {
  HistoryPromptSummary,
  HistoryRoot,
  HistorySearchResult,
  HistorySession,
} from '../spectate/types';
import type { RunSummary } from '../types';
import { FirstUseTipOverlay, SCREEN_DEFAULT_STEPS } from './FirstUseTipOverlay';
import { isScreenTipSeen } from '../utils/firstUseTipsStorage';
import { WatchProjectPrompt } from './WatchProjectPrompt';
import type { ProjectChoice } from '../spectate/types';
import {
  dismissHomeWatchPrompt,
  isHomeWatchPromptDismissed,
} from '../utils/replayProjectLinksStorage';

export interface AutodetectHomeScreenProps {
  onSelectProject: () => void | Promise<ProjectChoice | null>;
  isBusy?: boolean;
  hasBridge: boolean;
  statusNote?: string | null;
  activeRun?: RunSummary | null;
  onReturnToWorkspace?: () => void;
  onOpenRecording?: () => void;
  onImportSession?: (
    sessionId: string,
    tool: string,
    focusSequence?: number,
    source?: 'history' | 'replay_store',
  ) => Promise<void>;
  cachedRoots?: HistoryRoot[] | null;
  cachedSessions?: HistorySession[] | null;
  onCacheHistory?: (roots: HistoryRoot[], sessions: HistorySession[]) => void;
  expandedFolderKeys?: Set<string>;
  onToggleFolderExpanded?: (key: string) => void;
  selectedTool?: string | null;
  onSelectTool?: (tool: string | null) => void;
  initialSelectedTool?: string | null;
  showWatchProjectPrompt?: boolean;
}

export function formatRelativeTime(isoString?: string | null): string {
  if (!isoString) return '';
  try {
    const timestamp = new Date(isoString).getTime();
    if (Number.isNaN(timestamp)) return isoString;
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return isoString;
  }
}

export function formatToolDisplayName(tool: string): string {
  if (tool === 'codex') return 'Codex';
  if (tool === 'claude_code') return 'Claude Code';
  return tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface DatedHistorySessions {
  key: string;
  label: string;
  sessions: HistorySession[];
}

export function groupSessionsByLocalDate(
  sessions: HistorySession[],
  now: Date = new Date(),
): DatedHistorySessions[] {
  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const todayKey = dayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = dayKey(yesterday);
  const groups = new Map<string, DatedHistorySessions>();
  for (const session of sessions) {
    const parsed = new Date(session.started_at || session.ended_at);
    const valid = !Number.isNaN(parsed.getTime());
    const key = valid ? dayKey(parsed) : 'unknown-date';
    const label = !valid
      ? 'Date unavailable'
      : key === todayKey
      ? 'Today'
      : key === yesterdayKey
      ? 'Yesterday'
      : parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const group = groups.get(key) || { key, label, sessions: [] };
    group.sessions.push(session);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

export function sanitizeParentDirectory(parent?: string | null): string | null {
  if (!parent || !parent.trim()) return null;
  const trimmed = parent.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (trimmed === '~' || trimmed === '/' || !trimmed) return null;
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  // Never leak home directory paths (e.g. /Users/sam, /home/ubuntu)
  if (parts.length <= 2 && (parts[0] === 'Users' || parts[0] === 'home')) return null;
  const last = parts[parts.length - 1];
  if (last === '~' || last === 'Users' || last === 'home' || last === 'root') return null;
  if (last.startsWith('~')) return null;
  return last;
}

export const AutodetectHomeScreen: React.FC<AutodetectHomeScreenProps> = ({
  onSelectProject,
  isBusy = false,
  hasBridge,
  statusNote = null,
  activeRun = null,
  onReturnToWorkspace,
  onOpenRecording,
  onImportSession,
  cachedRoots = null,
  cachedSessions = null,
  onCacheHistory,
  expandedFolderKeys: externalExpandedKeys,
  onToggleFolderExpanded,
  selectedTool: propSelectedTool,
  onSelectTool,
  initialSelectedTool = null,
  showWatchProjectPrompt = false,
}) => {
  const [internalSelectedTool, setInternalSelectedTool] = useState<string | null>(initialSelectedTool);
  const activeTool = propSelectedTool !== undefined ? propSelectedTool : internalSelectedTool;
  const [showTips, setShowTips] = useState<boolean>(() => !isScreenTipSeen('home'));
  const [showWatchPrompt, setShowWatchPrompt] = useState<boolean>(() => (
    showWatchProjectPrompt && !isHomeWatchPromptDismissed()
  ));

  const handleDismissWatchPrompt = useCallback(() => {
    dismissHomeWatchPrompt();
    setShowWatchPrompt(false);
  }, []);

  const handleChooseWatchProject = useCallback(async () => {
    const selected = await onSelectProject();
    if (selected) {
      dismissHomeWatchPrompt();
      setShowWatchPrompt(false);
    }
  }, [onSelectProject]);

  const handleSelectTool = useCallback(
    (tool: string | null) => {
      if (onSelectTool) {
        onSelectTool(tool);
      } else {
        setInternalSelectedTool(tool);
      }
    },
    [onSelectTool]
  );

  useEffect(() => {
    if (!activeTool) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleSelectTool(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, handleSelectTool]);

  const [internalExpandedKeys, setInternalExpandedKeys] = useState<Set<string>>(() => new Set());
  const expandedKeys = externalExpandedKeys ?? internalExpandedKeys;

  const toggleFolder = useCallback(
    (folderKey: string) => {
      if (onToggleFolderExpanded) {
        onToggleFolderExpanded(folderKey);
      } else {
        setInternalExpandedKeys((prev) => {
          const next = new Set(prev);
          if (next.has(folderKey)) {
            next.delete(folderKey);
          } else {
            next.add(folderKey);
          }
          return next;
        });
      }
    },
    [onToggleFolderExpanded]
  );

  const [roots, setRoots] = useState<HistoryRoot[]>(cachedRoots || []);
  const [sessions, setSessions] = useState<HistorySession[]>(cachedSessions || []);
  const [isLoading, setIsLoading] = useState<boolean>(!cachedRoots);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [importingSessionId, setImportingSessionId] = useState<string | null>(null);
  const [importError, setImportError] = useState<{ sessionId: string; message: string } | null>(null);
  const [playgroundExpanded, setPlaygroundExpanded] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [showHiddenByTool, setShowHiddenByTool] = useState<Record<string, boolean>>({});
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(() => new Set());
  const [promptsBySession, setPromptsBySession] = useState<Record<string, HistoryPromptSummary[]>>({});
  const [promptLoadingIds, setPromptLoadingIds] = useState<Set<string>>(() => new Set());
  const [promptErrors, setPromptErrors] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<HistorySearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRequestRef = useRef(0);

  const isMacDesktop =
    typeof navigator !== 'undefined' &&
    /Electron/i.test(navigator.userAgent) &&
    (/Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent));

  const hasHistoryBridge = Boolean(
    typeof window !== 'undefined' &&
      window.faultmeshSpectate &&
      typeof window.faultmeshSpectate.listHistory === 'function'
  );

  const fetchHistory = useCallback(async () => {
    if (!hasHistoryBridge) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setDiscoveryError(null);
    try {
      const res = await window.faultmeshSpectate!.listHistory!();
      setRoots(res.roots || []);
      setSessions(res.sessions || []);
      if (onCacheHistory) {
        onCacheHistory(res.roots || [], res.sessions || []);
      }
      // By default expand all discovered folders on first load if none set
      if (expandedKeys.size === 0 && res.sessions?.length) {
        const initialKeys = new Set<string>();
        for (const s of res.sessions) {
          initialKeys.add(`${s.tool}:${s.project_group_key}`);
        }
        if (onToggleFolderExpanded) {
          initialKeys.forEach((k) => onToggleFolderExpanded(k));
        } else {
          setInternalExpandedKeys(initialKeys);
        }
      }
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [hasHistoryBridge, onCacheHistory, expandedKeys.size, onToggleFolderExpanded]);

  useEffect(() => {
    if (!cachedRoots && hasHistoryBridge) {
      fetchHistory();
    } else {
      setIsLoading(false);
    }
  }, [cachedRoots, hasHistoryBridge, fetchHistory]);

  useEffect(() => {
    const onSearchShortcut = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof Element
        && target.matches('input, textarea, [contenteditable="true"]')
      ) return;
      event.preventDefault();
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', onSearchShortcut);
    return () => window.removeEventListener('keydown', onSearchShortcut);
  }, []);

  useEffect(() => {
    const query = searchQuery.trim();
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    if (!query) {
      setSearchResult(null);
      setSearchError(null);
      setSearchLoading(false);
      return undefined;
    }
    const bridge = window.faultmeshSpectate;
    if (!bridge?.searchHistory) {
      setSearchResult(null);
      setSearchLoading(false);
      setSearchError('Local history search is available in the desktop app.');
      return undefined;
    }
    setSearchLoading(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      void bridge.searchHistory!(query).then((result) => {
        if (searchRequestRef.current !== requestId) return;
        setSearchResult(result);
        setSearchLoading(false);
      }).catch((error: unknown) => {
        if (searchRequestRef.current !== requestId) return;
        setSearchResult(null);
        setSearchError(error instanceof Error ? error.message : String(error));
        setSearchLoading(false);
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const handlePromptClick = async (
    sessionId: string,
    tool: string,
    focusSequence?: number,
    source: 'history' | 'replay_store' = 'history',
  ) => {
    if (importingSessionId || !onImportSession) return;
    setImportingSessionId(sessionId);
    setImportError(null);
    try {
      await onImportSession(sessionId, tool, focusSequence, source);
    } catch (err) {
      setImportError({
        sessionId,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setImportingSessionId(null);
    }
  };

  const toggleSession = async (session: HistorySession) => {
    const isExpanded = expandedSessionIds.has(session.session_id);
    setExpandedSessionIds((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(session.session_id);
      else next.add(session.session_id);
      return next;
    });
    if (isExpanded || promptsBySession[session.session_id]) return;
    const bridge = window.faultmeshSpectate;
    if (!bridge?.listPrompts) {
      setPromptsBySession((current) => ({
        ...current,
        [session.session_id]: [{
          prompt_id: `fallback:${session.session_id}`,
          first_line: session.first_prompt_preview,
          start_sequence: 1,
          end_sequence: 1,
          changed_files: [],
          changed_file_count: 0,
          started_at: session.started_at,
          ended_at: session.ended_at,
          test_observation: 'not_observed',
          grouping: 'recorded_events',
        }],
      }));
      return;
    }
    setPromptLoadingIds((current) => new Set(current).add(session.session_id));
    setPromptErrors((current) => {
      const next = { ...current };
      delete next[session.session_id];
      return next;
    });
    try {
      const result = await bridge.listPrompts(session.session_id, session.tool);
      setPromptsBySession((current) => ({ ...current, [session.session_id]: result.prompts }));
    } catch (error) {
      setPromptErrors((current) => ({
        ...current,
        [session.session_id]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setPromptLoadingIds((current) => {
        const next = new Set(current);
        next.delete(session.session_id);
        return next;
      });
    }
  };

  const handleCopyCmd = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText('cp -r examples/vscode_playground ~/Desktop/faultmesh-playground');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Split roots into ok, unreadable, and missing
  const okRoots = useMemo(() => roots.filter((r) => r.status === 'ok'), [roots]);
  const unreadableRoots = useMemo(() => roots.filter((r) => r.status === 'unreadable'), [roots]);
  const missingRoots = useMemo(() => roots.filter((r) => r.status === 'missing'), [roots]);

  // Group sessions by (tool, project_group_key)
  const groupedByTool = useMemo(() => {
    const map = new Map<
      string,
      {
        groupKey: string;
        displayName: string;
        parentDirectory: string | null;
        isSystemTemp: boolean;
        sessions: HistorySession[];
        latestTime: number;
      }[]
    >();

    for (const root of okRoots) {
      const toolSessions = sessions.filter((s) => s.tool === root.tool);
      const projectMap = new Map<string, HistorySession[]>();

      for (const s of toolSessions) {
        const list = projectMap.get(s.project_group_key) || [];
        list.push(s);
        projectMap.set(s.project_group_key, list);
      }

      const projects = Array.from(projectMap.entries()).map(([groupKey, sessList]) => {
        // Sort sessions newest first with stable session_id tie break
        const sortedSessions = [...sessList].sort((a, b) => {
          const tA = new Date(a.started_at || a.ended_at).getTime() || 0;
          const tB = new Date(b.started_at || b.ended_at).getTime() || 0;
          if (tB !== tA) return tB - tA;
          return a.session_id.localeCompare(b.session_id);
        });

        const latestTime = sortedSessions.length > 0 ? new Date(sortedSessions[0].started_at || sortedSessions[0].ended_at).getTime() || 0 : 0;
        const displayName = sortedSessions[0]?.project_display_name || groupKey;
        const isSystemTemp = sortedSessions.some((s) => s.project_visibility === 'system_temp');
        const rawParentSession = sortedSessions.find(
          (s) => s.project_parent_name || s.parent_display_name || s.parent_directory || s.parent_dir
        );
        const parentDirectory = sanitizeParentDirectory(
          rawParentSession?.project_parent_name ||
          rawParentSession?.parent_display_name ||
          rawParentSession?.parent_directory ||
          rawParentSession?.parent_dir
        );

        return {
          groupKey,
          displayName,
          parentDirectory,
          isSystemTemp,
          sessions: sortedSessions,
          latestTime,
        };
      });

      // Sort projects by newest session first
      projects.sort((a, b) => b.latestTime - a.latestTime);

      map.set(root.tool, projects);
    }

    return map;
  }, [okRoots, sessions]);

  // Keyboard navigation within widgets
  const handleWidgetKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const focusable = Array.from(
        e.currentTarget.querySelectorAll<HTMLElement>('[tabindex="0"]')
      );
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      if (e.key === 'ArrowDown') {
        const next = (currentIndex + 1) % focusable.length;
        focusable[next]?.focus();
      } else {
        const prev = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
        focusable[prev]?.focus();
      }
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: '#101114',
        color: '#f8fafc',
        fontFamily: 'var(--font-sans)',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      {/* 42px Draggable Titlebar for Mac / Desktop Window Dragging */}
      <div
        data-testid="startup-titlebar"
        style={{
          height: '42px',
          width: '100%',
          flexShrink: 0,
          // @ts-expect-error WebkitAppRegion
          WebkitAppRegion: 'drag',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: isMacDesktop ? '78px' : '16px',
          paddingRight: '16px',
          boxSizing: 'border-box',
        }}
      />

      {/* Main Container */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '1280px',
          width: '100%',
          margin: '0 auto',
          padding: '0 24px 32px 24px',
          boxSizing: 'border-box',
          gap: '24px',
        }}
      >
        {/* Header Section */}
        <div
          data-testid="autodetect-home-header"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            borderBottom: '1px solid #1e2430',
            paddingBottom: '20px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 className="faultmesh-wordmark" style={{ margin: 0 }}>
                FaultMesh
              </h1>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#94a3b8',
                  backgroundColor: '#1e2638',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  letterSpacing: '0.02em',
                }}
              >
                Local sessions
              </span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: '13px',
                color: 'var(--text-secondary)',
                lineHeight: '1.4',
              }}
            >
              Recorded coding sessions found on this machine.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="first-use-help-btn"
              data-testid="home-help-tips-btn"
              onClick={() => setShowTips(true)}
              title="First-use guide (?)"
              aria-label="First-use guide"
            >
              ?
            </button>
            {hasHistoryBridge && (
              <button
                data-testid="autodetect-refresh-btn"
                onClick={fetchHistory}
                disabled={isLoading}
                className="btn-ghost"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid #262f3f',
                  backgroundColor: '#151922',
                  color: '#f8fafc',
                  cursor: isLoading ? 'wait' : 'pointer',
                }}
                aria-label="Refresh discovered sessions"
                title="Rescan local roots for recorded sessions"
              >
                <RefreshCw size={13} className={isLoading ? 'animate-spin' : undefined} />
                <span>{isLoading ? 'Scanning…' : 'Refresh'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="history-search-shell" data-testid="history-search-shell">
          <Search size={16} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="text"
            inputMode="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search prompts, session titles, and changed files"
            aria-label="Search recorded sessions"
            data-testid="history-search-input"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
          />
          {searchLoading && <RefreshCw size={14} className="animate-spin" aria-label="Searching" />}
          {searchQuery && !searchLoading && (
            <button
              type="button"
              className="history-search-clear"
              aria-label="Clear history search"
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
          <kbd aria-hidden="true">/</kbd>
        </div>

        {/* Discovery Error */}
        {discoveryError && (
          <div
            data-testid="autodetect-discovery-error"
            style={{
              padding: '12px 16px',
              backgroundColor: 'var(--accent-muted)',
              border: '1px solid var(--border-focus)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-primary)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <span>Discovery error: {discoveryError}</span>
            <button
              onClick={fetchHistory}
              style={{
                background: 'none',
                border: 'none',
                color: '#ffffff',
                textDecoration: 'underline',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Body Content */}
        {searchQuery.trim() ? (
          <section className="history-search-results" data-testid="history-search-results">
            <header>
              <div>
                <h2>Search results</h2>
                <p>
                  {searchLoading
                    ? 'Searching the local prompt index…'
                    : `${searchResult?.match_count ?? 0} matching ${(searchResult?.match_count ?? 0) === 1 ? 'prompt' : 'prompts'}`}
                </p>
              </div>
              {searchResult && (
                <span>{searchResult.indexed_session_count} indexed sessions</span>
              )}
            </header>
            {searchError && (
              <div className="history-search-state is-error" role="alert">
                Search unavailable: {searchError}
              </div>
            )}
            {searchLoading && !searchResult && (
              <div className="history-search-state" role="status">
                <RefreshCw size={16} className="animate-spin" />
                Searching recorded sessions…
              </div>
            )}
            {!searchLoading && !searchError && searchResult?.sessions.length === 0 && (
              <div className="history-search-empty" data-testid="history-search-empty">
                <Search size={22} aria-hidden="true" />
                <strong>No matching prompts</strong>
                <span>
                  Try a session title, a file name, or a phrase from a prompt. Newly discovered
                  sessions are indexed quietly in the background.
                </span>
              </div>
            )}
            {!searchError && searchResult?.sessions.map((session) => (
              <article
                key={`${session.tool}:${session.session_id}`}
                className="history-search-session"
                data-testid={`history-search-session-${session.session_id}`}
              >
                <div className="history-search-session-heading">
                  <div>
                    <strong>{session.title}</strong>
                    <span>{formatToolDisplayName(session.tool)} · {session.project_display_name}</span>
                  </div>
                  <time dateTime={session.ended_at}>{formatRelativeTime(session.ended_at)}</time>
                </div>
                <div className="history-search-prompts">
                  {session.prompts.map((prompt) => {
                    const matchedPaths = prompt.matched_in.includes('changed_file')
                      ? prompt.changed_files.filter((path) => (
                        path.toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase())
                      ))
                      : prompt.changed_files;
                    return (
                      <button
                        type="button"
                        key={`${prompt.prompt_id}:${prompt.start_sequence}`}
                        className="history-search-prompt"
                        data-testid={`history-search-prompt-${session.session_id}-${prompt.start_sequence}`}
                        disabled={importingSessionId !== null}
                        onClick={() => void handlePromptClick(
                          session.session_id,
                          session.tool,
                          prompt.start_sequence,
                          session.source,
                        )}
                      >
                        <span className="history-search-prompt-copy">
                          <strong>{prompt.first_line || 'Prompt preview unavailable'}</strong>
                          <span>
                            {matchedPaths.length > 0
                              ? matchedPaths.slice(0, 3).join(' · ')
                              : prompt.changed_file_count === 0
                              ? 'No recorded file changes'
                              : `${prompt.changed_file_count} ${prompt.changed_file_count === 1 ? 'file' : 'files'} changed`}
                          </span>
                        </span>
                        <ArrowRight size={15} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </article>
            ))}
          </section>
        ) : !hasHistoryBridge ? (
          /* Empty State: No Desktop Bridge */
          <div
            data-testid="autodetect-no-bridge-empty-state"
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              backgroundColor: '#151922',
              border: '1px solid #262f3f',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '14px',
            }}
          >
            <Layers size={36} color="#64748b" />
            <div style={{ maxWidth: '440px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 6px 0', color: '#f8fafc' }}>
              Local sessions are available in the FaultMesh desktop app
              </h2>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                FaultMesh automatically indexes local Codex and Claude Code sessions when running inside the desktop app. In the browser, you can open any exported recording (.json) directly below.
              </p>
            </div>
          </div>
        ) : isLoading ? (
          /* Scanning indicator */
          <div
            data-testid="autodetect-scanning-state"
            style={{
              padding: '40px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
            }}
          >
            <RefreshCw size={16} className="animate-spin" />
            <span>Scanning local coding tool history…</span>
          </div>
        ) : okRoots.length === 0 && unreadableRoots.length === 0 ? (
          /* Empty State: No supported roots found */
          <div
            data-testid="autodetect-no-roots-empty-state"
            style={{
              padding: '40px 24px',
              textAlign: 'center',
              backgroundColor: '#151922',
              border: '1px solid #262f3f',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <Layers size={32} color="#64748b" />
            <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0, color: '#f8fafc' }}>
              No recorded sessions found
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '420px', lineHeight: '1.4' }}>
              FaultMesh detected no active Codex or Claude Code history folders on this machine. You can open a recorded export (.json) or watch a Python codebase live.
            </p>
          </div>
        ) : activeTool !== null ? (
          /* Full-Screen Tool Sessions View */
          (() => {
            const root = okRoots.find((r) => r.tool === activeTool) || {
              tool: activeTool,
              status: 'ok',
              file_count: 0,
              message: null,
            };
            const allProjects = groupedByTool.get(root.tool) || [];
            const totalSessions = allProjects.reduce((acc, p) => acc + p.sessions.length, 0);
            const isShowingHidden = Boolean(showHiddenByTool[root.tool]);
            const hiddenCount = allProjects.filter((p) => p.isSystemTemp).length;
            const visibleProjects = isShowingHidden
              ? allProjects
              : allProjects.filter((p) => !p.isSystemTemp);

            const nameCounts = new Map<string, number>();
            for (const p of visibleProjects) {
              nameCounts.set(p.displayName, (nameCounts.get(p.displayName) || 0) + 1);
            }

            return (
              <div
                data-testid={`tool-fullscreen-${root.tool}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  width: '100%',
                }}
              >
                {/* Back button and tool bar */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    paddingBottom: '12px',
                    borderBottom: '1px solid #1e2430',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      type="button"
                      data-testid="back-to-tools-btn"
                      onClick={() => handleSelectTool(null)}
                      className="btn-ghost"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        fontSize: '12px',
                        color: '#94a3b8',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid #262f3f',
                        backgroundColor: '#151922',
                        cursor: 'pointer',
                      }}
                      aria-label="Back to detected tools"
                    >
                      <ArrowLeft size={14} />
                      <span>All Tools</span>
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff' }}>
                        {formatToolDisplayName(root.tool)}
                      </span>
                      {root.tool === 'claude_code' && (
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            padding: '1px 6px',
                            backgroundColor: '#232b3b',
                            color: '#94a3b8',
                            borderRadius: '4px',
                            border: '1px solid #334155',
                          }}
                        >
                          Synthetic contract only
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      data-testid={`tool-file-count-${root.tool}`}
                      style={{
                        fontSize: '11.5px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {root.file_count} source {root.file_count === 1 ? 'file' : 'files'}
                    </span>
                    <span
                      data-testid={`tool-session-count-${root.tool}`}
                      style={{
                        fontSize: '11.5px',
                        fontWeight: 600,
                        backgroundColor: '#202738',
                        color: 'var(--accent)',
                        padding: '2px 8px',
                        borderRadius: '10px',
                      }}
                    >
                      {totalSessions} {totalSessions === 1 ? 'session' : 'sessions'}
                    </span>
                  </div>
                </div>

                {/* Full-Screen Tool Card with all folders and sessions */}
                <div
                  data-testid={`tool-widget-${root.tool}`}
                  onKeyDown={handleWidgetKeyDown}
                  style={{
                    backgroundColor: '#151922',
                    border: '1px solid #262f3f',
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Tool Widget Body */}
                  <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {visibleProjects.length === 0 ? (
                      <div
                        data-testid={`tool-no-sessions-${root.tool}`}
                        style={{
                          padding: '24px 12px',
                          textAlign: 'center',
                          color: 'var(--text-muted)',
                          fontSize: '12px',
                        }}
                      >
                        {hiddenCount > 0
                          ? 'All sessions in this tool are inside hidden system folders.'
                          : 'No recorded sessions found for this tool.'}
                      </div>
                    ) : (
                      visibleProjects.map((proj) => {
                        const folderKey = `${root.tool}:${proj.groupKey}`;
                        const isExpanded = expandedKeys.has(folderKey);
                        const isDuplicate = (nameCounts.get(proj.displayName) || 0) > 1;
                        const resolvedDisplayName =
                          isDuplicate && proj.parentDirectory
                            ? `${proj.displayName} / ${proj.parentDirectory}`
                            : proj.displayName;

                        return (
                          <div
                            key={folderKey}
                            data-testid={`project-folder-${folderKey}`}
                            style={{
                              border: '1px solid #1e2638',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: '#10131a',
                              overflow: 'hidden',
                            }}
                          >
                            {/* Folder Header Row */}
                            <button
                              type="button"
                              data-testid={`folder-toggle-${folderKey}`}
                              onClick={() => toggleFolder(folderKey)}
                              tabIndex={0}
                              aria-expanded={isExpanded}
                              style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '10px 12px',
                                background: 'transparent',
                                border: 'none',
                                color: '#f8fafc',
                                cursor: 'pointer',
                                textAlign: 'left',
                                gap: '8px',
                                outline: 'none',
                              }}
                              onKeyDown={(e) => {
                                if (e.key === ' ' || e.key === 'Enter') {
                                  e.preventDefault();
                                  toggleFolder(folderKey);
                                }
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
                                {isExpanded ? (
                                  <ChevronDown size={14} color="#94a3b8" />
                                ) : (
                                  <ChevronRight size={14} color="#94a3b8" />
                                )}
                                {isExpanded ? (
                                  <FolderOpen size={15} color="var(--accent)" />
                                ) : (
                                  <Folder size={15} color="var(--accent)" />
                                )}
                                <span
                                  data-testid="project-folder-name"
                                  style={{
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    color: '#ffffff',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {resolvedDisplayName}
                                </span>
                                {proj.isSystemTemp && (
                                  <span
                                    data-testid="system-temp-badge"
                                    style={{
                                      fontSize: '9.5px',
                                      fontWeight: 500,
                                      padding: '1px 6px',
                                      borderRadius: '3px',
                                      backgroundColor: '#1e2430',
                                      color: '#94a3b8',
                                      border: '1px solid #2d3748',
                                      flexShrink: 0,
                                      letterSpacing: '0.02em',
                                    }}
                                  >
                                    system temp
                                  </span>
                                )}
                              </div>

                              <span
                                style={{
                                  fontSize: '11px',
                                  color: 'var(--text-muted)',
                                  flexShrink: 0,
                                }}
                              >
                                {proj.sessions.length}
                              </span>
                            </button>

                            {/* Collapsible Sessions List */}
                            {isExpanded && (
                              <div
                                data-testid={`folder-sessions-${folderKey}`}
                                style={{
                                  borderTop: '1px solid #1a202c',
                                  padding: '4px 6px 6px 6px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '4px',
                                }}
                              >
                                {groupSessionsByLocalDate(proj.sessions).map((dateGroup) => (
                                  <section
                                    key={dateGroup.key}
                                    data-testid={`date-folder-${folderKey}-${dateGroup.key}`}
                                    className="history-date-folder"
                                  >
                                    <div className="history-date-folder-label">
                                      <Folder size={12} aria-hidden="true" />
                                      <span>{dateGroup.label}</span>
                                    </div>
                                    {dateGroup.sessions.map((sess) => {
                                      const isImporting = importingSessionId === sess.session_id;
                                      const hasError = importError?.sessionId === sess.session_id;
                                      const isSessionExpanded = expandedSessionIds.has(sess.session_id);
                                      const hasSourceTitle = Boolean(sess.source_title?.trim());
                                      const primaryTitle = hasSourceTitle
                                        ? sess.source_title!
                                        : (sess.first_prompt_preview || 'Untitled session');
                                      const promptRows = promptsBySession[sess.session_id] || [];
                                      return (
                                        <div key={sess.session_id} className="history-session-branch">
                                          <button
                                            type="button"
                                            data-testid={`session-row-${sess.session_id}`}
                                            aria-expanded={isSessionExpanded}
                                            onClick={() => void toggleSession(sess)}
                                            onMouseEnter={() => setHoveredSessionId(sess.session_id)}
                                            onMouseLeave={() => setHoveredSessionId(null)}
                                            className={`history-session-row ${hoveredSessionId === sess.session_id ? 'is-hovered' : ''}`}
                                          >
                                            <span className="history-tree-chevron">
                                              {isSessionExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                            </span>
                                            <span className="history-session-copy">
                                              <span data-testid="session-title" title={primaryTitle}>{primaryTitle}</span>
                                              {hasSourceTitle && sess.first_prompt_preview && (
                                                <span data-testid="session-preview-secondary">{sess.first_prompt_preview}</span>
                                              )}
                                              <span className="history-session-meta">
                                                <span data-testid="session-prompt-count">
                                                  {sess.prompt_count} {sess.prompt_count === 1 ? 'prompt' : 'prompts'}
                                                </span>
                                                <span data-testid="session-time" title={sess.started_at || sess.ended_at}>
                                                  {formatRelativeTime(sess.started_at || sess.ended_at)}
                                                </span>
                                                {sess.history_state === 'archived' && (
                                                  <span data-testid="session-history-state-archived">archived</span>
                                                )}
                                                {sess.parse_status !== 'ok' && (
                                                  <span
                                                    data-testid={`session-parse-status-${sess.parse_status}`}
                                                    title={sess.unsupported_reason || 'Incomplete or unsupported structure'}
                                                  >
                                                    {sess.parse_status}
                                                  </span>
                                                )}
                                              </span>
                                            </span>
                                            {isImporting && (
                                              <span className="history-session-busy">
                                                <RefreshCw size={11} className="animate-spin" /> Importing…
                                              </span>
                                            )}
                                          </button>
                                          {isSessionExpanded && (
                                            <div className="history-prompt-list" data-testid={`session-prompts-${sess.session_id}`}>
                                              {promptLoadingIds.has(sess.session_id) && (
                                                <div className="history-prompt-state" role="status">Loading prompts…</div>
                                              )}
                                              {promptErrors[sess.session_id] && (
                                                <div className="history-prompt-state" role="alert">
                                                  Prompt list unavailable: {promptErrors[sess.session_id]}
                                                </div>
                                              )}
                                              {!promptLoadingIds.has(sess.session_id)
                                                && !promptErrors[sess.session_id]
                                                && promptRows.length === 0 && (
                                                <div className="history-prompt-state">No recorded prompts are available.</div>
                                              )}
                                              {promptRows.map((prompt, promptIndex) => (
                                                <button
                                                  type="button"
                                                  key={`${prompt.prompt_id}:${prompt.start_sequence}`}
                                                  className="history-prompt-row"
                                                  data-testid={`prompt-row-${sess.session_id}-${promptIndex}`}
                                                  onClick={() => void handlePromptClick(
                                                    sess.session_id,
                                                    sess.tool,
                                                    prompt.start_sequence,
                                                  )}
                                                >
                                                  <span className="history-prompt-index">{promptIndex + 1}</span>
                                                  <span className="history-prompt-copy">
                                                    <span>{prompt.first_line || 'Prompt preview unavailable'}</span>
                                                    <span>
                                                      {prompt.changed_file_count === 0
                                                        ? 'No recorded file changes'
                                                        : `${prompt.changed_file_count} ${prompt.changed_file_count === 1 ? 'file' : 'files'} changed`}
                                                      {prompt.grouping === 'recorded_events' ? ' · grouped from recorded events' : ''}
                                                    </span>
                                                  </span>
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                          {hasError && (
                                            <div data-testid={`session-import-error-${sess.session_id}`} className="history-prompt-state" role="alert">
                                              <span>Import failed: {importError.message}</span>
                                              <button
                                                type="button"
                                                onClick={() => void handlePromptClick(
                                                  sess.session_id,
                                                  sess.tool,
                                                  promptRows[0]?.start_sequence,
                                                )}
                                              >
                                                Retry
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </section>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}

                    {/* Quiet "Show N hidden system folders" toggle */}
                    {hiddenCount > 0 && (
                      <div
                        style={{
                          padding: '4px 2px 2px 2px',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <button
                          type="button"
                          data-testid={`toggle-hidden-system-${root.tool}`}
                          onClick={() =>
                            setShowHiddenByTool((prev) => ({
                              ...prev,
                              [root.tool]: !prev[root.tool],
                            }))
                          }
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: '4px 6px',
                            color: 'var(--text-muted)',
                            fontSize: '11.5px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            borderRadius: 'var(--radius-sm)',
                          }}
                          aria-label={
                            isShowingHidden
                              ? `Hide ${hiddenCount} hidden system ${hiddenCount === 1 ? 'folder' : 'folders'}`
                              : `Show ${hiddenCount} hidden system ${hiddenCount === 1 ? 'folder' : 'folders'}`
                          }
                        >
                          <span>
                            {isShowingHidden
                              ? `Hide ${hiddenCount} hidden system ${hiddenCount === 1 ? 'folder' : 'folders'}`
                              : `Show ${hiddenCount} hidden system ${hiddenCount === 1 ? 'folder' : 'folders'}`}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                
                </div>
              </div>
            );
          })()
        ) : (
          /* Tool Widgets Grid (Overview Cards) */
          <div
            data-testid="autodetect-widgets-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '20px',
              alignItems: 'start',
            }}
          >
            {okRoots.map((root) => {
              const allProjects = groupedByTool.get(root.tool) || [];
              const totalSessions = allProjects.reduce((acc, p) => acc + p.sessions.length, 0);

              return (
                <div
                  key={root.tool}
                  data-testid={`tool-widget-${root.tool}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectTool(root.tool)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectTool(root.tool);
                    }
                  }}
                  style={{
                    backgroundColor: '#151922',
                    border: '1px solid #262f3f',
                    borderRadius: 'var(--radius-md)',
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s ease, background-color 0.15s ease',
                    minHeight: '170px',
                    outline: 'none',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.backgroundColor = '#181e2b';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#262f3f';
                    e.currentTarget.style.backgroundColor = '#151922';
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '8px',
                            backgroundColor: '#1e2638',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--accent)',
                          }}
                        >
                          {root.tool === 'codex' ? <Terminal size={20} /> : <Layers size={20} />}
                        </div>
                        <span style={{ fontSize: '18px', fontWeight: 600, color: '#ffffff' }}>
                          {formatToolDisplayName(root.tool)}
                        </span>
                      </div>
                      {root.tool === 'claude_code' && (
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            padding: '2px 8px',
                            backgroundColor: '#232b3b',
                            color: '#94a3b8',
                            borderRadius: '4px',
                            border: '1px solid #334155',
                          }}
                        >
                          Synthetic contract only
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span
                        data-testid={`tool-file-count-${root.tool}`}
                        style={{ fontSize: '12px', color: 'var(--text-muted)' }}
                      >
                        {root.file_count} source {root.file_count === 1 ? 'file' : 'files'}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>·</span>
                      <span
                        data-testid={`tool-session-count-${root.tool}`}
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: 'var(--accent)',
                        }}
                      >
                        {totalSessions} {totalSessions === 1 ? 'session' : 'sessions'}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: '20px',
                      paddingTop: '12px',
                      borderTop: '1px solid #1e2533',
                      color: 'var(--accent-strong)',
                      fontSize: '13px',
                      fontWeight: 500,
                    }}
                  >
                    <span>Explore sessions</span>
                    <ArrowRight size={15} />
                  </div>
                </div>
              );
            })}
{/* Unreadable Roots */}
            {unreadableRoots.map((root) => (
              <div
                key={root.tool}
                data-testid={`tool-widget-unreadable-${root.tool}`}
                style={{
                  backgroundColor: '#151922',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertCircle size={16} color="var(--semantic-danger)" />
                  <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--semantic-danger)' }}>
                    {formatToolDisplayName(root.tool)} (Unreadable)
                  </span>
                </div>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  {root.message || 'History directory exists but could not be read.'}
                </p>
                <button
                  onClick={fetchHistory}
                  className="btn-ghost btn-sm"
                  style={{ alignSelf: 'flex-start', fontSize: '11px' }}
                >
                  Retry scan
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Compact Not Found Roots Status */}
        {missingRoots.length > 0 && (
          <div
            data-testid="autodetect-missing-roots-status"
            style={{
              padding: '10px 14px',
              backgroundColor: '#131720',
              border: '1px solid #1e2430',
              borderRadius: 'var(--radius-sm)',
              fontSize: '12px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Info size={14} color="#64748b" />
            <span>
              Not found on this machine: {missingRoots.map((r) => formatToolDisplayName(r.tool)).join(', ')}
            </span>
          </div>
        )}

        {/* Status Note Banner */}
        {statusNote && (
          <div
            style={{
              backgroundColor: '#131720',
              border: '1px solid #1e2430',
              borderRadius: 'var(--radius-sm)',
              padding: '8px 14px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {statusNote}
          </div>
        )}

        {/* Secondary Utilities Area */}
        <div
          data-testid="startup-secondary-utilities"
          style={{
            marginTop: 'auto',
            paddingTop: '20px',
            borderTop: '1px solid #1e2430',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {/* Select Project for live Python watching */}
              <button
                data-testid="startup-select-project-btn"
                onClick={onSelectProject}
                disabled={!hasBridge || isBusy}
                className="btn-primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 18px',
                  fontSize: '13px',
                  fontWeight: 600,
                  borderRadius: 'var(--radius-sm)',
                  cursor: !hasBridge || isBusy ? 'not-allowed' : 'pointer',
                }}
                aria-label="Select project"
              >
                <FolderOpenIcon size={15} />
                <span>{isBusy ? 'Opening…' : 'Select project'}</span>
              </button>

              {/* Open recording (.json) */}
              {onOpenRecording && (
                <button
                  data-testid="startup-open-recording-btn"
                  onClick={onOpenRecording}
                  className="btn-ghost"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    border: '1px solid #262f3f',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: '#151922',
                  }}
                  aria-label="Open recording"
                >
                  <FileText size={14} />
                  <span>Open recording (.json)</span>
                </button>
              )}

              {/* Return to workspace */}
              {activeRun && onReturnToWorkspace && (
                <button
                  onClick={onReturnToWorkspace}
                  className="btn-ghost"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    border: '1px solid #262f3f',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: '#151922',
                  }}
                  aria-label="Return to workspace"
                >
                  <span>Return to workspace ({activeRun.project})</span>
                  <ArrowRight size={13} />
                </button>
              )}
            </div>

            {/* Toggle help / playground instructions */}
            <button
              onClick={() => setPlaygroundExpanded((prev) => !prev)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
              }}
            >
              <Terminal size={13} color="var(--accent)" />
              <span>{playgroundExpanded ? 'Hide playground instructions' : 'Python playground example'}</span>
            </button>
          </div>

          {!hasBridge && (
            <div
              style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                lineHeight: '1.4',
              }}
            >
              Desktop app required to watch local projects
            </div>
          )}

          {/* Collapsible Playground Card */}
          {playgroundExpanded && (
            <div
              data-testid="startup-example-card"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 'var(--radius-sm)',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#f8fafc',
                }}
              >
                <Terminal size={14} color="var(--accent)" />
                <span>No project yet? Try the included example</span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.45',
                }}
              >
                FaultMesh works with Python projects only (it reads your .py files).
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.45',
                }}
              >
                Try FaultMesh with the bundled playground repository in three steps:
              </p>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: '18px',
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.5',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <li>
                  <span>Make a throwaway copy in your terminal:</span>
                  <div
                    style={{
                      backgroundColor: '#0a0d14',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '4px',
                      padding: '6px 10px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '9.5px',
                      color: 'var(--accent)',
                      marginTop: '4px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <code>cp -r examples/vscode_playground ~/Desktop/faultmesh-playground</code>
                    <button
                      onClick={handleCopyCmd}
                      className="btn-ghost btn-sm"
                      style={{
                        padding: '2px 5px',
                        fontSize: '10px',
                        color: copied ? 'var(--semantic-success)' : 'var(--text-muted)',
                        flexShrink: 0,
                        cursor: 'pointer',
                      }}
                      title="Copy to clipboard"
                      aria-label="Copy command"
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </div>
                </li>
                <li>
                  Click <strong>Select project</strong> above and choose the copied folder (<code>faultmesh-playground</code>).
                </li>
                <li>
                  Open and save any edit to a <code>.py</code> file in your editor to see changes appear live.
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>

      <WatchProjectPrompt
        open={showWatchPrompt}
        hasBridge={hasBridge}
        busy={isBusy}
        onChoose={() => void handleChooseWatchProject()}
        onDismiss={handleDismissWatchPrompt}
      />

      <FirstUseTipOverlay
        screenId="home"
        steps={SCREEN_DEFAULT_STEPS.home}
        active={showTips}
        onDismiss={() => setShowTips(false)}
      />
    </div>
  );
};
