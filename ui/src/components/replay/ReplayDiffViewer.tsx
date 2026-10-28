import React, { useState } from 'react';
import type { ChangedFileView, ChangedSymbolView } from '../../replay/types';
import { FileDiff, AlertTriangle, Hash } from 'lucide-react';

interface ReplayDiffViewerProps {
  selectedFile: string | null;
  changedFiles: ChangedFileView[];
  changedSymbols: ChangedSymbolView[];
  onSelectFile: (path: string) => void;
  getHistoricalContent: (path: string) => { content: string | null; sha256: string | null };
}

export const ReplayDiffViewer: React.FC<ReplayDiffViewerProps> = ({
  selectedFile,
  changedFiles,
  changedSymbols,
  onSelectFile,
  getHistoricalContent,
}) => {
  const [viewMode, setViewMode] = useState<'diff' | 'source'>('diff');

  const activeChangedFile = changedFiles.find((f) => f.path === selectedFile) || changedFiles[0] || null;
  const currentPath = selectedFile || activeChangedFile?.path || null;
  const historical = currentPath ? getHistoricalContent(currentPath) : { content: null, sha256: null };

  const symbolsForFile = currentPath
    ? changedSymbols.filter((s) => s.path === currentPath)
    : [];

  const hasStaleAst = symbolsForFile.some((s) => !s.verified);

  if (!currentPath && changedFiles.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-muted)',
          fontSize: '12px',
          gap: '8px',
          backgroundColor: '#111318',
        }}
        data-testid="replay-empty-diff"
      >
        <FileDiff size={28} style={{ opacity: 0.4 }} />
        <span>No file changes recorded at this checkpoint</span>
      </div>
    );
  }

  const renderDiffLines = (diffText: string | null | undefined) => {
    if (!diffText) {
      if (activeChangedFile?.change === 'added') {
        return (
          <div style={{ padding: '16px', color: '#10b981', fontSize: '12px' }}>
            New file added at this checkpoint.
          </div>
        );
      }
      if (activeChangedFile?.change === 'deleted') {
        return (
          <div style={{ padding: '16px', color: '#ef4444', fontSize: '12px' }}>
            File deleted at this checkpoint.
          </div>
        );
      }
      return (
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>
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
        }}
        data-testid="replay-unified-diff-content"
      >
        {lines.map((line, idx) => {
          let bg = 'transparent';
          let color = '#e2e8f0';

          if (line.startsWith('+++') || line.startsWith('---')) {
            color = '#94a3b8';
            bg = 'rgba(255, 255, 255, 0.03)';
          } else if (line.startsWith('@@')) {
            color = '#38bdf8';
            bg = 'rgba(56, 189, 248, 0.08)';
          } else if (line.startsWith('+')) {
            color = '#4ade80';
            bg = 'rgba(34, 197, 94, 0.12)';
          } else if (line.startsWith('-')) {
            color = '#f87171';
            bg = 'rgba(239, 68, 68, 0.12)';
          }

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                backgroundColor: bg,
                padding: '1px 12px',
                minWidth: 'fit-content',
              }}
            >
              <span
                style={{
                  width: '32px',
                  color: 'var(--text-muted)',
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
        <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>
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
                color: 'var(--text-muted)',
                userSelect: 'none',
                flexShrink: 0,
                fontSize: '10px',
              }}
            >
              {idx + 1}
            </span>
            <span style={{ color: '#e2e8f0', whiteSpace: 'pre', flex: 1 }}>{line}</span>
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
        backgroundColor: '#111318',
        color: '#f8fafc',
        borderRight: '1px solid #232730',
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
          borderBottom: '1px solid #232730',
          backgroundColor: '#161920',
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
                  backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                  border: isSelected ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid transparent',
                  borderRadius: '4px',
                  color: isSelected ? '#38bdf8' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                aria-label={`Select file ${f.path}`}
              >
                <span>{f.path}</span>
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 600,
                    padding: '1px 4px',
                    borderRadius: '2px',
                    backgroundColor:
                      f.change === 'added'
                        ? 'rgba(34, 197, 94, 0.2)'
                        : f.change === 'deleted'
                        ? 'rgba(239, 68, 68, 0.2)'
                        : 'rgba(245, 158, 11, 0.2)',
                    color:
                      f.change === 'added'
                        ? '#4ade80'
                        : f.change === 'deleted'
                        ? '#f87171'
                        : '#fbbf24',
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
            backgroundColor: '#0d0f12',
            padding: '2px',
            borderRadius: '4px',
            border: '1px solid #232730',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setViewMode('diff')}
            style={{
              padding: '2px 8px',
              fontSize: '10px',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
              backgroundColor: viewMode === 'diff' ? '#232730' : 'transparent',
              color: viewMode === 'diff' ? '#f8fafc' : 'var(--text-muted)',
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
              borderRadius: '3px',
              cursor: 'pointer',
              backgroundColor: viewMode === 'source' ? '#232730' : 'transparent',
              color: viewMode === 'source' ? '#f8fafc' : 'var(--text-muted)',
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
            borderBottom: '1px solid #1e222b',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: 'var(--text-muted)',
            backgroundColor: '#13151b',
            flexWrap: 'wrap',
            gap: '8px',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', color: '#f8fafc', fontWeight: 600 }}>
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
                  color: '#94a3b8',
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
                borderRadius: '3px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                fontSize: '10px',
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
            backgroundColor: '#0f1115',
            borderBottom: '1px solid #1e222b',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
            fontSize: '10px',
            flexShrink: 0,
          }}
        >
          <span style={{ color: 'var(--text-muted)' }}>Functions:</span>
          {symbolsForFile.map((s) => (
            <span
              key={s.qualified_name}
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                padding: '1px 5px',
                borderRadius: '2px',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                color: s.verified ? '#cbd5e1' : '#f87171',
                border: s.verified ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(239, 68, 68, 0.3)',
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
          backgroundColor: '#0e1014',
        }}
      >
        {viewMode === 'diff'
          ? renderDiffLines(activeChangedFile?.unified_diff)
          : renderSourceLines(historical.content)}
      </div>
    </div>
  );
};
