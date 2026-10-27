import React, { useState } from 'react';
import { Columns, FileDiff } from 'lucide-react';

interface DiffViewerProps {
  diff?: string;
  source?: string;
  lineStart?: number;
  originalSource?: string;
  candidateSource?: string;
  isCandidatePatch?: boolean;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  diff,
  source,
  lineStart = 1,
  originalSource,
  candidateSource,
  isCandidatePatch = false,
}) => {
  const [displayMode, setDisplayMode] = useState<'unified' | 'split'>('unified');

  // If candidate patch comparison is available and split mode is active
  if (displayMode === 'split' && (originalSource || diff)) {
    const origLines = (originalSource || '').split('\n');
    const candLines = (candidateSource || source || '').split('\n');

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
          <span style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
            Before & After Comparison
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setDisplayMode('unified')}
              className="btn-ghost btn-sm"
              style={{ fontSize: '10px', padding: '1px 6px' }}
              title="Switch to unified patch diff"
            >
              <FileDiff size={11} style={{ marginRight: '3px' }} />
              Unified
            </button>
            <button
              onClick={() => setDisplayMode('split')}
              className="btn-ghost btn-sm"
              style={{ fontSize: '10px', padding: '1px 6px', color: '#38bdf8', fontWeight: 700 }}
              title="Side-by-side comparison"
            >
              <Columns size={11} style={{ marginRight: '3px' }} />
              Split
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          {/* Original Implementation */}
          <div className="diff-container" style={{ maxHeight: '340px' }}>
            <div
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                fontWeight: 700,
                color: '#f87171',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                borderBottom: '1px solid rgba(239, 68, 68, 0.25)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              ORIGINAL (HEAD~1)
            </div>
            {origLines.map((line, idx) => {
              const isSuspect = line.includes('isinstance') || line.includes("'exp' claim is not numeric");
              return (
                <div
                  key={idx}
                  className={`diff-line ${isSuspect ? 'removed' : 'normal'}`}
                  style={{
                    display: 'flex',
                    gap: '8px',
                    borderLeft: isSuspect ? '2px solid #ef4444' : '2px solid transparent',
                  }}
                >
                  <span style={{ width: '24px', color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
                    {lineStart + idx}
                  </span>
                  <span style={{ whiteSpace: 'pre' }}>{line || ' '}</span>
                </div>
              );
            })}
          </div>

          {/* Candidate Proposed Remediation */}
          <div className="diff-container" style={{ maxHeight: '340px' }}>
            <div
              style={{
                padding: '4px 8px',
                fontSize: '10px',
                fontWeight: 700,
                color: '#34d399',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                borderBottom: '1px solid rgba(16, 185, 129, 0.25)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              CANDIDATE PROPOSED REMEDIATION
            </div>
            {candLines.map((line, idx) => {
              const isPatch = line.includes('try:') || line.includes('float(exp_val)') || line.includes('except (ValueError');
              return (
                <div
                  key={idx}
                  className={`diff-line ${isPatch ? 'added' : 'normal'}`}
                  style={{
                    display: 'flex',
                    gap: '8px',
                    borderLeft: isPatch ? '2px solid #10b981' : '2px solid transparent',
                  }}
                >
                  <span style={{ width: '24px', color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>
                    {lineStart + idx}
                  </span>
                  <span style={{ whiteSpace: 'pre' }}>{line || ' '}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (diff) {
    const lines = diff.split('\n');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {(originalSource || isCandidatePatch) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
            <span style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
              Unified Code Review Diff
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                onClick={() => setDisplayMode('unified')}
                className="btn-ghost btn-sm"
                style={{ fontSize: '10px', padding: '1px 6px', color: '#38bdf8', fontWeight: 700 }}
                title="Unified diff format"
              >
                <FileDiff size={11} style={{ marginRight: '3px' }} />
                Unified
              </button>
              {originalSource && (
                <button
                  onClick={() => setDisplayMode('split')}
                  className="btn-ghost btn-sm"
                  style={{ fontSize: '10px', padding: '1px 6px' }}
                  title="Side-by-side comparison"
                >
                  <Columns size={11} style={{ marginRight: '3px' }} />
                  Split
                </button>
              )}
            </div>
          </div>
        )}

        <div className="diff-container">
          {lines.map((line, idx) => {
            let lineType = 'normal';
            if (line.startsWith('+') && !line.startsWith('+++')) lineType = 'added';
            else if (line.startsWith('-') && !line.startsWith('---')) lineType = 'removed';
            else if (line.startsWith('@') || line.startsWith('diff') || line.startsWith('---') || line.startsWith('+++'))
              lineType = 'header';

            return (
              <div
                key={idx}
                className={`diff-line ${lineType}`}
                style={{
                  borderLeft:
                    lineType === 'removed'
                      ? '2.5px solid #ef4444'
                      : lineType === 'added'
                      ? '2.5px solid #10b981'
                      : '2.5px solid transparent',
                }}
              >
                {line || ' '}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (source) {
    const lines = source.split('\n');
    return (
      <div className="diff-container">
        {lines.map((line, idx) => (
          <div
            key={idx}
            className="diff-line"
            style={{ display: 'flex', gap: '12px' }}
          >
            <span
              style={{
                width: '32px',
                textAlign: 'right',
                color: 'var(--text-muted)',
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              {lineStart + idx}
            </span>
            <span style={{ whiteSpace: 'pre', color: 'var(--text-primary)' }}>
              {line}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '12px',
        color: 'var(--text-muted)',
        fontStyle: 'italic',
        fontSize: '11px',
      }}
    >
      No source snippet or diff available for this symbol.
    </div>
  );
};
