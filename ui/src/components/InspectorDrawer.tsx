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
  Bot,
  Sparkles,
  FileCode,
  ArrowRightLeft,
} from 'lucide-react';
import type { AgentPhase, PhaseEvidenceItem } from '../agent/agentSimulation';
import {
  AGENT_EXPLANATION,
  AGENT_ACTIVE_FILES,
  AGENT_ORIGINAL_SNIPPET,
  AGENT_PATCHED_SNIPPET,
} from '../agent/agentSimulation';

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
  collapsedFiles?: Set<string>;
  onToggleCollapseFile?: (file: string) => void;
  pinnedSymbols: PinnedSymbol[];
  onPinSymbol?: (symbol: PinnedSymbol) => void;
  onUnpinSymbol?: (symbolId: string) => void;
  onClose: () => void;
  isAgentActive?: boolean;
  agentPhase?: AgentPhase;
  agentPhaseEvidence?: PhaseEvidenceItem | null;
  agentPatchedSnippet?: string | null;
  agentPatchedDiff?: string | null;
  onReplayInvestigation?: () => void;
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
  collapsedFiles = new Set(),
  onToggleCollapseFile,
  pinnedSymbols,
  onPinSymbol,
  onUnpinSymbol,
  onClose,
  isAgentActive = false,
  agentPhase = 'idle',
  agentPhaseEvidence,
  agentPatchedSnippet,
  agentPatchedDiff,
  onReplayInvestigation,
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

  // Sync active code tab when node changes or candidate patch is active
  useEffect(() => {
    if (selectedNode?.gitDiff || (isAgentActive && agentPhase === 'patching') || agentPatchedDiff) {
      setActiveCodeTab('diff');
    } else {
      setActiveCodeTab('source');
    }
  }, [selectedNode?.id, selectedNode?.gitDiff, isAgentActive, agentPhase, agentPatchedDiff]);

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
      className="inspector-drawer"
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
            {/* 2. What it does / Grounded Metadata */}
            {selectedNode.description ? (
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
                    color: 'var(--text-primary)',
                    margin: 0,
                  }}
                >
                  {selectedNode.description}
                </p>
              </div>
            ) : (
              <div
                style={{
                  backgroundColor: '#131b28',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: '#38bdf8',
                    }}
                  >
                    Grounded Metadata (V3)
                  </span>
                  {selectedNode.isGhost && (
                    <span
                      style={{
                        fontSize: '9px',
                        color: '#f87171',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        padding: '1px 5px',
                        borderRadius: '2px',
                      }}
                    >
                      Ghost (Base-side)
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '11px', lineHeight: 1.4 }}>
                  {selectedNode.signature && (
                    <div>
                      <span style={{ color: '#94a3b8', fontWeight: 600 }}>Signature: </span>
                      <code style={{ color: '#e2e8f0', fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>
                        {selectedNode.signature}
                      </code>
                    </div>
                  )}

                  <div>
                    <span style={{ color: '#94a3b8', fontWeight: 600 }}>Docstring: </span>
                    <span style={{ color: selectedNode.docstringFirstLine ? '#cbd5e1' : 'var(--text-muted)', fontStyle: selectedNode.docstringFirstLine ? 'italic' : 'normal' }}>
                      {selectedNode.docstringFirstLine ? `"${selectedNode.docstringFirstLine}"` : 'None in export'}
                    </span>
                  </div>

                  {selectedNode.parameterNames && selectedNode.parameterNames.length > 0 && (
                    <div>
                      <span style={{ color: '#94a3b8', fontWeight: 600 }}>Parameters: </span>
                      <span style={{ color: '#cbd5e1', fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>
                        {selectedNode.parameterNames.join(', ')}
                      </span>
                    </div>
                  )}

                  {selectedNode.bases && selectedNode.bases.length > 0 && (
                    <div>
                      <span style={{ color: '#94a3b8', fontWeight: 600 }}>Bases: </span>
                      <span style={{ color: '#cbd5e1', fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>
                        {selectedNode.bases.join(', ')}
                      </span>
                    </div>
                  )}

                  {selectedNode.decorators && selectedNode.decorators.length > 0 && (
                    <div>
                      <span style={{ color: '#94a3b8', fontWeight: 600 }}>Decorators: </span>
                      <span style={{ color: '#cbd5e1', fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>
                        {selectedNode.decorators.map((d) => `@${d}`).join(' ')}
                      </span>
                    </div>
                  )}

                  <div>
                    <span style={{ color: '#94a3b8', fontWeight: 600 }}>Static Edges: </span>
                    <span style={{ color: '#cbd5e1' }}>
                      {edges.filter((e) => e.target === selectedNode.id && !e.id.startsWith('containment:')).length} incoming · {edges.filter((e) => e.source === selectedNode.id && !e.id.startsWith('containment:')).length} outgoing
                    </span>
                  </div>

                  {selectedNode.contentHash && (
                    <div>
                      <span style={{ color: '#94a3b8', fontWeight: 600 }}>SHA-256: </span>
                      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                        {selectedNode.contentHash.slice(0, 16)}…
                      </span>
                    </div>
                  )}

                  {/* Test coverage summary if tests are loaded */}
                  {(() => {
                    const executingTests = tests.filter((t) => t.exercisedNodeIds?.includes(selectedNode.id));
                    return (
                      <div>
                        <span style={{ color: '#94a3b8', fontWeight: 600 }}>Test Coverage: </span>
                        <span style={{ color: executingTests.length > 0 ? '#34d399' : 'var(--text-muted)' }}>
                          {executingTests.length > 0
                            ? `Executed by ${executingTests.length} test${executingTests.length > 1 ? 's' : ''}`
                            : 'No executed coverage recorded'}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* 3. Active Remediation Files & Real Engineering Explanation (Demo only) */}
            {((isAgentActive) || (selectedNode.description && (selectedNode.id === 'auth/tokens.py::validate_token' || selectedNode.id === 'tests/test_auth.py::test_login_expired_token' || selectedNode.id === 'auth/service.py::login_with_token'))) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {/* Honest Simulation Demarcation Notice */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    fontSize: '10px',
                  }}
                >
                  <span style={{ fontWeight: 600, color: '#38bdf8', fontFamily: 'var(--font-mono)' }}>
                    SAMPLE INVESTIGATION PLAYBACK
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>
                    Simulated Replay
                  </span>
                </div>

                {/* Active Files in Remediation Tab Switcher */}
                <div
                  style={{
                    backgroundColor: '#111722',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#38bdf8' }}>
                      <ArrowRightLeft size={12} />
                      <span>Active Files in Remediation (Swap View)</span>
                    </div>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      3 files linked
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
                    {AGENT_ACTIVE_FILES.map((af) => {
                      const isCurrent = selectedNode.id === af.id;
                      return (
                        <button
                          key={af.id}
                          onClick={() => onSelectNode(af.id)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '3px 8px',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: '11px',
                            fontFamily: 'var(--font-mono)',
                            backgroundColor: isCurrent ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255, 255, 255, 0.04)',
                            color: isCurrent ? '#38bdf8' : 'var(--text-secondary)',
                            border: isCurrent ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                          title={`Inspect ${af.file} (${af.role})`}
                        >
                          <FileCode size={11} style={{ color: isCurrent ? '#38bdf8' : 'var(--text-muted)' }} />
                          <span>{af.file}</span>
                          <span
                            style={{
                              fontSize: '9px',
                              padding: '0 4px',
                              borderRadius: '2px',
                              backgroundColor:
                                af.status === 'defect_site'
                                  ? 'rgba(245, 158, 11, 0.2)'
                                  : af.status === 'regression_test'
                                  ? 'rgba(239, 68, 68, 0.2)'
                                  : 'rgba(100, 116, 139, 0.2)',
                              color:
                                af.status === 'defect_site'
                                  ? '#f59e0b'
                                  : af.status === 'regression_test'
                                  ? '#f87171'
                                  : '#94a3b8',
                              fontWeight: 600,
                            }}
                          >
                            {af.status === 'defect_site' ? 'PATCH' : af.status === 'regression_test' ? 'TEST' : 'CALLER'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Progressive Phase Evidence Item Card (Context-Aware for current step) */}
                {agentPhaseEvidence && (
                  <div
                    style={{
                      backgroundColor: '#121824',
                      border: '1px solid rgba(56, 189, 248, 0.2)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {agentPhaseEvidence.title}
                      </span>
                      <span
                        style={{
                          fontSize: '9px',
                          color: '#38bdf8',
                          backgroundColor: 'rgba(56, 189, 248, 0.15)',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          fontFamily: 'var(--font-mono)',
                          textTransform: 'uppercase',
                        }}
                      >
                        {agentPhase}
                      </span>
                    </div>

                    <p style={{ margin: 0, fontSize: '11px', lineHeight: 1.5, color: '#cbd5e1' }}>
                      {agentPhaseEvidence.summary}
                    </p>

                    {agentPhaseEvidence.bullets && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                        {agentPhaseEvidence.bullets.map((b, idx) => (
                          <div key={idx} style={{ fontSize: '11px', lineHeight: 1.4 }}>
                            <span style={{ fontWeight: 600, color: b.color || '#38bdf8' }}>{b.label}: </span>
                            <span style={{ color: '#94a3b8' }}>{b.text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {agentPhaseEvidence.tracebackSnippet && (
                      <pre
                        style={{
                          margin: '6px 0 0 0',
                          padding: '8px',
                          backgroundColor: 'rgba(0, 0, 0, 0.35)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          borderRadius: '4px',
                          fontSize: '10px',
                          color: '#f87171',
                          overflowX: 'auto',
                          fontFamily: 'var(--font-mono)',
                          lineHeight: 1.4,
                        }}
                      >
                        {agentPhaseEvidence.tracebackSnippet}
                      </pre>
                    )}
                  </div>
                )}

                {/* Deep Real Engineering Explanation Card */}
                <div
                  style={{
                    backgroundColor: '#121720',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Bot size={13} style={{ color: '#38bdf8' }} />
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#f8fafc', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Remediation Explanation & Analysis
                      </span>
                    </div>
                    {agentPhase === 'resolved' && onReplayInvestigation && (
                      <button
                        onClick={onReplayInvestigation}
                        className="btn-ghost btn-sm"
                        style={{ fontSize: '10px', padding: '1px 5px', color: '#10b981' }}
                        title="Replay entire investigation"
                      >
                        <RotateCcw size={10} style={{ marginRight: '3px' }} />
                        Replay
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', lineHeight: 1.5 }}>
                    <div>
                      <span style={{ color: '#f87171', fontWeight: 600 }}>Defect Isolation: </span>
                      <span style={{ color: '#cbd5e1' }}>{AGENT_EXPLANATION.defectSummary}</span>
                    </div>
                    {(agentPhase === 'inspecting' || agentPhase === 'patching' || agentPhase === 'verifying' || agentPhase === 'resolved') && (
                      <div>
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>Root Cause: </span>
                        <span style={{ color: '#cbd5e1' }}>{AGENT_EXPLANATION.rootCause}</span>
                      </div>
                    )}
                    {(agentPhase === 'patching' || agentPhase === 'verifying' || agentPhase === 'resolved') && (
                      <div>
                        <span style={{ color: '#38bdf8', fontWeight: 600 }}>Fix Applied: </span>
                        <span style={{ color: '#cbd5e1' }}>{AGENT_EXPLANATION.remediation}</span>
                      </div>
                    )}
                    {(agentPhase === 'verifying' || agentPhase === 'resolved') && (
                      <div>
                        <span style={{ color: '#34d399', fontWeight: 600 }}>Verification: </span>
                        <span style={{ color: '#cbd5e1' }}>{AGENT_EXPLANATION.verification}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 4. Source Viewer & Diff */}
            <div>
              {/* Active Agent Live Mutation Notice */}
              {isAgentActive && selectedNode.id === 'auth/tokens.py::validate_token' && (
                <div
                  style={{
                    padding: '8px 12px',
                    backgroundColor:
                      agentPhase === 'patching'
                        ? 'rgba(245, 158, 11, 0.15)'
                        : agentPhase === 'resolved'
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'rgba(56, 189, 248, 0.12)',
                    border: `1px solid ${
                      agentPhase === 'patching'
                        ? 'rgba(245, 158, 11, 0.35)'
                        : agentPhase === 'resolved'
                        ? 'rgba(16, 185, 129, 0.35)'
                        : 'rgba(56, 189, 248, 0.3)'
                    }`,
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '11px',
                  }}
                >
                  {agentPhase === 'resolved' ? (
                    <Sparkles size={14} style={{ color: '#10b981', flexShrink: 0 }} />
                  ) : (
                    <Bot
                      size={14}
                      style={{
                        color: agentPhase === 'patching' ? '#f59e0b' : '#38bdf8',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 600, color: '#f8fafc' }}>
                      {agentPhase === 'patching'
                        ? '🤖 Agent actively mutating auth/tokens.py: applying numeric coercion patch...'
                        : agentPhase === 'resolved'
                        ? '✨ Agent Patch Verified: test_login_expired_token Passed'
                        : '🤖 Agent inspecting code structure & AST relationships'}
                    </span>
                    <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                      {agentPhase === 'patching'
                        ? 'Converting string timestamps to float before range check to accept numeric strings.'
                        : agentPhase === 'resolved'
                        ? 'Replay trial #4 confirmed 0 regression failures. Verified green.'
                        : 'Call graph traced from test_login_expired_token.'}
                    </span>
                  </div>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <div style={{ display: 'flex', gap: '4px' }}>
                  {(agentPatchedDiff || selectedNode.gitDiff) && (
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

              {activeCodeTab === 'diff' && (agentPatchedDiff || selectedNode.gitDiff) ? (
                <div style={{ position: 'relative' }}>
                  {isAgentActive && (agentPhase === 'patching' || agentPhase === 'verifying' || agentPhase === 'resolved') && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '6px',
                        right: '8px',
                        zIndex: 10,
                        fontSize: '9px',
                        fontWeight: 700,
                        backgroundColor: 'rgba(245, 158, 11, 0.25)',
                        color: '#f59e0b',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        animation: 'livePatchFlash 1.5s infinite',
                        letterSpacing: '0.03em',
                      }}
                    >
                      DEMONSTRATED CANDIDATE CHANGE
                    </div>
                  )}
                  <DiffViewer
                    diff={agentPatchedDiff || selectedNode.gitDiff || ''}
                    originalSource={
                      selectedNode.id === 'auth/tokens.py::validate_token' || selectedNode.id === 'fn-validate-token'
                        ? AGENT_ORIGINAL_SNIPPET
                        : undefined
                    }
                    candidateSource={
                      selectedNode.id === 'auth/tokens.py::validate_token' || selectedNode.id === 'fn-validate-token'
                        ? AGENT_PATCHED_SNIPPET
                        : undefined
                    }
                    lineStart={selectedNode.lineStart}
                    isCandidatePatch={isAgentActive && agentPhase === 'patching'}
                  />
                </div>
              ) : selectedNode.sourceSnippet || agentPatchedSnippet ? (
                <DiffViewer
                  source={agentPatchedSnippet || selectedNode.sourceSnippet}
                  lineStart={selectedNode.lineStart}
                  originalSource={
                    selectedNode.id === 'auth/tokens.py::validate_token' || selectedNode.id === 'fn-validate-token'
                      ? AGENT_ORIGINAL_SNIPPET
                      : undefined
                  }
                  candidateSource={
                    selectedNode.id === 'auth/tokens.py::validate_token' || selectedNode.id === 'fn-validate-token'
                      ? AGENT_PATCHED_SNIPPET
                      : undefined
                  }
                  diff={agentPatchedDiff || selectedNode.gitDiff || undefined}
                  isCandidatePatch={isAgentActive && agentPhase === 'patching'}
                />
              ) : (
                <div
                  style={{
                    padding: '12px',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    backgroundColor: '#0c1017',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '6px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8', fontWeight: 600 }}>
                      {selectedNode.file}:{selectedNode.lineStart}–{selectedNode.lineEnd}
                    </span>
                    <span className={`badge-change ${selectedNode.changeStatus}`}>
                      {selectedNode.changeStatus}
                    </span>
                  </div>

                  {selectedNode.signature && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: '#e2e8f0', backgroundColor: '#131822', padding: '6px 8px', borderRadius: '3px' }}>
                      {selectedNode.signature}
                    </div>
                  )}

                  {selectedNode.docstringFirstLine && (
                    <div style={{ fontStyle: 'italic', color: '#94a3b8', fontSize: '11px', padding: '2px 0' }}>
                      "{selectedNode.docstringFirstLine}"
                    </div>
                  )}

                  {selectedNode.contentHash && (
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      SHA-256: {selectedNode.contentHash}
                    </div>
                  )}

                  <div
                    style={{
                      fontSize: '11px',
                      color: '#fbbf24',
                      backgroundColor: 'rgba(245, 158, 11, 0.08)',
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                      borderRadius: '4px',
                      padding: '8px 10px',
                      lineHeight: '1.4',
                      marginTop: '2px',
                    }}
                  >
                    source text not included in this export
                  </div>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: '#1e293b',
                    color: '#94a3b8',
                    textTransform: 'uppercase',
                    fontWeight: 600,
                  }}
                >
                  File Cluster
                </span>
                {currentFile.tier && (
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'rgba(59, 130, 246, 0.15)',
                      color: '#60a5fa',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                    }}
                  >
                    {currentFile.tier}
                  </span>
                )}
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
                fontSize: '15px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                color: '#f8fafc',
              }}
            >
              {currentFile.name}
            </div>

            {currentFile.role && (
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#93c5fd',
                  marginTop: '2px',
                }}
              >
                {currentFile.role}
              </div>
            )}

            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                marginTop: '4px',
              }}
            >
              {currentFile.file} • {currentFile.lineCount} lines • {currentFile.symbolCount} symbols
            </div>
          </div>

          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
            {/* Grounded Plain-English Architectural Role & Summary */}
            <div
              style={{
                backgroundColor: '#141a24',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '6px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-secondary)',
                  letterSpacing: '0.04em',
                }}
              >
                Architectural Role & Summary
              </div>
              {currentFile.description ? (
                <p
                  style={{
                    fontSize: '12px',
                    color: '#e2e8f0',
                    lineHeight: '1.5',
                    margin: 0,
                  }}
                >
                  {currentFile.description}
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '11px', color: '#94a3b8' }}>
                  <div>
                    <span style={{ color: '#cbd5e1', fontWeight: 600 }}>File: </span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{currentFile.file}</span>
                  </div>
                  <div>
                    <span style={{ color: '#cbd5e1', fontWeight: 600 }}>Child Symbols: </span>
                    <span>{currentFile.symbolCount}</span>
                  </div>
                  <div>
                    <span style={{ color: '#cbd5e1', fontWeight: 600 }}>Line Count: </span>
                    <span>{currentFile.lineCount}</span>
                  </div>
                  {currentFile.contentHash && (
                    <div>
                      <span style={{ color: '#cbd5e1', fontWeight: 600 }}>SHA-256: </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px' }}>{currentFile.contentHash.slice(0, 16)}…</span>
                    </div>
                  )}
                  {currentFile.gitStatus && (
                    <div>
                      <span style={{ color: '#cbd5e1', fontWeight: 600 }}>Git Status: </span>
                      <span className={`badge-change ${currentFile.changeStatus}`}>{currentFile.gitStatus}</span>
                    </div>
                  )}
                  {currentFile.isGhost && (
                    <div style={{ color: '#f87171', fontSize: '11px' }}>
                      Ghost file: removed in head worktree, present in base revision.
                    </div>
                  )}
                  {currentFile.parseError && (
                    <div style={{ color: '#f87171', fontSize: '11px' }}>
                      Parse error: {currentFile.parseError}
                    </div>
                  )}
                </div>
              )}

              {/* Cluster Map Controls */}
              {onToggleCollapseFile && (
                <div style={{ marginTop: '4px', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <button
                    onClick={() => onToggleCollapseFile(currentFile.file)}
                    className="btn-secondary btn-sm"
                    style={{ width: '100%', justifyContent: 'center', fontSize: '11px' }}
                  >
                    {collapsedFiles.has(currentFile.file)
                      ? 'Expand Cluster in Map (Show Symbols)'
                      : 'Collapse Cluster to Dot'}
                  </button>
                </div>
              )}
            </div>

            {/* Inbound & Outbound File Dependencies */}
            {(() => {
              const inboundFiles = new Set<string>();
              const outboundFiles = new Set<string>();

              edges.forEach((e) => {
                const srcNode = nodes.find((n) => n.id === e.source);
                const tgtNode = nodes.find((n) => n.id === e.target);
                if (srcNode && tgtNode) {
                  if (tgtNode.file === currentFile.file && srcNode.file !== currentFile.file) {
                    inboundFiles.add(srcNode.file);
                  }
                  if (srcNode.file === currentFile.file && tgtNode.file !== currentFile.file) {
                    outboundFiles.add(tgtNode.file);
                  }
                }
              });

              return (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div
                    style={{
                      backgroundColor: '#141a24',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: '6px',
                      padding: '8px 10px',
                    }}
                  >
                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Called By ({inboundFiles.size})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px' }}>
                      {Array.from(inboundFiles).length > 0 ? (
                        Array.from(inboundFiles).map((f) => (
                          <button
                            key={f}
                            onClick={() => onSelectFile(f)}
                            className="btn-ghost"
                            style={{
                              fontSize: '11px',
                              fontFamily: 'var(--font-mono)',
                              padding: '2px 4px',
                              textAlign: 'left',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: '#93c5fd',
                            }}
                            title={f}
                          >
                            {f.split('/').pop()}
                          </button>
                        ))
                      ) : (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>None (Ingress)</span>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: '#141a24',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: '6px',
                      padding: '8px 10px',
                    }}
                  >
                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Calls ({outboundFiles.size})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '4px' }}>
                      {Array.from(outboundFiles).length > 0 ? (
                        Array.from(outboundFiles).map((f) => (
                          <button
                            key={f}
                            onClick={() => onSelectFile(f)}
                            className="btn-ghost"
                            style={{
                              fontSize: '11px',
                              fontFamily: 'var(--font-mono)',
                              padding: '2px 4px',
                              textAlign: 'left',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: '#38bdf8',
                            }}
                            title={f}
                          >
                            {f.split('/').pop()}
                          </button>
                        ))
                      ) : (
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Leaf module</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* File Symbols List */}
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
                        padding: '5px 8px',
                        fontSize: '11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        backgroundColor: '#141a24',
                        borderRadius: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            color: sym.changeStatus !== 'unchanged' ? 'var(--change-modified)' : '#cbd5e1',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {sym.name}
                        </span>
                        {sym.changeStatus !== 'unchanged' && (
                          <span className={`badge-change ${sym.changeStatus}`} style={{ fontSize: '9px', padding: '0 4px' }}>
                            {sym.changeStatus}
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {touchingTests.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => onSelectTest(t.id)}
                        className="btn-ghost"
                        style={{
                          textAlign: 'left',
                          padding: '5px 8px',
                          fontSize: '11px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          backgroundColor: '#141a24',
                          borderRadius: '4px',
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
