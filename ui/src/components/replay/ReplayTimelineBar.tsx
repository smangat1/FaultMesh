import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { TimelineEntry, ReplayChapter, StructuredTestEvidence } from '../../replay/types';
import {
  computeTimelineBarGeometry,
  formatRecordedAt,
  type TimeModelOptions,
  type ChapterSegment,
  type AxisBreak,
  type GapRegion,
  type TestMarker,
} from '../../replay/timeModel';

export interface ReplayTimelineBarProps {
  timeline: TimelineEntry[];
  currentSequence: number;
  onSelectSequence: (sequence: number) => void;
  chapters?: ReplayChapter[];
  tests?: StructuredTestEvidence[];
  options?: TimeModelOptions;
  className?: string;
  style?: React.CSSProperties;
}

interface HoverTooltipState {
  x: number;
  content: React.ReactNode;
}

export const ReplayTimelineBar: React.FC<ReplayTimelineBarProps> = ({
  timeline,
  currentSequence,
  onSelectSequence,
  chapters = [],
  tests = [],
  options,
  className = '',
  style,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredTooltip, setHoveredTooltip] = useState<HoverTooltipState | null>(null);

  // Compute geometry using the pure time model
  const geometry = useMemo(() => {
    return computeTimelineBarGeometry({
      timeline,
      tests,
      chapters,
      options,
    });
  }, [timeline, tests, chapters, options]);

  // Current step lookup
  const currentStep = useMemo(() => {
    return geometry.getStepBySequence(currentSequence) || geometry.steps[0] || null;
  }, [geometry, currentSequence]);

  const minSequence = geometry.steps.length > 0 ? geometry.steps[0].sequence : 1;
  const maxSequence =
    geometry.steps.length > 0 ? geometry.steps[geometry.steps.length - 1].sequence : 1;

  // Extent time strings for footer
  const startTimeStr = useMemo(() => {
    if (geometry.steps.length === 0) return '';
    return geometry.steps[0].timeLabel.replace(/^recorded at /, '');
  }, [geometry.steps]);

  const endTimeStr = useMemo(() => {
    if (geometry.steps.length === 0) return '';
    return geometry.steps[geometry.steps.length - 1].timeLabel.replace(/^recorded at /, '');
  }, [geometry.steps]);

  // Ratio helper from client coordinate
  const getRatioFromClientX = useCallback((clientX?: number): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 800;
    const left = rect.left || 0;
    const x = typeof clientX === 'number' && !isNaN(clientX) ? clientX : left;
    const ratio = (x - left) / width;
    return Math.max(0, Math.min(1, isNaN(ratio) ? 0 : ratio));
  }, []);

  // Track click handler
  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const ratio = getRatioFromClientX(e.clientX);
      const nearest = geometry.findNearestStep(ratio);
      if (nearest) {
        onSelectSequence(nearest.sequence);
      }
    },
    [geometry, getRatioFromClientX, onSelectSequence]
  );

  // Pointer interactions on track (Click & Drag)
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Primary button only (allow undefined for test synthetics)
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();

      const ratio = getRatioFromClientX(e.clientX);
      const nearest = geometry.findNearestStep(ratio);
      if (nearest) {
        onSelectSequence(nearest.sequence);
      }

      setIsDragging(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Fallback for jsdom / tests
      }
    },
    [geometry, getRatioFromClientX, onSelectSequence]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const ratio = getRatioFromClientX(e.clientX);
      if (isDragging) {
        const nearest = geometry.findNearestStep(ratio);
        if (nearest && nearest.sequence !== currentSequence) {
          onSelectSequence(nearest.sequence);
        }
      } else {
        // Hovering track without dragging: show step preview tooltip
        const nearest = geometry.findNearestStep(ratio);
        if (!nearest || !trackRef.current) return;

        const rect = trackRef.current.getBoundingClientRect();
        const width = rect.width > 0 ? rect.width : 800;
        const x = nearest.positionRatio * width;

        setHoveredTooltip({
          x,
          content: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ fontWeight: 600, color: 'var(--replay-text-primary)' }}>
                Step #{nearest.sequence} ({nearest.record_type})
              </div>
              <div style={{ fontSize: '10px', color: 'var(--replay-text-muted)' }}>
                {nearest.timeLabel}
                {nearest.toolName && (
                  <span style={{ color: 'var(--replay-accent)', marginLeft: '6px' }}>
                    • tool: {nearest.toolName}
                    {nearest.toolDurationLabel && ` (${nearest.toolDurationLabel})`}
                  </span>
                )}
                {nearest.isGap && (
                  <span style={{ color: 'var(--replay-status-warning)', marginLeft: '6px' }}>
                    • GAP: {nearest.gapReason || 'unknown'}
                  </span>
                )}
              </div>
            </div>
          ),
        });
      }
    },
    [isDragging, getRatioFromClientX, geometry, currentSequence, onSelectSequence]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isDragging) {
        setIsDragging(false);
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          // Fallback for tests
        }
      }
    },
    [isDragging]
  );

  // Global pointerup listener in case capture was lost
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (isDragging) {
        setIsDragging(false);
      }
    };
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp);
  }, [isDragging]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (geometry.steps.length === 0) return;
      const currentIndex = geometry.steps.findIndex((s) => s.sequence === currentSequence);

      switch (e.key) {
        case 'ArrowLeft':
        case 'j':
          e.preventDefault();
          if (currentIndex > 0) {
            onSelectSequence(geometry.steps[currentIndex - 1].sequence);
          }
          break;

        case 'ArrowRight':
        case 'k':
          e.preventDefault();
          if (currentIndex < geometry.steps.length - 1) {
            onSelectSequence(geometry.steps[currentIndex + 1].sequence);
          }
          break;

        case 'Home':
          e.preventDefault();
          onSelectSequence(geometry.steps[0].sequence);
          break;

        case 'End':
          e.preventDefault();
          onSelectSequence(geometry.steps[geometry.steps.length - 1].sequence);
          break;

        case 'PageUp': {
          e.preventDefault();
          if (geometry.chapterSegments.length > 0) {
            const activeChapter = geometry.chapterSegments.find(
              (c) => currentSequence >= c.start_sequence && currentSequence <= c.end_sequence
            );
            if (activeChapter && currentSequence > activeChapter.start_sequence) {
              onSelectSequence(activeChapter.start_sequence);
            } else {
              const prevChapter = [...geometry.chapterSegments]
                .reverse()
                .find((c) => c.end_sequence < currentSequence);
              if (prevChapter) {
                onSelectSequence(prevChapter.start_sequence);
              } else {
                onSelectSequence(geometry.steps[0].sequence);
              }
            }
          } else {
            const targetIndex = Math.max(0, currentIndex - 10);
            onSelectSequence(geometry.steps[targetIndex].sequence);
          }
          break;
        }

        case 'PageDown': {
          e.preventDefault();
          if (geometry.chapterSegments.length > 0) {
            const nextChapter = geometry.chapterSegments.find(
              (c) => c.start_sequence > currentSequence
            );
            if (nextChapter) {
              onSelectSequence(nextChapter.start_sequence);
            } else {
              onSelectSequence(geometry.steps[geometry.steps.length - 1].sequence);
            }
          } else {
            const targetIndex = Math.min(geometry.steps.length - 1, currentIndex + 10);
            onSelectSequence(geometry.steps[targetIndex].sequence);
          }
          break;
        }
      }
    },
    [geometry, currentSequence, onSelectSequence]
  );

  // Dedicated Tooltip Handlers
  const handleChapterHover = (chapter: ChapterSegment, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!trackRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const rootRect = trackRef.current.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - rootRect.left;

    setHoveredTooltip({
      x,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <div style={{ fontWeight: 600, color: 'var(--replay-text-primary)' }}>{chapter.title}</div>
          <div style={{ fontSize: '10px', color: 'var(--replay-text-muted)' }}>
            Steps #{chapter.start_sequence}–#{chapter.end_sequence}
            {chapter.spansGap ? (
              <span style={{ color: 'var(--replay-status-warning)', marginLeft: '6px' }}>
                • Discontinuous (contains unrecorded gap)
              </span>
            ) : chapter.durationLabel ? (
              <span style={{ marginLeft: '6px' }}>• Duration: {chapter.durationLabel}</span>
            ) : null}
          </div>
          <div
            style={{
              fontSize: '9px',
              color: 'var(--replay-text-faint)',
              textTransform: 'capitalize',
            }}
          >
            {chapter.isModelInterpretation ? 'Model interpretation' : 'Deterministic template'}
          </div>
        </div>
      ),
    });
  };

  const handleGapHover = (gap: GapRegion, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!trackRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const rootRect = trackRef.current.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - rootRect.left;

    setHoveredTooltip({
      x,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontWeight: 600, color: 'var(--replay-status-warning)' }}>
            Unrecorded Gap: {gap.gapReason}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--replay-text-muted)' }}>
            Step #{gap.sequence} • Elapsed wall-clock time unknown
          </div>
        </div>
      ),
    });
  };

  const handleAxisBreakHover = (breakItem: AxisBreak, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!trackRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const rootRect = trackRef.current.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - rootRect.left;

    setHoveredTooltip({
      x,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontWeight: 600, color: 'var(--replay-text-primary)' }}>
            Idle Break: {breakItem.label}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--replay-text-muted)' }}>
            Between step #{breakItem.fromSequence} and #{breakItem.toSequence}
          </div>
        </div>
      ),
    });
  };

  const handleTestHover = (marker: TestMarker, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!trackRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const rootRect = trackRef.current.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - rootRect.left;

    setHoveredTooltip({
      x,
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div
            style={{
              fontWeight: 600,
              color:
                marker.markerType === 'fail' || marker.markerType === 'error'
                  ? 'var(--replay-status-danger)'
                  : 'var(--replay-accent)',
            }}
          >
            Test: {marker.testId} [{marker.state.toUpperCase()}]
          </div>
          <div style={{ fontSize: '10px', color: 'var(--replay-text-muted)' }}>
            Scope: {marker.suiteScope} • {formatRecordedAt(marker.observedAt, options?.timeZone)}
          </div>
        </div>
      ),
    });
  };

  const handleHoverLeave = () => {
    if (!isDragging) {
      setHoveredTooltip(null);
    }
  };

  // Safe Empty State
  if (!timeline || timeline.length === 0) {
    return (
      <div
        ref={rootRef}
        className={`replay-timeline-bar-root ${className}`}
        role="slider"
        aria-label="Timeline scrubber"
        aria-valuenow={0}
        aria-valuemin={0}
        aria-valuemax={0}
        aria-valuetext="No recorded steps"
        tabIndex={0}
        style={style}
        data-testid="replay-timeline-bar"
      >
        <div
          style={{
            textAlign: 'center',
            padding: '12px',
            color: 'var(--replay-text-muted)',
            fontSize: '12px',
          }}
        >
          No recorded steps in timeline
        </div>
      </div>
    );
  }

  const ariaValueText = currentStep
    ? `Step ${currentStep.sequence} of ${geometry.steps.length}: ${currentStep.record_type}, ${currentStep.timeLabel}`
    : 'No step selected';

  const thumbLeftPercent = (currentStep?.positionRatio ?? 0) * 100;

  return (
    <div
      ref={rootRef}
      className={`replay-timeline-bar-root ${className}`}
      role="slider"
      aria-label="Timeline scrubber"
      aria-valuenow={currentSequence}
      aria-valuemin={minSequence}
      aria-valuemax={maxSequence}
      aria-valuetext={ariaValueText}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseLeave={handleHoverLeave}
      style={style}
      data-testid="replay-timeline-bar"
    >
      {/* Floating Tooltip */}
      {hoveredTooltip && (
        <div
          className="replay-timeline-tooltip"
          style={{
            left: `${Math.max(16, Math.min((trackRef.current?.clientWidth || 800) - 200, hoveredTooltip.x))}px`,
          }}
          data-testid="timeline-tooltip"
        >
          {hoveredTooltip.content}
        </div>
      )}

      {/* 1. Chapter Bracket Lane */}
      {geometry.chapterSegments.length > 0 && (
        <div className="replay-timeline-chapter-lane" data-testid="timeline-chapter-lane">
          {geometry.chapterSegments.map((chapter) => {
            const leftPct = chapter.startRatio * 100;
            const widthPct = Math.max(0.8, (chapter.endRatio - chapter.startRatio) * 100);
            const isActive =
              currentSequence >= chapter.start_sequence && currentSequence <= chapter.end_sequence;

            return (
              <div
                key={chapter.id}
                className={`replay-timeline-chapter-segment ${
                  chapter.isModelInterpretation ? 'replay-timeline-chapter-model' : ''
                } ${isActive ? 'active' : ''}`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
                data-testid="timeline-chapter-segment"
                data-chapter-id={chapter.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectSequence(chapter.start_sequence);
                }}
                onMouseEnter={(e) => handleChapterHover(chapter, e)}
                onMouseLeave={handleHoverLeave}
                title={`${chapter.title} (steps #${chapter.start_sequence}–#${chapter.end_sequence})`}
              >
                <span className="replay-timeline-chapter-title">{chapter.title}</span>
                {chapter.isModelInterpretation && (
                  <span className="replay-timeline-chapter-model-tag" title="Model interpretation">
                    model
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 2. Main Track Lane */}
      <div
        ref={trackRef}
        className="replay-timeline-track-lane"
        data-testid="timeline-track-lane"
        onClick={handleTrackClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Track Rail Background */}
        <div className="replay-timeline-track-rail">
          {/* Axis Breaks (Idle Stretches) */}
          {geometry.axisBreaks.map((breakItem) => {
            const leftPct = breakItem.startRatio * 100;
            const widthPct = Math.max(2.5, (breakItem.endRatio - breakItem.startRatio) * 100);

            return (
              <div
                key={breakItem.id}
                className="replay-timeline-axis-break"
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
                data-testid="timeline-axis-break"
                onMouseEnter={(e) => handleAxisBreakHover(breakItem, e)}
                onMouseLeave={handleHoverLeave}
                title={`Idle period: ${breakItem.label} (steps #${breakItem.fromSequence}–#${breakItem.toSequence})`}
              >
                <svg
                  className="replay-timeline-break-squiggle"
                  width="10"
                  height="8"
                  viewBox="0 0 10 8"
                  fill="none"
                >
                  <path
                    d="M1 1 L3 7 M6 1 L8 7"
                    stroke="var(--replay-text-muted)"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="replay-timeline-break-label">{breakItem.label}</span>
              </div>
            );
          })}

          {/* Gap Regions (Unrecorded Gaps) */}
          {geometry.gapRegions.map((gap) => {
            const leftPct = gap.startRatio * 100;
            const widthPct = Math.max(1.8, (gap.endRatio - gap.startRatio) * 100);

            return (
              <div
                key={gap.id}
                className="replay-timeline-gap-hatch"
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
                data-testid="timeline-gap-region"
                onMouseEnter={(e) => handleGapHover(gap, e)}
                onMouseLeave={handleHoverLeave}
                title={`Unrecorded gap: ${gap.gapReason} (elapsed time unknown)`}
              >
                <span className="replay-timeline-gap-label">GAP</span>
              </div>
            );
          })}
        </div>

        {/* Step Ticks */}
        {geometry.steps.map((step) => {
          const leftPct = step.positionRatio * 100;
          const isSelected = step.sequence === currentSequence;

          return (
            <div
              key={step.record_id}
              className={`replay-timeline-step-tick ${step.isGap ? 'tick-gap' : ''} ${
                step.toolName ? 'tick-tool' : ''
              } ${isSelected ? 'tick-selected' : ''}`}
              style={{
                left: `${leftPct}%`,
              }}
              data-testid="timeline-step-tick"
              data-sequence={step.sequence}
            />
          );
        })}

        {/* Test Markers */}
        {geometry.testMarkers.map((marker) => {
          const leftPct = marker.positionRatio * 100;

          return (
            <div
              key={marker.id}
              className={`replay-timeline-test-marker test-${marker.markerType}`}
              style={{
                left: `${leftPct}%`,
              }}
              data-testid="timeline-test-marker"
              data-test-id={marker.testId}
              data-test-state={marker.state}
              onMouseEnter={(e) => handleTestHover(marker, e)}
              onMouseLeave={handleHoverLeave}
              onClick={(e) => {
                e.stopPropagation();
                if (marker.associatedSequence != null) {
                  onSelectSequence(marker.associatedSequence);
                }
              }}
              title={`Test: ${marker.testId} [${marker.state.toUpperCase()}]`}
            />
          );
        })}

        {/* Scrubber Thumb (Hero Element with Animated Snap) */}
        <div
          className={`replay-timeline-thumb ${isDragging ? 'dragging' : ''}`}
          style={{
            left: `${thumbLeftPercent}%`,
          }}
          data-testid="timeline-thumb"
          title={`Step #${currentSequence} (${currentStep?.timeLabel ?? ''})`}
        >
          <div className="replay-timeline-thumb-grip">
            <div className="replay-timeline-thumb-line" />
            <div className="replay-timeline-thumb-line" />
          </div>
        </div>
      </div>

      {/* 3. Bottom Status / Extent Strip */}
      <div className="replay-timeline-bar-footer" data-testid="timeline-bar-footer">
        <div className="replay-timeline-extent-start" data-testid="timeline-extent-start">
          {startTimeStr}
        </div>

        <div className="replay-timeline-step-indicator" data-testid="timeline-step-indicator">
          <span className="replay-timeline-step-seq">
            Step #{currentSequence} of {geometry.steps.length}
          </span>
          {currentStep && (
            <>
              <span className="replay-timeline-separator">•</span>
              <span className="replay-timeline-step-time" title={currentStep.captured_at}>
                {currentStep.timeLabel}
              </span>
              {currentStep.toolName && (
                <>
                  <span className="replay-timeline-separator">•</span>
                  <span className="replay-timeline-step-tool">
                    tool: {currentStep.toolName}
                    {currentStep.toolDurationLabel && ` (${currentStep.toolDurationLabel})`}
                  </span>
                </>
              )}
              {currentStep.isGap && (
                <>
                  <span className="replay-timeline-separator">•</span>
                  <span className="replay-timeline-step-gap">
                    GAP: {currentStep.gapReason || 'unknown'}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        <div className="replay-timeline-extent-end" data-testid="timeline-extent-end">
          {endTimeStr}
        </div>
      </div>
    </div>
  );
};
