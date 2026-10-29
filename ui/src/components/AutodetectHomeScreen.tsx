import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  FolderOpen as FolderOpenIcon,
  ArrowRight,
  Terminal,
  Copy,
  Check,
  AlertCircle,
  FileText,
  Layers,
  Info,
} from 'lucide-react';
import type { HistoryRoot, HistorySession } from '../spectate/types';
import type { RunSummary } from '../types';

export interface AutodetectHomeScreenProps {
  onSelectProject: () => void;
  isBusy?: boolean;
  hasBridge: boolean;
  statusNote?: string | null;
  activeRun?: RunSummary | null;
  onReturnToWorkspace?: () => void;
  onOpenRecording?: () => void;
  onImportSession?: (sessionId: string, tool: string) => Promise<void>;
  cachedRoots?: HistoryRoot[] | null;
  cachedSessions?: HistorySession[] | null;
  onCacheHistory?: (roots: HistoryRoot[], sessions: HistorySession[]) => void;
  expandedFolderKeys?: Set<string>;
  onToggleFolderExpanded?: (key: string) => void;
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
}) => {
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

  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleSessionClick = async (sessionId: string, tool: string) => {
    if (importingSessionId || !onImportSession) return;
    setImportingSessionId(sessionId);
    setImportError(null);
    try {
      await onImportSession(sessionId, tool);
    } catch (err) {
      setImportError({
        sessionId,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setImportingSessionId(null);
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
              <h1
                style={{
                  fontSize: '26px',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  margin: 0,
                  color: '#ffffff',
                }}
              >
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
                Local Autodetect
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
              Automatically discovers recorded coding sessions from local tools on this machine.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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

        {/* Discovery Error */}
        {discoveryError && (
          <div
            data-testid="autodetect-discovery-error"
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              color: '#fca5a5',
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
        {!hasHistoryBridge ? (
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
                Local session autodetect requires the FaultMesh desktop app
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
              No supported coding tool sessions detected
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '420px', lineHeight: '1.4' }}>
              FaultMesh detected no active Codex or Claude Code history folders on this machine. You can open a recorded export (.json) or watch a Python codebase live.
            </p>
          </div>
        ) : (
          /* Tool Widgets Grid */
          <div
            data-testid="autodetect-widgets-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: '20px',
              alignItems: 'start',
            }}
          >
            {okRoots.map((root) => {
              const allProjects = groupedByTool.get(root.tool) || [];
              const totalSessions = allProjects.reduce((acc, p) => acc + p.sessions.length, 0);
              const isShowingHidden = Boolean(showHiddenByTool[root.tool]);
              const hiddenCount = allProjects.filter((p) => p.isSystemTemp).length;
              const visibleProjects = isShowingHidden
                ? allProjects
                : allProjects.filter((p) => !p.isSystemTemp);

              // Disambiguate duplicate project display names among visible groups within this tool:
              // when two or more visible groups share the same project_display_name,
              // append the parent directory component (e.g. "auth-service / backend");
              // never render a full path or home directory.
              const nameCounts = new Map<string, number>();
              for (const p of visibleProjects) {
                nameCounts.set(p.displayName, (nameCounts.get(p.displayName) || 0) + 1);
              }

              return (
                <div
                  key={root.tool}
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
                  {/* Tool Widget Header */}
                  <div
                    style={{
                      padding: '16px',
                      backgroundColor: '#181d28',
                      borderBottom: '1px solid #262f3f',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px', fontWeight: 600, color: '#ffffff' }}>
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

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        data-testid={`tool-file-count-${root.tool}`}
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {root.file_count} source {root.file_count === 1 ? 'file' : 'files'}
                      </span>
                      <span
                        data-testid={`tool-session-count-${root.tool}`}
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          backgroundColor: '#202738',
                          color: '#38bdf8',
                          padding: '2px 8px',
                          borderRadius: '10px',
                        }}
                      >
                        {totalSessions} {totalSessions === 1 ? 'session' : 'sessions'}
                      </span>
                    </div>
                  </div>

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
                          : 'No recorded sessions found in this root.'}
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
                                  <FolderOpen size={15} color="#38bdf8" />
                                ) : (
                                  <Folder size={15} color="#38bdf8" />
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
                                {proj.sessions.map((sess) => {
                                  const isImporting = importingSessionId === sess.session_id;
                                  const hasError = importError?.sessionId === sess.session_id;
                                  const hasSourceTitle = Boolean(sess.source_title && sess.source_title.trim());
                                  const primaryTitle = hasSourceTitle ? sess.source_title! : (sess.first_prompt_preview || 'Untitled session');

                                  return (
                                    <div
                                      key={sess.session_id}
                                      style={{ display: 'flex', flexDirection: 'column' }}
                                    >
                                      <div
                                        data-testid={`session-row-${sess.session_id}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => handleSessionClick(sess.session_id, sess.tool)}
                                        onMouseEnter={() => setHoveredSessionId(sess.session_id)}
                                        onMouseLeave={() => setHoveredSessionId(null)}
                                        onFocus={() => setHoveredSessionId(sess.session_id)}
                                        onBlur={() => setHoveredSessionId(null)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleSessionClick(sess.session_id, sess.tool);
                                          }
                                        }}
                                        style={{
                                          display: 'flex',
                                          flexDirection: 'column',
                                          gap: '4px',
                                          padding: '8px 10px',
                                          borderRadius: '4px',
                                          backgroundColor: isImporting
                                            ? '#1e2838'
                                            : hoveredSessionId === sess.session_id
                                            ? '#1a2233'
                                            : '#141822',
                                          border: hoveredSessionId === sess.session_id
                                            ? '1px solid #2d3b55'
                                            : '1px solid #1f2736',
                                          cursor: isImporting ? 'wait' : 'pointer',
                                          transition: 'background-color 0.15s ease, border-color 0.15s ease',
                                        }}
                                      >
                                        {/* Session Title */}
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: '8px',
                                          }}
                                        >
                                          <span
                                            data-testid="session-title"
                                            style={{
                                              fontSize: '12.5px',
                                              fontWeight: 500,
                                              color: '#f8fafc',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap',
                                            }}
                                            title={primaryTitle}
                                          >
                                            {primaryTitle}
                                          </span>

                                          {isImporting && (
                                            <span
                                              style={{
                                                fontSize: '11px',
                                                color: '#38bdf8',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                flexShrink: 0,
                                              }}
                                            >
                                              <RefreshCw size={11} className="animate-spin" />
                                              Importing…
                                            </span>
                                          )}
                                        </div>

                                        {/* Secondary Preview Line when source_title is present */}
                                        {hasSourceTitle && sess.first_prompt_preview && (
                                          <div
                                            data-testid="session-preview-secondary"
                                            style={{
                                              fontSize: '11px',
                                              color: 'var(--text-secondary)',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap',
                                              lineHeight: '1.3',
                                            }}
                                            title={sess.first_prompt_preview}
                                          >
                                            {sess.first_prompt_preview}
                                          </div>
                                        )}

                                        {/* Metadata Row */}
                                        <div
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            fontSize: '11px',
                                            color: 'var(--text-muted)',
                                            flexWrap: 'wrap',
                                          }}
                                        >
                                          {/* Prompts Count (Honesty: Prompts, not steps!) */}
                                          <span data-testid="session-prompt-count">
                                            {sess.prompt_count} {sess.prompt_count === 1 ? 'prompt' : 'prompts'}
                                          </span>

                                          <span>•</span>

                                          {/* Time with hover exact timestamp */}
                                          <span
                                            data-testid="session-time"
                                            title={sess.started_at || sess.ended_at}
                                          >
                                            {formatRelativeTime(sess.started_at || sess.ended_at)}
                                          </span>

                                          {/* Archived badge */}
                                          {sess.history_state === 'archived' && (
                                            <span
                                              data-testid="session-history-state-archived"
                                              style={{
                                                fontSize: '9.5px',
                                                fontWeight: 600,
                                                padding: '1px 5px',
                                                borderRadius: '3px',
                                                backgroundColor: '#1f2430',
                                                color: '#94a3b8',
                                                border: '1px solid #2d3748',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.04em',
                                              }}
                                            >
                                              archived
                                            </span>
                                          )}

                                          {/* Parse Status Badge */}
                                          {sess.parse_status !== 'ok' && (
                                            <span
                                              data-testid={`session-parse-status-${sess.parse_status}`}
                                              title={sess.unsupported_reason || 'Incomplete or unsupported structure'}
                                              style={{
                                                fontSize: '9.5px',
                                                fontWeight: 600,
                                                padding: '1px 5px',
                                                borderRadius: '3px',
                                                backgroundColor: sess.parse_status === 'partial' ? 'rgba(234, 179, 8, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                                color: sess.parse_status === 'partial' ? '#fde047' : '#fca5a5',
                                                border: sess.parse_status === 'partial' ? '1px solid rgba(234, 179, 8, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.04em',
                                              }}
                                            >
                                              {sess.parse_status}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      {/* Inline Import Error */}
                                      {hasError && (
                                        <div
                                          data-testid={`session-import-error-${sess.session_id}`}
                                          style={{
                                            margin: '4px 0',
                                            padding: '6px 10px',
                                            backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                            border: '1px solid rgba(239, 68, 68, 0.3)',
                                            borderRadius: '4px',
                                            fontSize: '11px',
                                            color: '#fca5a5',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: '8px',
                                          }}
                                        >
                                          <span>Import failed: {importError.message}</span>
                                          <button
                                            onClick={() => handleSessionClick(sess.session_id, sess.tool)}
                                            style={{
                                              background: 'none',
                                              border: 'none',
                                              color: '#ffffff',
                                              textDecoration: 'underline',
                                              cursor: 'pointer',
                                              fontSize: '11px',
                                              padding: 0,
                                              flexShrink: 0,
                                            }}
                                          >
                                            Retry
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
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
                  <AlertCircle size={16} color="#f87171" />
                  <span style={{ fontSize: '15px', fontWeight: 600, color: '#f87171' }}>
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
              <Terminal size={13} color="#38bdf8" />
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
                <Terminal size={14} color="#38bdf8" />
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
                      color: '#38bdf8',
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
                        color: copied ? '#34d399' : 'var(--text-muted)',
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
    </div>
  );
};
