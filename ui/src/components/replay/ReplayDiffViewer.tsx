import React, { useState } from 'react';
import type {
  ChangedFileView,
  ChangedSymbolView,
  TimelineEntry,
  Completeness,
  ReplayRecord,
} from '../../replay/types';
import { FileDiff, AlertTriangle, Hash } from 'lucide-react';
import { formatReplayTime } from '../../replay/utils';

interface ReplayDiffViewerProps {
  selectedFile: string | null;
  changedFiles: ChangedFileView[];
  changedSymbols: ChangedSymbolView[];
  onSelectFile: (path: string) => void;
  getHistoricalContent: (path: string) => { content: string | null; sha256: string | null };
  entry?: TimelineEntry | null;
  record?: ReplayRecord | null;
  completenessInfo?: { completeness: Completeness; gaps: string[] };
  isModelNarrationAvailable?: boolean;
}

const EvidenceBlock: React.FC<{ label: string; value: string; testId: string }> = ({
  label,
  value,
  testId,
}) => (
  <div>
    <div style={{ color: 'var(--replay-text-muted, #8b97ad)', marginBottom: '4px' }}>{label}</div>
    <pre
      data-testid={testId}
      style={{
        margin: 0,
        padding: '8px',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '10px',
        color: 'var(--replay-text-primary, #e6edf8)',
        backgroundColor: 'var(--replay-bg-canvas, #07090e)',
        borderRadius: 'var(--replay-radius-control, 7px)',
      }}
    >
      {value}
    </pre>
  </div>
);

