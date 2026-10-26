import React, { useState, useEffect } from 'react';
import type {
  CodeNode,
  TestItem,
  FileCluster,
  PinnedSymbol,
  GraphEdge,
} from '../types';
import { DiffViewer } from './DiffViewer';
import {
  X,
  Pin,
  PinOff,
  Code2,
  GitCommit,
  CheckCircle2,
  XCircle,
  AlertOctagon,
  SkipForward,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Clock,
} from 'lucide-react';

export interface InspectorDrawerProps {
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  selectedTestId: string | null;
  onSelectTest: (testId: string | null) => void;
  selectedFile: string | null;
  onSelectFile: (file: string | null) => void;
  nodes: CodeNode[];
  edges: GraphEdge[];
  tests: TestItem[];
  files?: FileCluster[];
  pinnedSymbols: PinnedSymbol[];
  onPinSymbol?: (symbol: PinnedSymbol) => void;
  onUnpinSymbol?: (symbolId: string) => void;
  onClose: () => void;
}

export const InspectorDrawer: React.FC<InspectorDrawerProps> = ({
  selectedNodeId,
  onSelectNode,
  selectedTestId,
  onSelectTest,
  selectedFile,
  onSelectFile,
  nodes,
  edges,
  tests,
  files = [],
  pinnedSymbols,
  onPinSymbol,
  onUnpinSymbol,
  onClose,
}) => {
  const [activeCodeTab, setActiveCodeTab] = useState<'source' | 'diff'>('source');
  const [isTracebackOpen, setIsTracebackOpen] = useState(true);

  // Esc key listener to dismiss drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Determine active item
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedTest = tests.find((t) => t.id === selectedTestId) || null;
  const currentFile = files.find((f) => f.file === selectedFile) || null;

  // Sync active code tab when node changes
  useEffect(() => {
    if (selectedNode?.gitDiff) {
      setActiveCodeTab('diff');
    } else {
      setActiveCodeTab('source');
    }
  }, [selectedNode?.id, selectedNode?.gitDiff]);

  // If nothing is selected, do not render drawer
  if (!selectedNode && !selectedTest && !currentFile) {
    return null;
  }

  // Check if current node is pinned
  const isPinned = selectedNode ? pinnedSymbols.some((p) => p.id === selectedNode.id) : false;

  const handleTogglePin = () => {
    if (!selectedNode) return;
    if (isPinned) {
      onUnpinSymbol?.(selectedNode.id);
    } else {
      onPinSymbol?.({
        id: selectedNode.id,
        name: selectedNode.name,
        file: selectedNode.file,
        kind: selectedNode.kind,
        changeStatus: selectedNode.changeStatus,
        description: selectedNode.description,
      });
    }
  };

  return (
    <aside
      aria-label="Inspector Drawer"
      style={{
        width: '400px',
        maxWidth: '90vw',
        height: '100%',
        backgroundColor: '#111722',
        borderLeft: '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        zIndex: 30,
        boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* ================= MODE 1: SYMBOL INSPECTOR ================= */}
      {selectedNode ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          {/* 1. Identity Header */}
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border-default)',
              backgroundColor: '#161f2e',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: '#1e293b',
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                  }}
                >
                  {selectedNode.kind}
                </span>

                <span className={`badge-change ${selectedNode.changeStatus}`}>
                  {selectedNode.changeStatus}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  onClick={handleTogglePin}
                  className={`btn-secondary btn-sm ${isPinned ? 'active' : ''}`}
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    backgroundColor: isPinned ? 'rgba(56, 189, 248, 0.15)' : undefined,
                    borderColor: isPinned ? '#38bdf8' : undefined,
                    color: isPinned ? '#38bdf8' : undefined,
                  }}
                  title={isPinned ? 'Remove from pinned shortlist' : 'Pin to shortlist'}
                  aria-label={isPinned ? `Unpin ${selectedNode.name}` : `Pin ${selectedNode.name}`}
                >
                  {isPinned ? <PinOff size={11} /> : <Pin size={11} />}
                  <span>{isPinned ? 'Pinned' : 'Pin'}</span>
                </button>

                <button
                  onClick={onClose}
                  className="btn-ghost btn-sm"
                  title="Close inspector (Esc)"
                  aria-label="Close inspector"
                >
                  <X size={13} />
                </button>
              </div>
            </div>

            <div
              style={{
                fontSize: '14px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: '#f8fafc',
                wordBreak: 'break-all',
              }}
            >
              {selectedNode.name}
            </div>

            <div
              onClick={() => onSelectFile(selectedNode.file)}
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                marginTop: '3px',
                cursor: 'pointer',
              }}
              title={`View ${selectedNode.file} cluster`}
            >
              {selectedNode.file}:{selectedNode.lineStart}-{selectedNode.lineEnd}
            </div>
          </div>

          {/* Body Content */}
          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
            {/* 2. What it does (Role explanation) */}
            <div
              style={{
                backgroundColor: '#131b28',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '4px',
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--text-secondary)',
                  }}
                >
                  What It Does
                </span>
                <span
                  style={{
                    fontSize: '9px',
                    color: '#94a3b8',
                    padding: '1px 4px',
                    backgroundColor: '#1e293b',
                    borderRadius: '2px',
                  }}
                >
                  Sample description
                </span>
              </div>

              <p
                style={{
                  fontSize: '12px',
                  lineHeight: '1.5',
                  color: selectedNode.description ? 'var(--text-primary)' : 'var(--text-muted)',
                  margin: 0,
                }}
              >
                {selectedNode.description || 'Description unavailable in fixture sample.'}
              </p>
            </div>

            {/* 3. Source Viewer & Diff */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <div style={{ display: 'flex', gap: '4px' }}>
                  {selectedNode.gitDiff && (
                    <button
                      onClick={() => setActiveCodeTab('diff')}
                      className={`btn-ghost btn-sm ${activeCodeTab === 'diff' ? 'active' : ''}`}
                      style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        color: activeCodeTab === 'diff' ? 'var(--change-modified)' : undefined,
                        fontWeight: activeCodeTab === 'diff' ? 700 : 400,
                      }}
                    >
                      <GitCommit size={11} /> Unified Diff
                    </button>
                  )}
                  <button
                    onClick={() => setActiveCodeTab('source')}
                    className={`btn-ghost btn-sm ${activeCodeTab === 'source' ? 'active' : ''}`}
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      fontWeight: activeCodeTab === 'source' ? 700 : 400,
                    }}
                  >
                    <Code2 size={11} /> Source Code (L{selectedNode.lineStart}-{selectedNode.lineEnd})
                  </button>
                </div>
              </div>

              {activeCodeTab === 'diff' && selectedNode.gitDiff ? (
                <DiffViewer diff={selectedNode.gitDiff} />
              ) : selectedNode.sourceSnippet ? (
                <DiffViewer
                  source={selectedNode.sourceSnippet}
                  lineStart={selectedNode.lineStart}
                />
              ) : (
                <div style={{ padding: '12px', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
                  Source snippet unavailable.
                </div>
              )}
            </div>

            {/* 4. Relationships (Static Structure vs Observed Call Edges) */}
            <div>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                Relationships
              </div>

              {/* Static Callees / Callers */}
              {(() => {
                const staticEdges = edges.filter(
                  (e) =>
                    (e.category === 'static_call' || e.category === 'static_import') &&
                    (e.source === selectedNode.id || e.target === selectedNode.id)
                );

                const observedTestEdges = edges.filter(
                  (e) =>
                    e.category === 'runtime_observed' &&
                    selectedTest &&
                    e.testIds?.includes(selectedTest.id) &&
                    (e.source === selectedNode.id || e.target === selectedNode.id)
                );

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {/* Observed Calls for selected test */}
                    {selectedTest && (
                      <div
                        style={{
                          backgroundColor: '#0f172a',
                          border: '1px solid rgba(56, 189, 248, 0.3)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '8px 10px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '10px',
                            fontWeight: 700,
                            color: '#38bdf8',
                            marginBottom: '4px',
                            textTransform: 'uppercase',
                          }}
                        >
                          Observed in {selectedTest.name} ({observedTestEdges.length})
                        </div>
                        {observedTestEdges.length === 0 ? (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                            No observed call edges recorded for this symbol during {selectedTest.name}.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {observedTestEdges.map((e) => {
                              const isOutbound = e.source === selectedNode.id;
                              const other = isOutbound ? e.target : e.source;
                              return (
                                <button
                                  key={e.id}
                                  onClick={() => onSelectNode(other)}
                                  className="btn-ghost"
                                  style={{
                                    textAlign: 'left',
                                    padding: '3px 6px',
                                    fontSize: '11px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    backgroundColor: '#1e293b',
                                  }}
                                  title={other}
                                >
                                  <span style={{ color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                                    {isOutbound ? '→ calls' : '← called by'} {other.split('::').pop()}
                                  </span>
                                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                    {other.split('::')[0]}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Static Relationships */}
                    <div
                      style={{
                        backgroundColor: '#131b28',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '8px 10px',
                      }}
                    >
                      <div
                        style={{
                          fontSize: '10px',
                          fontWeight: 700,
                          color: 'var(--text-secondary)',
                          marginBottom: '4px',
                          display: 'flex',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span>Static Structure (Sample)</span>
                        <span style={{ color: 'var(--text-muted)' }}>{staticEdges.length} links</span>
                      </div>
                      {staticEdges.length === 0 ? (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          No static relationships recorded.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          {staticEdges.map((e) => {
                            const isOutbound = e.source === selectedNode.id;
                            const other = isOutbound ? e.target : e.source;
                            return (
                              <button
                                key={e.id}
                                onClick={() => onSelectNode(other)}
                                className="btn-ghost"
                                style={{
                                  textAlign: 'left',
                                  padding: '3px 6px',
                                  fontSize: '11px',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                }}
                                title={other}
                              >
                                <span style={{ fontFamily: 'var(--font-mono)' }}>
                                  {isOutbound ? '→' : '←'} {other.split('::').pop()}
                                </span>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                  {e.category === 'static_import' ? 'import' : 'call'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 5. Test Evidence (Coverage) */}
            <div>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                Observed Coverage
              </div>

              {(() => {
                const exercisingTests = tests.filter((t) =>
                  t.exercisedNodeIds.includes(selectedNode.id)
                );

                if (exercisingTests.length === 0) {
                  return (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      Not recorded as covered in any executed test run.
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {exercisingTests.map((t) => {
                      const isHighlighted = t.id === selectedTestId;
                      return (
                        <button
                          key={t.id}
                          onClick={() => onSelectTest(isHighlighted ? null : t.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '4px 8px',
                            backgroundColor: isHighlighted ? '#1e293b' : '#131b28',
                            border: '1px solid var(--border-default)',
                            borderRadius: 'var(--radius-sm)',
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                          title={`Click to highlight ${t.name}`}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                backgroundColor:
                                  t.status === 'fail'
                                    ? 'var(--status-fail)'
                                    : t.status === 'error'
                                    ? 'var(--status-error)'
                                    : 'var(--status-pass)',
                              }}
                            />
                            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
                              {t.name}
                            </span>
                          </div>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            {t.durationMs}ms
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      ) : selectedTest ? (
        /* ================= MODE 2: TEST INSPECTOR ================= */
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          {/* Header */}
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border-default)',
              backgroundColor: '#161f2e',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className={`badge-status ${selectedTest.status}`}>
                  {selectedTest.status === 'pass' && <CheckCircle2 size={11} />}
                  {selectedTest.status === 'fail' && <XCircle size={11} />}
                  {selectedTest.status === 'error' && <AlertOctagon size={11} />}
                  {selectedTest.status === 'skipped' && <SkipForward size={11} />}
                  {selectedTest.status.toUpperCase()}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Clock size={11} /> {selectedTest.durationMs}ms
                </span>
              </div>

              <button
                onClick={onClose}
                className="btn-ghost btn-sm"
                title="Close inspector"
                aria-label="Close inspector"
              >
                <X size={13} />
              </button>
            </div>

            <div
              style={{
                fontSize: '13px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: '#f8fafc',
                wordBreak: 'break-all',
              }}
            >
              {selectedTest.name}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                marginTop: '2px',
              }}
            >
              {selectedTest.file}
            </div>
          </div>

          {/* Test Body */}
          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
            {/* Failure Message & Traceback */}
            {selectedTest.failureMessage && (
              <div
                style={{
                  backgroundColor: 'var(--status-fail-bg)',
                  border: '1px solid var(--status-fail-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                }}
              >
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    color: 'var(--status-fail)',
                    marginBottom: '4px',
                    textTransform: 'uppercase',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <XCircle size={12} /> Failure Message
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    lineHeight: '1.4',
                    color: '#f8fafc',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {selectedTest.failureMessage}
                </div>

                {selectedTest.traceback && (
                  <div style={{ marginTop: '8px', borderTop: '1px solid rgba(239, 68, 68, 0.2)', paddingTop: '6px' }}>
                    <button
                      onClick={() => setIsTracebackOpen(!isTracebackOpen)}
                      className="btn-ghost btn-sm"
                      style={{ padding: '2px 0', fontSize: '11px', color: 'var(--text-secondary)' }}
                      aria-expanded={isTracebackOpen}
                    >
                      {isTracebackOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      Python Traceback ({selectedTest.traceback.split('\n').length} lines)
                    </button>

                    {isTracebackOpen && (
                      <pre
                        style={{
                          marginTop: '6px',
                          backgroundColor: '#0a0d14',
                          border: '1px solid var(--border-default)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '8px 10px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '10px',
                          lineHeight: '1.4',
                          overflowX: 'auto',
                          color: '#e2e8f0',
                        }}
                      >
                        {selectedTest.traceback}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Recorded Replay Comparison */}
            {selectedTest.rerunHistory && selectedTest.rerunHistory.length > 0 && (
              <div
                style={{
                  backgroundColor: '#131b28',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                }}
              >
                <div
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                    marginBottom: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <RotateCcw size={11} /> Recorded Replay Comparison ({selectedTest.rerunHistory.length} trials)
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {selectedTest.rerunHistory.map((r, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#161f2e',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>Trial #{r.rerunIndex}: {r.status.toUpperCase()}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {r.failureFingerprint || `${r.durationMs}ms`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Exercised Symbols */}
            <div>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                Exercised Symbols ({selectedTest.exercisedNodeIds.length})
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {selectedTest.exercisedNodeIds.map((nodeId) => {
                  const nodeObj = nodes.find((n) => n.id === nodeId);
                  return (
                    <button
                      key={nodeId}
                      onClick={() => onSelectNode(nodeId)}
                      className="btn-ghost"
                      style={{
                        textAlign: 'left',
                        padding: '4px 6px',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)' }}>
                        {nodeObj?.name || nodeId.split('::').pop()}
                      </span>
                      {nodeObj?.changeStatus && nodeObj.changeStatus !== 'unchanged' && (
                        <span className={`badge-change ${nodeObj.changeStatus}`}>
                          {nodeObj.changeStatus}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : currentFile ? (
        /* ================= MODE 3: FILE INSPECTOR ================= */
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
          {/* Header */}
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--border-default)',
              backgroundColor: '#161f2e',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: '#1e293b',
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                  }}
                >
                  File Cluster
                </span>
                {currentFile.changeStatus !== 'unchanged' && (
                  <span className={`badge-change ${currentFile.changeStatus}`}>
                    {currentFile.changeStatus}
                  </span>
                )}
              </div>

              <button onClick={onClose} className="btn-ghost btn-sm" title="Close inspector">
                <X size={13} />
              </button>
            </div>

            <div
              style={{
                fontSize: '14px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: '#f8fafc',
              }}
            >
              {currentFile.name}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                marginTop: '2px',
              }}
            >
              {currentFile.file} • {currentFile.lineCount} lines
            </div>
          </div>

          {/* File Symbols List */}
          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
            <div>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                Symbols in File ({currentFile.symbolCount})
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {nodes
                  .filter((n) => n.file === currentFile.file)
                  .map((sym) => (
                    <button
                      key={sym.id}
                      onClick={() => onSelectNode(sym.id)}
                      className="btn-ghost"
                      style={{
                        textAlign: 'left',
                        padding: '4px 6px',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{sym.name}</span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        L{sym.lineStart}-{sym.lineEnd}
                      </span>
                    </button>
                  ))}
              </div>
            </div>

            {/* Tests Touching this File */}
            <div>
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  marginBottom: '6px',
                }}
              >
                Tests Touching This File
              </div>

              {(() => {
                const fileSymbols = new Set(
                  nodes.filter((n) => n.file === currentFile.file).map((n) => n.id)
                );
                const touchingTests = tests.filter((t) =>
                  t.exercisedNodeIds.some((id) => fileSymbols.has(id))
                );

                if (touchingTests.length === 0) {
                  return (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      No executed tests touched this file.
                    </div>
                  );
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {touchingTests.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => onSelectTest(t.id)}
                        className="btn-ghost"
                        style={{
                          textAlign: 'left',
                          padding: '4px 6px',
                          fontSize: '11px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{t.name}</span>
                        <span className={`badge-status ${t.status}`}>{t.status}</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
};
