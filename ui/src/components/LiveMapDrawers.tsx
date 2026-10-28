import React, { useState, useMemo } from 'react';
import type { V3FileNode } from '../import';
import type { LiveFileRecord } from '../spectate/liveState';
import { DiffViewer } from './DiffViewer';
import { X, Search, FileCode, FileDiff, AlertTriangle } from 'lucide-react';

export interface LiveMapDrawersProps {
  activeDrawer: 'none' | 'files' | 'diff';
  onClose: () => void;
  files: V3FileNode[];
  fileHistory: LiveFileRecord[];
  selectedFile: string | null;
  onSelectFile: (file: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.round(diffMin / 60)}h ago`;
}

export const LiveMapDrawers: React.FC<LiveMapDrawersProps> = ({
  activeDrawer,
  onClose,
  files,
  fileHistory,
  selectedFile,
  onSelectFile,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDiffFile, setActiveDiffFile] = useState<string | null>(null);

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
      if (timeA !== timeB) return timeB - timeA;
      return a.path.localeCompare(b.path);
    });
  }, [files, historyMap]);

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return sortedFiles;
    const q = searchQuery.toLowerCase();
    return sortedFiles.filter((f) => f.path.toLowerCase().includes(q));
  }, [sortedFiles, searchQuery]);

  // For diff drawer: resolve which file record to display
  const targetDiffFile = activeDiffFile || selectedFile || fileHistory[0]?.path || null;
  const currentDiffRecord = targetDiffFile ? historyMap.get(targetDiffFile) || null : null;

  if (activeDrawer === 'none') return null;

  return (
    <aside
      data-testid="live-map-drawer"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: activeDrawer === 'diff' ? '420px' : '320px',
        backgroundColor: '#0c0f14',
        borderLeft: '1px solid var(--border-default)',
        boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.45)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
      aria-label={activeDrawer === 'files' ? 'Files Drawer' : 'Diff Drawer'}
    >
      {/* Drawer Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          backgroundColor: '#11141a',
          borderBottom: '1px solid var(--border-default)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {activeDrawer === 'files' ? (
            <FileCode size={13} style={{ color: '#38bdf8' }} />
          ) : (
            <FileDiff size={13} style={{ color: '#38bdf8' }} />
          )}
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: '#f8fafc',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {activeDrawer === 'files' ? 'Watched Files' : 'Diff / Source'}
          </span>
        </div>

        <button
          onClick={onClose}
          className="btn-ghost"
          style={{ padding: '2px 5px', color: 'var(--text-muted)' }}
          title="Collapse drawer"
          aria-label="Collapse drawer"
        >
          <X size={13} />
        </button>
      </div>

      {/* Drawer Body: Files Drawer */}
      {activeDrawer === 'files' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Quick Search */}
          <div
            style={{
              padding: '8px 10px',
              borderBottom: '1px solid var(--border-default)',
              backgroundColor: '#0a0d12',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: '#11141a',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px',
                gap: '4px',
              }}
            >
              <Search size={11} style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter files..."
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

          {/* Files List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {filteredFiles.map((file) => {
              const history = historyMap.get(file.path);
              const isSelected = selectedFile === file.path;
              const isChanged = Boolean(history);
              const diffSec = history ? Math.max(0, (Date.now() - history.timestamp) / 1000) : Infinity;

              let itemBg = 'transparent';
              let accentColor = 'var(--text-secondary)';
              if (isSelected) {
                itemBg = '#1e293b';
                accentColor = '#38bdf8';
              } else if (isChanged) {
                if (diffSec < 45) {
                  itemBg = 'rgba(56, 189, 248, 0.12)';
                  accentColor = '#38bdf8';
                } else {
                  itemBg = 'rgba(56, 189, 248, 0.05)';
                  accentColor = '#7dd3fc';
                }
              }

              return (
                <div
                  key={file.path}
                  onClick={() => onSelectFile(file.path)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '5px 8px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: itemBg,
                    borderLeft: isSelected ? '3px solid #38bdf8' : '3px solid transparent',
                    cursor: 'pointer',
                    gap: '6px',
                  }}
                  title={file.path}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                    <FileCode size={12} style={{ color: accentColor, flexShrink: 0 }} />
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        color: isSelected ? '#f8fafc' : isChanged ? '#e2e8f0' : 'var(--text-primary)',
                        fontWeight: isSelected || isChanged ? 600 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {file.path}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                    {history && (
                      <span
                        style={{
                          fontSize: '9px',
                          color: '#38bdf8',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {formatRelativeTime(history.timestamp)}
                      </span>
                    )}
                    {file.parse_error && (
                      <span title={file.parse_error} style={{ display: 'inline-flex', alignItems: 'center' }}>
                        <AlertTriangle size={10} color="#f87171" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Drawer Body: Diff / Source Drawer */}
      {activeDrawer === 'diff' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '10px' }}>
          {fileHistory.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <select
                value={targetDiffFile || ''}
                onChange={(e) => {
                  setActiveDiffFile(e.target.value);
                  onSelectFile(e.target.value);
                }}
                style={{
                  width: '100%',
                  backgroundColor: '#11141a',
                  border: '1px solid var(--border-default)',
                  color: '#38bdf8',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  padding: '3px 6px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                {fileHistory.map((rec) => (
                  <option key={rec.path} value={rec.path}>
                    {rec.path} ({rec.kind})
                  </option>
                ))}
              </select>
            </div>
          )}

          {currentDiffRecord ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {currentDiffRecord.parseError && (
                <div
                  style={{
                    padding: '6px 8px',
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '4px',
                    color: '#fca5a5',
                    fontSize: '10.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <AlertTriangle size={11} color="#ef4444" />
                  <span>Parse error: {currentDiffRecord.parseError}</span>
                </div>
              )}

              {currentDiffRecord.diff ? (
                <DiffViewer
                  diff={currentDiffRecord.diff}
                  source={currentDiffRecord.source ?? undefined}
                />
              ) : currentDiffRecord.source ? (
                <DiffViewer
                  source={currentDiffRecord.source}
                />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: '11px', padding: '12px', textAlign: 'center' }}>
                  Waiting for source / diff text from live watcher...
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: '11px', padding: '24px', textAlign: 'center' }}>
              No changed files to display. Select a file on the map or edit a file to view its diff.
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