export const ReplayDiffViewer: React.FC<ReplayDiffViewerProps> = ({
  selectedFile,
  changedFiles,
  changedSymbols,
  onSelectFile,
  getHistoricalContent,
  entry,
  record,
  completenessInfo,
  isModelNarrationAvailable,
}) => {
  const [viewMode, setViewMode] = useState<'diff' | 'source'>('diff');

  const activeChangedFile = changedFiles.find((f) => f.path === selectedFile) || changedFiles[0] || null;
  const currentPath = selectedFile || activeChangedFile?.path || null;
  const historical = currentPath ? getHistoricalContent(currentPath) : { content: null, sha256: null };

  const symbolsForFile = currentPath
    ? changedSymbols.filter((s) => s.path === currentPath)
    : [];

  const hasStaleAst = symbolsForFile.some((s) => !s.verified);

  const evidenceText = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (!serialized) return null;
    const bounded = serialized.length > 4000 ? `${serialized.slice(0, 4000)}\n… [truncated in viewer]` : serialized;
    return record?.truncated && !bounded.includes('[truncated') ? `${bounded}\n… [source truncated]` : bounded;
  };

  const commandText = (() => {
    if (record?.edit_command) return record.edit_command;
    if (record?.tool_input && typeof record.tool_input === 'object') {
      const command = (record.tool_input as Record<string, unknown>).command;
      if (typeof command === 'string') return command;
    }
    return null;
  })();
  const toolInputText = commandText ? null : evidenceText(record?.tool_input);
  const toolOutputText = evidenceText(record?.tool_response);
  const isHistoryImport = record?.provenance === 'history_import';

  if (!currentPath && changedFiles.length === 0) {
    const isPartial = entry?.completeness === 'partial' || completenessInfo?.completeness === 'partial';
    const isTool = entry?.attribution_status === 'tool_boundary';

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--replay-text-primary, #e6edf8)',
          backgroundColor: 'var(--replay-bg-canvas, #07090e)',
          padding: '32px',
          overflowY: 'auto',
        }}
        data-testid="replay-empty-diff"
      >
        <div
          style={{
            maxWidth: '560px',
            width: '100%',
            backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
            border: '1px solid var(--replay-border-card, rgba(255, 255, 255, 0.09))',
            borderRadius: 'var(--replay-radius-panel, 14px)',
            boxShadow: 'var(--replay-shadow-ambient)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: 'var(--replay-radius-control, 7px)',
                backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--replay-text-muted, #8b97ad)',
                flexShrink: 0,
              }}
            >
              <FileDiff size={18} />
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--replay-text-primary, #e6edf8)' }}>
                Checkpoint #{entry?.sequence ?? 1} Overview
              </div>
              <div style={{ fontSize: '11px', color: 'var(--replay-text-faint, #4d576a)', fontFamily: 'var(--font-mono, monospace)', marginTop: '2px' }}>
                record:{entry?.record_id ?? 'unknown'} {entry?.captured_at ? `· ${formatReplayTime(entry.captured_at)}` : ''}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '11px', lineHeight: '1.5' }}>
            {isHistoryImport && (
              <div
                data-testid="replay-history-step-evidence"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  padding: '12px',
                  borderRadius: 'var(--replay-radius-control, 7px)',
                  backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                  border: '1px solid var(--replay-border-card, rgba(255, 255, 255, 0.09))',
                }}
              >
                <div style={{ fontWeight: 600 }}>Recorded history step</div>
                {record?.prompt_text && (
                  <EvidenceBlock label="Prompt" value={record.prompt_text} testId="replay-history-prompt" />
                )}
                {record?.tool_name && (
                  <div data-testid="replay-history-tool-name">
                    <span style={{ color: 'var(--replay-text-muted, #8b97ad)' }}>Tool: </span>
                    <strong>{record.tool_name}</strong>
                  </div>
                )}
                {commandText && (
                  <EvidenceBlock label="Command" value={commandText} testId="replay-history-command" />
                )}
                {toolInputText && (
                  <EvidenceBlock label="Tool input" value={toolInputText} testId="replay-history-tool-input" />
                )}
                {toolOutputText && (
                  <EvidenceBlock label="Recorded output" value={toolOutputText} testId="replay-history-tool-output" />
                )}
                {record?.edit_patch && (
                  <EvidenceBlock label="Recorded edit" value={record.edit_patch} testId="replay-history-edit" />
                )}
                {record?.file_state === 'unknown' && (
                  <div data-testid="replay-history-file-state" style={{ color: 'var(--replay-status-warning, #946c32)' }}>
                    Historical file state: unknown — action evidence only; source bytes were not reconstructed.
                  </div>
                )}
                {record?.timestamp_inferred && (
                  <div data-testid="replay-history-inferred-time" style={{ color: 'var(--replay-text-muted, #8b97ad)' }}>
                    Recorded time inferred from the nearest timestamped source event.
                  </div>
                )}
              </div>
            )}

            {/* Step Boundary & Attribution */}
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--replay-radius-control, 7px)',
                backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ color: 'var(--replay-text-muted, #8b97ad)' }}>Attribution status:</span>
              <span style={{ color: isTool ? 'var(--replay-accent, #4a7bb0)' : 'var(--replay-text-primary, #e6edf8)', fontWeight: 500 }}>
                {isTool ? `Tool boundary (${entry?.tool_name || 'attributed step'})` : 'Observed checkpoint (timer / non-tool event)'}
              </span>
            </div>

            {/* Completeness / Snapshot state */}
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--replay-radius-control, 7px)',
                backgroundColor: isPartial ? 'var(--replay-status-warning-bg, rgba(148, 108, 50, 0.12))' : 'var(--replay-bg-surface-2, #141a26)',
                border: isPartial ? '1px solid var(--replay-status-warning-border, rgba(148, 108, 50, 0.30))' : '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: 'var(--replay-text-muted, #8b97ad)' }}>Recording completeness:</span>
                <span style={{ color: isPartial ? 'var(--replay-status-warning, #946c32)' : 'var(--replay-status-complete, #4a7bb0)', fontWeight: 600, textTransform: 'uppercase' }}>
                  {entry?.completeness ?? 'complete'}
                </span>
              </div>
              <div style={{ color: isPartial ? 'var(--replay-status-warning, #946c32)' : 'var(--replay-text-muted, #8b97ad)', fontSize: '10px' }}>
                {entry?.gap_reason
                  ? `Gap details: ${entry.gap_reason}`
                  : isPartial
                  ? 'Missing content hashes detected in recording; code diff unavailable at this sequence.'
                  : 'No file modifications recorded at this checkpoint; code state is unchanged from previous step.'}
              </div>
            </div>

            {/* Model interpretation note */}
            {!isModelNarrationAvailable && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--replay-radius-control, 7px)',
                  backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                  border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                  color: 'var(--replay-text-muted, #8b97ad)',
                  fontSize: '10px',
                }}
              >
                <strong>Prompt A Baseline Recording:</strong> Model-generated chapters, atomic claims, and likely-reason inferences are not present for this export.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const renderDiffLines = (diffText: string | null | undefined) => {
    if (!diffText) {
      if (activeChangedFile?.change === 'added') {
        return (
          <div style={{ padding: '16px', color: 'var(--replay-status-complete, #4a7bb0)', fontSize: '12px' }}>
            New file added at this checkpoint.
          </div>
        );
      }
      if (activeChangedFile?.change === 'deleted') {
        return (
          <div style={{ padding: '16px', color: 'var(--replay-status-danger, #9c4444)', fontSize: '12px' }}>
            File deleted at this checkpoint.
          </div>
        );
      }
      return (
        <div style={{ padding: '16px', color: 'var(--replay-text-muted, #8b97ad)', fontSize: '12px' }}>
          No diff stored for this file.
        </div>
      );
    }

    const lines = diffText.split('\n');
    return (
      <div
        style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '11px',
          lineHeight: '1.5',
          overflowX: 'auto',
          padding: '8px 0',
          backgroundColor: 'var(--replay-bg-code, #090c12)',
        }}
        data-testid="replay-unified-diff-content"
      >
        {lines.map((line, idx) => {
          let bg = 'transparent';
          let color = 'var(--replay-text-primary, #e6edf8)';
          let borderLeft = '3px solid transparent';

          if (line.startsWith('+++') || line.startsWith('---')) {
            color = 'var(--replay-text-muted, #8b97ad)';
            bg = 'rgba(255, 255, 255, 0.02)';
          } else if (line.startsWith('@@')) {
            color = 'var(--replay-accent, #4a7bb0)';
            bg = 'var(--replay-accent-glow, rgba(74, 123, 176, 0.15))';
          } else if (line.startsWith('+')) {
            color = 'var(--replay-text-primary, #e6edf8)';
            bg = 'var(--replay-diff-add-bg, rgba(74, 123, 176, 0.12))';
            borderLeft = '3px solid var(--replay-diff-add-gutter, #4a7bb0)';
          } else if (line.startsWith('-')) {
            color = 'var(--replay-text-primary, #e6edf8)';
            bg = 'var(--replay-diff-del-bg, rgba(156, 68, 68, 0.12))';
            borderLeft = '3px solid var(--replay-diff-del-gutter, #9c4444)';
          }

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                backgroundColor: bg,
                borderLeft,
                padding: '1px 12px',
                minWidth: 'fit-content',
              }}
            >
              <span
                style={{
                  width: '32px',
                  color: 'var(--replay-text-faint, #4d576a)',
                  userSelect: 'none',
                  flexShrink: 0,
                  fontSize: '10px',
                }}
              >
                {idx + 1}
              </span>
              <span style={{ color, whiteSpace: 'pre', flex: 1 }}>{line}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderSourceLines = (sourceText: string | null) => {
    if (sourceText == null) {
      return (
        <div style={{ padding: '16px', color: 'var(--replay-text-muted, #8b97ad)', fontSize: '12px' }}>
          Historical file source not present in stored snapshot bytes.
        </div>
      );
    }

    const lines = sourceText.split('\n');
    return (
      <div
        style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '11px',
          lineHeight: '1.5',
          overflowX: 'auto',
          padding: '8px 0',
          backgroundColor: 'var(--replay-bg-code, #090c12)',
        }}
        data-testid="replay-historical-source-content"
      >
        {lines.map((line, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              padding: '1px 12px',
              minWidth: 'fit-content',
            }}
          >
            <span
              style={{
                width: '36px',
                color: 'var(--replay-text-faint, #4d576a)',
                userSelect: 'none',
                flexShrink: 0,
                fontSize: '10px',
              }}
            >
              {idx + 1}
            </span>
            <span style={{ color: 'var(--replay-text-primary, #e6edf8)', whiteSpace: 'pre', flex: 1 }}>{line}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--replay-bg-canvas, #07090e)',
        color: 'var(--replay-text-primary, #e6edf8)',
        borderRight: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
        minWidth: 0,
        overflow: 'hidden',
      }}
      data-testid="replay-diff-pane"
    >
      {/* File Selector Tabs */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
          backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
          padding: '4px 8px',
          gap: '8px',
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflowX: 'auto', flex: 1, minWidth: 0 }}>
          {changedFiles.map((f) => {
            const isSelected = f.path === currentPath;
            return (
              <button
                key={f.path}
                onClick={() => onSelectFile(f.path)}
                className="btn-ghost"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono, monospace)',
                  backgroundColor: isSelected ? 'var(--replay-bg-surface-2, #141a26)' : 'transparent',
                  border: isSelected ? '1px solid var(--replay-border-focus, rgba(96, 140, 200, 0.45))' : '1px solid transparent',
                  borderRadius: 'var(--replay-radius-control, 7px)',
                  color: isSelected ? 'var(--replay-accent, #4a7bb0)' : 'var(--replay-text-muted, #8b97ad)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: isSelected ? 'var(--replay-shadow-subtle)' : 'none',
                  transition: 'background-color var(--replay-transition-quick, 160ms ease)',
                }}
                aria-label={`Select file ${f.path}`}
              >
                <span>{f.path}</span>
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 600,
                    padding: '1px 5px',
                    borderRadius: 'var(--replay-radius-control, 7px)',
                    backgroundColor:
                      f.change === 'added'
                        ? 'var(--replay-status-complete-bg, rgba(74, 123, 176, 0.12))'
                        : f.change === 'deleted'
                        ? 'var(--replay-status-danger-bg, rgba(156, 68, 68, 0.12))'
                        : 'var(--replay-status-neutral-bg, rgba(90, 101, 120, 0.12))',
                    color:
                      f.change === 'added'
                        ? 'var(--replay-status-complete, #4a7bb0)'
                        : f.change === 'deleted'
                        ? 'var(--replay-status-danger, #9c4444)'
                        : 'var(--replay-text-muted, #8b97ad)',
                    border:
                      f.change === 'added'
                        ? '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))'
                        : f.change === 'deleted'
                        ? '1px solid var(--replay-status-danger-border, rgba(156, 68, 68, 0.30))'
                        : '1px solid var(--replay-status-neutral-border, rgba(90, 101, 120, 0.25))',
                  }}
                >
                  {f.change.toUpperCase()}
                </span>
              </button>
            );
          })}
        </div>

        {/* View mode toggle: Diff vs Full Source */}
        <div
          style={{
            display: 'flex',
            backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
            padding: '2px',
            borderRadius: 'var(--replay-radius-control, 7px)',
            border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setViewMode('diff')}
            style={{
              padding: '2px 8px',
              fontSize: '10px',
              border: 'none',
              borderRadius: 'var(--replay-radius-control, 7px)',
              cursor: 'pointer',
              backgroundColor: viewMode === 'diff' ? 'var(--replay-bg-surface-3, #1c2436)' : 'transparent',
              color: viewMode === 'diff' ? 'var(--replay-accent, #4a7bb0)' : 'var(--replay-text-muted, #8b97ad)',
              fontWeight: viewMode === 'diff' ? 600 : 400,
              transition: 'background-color var(--replay-transition-quick, 160ms ease)',
            }}
            aria-label="View diff"
          >
            Diff
          </button>
          <button
            onClick={() => setViewMode('source')}
            style={{
              padding: '2px 8px',
              fontSize: '10px',
              border: 'none',
              borderRadius: 'var(--replay-radius-control, 7px)',
              cursor: 'pointer',
              backgroundColor: viewMode === 'source' ? 'var(--replay-bg-surface-3, #1c2436)' : 'transparent',
              color: viewMode === 'source' ? 'var(--replay-accent, #4a7bb0)' : 'var(--replay-text-muted, #8b97ad)',
              fontWeight: viewMode === 'source' ? 600 : 400,
              transition: 'background-color var(--replay-transition-quick, 160ms ease)',
            }}
            aria-label="View full historical source"
          >
            Source
          </button>
        </div>
      </div>

      {/* File Header & Hashes */}
      {currentPath && (
        <div
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: 'var(--replay-text-muted, #8b97ad)',
            backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
            flexWrap: 'wrap',
            gap: '8px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--replay-text-primary, #e6edf8)', fontWeight: 600 }}>
              {currentPath}
            </span>
            {historical.sha256 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: '10px',
                  color: 'var(--replay-text-faint, #4d576a)',
                }}
                title={`Historical content SHA-256: ${historical.sha256}`}
              >
                <Hash size={10} />
                {historical.sha256.slice(0, 10)}
              </span>
            )}
          </div>

          {/* Stale AST badge if syntax errors invalidated verified symbols */}
          {hasStaleAst && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 6px',
                borderRadius: 'var(--replay-radius-control, 7px)',
                backgroundColor: 'var(--replay-status-warning-bg, rgba(148, 108, 50, 0.12))',
                border: '1px solid var(--replay-status-warning-border, rgba(148, 108, 50, 0.30))',
                color: 'var(--replay-status-warning, #946c32)',
                fontSize: '10px',
                fontWeight: 600,
              }}
              title="Syntax error or invalid bytes: symbols derived from older parse are unverified"
              data-testid="replay-stale-ast-badge"
            >
              <AlertTriangle size={11} />
              <span>Stale AST / Syntax error</span>
            </div>
          )}
        </div>
      )}

      {/* Changed Symbols / Functions bar if any */}
      {symbolsForFile.length > 0 && (
        <div
          style={{
            padding: '4px 12px',
            backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
            borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
            fontSize: '10px',
            flexShrink: 0,
          }}
        >
          <span style={{ color: 'var(--replay-text-muted, #8b97ad)' }}>Functions:</span>
          {symbolsForFile.map((s) => (
            <span
              key={s.qualified_name}
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                padding: '1px 5px',
                borderRadius: 'var(--replay-radius-control, 7px)',
                backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                color: s.verified ? 'var(--replay-text-primary, #e6edf8)' : 'var(--replay-status-warning, #946c32)',
                border: s.verified ? '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))' : '1px solid var(--replay-status-warning-border, rgba(148, 108, 50, 0.30))',
              }}
              title={s.verified ? `${s.kind} ${s.change}` : 'Unverified due to syntax error'}
            >
              {s.qualified_name} ({s.change})
            </span>
          ))}
        </div>
      )}

      {/* Code Area */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
          backgroundColor: 'var(--replay-bg-code, #090c12)',
        }}
      >
        {viewMode === 'diff'
          ? renderDiffLines(activeChangedFile?.unified_diff)
          : renderSourceLines(historical.content)}
      </div>
    </div>
  );
};
