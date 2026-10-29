import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReplayAdapter } from '../../adapter/replayAdapter';
import { ReplayTimeline } from './ReplayTimeline';
import { ReplayDiffViewer } from './ReplayDiffViewer';
import { ReplayEvidenceInspector } from './ReplayEvidenceInspector';
import {
  ChevronLeft,
  ChevronRight,
  Layers,
} from 'lucide-react';

interface ReplayWorkspaceProps {
  adapter: ReplayAdapter;
  onOpenProjectMap?: () => void;
}

export const ReplayWorkspace: React.FC<ReplayWorkspaceProps> = ({
  adapter,
  onOpenProjectMap,
}) => {
  const timeline = useMemo(() => adapter.getTimeline(), [adapter]);
  const [currentSeq, setCurrentSeq] = useState<number>(() => adapter.getCurrentSequence());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [isNarrationOn, setIsNarrationOn] = useState<boolean>(true);
  const [isBaselineMode, setIsBaselineMode] = useState<boolean>(false);

  const currentEntry = adapter.getTimelineEntry(currentSeq) || timeline[0] || null;
  const session = adapter.getSession();
  const origin = adapter.getOrigin();
  const limitations = adapter.getLimitations();
  const completenessInfo = adapter.getCompletenessSummary();
  const granularity = adapter.detectCaptureGranularity();
  const hasModelChapters = adapter.isModelNarrationAvailable();

  const chapters = useMemo(() => {
    return isBaselineMode ? adapter.getBaselineChapters() : adapter.getChapters();
  }, [adapter, isBaselineMode]);

  const narration = useMemo(() => {
    return adapter.getNarration(currentSeq);
  }, [adapter, currentSeq]);

  const testsForCurrentSeq = useMemo(() => {
    return adapter.getTestsForSequence(currentSeq);
  }, [adapter, currentSeq]);

  // Set sequence and update adapter
  const handleSelectSequence = useCallback(
    (seq: number) => {
      const entry = timeline.find((t) => t.sequence === seq);
      if (entry) {
        setCurrentSeq(seq);
        adapter.setCurrentSequence(seq);
        if (entry.changed_files.length > 0) {
          setSelectedFile(entry.changed_files[0].path);
        } else {
          setSelectedFile(null);
        }
      }
    },
    [adapter, timeline]
  );

  // Navigate previous / next checkpoint
  const handlePrevCheckpoint = useCallback(() => {
    const currentIndex = timeline.findIndex((t) => t.sequence === currentSeq);
    if (currentIndex > 0) {
      handleSelectSequence(timeline[currentIndex - 1].sequence);
    }
  }, [currentSeq, handleSelectSequence, timeline]);

  const handleNextCheckpoint = useCallback(() => {
    const currentIndex = timeline.findIndex((t) => t.sequence === currentSeq);
    if (currentIndex >= 0 && currentIndex < timeline.length - 1) {
      handleSelectSequence(timeline[currentIndex + 1].sequence);
    }
  }, [currentSeq, handleSelectSequence, timeline]);

  // Keyboard navigation: Left/Right arrows or j/k
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'j') {
        e.preventDefault();
        handlePrevCheckpoint();
      } else if (e.key === 'ArrowRight' || e.key === 'k') {
        e.preventDefault();
        handleNextCheckpoint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevCheckpoint, handleNextCheckpoint]);

  const getHistoricalContent = useCallback(
    (path: string) => {
      return adapter.getHistoricalFileAtCheckpoint(currentSeq, path);
    },
    [adapter, currentSeq]
  );

  const currentIndex = timeline.findIndex((t) => t.sequence === currentSeq);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: 'var(--replay-bg-canvas, #07090e)',
        color: 'var(--replay-text-primary, #e6edf8)',
        fontFamily: 'var(--font-sans, -apple-system, sans-serif)',
        overflow: 'hidden',
      }}
      data-testid="replay-workspace"
    >
      {/* Top Replay Navigation & Context Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
          backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
          flexWrap: 'wrap',
          gap: '12px',
          flexShrink: 0,
        }}
        data-testid="replay-workspace-header"
      >
        {/* Left: Scrubber Controls & Checkpoint ID */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={handlePrevCheckpoint}
              disabled={currentIndex <= 0}
              className="btn-ghost"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 8px',
                fontSize: '12px',
                borderRadius: 'var(--replay-radius-control, 7px)',
                border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                backgroundColor: currentIndex <= 0 ? 'transparent' : 'var(--replay-bg-surface-2, #141a26)',
                color: 'var(--replay-text-primary, #e6edf8)',
                cursor: currentIndex <= 0 ? 'not-allowed' : 'pointer',
                opacity: currentIndex <= 0 ? 0.35 : 1,
                transition: 'background-color var(--replay-transition-quick, 160ms ease)',
              }}
              title="Previous checkpoint (Left arrow or j)"
              aria-label="Previous checkpoint"
              data-testid="replay-prev-btn"
            >
              <ChevronLeft size={14} />
              <span>Prev</span>
            </button>

            <span
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '12px',
                fontWeight: 600,
                padding: '4px 8px',
                color: 'var(--replay-accent, #4a7bb0)',
                backgroundColor: 'var(--replay-accent-glow, rgba(74, 123, 176, 0.15))',
                border: '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))',
                borderRadius: 'var(--replay-radius-control, 7px)',
              }}
              data-testid="replay-current-seq-badge"
            >
              Checkpoint #{currentSeq} of {timeline.length}
            </span>

            <button
              onClick={handleNextCheckpoint}
              disabled={currentIndex >= timeline.length - 1}
              className="btn-ghost"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 8px',
                fontSize: '12px',
                borderRadius: 'var(--replay-radius-control, 7px)',
                border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                backgroundColor: currentIndex >= timeline.length - 1 ? 'transparent' : 'var(--replay-bg-surface-2, #141a26)',
                color: 'var(--replay-text-primary, #e6edf8)',
                cursor: currentIndex >= timeline.length - 1 ? 'not-allowed' : 'pointer',
                opacity: currentIndex >= timeline.length - 1 ? 0.35 : 1,
                transition: 'background-color var(--replay-transition-quick, 160ms ease)',
              }}
              title="Next checkpoint (Right arrow or k)"
              aria-label="Next checkpoint"
              data-testid="replay-next-btn"
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>

          {currentEntry && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--replay-text-muted, #8b97ad)' }}>
              <span style={{ fontFamily: 'var(--font-mono, monospace)', color: 'var(--replay-text-faint, #4d576a)' }}>
                record:{currentEntry.record_id}
              </span>
              {currentEntry.tool_name && (
                <span
                  style={{
                    fontFamily: 'var(--font-mono, monospace)',
                    color: 'var(--replay-text-primary, #e6edf8)',
                    backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                    border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                    padding: '1px 6px',
                    borderRadius: 'var(--replay-radius-control, 7px)',
                  }}
                >
                  tool: {currentEntry.tool_name}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Honesty Badges & Optional Graph action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Origin badge */}
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 600,
              padding: '2px 7px',
              borderRadius: 'var(--replay-radius-control, 7px)',
              backgroundColor: origin === 'real_recording' ? 'var(--replay-status-complete-bg, rgba(74, 123, 176, 0.12))' : 'var(--replay-status-neutral-bg, rgba(90, 101, 120, 0.12))',
              border: origin === 'real_recording' ? '1px solid var(--replay-status-complete-border, rgba(74, 123, 176, 0.30))' : '1px solid var(--replay-status-neutral-border, rgba(90, 101, 120, 0.25))',
              color: origin === 'real_recording' ? 'var(--replay-accent, #4a7bb0)' : 'var(--replay-text-muted, #8b97ad)',
            }}
            data-testid="replay-header-origin"
          >
            {origin === 'synthetic_fixture'
              ? 'SYNTHETIC FIXTURE'
              : origin === 'simulated_demo'
              ? 'SIMULATED DEMO'
              : 'REAL RECORDING'}
          </span>

          {/* Historical (Stopped) Badge or In-Progress Snapshot */}
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono, monospace)',
              padding: '2px 7px',
              borderRadius: 'var(--replay-radius-control, 7px)',
              backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
              border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
              color: 'var(--replay-text-muted, #8b97ad)',
            }}
            data-testid="replay-historical-status"
          >
            {session.status === 'active' ? 'IN-PROGRESS SNAPSHOT' : 'HISTORICAL (STOPPED)'}
          </span>

          {/* Granularity badge */}
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono, monospace)',
              padding: '2px 7px',
              borderRadius: 'var(--replay-radius-control, 7px)',
              backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
              border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
              color: 'var(--replay-text-muted, #8b97ad)',
            }}
            data-testid="replay-granularity-badge"
          >
            {granularity === 'tool_boundary' ? 'TOOL BOUNDARY' : 'OBSERVED CHECKPOINT'}
          </span>

          {/* Completeness Badge (only when incomplete) */}
          {completenessInfo.completeness !== 'complete' && (
            <span
              style={{
                fontSize: '10px',
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 600,
                padding: '2px 7px',
                borderRadius: 'var(--replay-radius-control, 7px)',
                backgroundColor: 'var(--replay-status-warning-bg, rgba(148, 108, 50, 0.12))',
                border: '1px solid var(--replay-status-warning-border, rgba(148, 108, 50, 0.30))',
                color: 'var(--replay-status-warning, #946c32)',
              }}
              title={completenessInfo.gaps.join('\n')}
              data-testid="replay-completeness-badge"
            >
              {completenessInfo.completeness.toUpperCase()}
            </span>
          )}

          {/* Codex Agent Version */}
          {session.codex_version && (
            <span
              style={{
                fontSize: '10px',
                fontFamily: 'var(--font-mono, monospace)',
                color: 'var(--replay-text-faint, #4d576a)',
                padding: '2px 6px',
              }}
              data-testid="replay-agent-version"
            >
              {session.codex_version}
            </span>
          )}

          {/* Optional Project Map Button */}
          {onOpenProjectMap && (
            <button
              onClick={onOpenProjectMap}
              className="btn-ghost"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '11px',
                padding: '3px 8px',
                color: 'var(--replay-text-muted, #8b97ad)',
                border: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
                borderRadius: 'var(--replay-radius-control, 7px)',
                backgroundColor: 'var(--replay-bg-surface-2, #141a26)',
                cursor: 'pointer',
                transition: 'background-color var(--replay-transition-quick, 160ms ease)',
              }}
              title="Open full AST project map (optional)"
              aria-label="Open project map"
              data-testid="replay-open-map-btn"
            >
              <Layers size={12} />
              <span>Project Map</span>
            </button>
          )}
        </div>
      </div>

      {/* Main 3-Column Obsidian-Style Layout */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Left Column: Chapters & Timeline Scrubber */}
        <ReplayTimeline
          timeline={timeline}
          currentSequence={currentSeq}
          onSelectSequence={handleSelectSequence}
          chapters={chapters}
          selectedChapterId={selectedChapterId}
          onSelectChapter={setSelectedChapterId}
          isNarrationOn={isNarrationOn}
          onToggleNarration={setIsNarrationOn}
          isBaselineMode={isBaselineMode}
          onToggleBaseline={(baseline) => {
            setIsBaselineMode(baseline);
            adapter.setUseBaselineChapters(baseline);
          }}
          hasModelChapters={hasModelChapters}
        />

        {/* Center Column: Historical Unified Diff & Stored Source */}
        <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
          <ReplayDiffViewer
            selectedFile={selectedFile}
            changedFiles={currentEntry?.changed_files || []}
            changedSymbols={currentEntry?.changed_symbols || []}
            onSelectFile={setSelectedFile}
            getHistoricalContent={getHistoricalContent}
            entry={currentEntry}
            completenessInfo={completenessInfo}
            isModelNarrationAvailable={hasModelChapters}
          />
        </div>

        {/* Right Column: Evidence, Nearby Tests, & Claims Inspector */}
        <ReplayEvidenceInspector
          narration={narration}
          tests={testsForCurrentSeq}
          limitations={limitations}
          isNarrationOn={isNarrationOn}
        />
      </div>
    </div>
  );
};
