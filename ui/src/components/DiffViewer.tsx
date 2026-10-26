import React from 'react';

interface DiffViewerProps {
  diff?: string;
  source?: string;
  lineStart?: number;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  diff,
  source,
  lineStart = 1,
}) => {
  if (diff) {
    const lines = diff.split('\n');
    return (
      <div className="diff-container">
        {lines.map((line, idx) => {
          let lineType = 'normal';
          if (line.startsWith('+') && !line.startsWith('+++')) lineType = 'added';
          else if (line.startsWith('-') && !line.startsWith('---')) lineType = 'removed';
          else if (line.startsWith('@') || line.startsWith('diff') || line.startsWith('---') || line.startsWith('+++')) lineType = 'header';

          return (
            <div key={idx} className={`diff-line ${lineType}`}>
              {line || ' '}
            </div>
          );
        })}
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
