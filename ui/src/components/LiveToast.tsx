import React, { useEffect } from 'react';
import { X, FileCode } from 'lucide-react';

export interface LiveToastProps {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
}

export const LiveToast: React.FC<LiveToastProps> = ({
  message,
  onDismiss,
  durationMs = 4000,
}) => {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, durationMs);
    return () => clearTimeout(timer);
  }, [message, onDismiss, durationMs]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        top: '14px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: '#131b28',
        border: '1px solid rgba(56, 189, 248, 0.35)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
        borderRadius: '6px',
        padding: '5px 10px',
        color: '#f8fafc',
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        pointerEvents: 'auto',
        maxWidth: '480px',
        animation: 'fadeIn 0.15s ease-out',
      }}
    >
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          backgroundColor: '#38bdf8',
          boxShadow: '0 0 6px #38bdf8',
          flexShrink: 0,
        }}
      />
      <FileCode size={12} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '380px',
        }}
      >
        {message}
      </span>
      <button
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          padding: '2px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '3px',
          flexShrink: 0,
        }}
        title="Dismiss notification"
        aria-label="Dismiss notification"
      >
        <X size={12} />
      </button>
    </div>
  );
};
