import React, { useState, useMemo } from 'react';
import type { LiveFileRecord, LiveSessionStatus } from '../spectate/liveState';
import { DiffViewer } from './DiffViewer';
import { FileDiff, FileCode, Layers, AlertTriangle, Clock } from 'lucide-react';

export interface LiveChangesViewProps {
  fileHistory: LiveFileRecord[];
  liveStatus: LiveSessionStatus;
  stopReason?: string | null;
  selectedFilePath?: string | null;
  onSelectFilePath?: (path: string) => void;
  onOpenMap?: (path: string) => void;
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

export const LiveChangesView: React.FC<LiveChangesViewProps> = ({
  fileHistory,
  liveStatus,
  stopReason,
  selectedFilePath,
  onSelectFilePath,
  onOpenMap,
}) => {
  const [internalSelectedPath, setInternalSelectedPath] = useState<string | null>(null);

  // Active path: prefer prop if set and present in history, else internal, else first item
  const activePath = useMemo(() => {
    if (selectedFilePath && fileHistory.some((f) => f.path === selectedFilePath)) {
      return selectedFilePath;
    }
    if (internalSelectedPath && fileHistory.some((f) => f.path === internalSelectedPath)) {
      return internalSelectedPath;
    }
    return fileHistory[0]?.path || null;
  }, [fileHistory, selectedFilePath, internalSelectedPath]);

  const activeRecord = useMemo(() => {
    if (!activePath) return null;
    return fileHistory.find((f) => f.path === activePath) || null;
  }, [fileHistory, activePath]);

  const handleSelect = (path: string) => {
    setInternalSelectedPath(path);
    onSelectFilePath?.(path);
  };

  return (
    <div
      data-testid="live-changes-view"
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
      {/* Sub-header / Summary */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          borderBottom: '1px solid var(--border-default)',
          backgroundColor: '#11141a',
          gap: '12px',
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
            Observed Changes
          </h2>
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ({fileHistory.length} {fileHistory.length === 1 ? 'file' : 'files'} changed on disk)
          </span>
        </div>
      </div>

      {/* 1-Line First-Run Help Banner */}
      <div
        data-testid="changes-help-banner"
        style={{
          padding: '6px 16px',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>
          Changes lists files modified on disk during this session and their line diffs. Save any .py file in your editor to see changes appear here.
        </span>
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
          <span>Watcher stopped ({stopReason || 'session ended'}) · displaying last known changes</span>
        </div>
      )}

      {/* Empty State: No changes yet */}
      {fileHistory.length === 0 && (
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
            textAlign: 'center',
          }}
        >
          <FileDiff size={28} style={{ opacity: 0.5 }} />
          <span style={{ fontWeight: 600, color: '#f8fafc' }}>No file changes observed yet</span>
          <span style={{ maxWidth: '360px', lineHeight: '1.5' }}>
            {liveStatus === 'live'
              ? 'Saving a file in the watched project directory will display its source diff here in real time.'
              : 'No file modifications recorded in this watch session.'}
          </span>
        </div>
      )}

      {/* Two-Column Master / Detail View */}
      {fileHistory.length > 0 && (
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          {/* Left Column: Changed Files List */}
          <div
            style={{
              width: '280px',
              borderRight: '1px solid var(--border-default)',
              backgroundColor: '#0c0e12',
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--text-secondary)',
                borderBottom: '1px solid var(--border-default)',
              }}
            >
              Changed Files
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '6px' }}>
              {fileHistory.map((rec) => {
                const isSelected = rec.path === activePath;
                return (
                  <div
                    key={rec.path}
                    onClick={() => handleSelect(rec.path)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '6px 8px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                      border: isSelected ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid transparent',
                      cursor: 'pointer',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                      <span
                        style={{
                          fontSize: '11.5px',
                          fontFamily: 'var(--font-mono)',
                          color: isSelected ? '#38bdf8' : 'var(--text-primary)',
                          fontWeight: isSelected ? 600 : 400,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={rec.path}
                      >
                        {rec.path}
                      </span>
                      <span
                        style={{
                          fontSize: '9.5px',
                          color: isSelected ? '#38bdf8' : 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                          flexShrink: 0,
                        }}
                      >
                        {formatRelativeTime(rec.timestamp)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span
                        style={{
                          fontSize: '9px',
                          textTransform: 'uppercase',
                          fontWeight: 700,
                          padding: '0 4px',
                          borderRadius: '2px',
                          backgroundColor:
                            rec.kind === 'created'
                              ? 'rgba(16, 185, 129, 0.2)'
                              : rec.kind === 'deleted'
                              ? 'rgba(239, 68, 68, 0.2)'
                              : 'rgba(245, 158, 11, 0.2)',
                          color:
                            rec.kind === 'created'
                              ? '#34d399'
                              : rec.kind === 'deleted'
                              ? '#f87171'
                              : 'var(--change-modified)',
                        }}
                      >
                        {rec.kind}
                      </span>
                      {rec.parseError && (
                        <span
                          style={{
                            fontSize: '9px',
                            color: '#f87171',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '2px',
                          }}
                        >
                          <AlertTriangle size={9} />
                          syntax error
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Diff / Source Viewer */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              overflowY: 'auto',
              padding: '14px 16px',
              backgroundColor: '#101114',
              gap: '12px',
            }}
          >
            {activeRecord ? (
              <>
                {/* Active File Header */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: '10px',
                    borderBottom: '1px solid var(--border-default)',
                    flexWrap: 'wrap',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <FileCode size={16} style={{ color: '#38bdf8', flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: '13px',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        color: '#f8fafc',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {activeRecord.path}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                        color: 'var(--change-modified)',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {activeRecord.kind}
                    </span>
                  </div>

                  {onOpenMap && (
                    <button
                      onClick={() => onOpenMap(activeRecord.path)}
                      className="btn-ghost btn-sm"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                      }}
                      title="View file cluster on Map"
                    >
                      <Layers size={12} />
                      <span>View on Map</span>
                    </button>
                  )}
                </div>

                {/* Parse Error Notice if file broke during edit */}
                {activeRecord.parseError && (
                  <div
                    style={{
                      padding: '8px 12px',
                      backgroundColor: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: 'var(--radius-sm)',
                      color: '#fca5a5',
                      fontSize: '11.5px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
                      <AlertTriangle size={13} color="#ef4444" />
                      <span>Python Syntax / Parse Error</span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: '#fecaca' }}>
                      {activeRecord.parseError}
                    </div>
                  </div>
                )}

                {/* DiffViewer: Unified / Split Diff or Source */}
                {activeRecord.diff ? (
                  <div style={{ flex: 1 }}>
                    <DiffViewer
                      diff={activeRecord.diff}
                      source={activeRecord.source ?? undefined}
                    />
                  </div>
                ) : activeRecord.source ? (
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        marginBottom: '6px',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      Source (new file content)
                    </div>
                    <DiffViewer
                      source={activeRecord.source}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '24px',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '11.5px',
                    }}
                  >
                    File changed on disk. Waiting for source/diff fact arrival...
                  </div>
                )}
              </>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                }}
              >
                Select a file from the left to inspect its diff.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
