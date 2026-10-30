import React from 'react';

interface ReplayModelSetupProps {
  open: boolean;
  message: string;
  busy: boolean;
  progress?: { downloaded: number; total: number } | null;
  onDownload: () => void;
  onChoose: () => void;
  onSkip: () => void;
}

export const ReplayModelSetup: React.FC<ReplayModelSetupProps> = ({
  open,
  message,
  busy,
  progress,
  onDownload,
  onChoose,
  onSkip,
}) => {
  if (!open) return null;
  const percentage = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Set up local narration"
      data-testid="replay-model-setup"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(3, 5, 9, 0.78)',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: 'min(480px, 100%)',
          padding: '24px',
          borderRadius: '14px',
          border: '1px solid var(--replay-border-card, rgba(255,255,255,0.09))',
          background: 'var(--replay-bg-surface-1, #0d111a)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ fontSize: '16px', fontWeight: 650, marginBottom: '8px' }}>
          Set up local narration
        </div>
        <p style={{ color: 'var(--replay-text-muted, #8b97ad)', fontSize: '12px', lineHeight: 1.6 }}>
          {message} Narration runs on this machine. Session evidence is redacted before the model sees it.
        </p>
        {percentage !== null && (
          <div data-testid="replay-model-download-progress" style={{ fontSize: '11px', margin: '14px 0' }}>
            Downloading recommended model… {percentage}%
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '18px' }}>
          <button type="button" className="btn-primary" disabled={busy} onClick={onDownload}>
            Download recommended 3B
          </button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={onChoose}>
            Choose my GGUF
          </button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={onSkip}>
            Keep plain mode
          </button>
        </div>
      </div>
    </div>
  );
};
