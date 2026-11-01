import React, { useState } from 'react';
import type {
  ChangedFileView,
  ChangedSymbolView,
  TimelineEntry,
  Completeness,
  ReplayRecord,
  StepNarration,
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
  narration?: StepNarration | null;
  explanationLoading?: boolean;
  instantStepNote?: string | null;
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
        padding: '9px 12px',
        whiteSpace: 'pre',
        overflowX: 'auto',
        maxWidth: '100%',
        boxSizing: 'border-box',
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
  narration,
  explanationLoading = false,
  instantStepNote = null,
}) => {
  const [viewMode, setViewMode] = useState<'diff' | 'source'>('diff');

  const activeChangedFile = changedFiles.find((f) => f.path === selectedFile) || changedFiles[0] || null;
  // A step change can replace the entire impacted-file set. Prefer that step's
  // first file when the previous selection is no longer present.
  const currentPath = activeChangedFile?.path || selectedFile || null;
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
    return (
      <div
        className="replay-empty-stage"
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
          className="replay-empty-panel"
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
                No files changed in this step
              </div>
              <div style={{ fontSize: '11px', color: 'var(--replay-text-faint, #4d576a)', fontFamily: 'var(--font-mono, monospace)', marginTop: '2px' }}>
                {entry?.captured_at ? formatReplayTime(entry.captured_at) : ''}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '11px', lineHeight: '1.5' }}>
            {explanationLoading && (
              <div data-testid="replay-step-explanation-loading">Checking this step with the local model…</div>
            )}
            {instantStepNote && (
              <div data-testid="replay-step-deterministic-note">{instantStepNote}</div>
            )}
            {narration?.explanation && (
              <div
                data-testid="replay-ai-summary"
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--replay-radius-control, 7px)',
                  backgroundColor: 'var(--replay-accent-glow, rgba(74, 123, 176, 0.15))',
                  border: '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))',
                  color: 'var(--replay-text-primary, #e6edf8)',
                }}
              >
                <strong style={{ display: 'block', marginBottom: '4px' }}>{narration.explanation.label}</strong>
                {narration.explanation.text}
              </div>
            )}
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
                <div style={{ fontWeight: 600 }}>Recorded evidence</div>
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

            {/* Plain recording state; technical provenance lives in the focus-strip disclosure. */}
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--replay-radius-control, 7px)',
                backgroundColor: isPartial ? 'var(--replay-status-warning-bg, rgba(148, 108, 50, 0.12))' : 'var(--replay-bg-surface-2, #141a26)',
                border: isPartial ? '1px solid var(--replay-status-warning-border, rgba(148, 108, 50, 0.30))' : '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
              }}
            >
              <div style={{ color: isPartial ? 'var(--replay-status-warning, #946c32)' : 'var(--replay-text-muted, #8b97ad)', fontSize: '10px' }}>
                {entry?.gap_reason
                  ? `Gap details: ${entry.gap_reason}`
                  : isPartial
                  ? 'Missing content hashes detected in recording; code diff unavailable at this sequence.'
                  : 'No file changes were recorded for this step; the previous file state remains current.'}
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
                This step is shown from the recorded session. Local narration has not added an explanation yet.
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
            New file added in this step.
          </div>
        );
      }
      if (activeChangedFile?.change === 'deleted') {
        return (
          <div style={{ padding: '16px', color: 'var(--replay-status-danger, #9c4444)', fontSize: '12px' }}>
            File deleted in this step.
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
    let oldLine = 0;
    let newLine = 0;
    return (
      <div className="replay-code-editor" data-testid="replay-unified-diff-content">
        {lines.map((line, idx) => {
          let kind = 'context';
          let oldNumber: number | null = null;
          let newNumber: number | null = null;
          if (line.startsWith('+++') || line.startsWith('---')) {
            kind = 'metadata';
          } else if (line.startsWith('@@')) {
            kind = 'hunk';
            const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
            if (match) {
              oldLine = Number(match[1]);
              newLine = Number(match[2]);
            }
          } else if (line.startsWith('+')) {
            kind = 'added';
            newNumber = newLine;
            newLine += 1;
          } else if (line.startsWith('-')) {
            kind = 'removed';
            oldNumber = oldLine;
            oldLine += 1;
          } else if (!line.startsWith('\\')) {
            oldNumber = oldLine;
            newNumber = newLine;
            oldLine += 1;
            newLine += 1;
          }

          return (
            <div key={idx} className={`replay-code-line ${kind}`}>
              <span className="replay-code-gutter">{oldNumber ?? ''}</span>
              <span className="replay-code-gutter">{newNumber ?? ''}</span>
              <span className="replay-code-text">{line || ' '}</span>
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
      <div className="replay-code-editor" data-testid="replay-historical-source-content">
        {lines.map((line, idx) => (
          <div key={idx} className="replay-code-line context">
            <span className="replay-code-gutter">{idx + 1}</span>
            <span className="replay-code-text">{line || ' '}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="replay-file-workbench" data-testid="replay-diff-pane">
      <aside className="replay-file-explorer" data-testid="replay-file-explorer">
        <div className="replay-file-explorer-title">
          <span>Changed files</span>
          <span>{changedFiles.length}</span>
        </div>
        <div className="replay-file-list">
          {changedFiles.map((file, index) => {
            const isSelected = file.path === currentPath;
            return (
              <button
                key={file.path}
                type="button"
                className={`replay-file-row ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectFile(file.path)}
                aria-label={`Select file ${file.path}`}
                data-testid={`replay-file-row-${index}`}
              >
                <FileDiff size={14} />
                <span className="replay-file-path">{file.path}</span>
                <span className={`replay-file-change ${file.change}`}>{file.change}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="replay-file-editor" data-testid="replay-file-editor">
        <div className="replay-editor-toolbar">
          <div className="replay-editor-path">
            <span>{currentPath}</span>
            {historical.sha256 && (
              <span className="replay-editor-hash" title={`Historical content SHA-256: ${historical.sha256}`}>
                <Hash size={11} />
                {historical.sha256.slice(0, 10)}
              </span>
            )}
          </div>
          <div className="replay-editor-view-switch" role="group" aria-label="File view">
            <button
              type="button"
              className={viewMode === 'diff' ? 'active' : ''}
              onClick={() => setViewMode('diff')}
              aria-label="View diff"
            >
              Changes
            </button>
            <button
              type="button"
              className={viewMode === 'source' ? 'active' : ''}
              onClick={() => setViewMode('source')}
              aria-label="View full historical source"
            >
              File
            </button>
          </div>
        </div>

        {explanationLoading && (
          <div className="replay-editor-note" data-testid="replay-step-explanation-loading">
            Checking this step with the local model…
          </div>
        )}
        {instantStepNote && (
          <div className="replay-editor-note" data-testid="replay-step-deterministic-note">
            {instantStepNote}
          </div>
        )}
        {narration?.explanation && (
          <div className="replay-editor-provenance model" data-testid="replay-ai-summary">
            <strong>{narration.explanation.label}: </strong>{narration.explanation.text}
          </div>
        )}
        {hasStaleAst && (
          <div
            className="replay-editor-provenance"
            title="Syntax error or invalid bytes: symbols derived from older parse are unverified"
            data-testid="replay-stale-ast-badge"
          >
            <AlertTriangle size={12} />
            <span>Stale AST / Syntax error</span>
          </div>
        )}
        {activeChangedFile?.file_state === 'reconstructed_from_current_checkout_unverified' && (
          <div className="replay-editor-provenance" data-testid="replay-derived-file-state">
            Derived: {activeChangedFile.reconstruction_label}
          </div>
        )}
        {activeChangedFile?.file_state === 'unknown' && (
          <div className="replay-editor-provenance" data-testid="replay-unknown-file-state">
            Derived file state: unknown — the recorded patch could not be reconstructed.
          </div>
        )}
        {symbolsForFile.length > 0 && (
          <div className="replay-symbol-strip">
            <span>Functions</span>
            {symbolsForFile.map((symbol) => (
              <span
                key={symbol.qualified_name}
                className={symbol.verified ? '' : 'unverified'}
                title={symbol.verified ? `${symbol.kind} ${symbol.change}` : 'Unverified due to syntax error'}
              >
                {symbol.qualified_name} ({symbol.change})
              </span>
            ))}
          </div>
        )}
        <div className="replay-editor-content">
          {viewMode === 'diff'
            ? renderDiffLines(activeChangedFile?.unified_diff)
            : renderSourceLines(historical.content)}
        </div>
      </section>
    </div>
  );
};
