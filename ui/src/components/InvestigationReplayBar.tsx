import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Target,
  X,
} from 'lucide-react';
import type { AgentPhase } from '../agent/agentSimulation';

interface CheckpointInfo {
  index: number;
  label: string;
  phase: AgentPhase;
  phaseName: string;
}

interface InvestigationReplayBarProps {
  currentStepIndex: number;
  totalSteps: number;
  currentPhase: AgentPhase;
  checkpoints: CheckpointInfo[];
  isPlaying: boolean;
  onTogglePlay: () => void;
  onPrevStep: () => void;
  onNextStep: () => void;
  onRestart: () => void;
  onJumpToStep: (step: number) => void;
  speed: number;
  onChangeSpeed: (speed: number) => void;
  isCameraTrackingPaused: boolean;
  onResumeTracking: () => void;
  onClose: () => void;
  isInspectorOpen?: boolean;
}

const PHASE_COLORS: Record<AgentPhase, string> = {
  idle: '#94a3b8',
  diagnosing: '#ef4444',
  tracing: '#38bdf8',
  inspecting: '#f59e0b',
  patching: '#f59e0b',
  verifying: '#a855f7',
  resolved: '#10b981',
};

export const InvestigationReplayBar: React.FC<InvestigationReplayBarProps> = ({
  currentStepIndex,
  totalSteps,
  currentPhase,
  checkpoints,
  isPlaying,
  onTogglePlay,
  onPrevStep,
  onNextStep,
  onRestart,
  onJumpToStep,
  speed,
  onChangeSpeed,
  isCameraTrackingPaused,
  onResumeTracking,
  onClose,
  isInspectorOpen = false,
}) => {
  const activeColor = PHASE_COLORS[currentPhase] || '#38bdf8';
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 1200;
  const drawerWidth = isNarrow ? 330 : 400;
  const centerShift = isInspectorOpen ? Math.round(drawerWidth / 2) : 0;

  // Percentage progress along timeline track (0% to 100%)
  const progressPercent = totalSteps > 1 ? (currentStepIndex / (totalSteps - 1)) * 100 : 0;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '12px',
        left: isInspectorOpen ? `calc(50% - ${centerShift}px)` : '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 14px',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: '8px',
        boxShadow: '0 10px 32px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.04)',
        backdropFilter: 'blur(14px)',
        color: '#f8fafc',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        width: 'min(720px, calc(100% - 24px))',
        maxWidth: 'calc(100% - 24px)',
        userSelect: 'none',
      }}
      role="region"
      aria-label="Investigation Replay Bar"
    >
      {/* 1. Playback Controls Group */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
        <button
          onClick={onRestart}
          className="btn-ghost btn-sm"
          style={{ padding: '3px 6px', color: 'var(--text-secondary)' }}
          title="Restart investigation demo from step 1"
          aria-label="Restart Investigation"
        >
          <RotateCcw size={12} />
        </button>

        <button
          onClick={onPrevStep}
          disabled={currentStepIndex === 0}
          className="btn-ghost btn-sm"
          style={{
            padding: '3px 6px',
            color: currentStepIndex === 0 ? 'var(--text-muted)' : 'var(--text-secondary)',
          }}
          title="Step backward in investigation"
          aria-label="Previous Step"
        >
          <ChevronLeft size={13} />
        </button>

        <button
          onClick={onTogglePlay}
          className="btn-secondary btn-sm"
          style={{
            padding: '3px 9px',
            fontWeight: 600,
            fontSize: '11px',
            backgroundColor: isPlaying ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-raised)',
            borderColor: isPlaying ? 'rgba(56, 189, 248, 0.4)' : 'var(--border-default)',
            color: isPlaying ? '#38bdf8' : 'var(--text-primary)',
          }}
          title={isPlaying ? 'Pause investigation playback' : 'Play investigation playback'}
          aria-label={isPlaying ? 'Pause Investigation' : 'Play Investigation'}
        >
          {isPlaying ? <Pause size={12} /> : <Play size={12} />}
          <span className="agent-btn-label" style={{ marginLeft: '4px' }}>
            {isPlaying ? 'Pause' : 'Play'}
          </span>
        </button>

        <button
          onClick={onNextStep}
          disabled={currentStepIndex === totalSteps - 1}
          className="btn-ghost btn-sm"
          style={{
            padding: '3px 6px',
            color: currentStepIndex === totalSteps - 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
          }}
          title="Step forward in investigation"
          aria-label="Next Step"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      {/* 2. Interactive Video Timeline Track with Checkpoints */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          height: '24px',
          minWidth: '120px',
        }}
      >
        {/* Background Track Bar */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: '3px',
            backgroundColor: 'rgba(255, 255, 255, 0.12)',
            borderRadius: '2px',
          }}
        />

        {/* Filled Progress Track */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${progressPercent}%`,
            height: '3px',
            backgroundColor: activeColor,
            borderRadius: '2px',
            boxShadow: `0 0 8px ${activeColor}80`,
            transition: 'width 0.25s ease, background-color 0.25s ease',
          }}
        />

        {/* Checkpoint Dots along the Track */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 2,
          }}
        >
          {checkpoints.map((cp, idx) => {
            const isCurrent = idx === currentStepIndex;
            const isPassed = idx < currentStepIndex;
            const cpColor = PHASE_COLORS[cp.phase] || '#38bdf8';

            return (
              <button
                key={cp.index}
                onClick={() => onJumpToStep(idx)}
                style={{
                  position: 'relative',
                  width: isCurrent ? '14px' : '10px',
                  height: isCurrent ? '14px' : '10px',
                  borderRadius: '50%',
                  backgroundColor: isCurrent
                    ? cpColor
                    : isPassed
                    ? 'rgba(255, 255, 255, 0.7)'
                    : 'rgba(15, 23, 42, 0.95)',
                  border: isCurrent
                    ? '2px solid #ffffff'
                    : isPassed
                    ? '1.5px solid rgba(255, 255, 255, 0.4)'
                    : '1.5px solid rgba(255, 255, 255, 0.25)',
                  boxShadow: isCurrent ? `0 0 10px ${cpColor}` : 'none',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'all 0.18s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={`Checkpoint ${idx + 1}: ${cp.label} (${cp.phaseName})`}
                aria-label={`Step ${idx + 1}: ${cp.label}`}
              >
                {/* Checkpoint Number on Hover / Current */}
                {isCurrent && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-18px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      fontSize: '9px',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      color: cpColor,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {idx + 1}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Progress Step Indicator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '10px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, color: '#f8fafc' }}>{currentStepIndex + 1}</span>
        <span style={{ color: 'var(--text-muted)' }}>/</span>
        <span>{totalSteps}</span>
      </div>

      {/* 4. Speed Multipliers */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          borderRadius: '4px',
          padding: '1px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          flexShrink: 0,
        }}
      >
        {[0.5, 1, 2].map((s) => (
          <button
            key={s}
            onClick={() => onChangeSpeed(s)}
            style={{
              padding: '2px 5px',
              fontSize: '9.5px',
              fontFamily: 'var(--font-mono)',
              fontWeight: speed === s ? 700 : 500,
              backgroundColor: speed === s ? 'rgba(255, 255, 255, 0.14)' : 'transparent',
              color: speed === s ? '#ffffff' : 'var(--text-muted)',
              border: 'none',
              borderRadius: '3px',
              cursor: 'pointer',
            }}
            title={`Set playback speed to ${s}x`}
            aria-label={`${s}x speed`}
          >
            {s}x
          </button>
        ))}
      </div>

      {/* 5. Resume Camera Tracking Action Pill */}
      {isCameraTrackingPaused && (
        <button
          onClick={onResumeTracking}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '3px 7px',
            borderRadius: '4px',
            fontSize: '9.5px',
            fontWeight: 600,
            backgroundColor: 'rgba(56, 189, 248, 0.2)',
            color: '#38bdf8',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            cursor: 'pointer',
            flexShrink: 0,
            animation: 'agentBreathingPulse 2s infinite',
          }}
          title="Manual pan detected. Click to center and resume camera tracking"
          aria-label="Resume Camera Tracking"
        >
          <Target size={11} />
          <span className="agent-btn-label">Follow</span>
        </button>
      )}

      {/* 6. Exit Button */}
      <button
        onClick={onClose}
        className="btn-ghost btn-sm"
        style={{ padding: '3px 5px', color: 'var(--text-muted)', flexShrink: 0 }}
        title="Exit investigation replay"
        aria-label="Exit Agent Playback"
      >
        <X size={13} />
      </button>
    </div>
  );
};
