import React from 'react';
import type {
  TimelineEntry,
  ReplayChapter,
} from '../../replay/types';
import { formatReplayTime } from '../../replay/utils';
import { CheckCircle2, XCircle } from 'lucide-react';

interface ReplayTimelineProps {
  timeline: TimelineEntry[];
  currentSequence: number;
  onSelectSequence: (seq: number) => void;
  chapters: ReplayChapter[];
  selectedChapterId: string | null;
  onSelectChapter: (chapterId: string | null) => void;
  isNarrationOn: boolean;
  onToggleNarration: (on: boolean) => void;
  isBaselineMode: boolean;
  onToggleBaseline: (baseline: boolean) => void;
  hasModelChapters: boolean;
}

export const ReplayTimeline: React.FC<ReplayTimelineProps> = ({
  timeline,
  currentSequence,
  onSelectSequence,
  chapters,
  selectedChapterId,
  onSelectChapter,
  isNarrationOn,
  onToggleNarration,
  isBaselineMode,
  onToggleBaseline,
  hasModelChapters,
}) => {
  const activeChapter = chapters.find((c) => c.id === selectedChapterId) || null;

  const filteredTimeline = activeChapter
    ? timeline.filter((t) => t.sequence >= activeChapter.start_sequence && t.sequence <= activeChapter.end_sequence)
    : timeline;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#13151b',
        borderRight: '1px solid #232730',
        width: '320px',
        flexShrink: 0,
        overflow: 'hidden',
        color: '#f8fafc',
      }}
      data-testid="replay-timeline-pane"
    >
      {/* Chapter & Timeline Mode Controls */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #232730',
          backgroundColor: '#161920',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            REPLAY TIMELINE
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
            {timeline.length} checkpoint{timeline.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Narration & Baseline Toggles */}
        {hasModelChapters && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <button
              onClick={() => onToggleNarration(!isNarrationOn)}
              className="btn-ghost"
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '3px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                backgroundColor: isNarrationOn ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: isNarrationOn ? '#38bdf8' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
              aria-label="Toggle narration"
              data-testid="replay-narration-toggle"
            >
              Narration: {isNarrationOn ? 'ON' : 'OFF'}
            </button>

            {isNarrationOn && (
              <button
                onClick={() => onToggleBaseline(!isBaselineMode)}
                className="btn-ghost"
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  backgroundColor: isBaselineMode ? 'rgba(148, 163, 184, 0.2)' : 'transparent',
                  color: isBaselineMode ? '#e2e8f0' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
                aria-label="Toggle baseline comparison"
                data-testid="replay-baseline-toggle"
              >
                Chapters: {isBaselineMode ? 'Baseline' : 'Model'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Chapters Accordion / List */}
      {chapters.length > 0 && isNarrationOn && (
        <div
          style={{
            maxHeight: '180px',
            overflowY: 'auto',
            borderBottom: '1px solid #232730',
            backgroundColor: '#0f1115',
            padding: '4px',
            flexShrink: 0,
          }}
          data-testid="replay-chapters-list"
        >
          <div
            style={{
              padding: '2px 8px',
              fontSize: '10px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontWeight: 600 }}>CHAPTERS</span>
            {selectedChapterId && (
              <button
                onClick={() => onSelectChapter(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#38bdf8',
                  fontSize: '9px',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Show all
              </button>
            )}
          </div>

          {chapters.map((ch) => {
            const isSelected = ch.id === selectedChapterId;
            const isInterpretation = ch.title_status === 'model interpretation';
            const isTemplate = ch.title_status === 'deterministic template' || ch.title_status === 'baseline';
            const titleStatusLabel = isInterpretation
              ? 'model interpretation'
              : isTemplate
              ? 'baseline'
              : ch.title_status || 'unknown';
            const count = timeline.filter((t) => t.sequence >= ch.start_sequence && t.sequence <= ch.end_sequence).length;

            return (
              <div
                key={ch.id}
                onClick={() => {
                  onSelectChapter(isSelected ? null : ch.id);
                  onSelectSequence(ch.start_sequence);
                }}
                style={{
                  padding: '6px 8px',
                  borderRadius: '4px',
                  backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                  border: isSelected ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid transparent',
                  cursor: 'pointer',
                  marginBottom: '2px',
                  fontSize: '11px',
                }}
                data-testid={`replay-chapter-item-${ch.id}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                  <span
                    style={{
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? '#38bdf8' : '#f8fafc',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={ch.title}
                  >
                    {ch.title}
                  </span>
                  <span
                    style={{
                      fontSize: '9px',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono, monospace)',
                      flexShrink: 0,
                    }}
                  >
                    #{ch.start_sequence}..#{ch.end_sequence} ({count})
                  </span>
                </div>

                <div style={{ marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span
                    style={{
                      fontSize: '9px',
                      padding: '1px 5px',
                      borderRadius: '2px',
                      backgroundColor: isInterpretation ? 'rgba(168, 85, 247, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                      color: isInterpretation ? '#c084fc' : '#94a3b8',
                      border: isInterpretation ? '1px solid rgba(168, 85, 247, 0.3)' : '1px solid rgba(148, 163, 184, 0.2)',
                    }}
                    data-testid="replay-chapter-title-status"
                  >
                    {titleStatusLabel}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Checkpoints Sequence List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
          padding: '6px',
        }}
        data-testid="replay-sequence-list"
      >
        {filteredTimeline.map((entry) => {
          const isSelected = entry.sequence === currentSequence;
          const hasFailTest = entry.test_evidence.some((t) => t.state === 'fail');
          const hasPassTest = entry.test_evidence.some((t) => t.state === 'pass');

          return (
            <div
              key={entry.sequence}
              onClick={() => onSelectSequence(entry.sequence)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                padding: '8px 10px',
                borderRadius: '4px',
                backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.14)' : 'rgba(255, 255, 255, 0.02)',
                border: isSelected ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(255, 255, 255, 0.05)',
                cursor: 'pointer',
                marginBottom: '4px',
                transition: 'background-color 0.15s ease',
              }}
              data-testid={`replay-checkpoint-row-${entry.sequence}`}
              aria-selected={isSelected}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono, monospace)',
                    fontWeight: 700,
                    fontSize: '11px',
                    color: isSelected ? '#38bdf8' : '#e2e8f0',
                  }}
                >
                  #{entry.sequence}
                </span>

                <span
                  style={{
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono, monospace)',
                  }}
                >
                  {formatReplayTime(entry.captured_at)}
                </span>
              </div>

              {/* Tool / Event info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: '10px',
                    fontFamily: 'var(--font-mono, monospace)',
                    color: entry.tool_name ? '#cbd5e1' : '#94a3b8',
                  }}
                >
                  {entry.tool_name ? entry.tool_name : entry.record_type}
                </span>

                {/* Attribution status tag */}
                <span
                  style={{
                    fontSize: '9px',
                    padding: '0 4px',
                    borderRadius: '2px',
                    backgroundColor:
                      entry.attribution_status === 'tool_boundary'
                        ? 'rgba(56, 189, 248, 0.1)'
                        : 'rgba(255, 255, 255, 0.04)',
                    color: entry.attribution_status === 'tool_boundary' ? '#38bdf8' : 'var(--text-muted)',
                  }}
                >
                  {entry.attribution_status === 'tool_boundary' ? 'tool step' : 'checkpoint'}
                </span>

                {/* Completeness badge if partial/missing */}
                {entry.completeness !== 'complete' && (
                  <span
                    style={{
                      fontSize: '9px',
                      padding: '0 4px',
                      borderRadius: '2px',
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      color: '#fbbf24',
                    }}
                    title={entry.gap_reason || 'Incomplete recording data'}
                  >
                    {entry.completeness}
                  </span>
                )}
              </div>

              {/* Changes & Tests summaries */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '10px', marginTop: '2px' }}>
                {entry.changed_files.length > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {entry.changed_files.length} file{entry.changed_files.length !== 1 ? 's' : ''}
                  </span>
                )}

                {hasFailTest && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      color: '#f87171',
                      fontWeight: 600,
                    }}
                  >
                    <XCircle size={10} />
                    FAIL
                  </span>
                )}

                {!hasFailTest && hasPassTest && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      color: '#4ade80',
                      fontWeight: 600,
                    }}
                  >
                    <CheckCircle2 size={10} />
                    PASS
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
