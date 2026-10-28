import React, { useState, useMemo } from 'react';
import type { V3FileNode } from '../import';
import type { LiveFileRecord, LiveSessionStatus } from '../spectate/liveState';
import { Search, FileCode, Layers, FileDiff, AlertTriangle, Clock } from 'lucide-react';

export interface LiveFilesViewProps {
  files: V3FileNode[];
  fileHistory: LiveFileRecord[];
  liveStatus: LiveSessionStatus;
  stopReason?: string | null;
  projectName?: string | null;
  onSelectFile?: (file: string) => void;
  onOpenMap?: (file: string) => void;
  onOpenChanges?: (file: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  return `${diffHours}h ago`;
}

export const LiveFilesView: React.FC<LiveFilesViewProps> = ({
  files,
  fileHistory,
  liveStatus,
  stopReason,
  projectName,
  onSelectFile,
  onOpenMap,
  onOpenChanges,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const historyMap = useMemo(() => {
    const map = new Map<string, LiveFileRecord>();
    for (const record of fileHistory) {
      map.set(record.path, record);
    }
    return map;
  }, [fileHistory]);

  const sortedFiles = useMemo(() => {
    return [...files].sort((a, b) => {
      const recA = historyMap.get(a.path);
      const recB = historyMap.get(b.path);
      const timeA = recA ? recA.timestamp : 0;
      const timeB = recB ? recB.timestamp : 0;
      if (timeA !== timeB) {
        return timeB - timeA; // most recently saved first
      }
      return a.path.localeCompare(b.path);
    });
  }, [files, historyMap]);

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return sortedFiles;
    const q = searchQuery.toLowerCase();
    return sortedFiles.filter((f) => f.path.toLowerCase().includes(q));
  }, [sortedFiles, searchQuery]);

  return (
    <div
      data-testid="live-files-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: '#101114',
        color: 'var(--text-primary)',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Sub-header / Status & Search Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-default)',
          backgroundColor: '#11141a',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2
            style={{
              margin: 0,
              fontSize: '13px',
              fontWeight: 600,
              color: '#f8fafc',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {projectName ? `${projectName} · Watched Files` : 'Watched Files'}
          </h2>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ({files.length} {files.length === 1 ? 'file' : 'files'})
          </span>
          {fileHistory.length > 0 && (
            <span
              style={{
                fontSize: '10px',
                color: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.1)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                padding: '1px 6px',
                borderRadius: '4px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {fileHistory.length} saved this session
            </span>
          )}
        </div>

        {/* Search Input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: '#0d1017',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            padding: '3px 8px',
            gap: '6px',
            width: '240px',
          }}
        >
          <Search size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter files by path..."
            style={{
              background: 'none',
              border: 'none',
              outline: 'none',
              color: '#f8fafc',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              width: '100%',
            }}
          />
        </div>
      </div>

      {/* Stopped status banner if watcher is stopped */}
      {liveStatus === 'stopped' && (
        <div
          style={{
            padding: '6px 16px',
            backgroundColor: 'rgba(100, 116, 139, 0.12)',
            borderBottom: '1px solid rgba(100, 116, 139, 0.25)',
            color: '#cbd5e1',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Clock size={12} style={{ color: 'var(--text-muted)' }} />
          <span>Watcher stopped ({stopReason || 'session ended'}) · displaying last known project files</span>
        </div>
      )}

      {/* Pre-first-snapshot empty state */}
      {files.length === 0 && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px',
            color: 'var(--text-muted)',
            fontSize: '12px',
            gap: '8px',
          }}
        >
          <FileCode size={24} style={{ opacity: 0.5 }} />
          <span>
            {liveStatus === 'live'
              ? 'Waiting for project snapshot...'
              : 'No files recorded in watched project.'}
          </span>
        </div>
      )}

      {/* File List */}
      {files.length > 0 && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {filteredFiles.map((file) => {
            const history = historyMap.get(file.path);
            const isChanged = Boolean(history);
            const diffSec = history ? Math.max(0, (Date.now() - history.timestamp) / 1000) : Infinity;

            // Recency coloring: strongest highlight for most recent, fading with age
            let itemBg = 'transparent';
            let itemBorder = '1px solid var(--border-default)';
            let accentColor = 'var(--text-secondary)';
            let recencyTag: string | null = null;

            if (isChanged && history) {
              if (diffSec < 45) {
                itemBg = 'rgba(56, 189, 248, 0.12)';
                itemBorder = '1px solid rgba(56, 189, 248, 0.4)';
                accentColor = '#38bdf8';
                recencyTag = formatRelativeTime(history.timestamp);
              } else if (diffSec < 180) {
                itemBg = 'rgba(56, 189, 248, 0.06)';
                itemBorder = '1px solid rgba(56, 189, 248, 0.2)';
                accentColor = '#7dd3fc';
                recencyTag = formatRelativeTime(history.timestamp);
              } else {
                itemBg = 'rgba(148, 163, 184, 0.05)';
                itemBorder = '1px solid rgba(148, 163, 184, 0.15)';
                accentColor = '#94a3b8';
                recencyTag = formatRelativeTime(history.timestamp);
              }
            }

            return (
              <div
                key={file.path}
                onClick={() => onSelectFile?.(file.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 12px',
                  backgroundColor: itemBg,
                  border: itemBorder,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'background-color 0.1s ease',
                  gap: '12px',
                }}
              >
                {/* File info */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <FileCode size={13} style={{ color: accentColor, flexShrink: 0 }} />
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      color: isChanged ? '#f8fafc' : 'var(--text-primary)',
                      fontWeight: isChanged ? 600 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={file.path}
                  >
                    {file.path}
                  </span>

                  {/* Parse error pill if broken */}
                  {file.parse_error && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        fontSize: '10px',
                        color: '#f87171',
                        backgroundColor: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '3px',
                        padding: '1px 5px',
                        flexShrink: 0,
                      }}
                      title={file.parse_error}
                    >
                      <AlertTriangle size={10} />
                      parse error
                    </span>
                  )}
                </div>

                {/* Meta & Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  {recencyTag && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontFamily: 'var(--font-mono)',
                        color: accentColor,
                        backgroundColor: 'rgba(15, 23, 42, 0.6)',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        border: `1px solid ${accentColor}33`,
                      }}
                    >
                      {recencyTag}
                    </span>
                  )}

                  <span
                    style={{
                      fontSize: '10.5px',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {file.line_count} {file.line_count === 1 ? 'line' : 'lines'}
                  </span>

                  {onOpenMap && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenMap(file.path);
                      }}
                      className="btn-ghost btn-sm"
                      style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        color: 'var(--text-secondary)',
                      }}
                      title="Center on Map"
                    >
                      <Layers size={11} />
                      <span>Map</span>
                    </button>
                  )}

                  {onOpenChanges && isChanged && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenChanges(file.path);
                      }}
                      className="btn-ghost btn-sm"
                      style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        color: '#38bdf8',
                      }}
                      title="View Diff / Changes"
                    >
                      <FileDiff size={11} />
                      <span>Diff</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
