import React from 'react';
import {
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Search,
  FileText,
  GitCommit,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import type { AgentPhase, StepExplanation } from '../agent/agentSimulation';

interface StepExplanationPopupProps {
  currentStepIndex: number;
  totalSteps: number;
  currentPhase: AgentPhase;
  phaseLabel: string;
  checkpointLabel: string;
  targetNodeId: string;
  explanation: StepExplanation;
  isExpanded: boolean;
  onToggleExpand: () => void;
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

export const StepExplanationPopup: React.FC<StepExplanationPopupProps> = ({
  currentStepIndex,
  totalSteps,
  currentPhase,
  phaseLabel: _phaseLabel,
  checkpointLabel,
  targetNodeId,
  explanation,
  isExpanded,
  onToggleExpand,
  isInspectorOpen = false,
}) => {
  const activeColor = PHASE_COLORS[currentPhase] || '#38bdf8';
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 1200;
  const drawerWidth = isNarrow ? 330 : 400;
  const centerShift = isInspectorOpen ? Math.round(drawerWidth / 2) : 0;

  // Short target name for display
  const targetShort = targetNodeId ? targetNodeId.split('::').pop() || targetNodeId : '';

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '62px',
        left: isInspectorOpen ? `calc(50% - ${centerShift}px)` : '50%',
        transform: 'translateX(-50%)',
        zIndex: 55,
        width: isExpanded ? 'min(580px, calc(100% - 32px))' : 'min(560px, calc(100% - 32px))',
        backgroundColor: 'rgba(15, 23, 42, 0.96)',
        border: `1px solid ${isExpanded ? `${activeColor}55` : 'rgba(255, 255, 255, 0.14)'}`,
        borderRadius: '8px',
        boxShadow: isExpanded
          ? '0 12px 36px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.06)'
          : '0 8px 24px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.04)',
        backdropFilter: 'blur(16px)',
        color: '#f8fafc',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
        fontSize: '11px',
        lineHeight: 1.45,
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        overflow: 'hidden',
      }}
      role="region"
      aria-label="Investigation Step Explanation"
    >
      {/* 1. Header & Collapsed Summary Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '6px 12px',
          backgroundColor: isExpanded ? 'rgba(0, 0, 0, 0.35)' : 'transparent',
          borderBottom: isExpanded ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={onToggleExpand}
        title={isExpanded ? 'Collapse step explanation' : 'Expand detailed step explanation & reasoning'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          {/* Step Pill */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '1px 6px',
              borderRadius: '4px',
              backgroundColor: `${activeColor}18`,
              border: `1px solid ${activeColor}40`,
              flexShrink: 0,
            }}
          >
            <span
              style={{
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                backgroundColor: activeColor,
              }}
            />
            <span
              style={{
                fontSize: '9.5px',
                fontWeight: 700,
                color: activeColor,
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Step {currentStepIndex + 1}/{totalSteps} • {checkpointLabel}
            </span>
          </div>

          {/* Collapsed Summary */}
          {!isExpanded && (
            <div
              style={{
                color: '#cbd5e1',
                fontSize: '11px',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                flex: 1,
              }}
            >
              {explanation.stepSummary}
            </div>
          )}

          {/* Expanded Step Title */}
          {isExpanded && (
            <div
              style={{
                color: '#f8fafc',
                fontSize: '11px',
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
                flex: 1,
              }}
            >
              Focus: <span style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>{targetShort}()</span>
            </div>
          )}
        </div>

        {/* Toggle Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="btn-ghost btn-sm"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 7px',
            fontSize: '10px',
            fontWeight: 600,
            color: isExpanded ? '#38bdf8' : 'var(--text-secondary)',
            backgroundColor: isExpanded ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.05)',
            border: `1px solid ${isExpanded ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
            borderRadius: '4px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Collapse step explanation' : 'Why this step?'}
        >
          <HelpCircle size={11} />
          <span>{isExpanded ? 'Collapse' : 'Why this step?'}</span>
          {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      </div>

      {/* 2. Expanded Detailed Explanation Body */}
      {isExpanded && (
        <div
          style={{
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '9px',
            maxHeight: '300px',
            overflowY: 'auto',
          }}
        >
          {/* Section 1: What happened? */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <Search size={13} style={{ color: '#38bdf8', marginTop: '2px', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                What happened?
              </div>
              <div style={{ color: '#f1f5f9', fontSize: '11px', marginTop: '1px' }}>
                {explanation.whatHappened}
              </div>
            </div>
          </div>

          {/* Section 2: Why did it do this? */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <HelpCircle size={13} style={{ color: '#f59e0b', marginTop: '2px', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Why did it do this?
              </div>
              <div style={{ color: '#f1f5f9', fontSize: '11px', marginTop: '1px' }}>
                {explanation.whyDidItDoThis}
              </div>
            </div>
          </div>

          {/* Section 3: Evidence supporting decision */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <FileText size={13} style={{ color: '#a855f7', marginTop: '2px', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                What evidence supported the decision?
              </div>
              <div style={{ color: '#e2e8f0', fontSize: '11px', marginTop: '1px', fontFamily: 'var(--font-mono)' }}>
                {explanation.evidenceSupported}
              </div>
            </div>
          </div>

          {/* Section 4: What changed? */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <GitCommit size={13} style={{ color: '#f59e0b', marginTop: '2px', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                What changed?
              </div>
              <div style={{ color: '#f1f5f9', fontSize: '11px', marginTop: '1px' }}>
                {explanation.whatChanged}
              </div>
            </div>
          </div>

          {/* Section 5: Outcome & Next step */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <CheckCircle2 size={13} style={{ color: '#10b981', marginTop: '2px', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                What was the outcome?
              </div>
              <div style={{ color: '#f1f5f9', fontSize: '11px', marginTop: '1px' }}>
                {explanation.outcome}
              </div>
            </div>
          </div>

          {/* Simulation Grounded Notice Footer */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              paddingTop: '6px',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              fontSize: '9.5px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <Sparkles size={11} style={{ color: '#38bdf8' }} />
            <span>Sample Investigation Replay • Grounded in recorded pytest failure & AST git diff</span>
          </div>
        </div>
      )}
    </div>
  );
};
