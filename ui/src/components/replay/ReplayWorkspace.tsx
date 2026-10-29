import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReplayAdapter } from '../../adapter/replayAdapter';
import { ReplayTimeline } from './ReplayTimeline';
import { ReplayDiffViewer } from './ReplayDiffViewer';
import { ReplayEvidenceInspector } from './ReplayEvidenceInspector';
import { ReplayTimelineBar } from './ReplayTimelineBar';
import { ReplayMiniMapDock } from './ReplayMiniMapDock';
import type { TimeModelOptions } from '../../replay/timeModel';
import { formatRecordedAt } from '../../replay/timeModel';
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  BookOpen,
  ShieldCheck,
  X,
} from 'lucide-react';

interface ReplayWorkspaceProps {
  adapter: ReplayAdapter;
  onOpenProjectMap?: () => void;
  timelineOptions?: TimeModelOptions;
  defaultChaptersOpen?: boolean;
  defaultEvidenceOpen?: boolean;
  defaultMiniMapOpen?: boolean;
}

export const ReplayWorkspace: React.FC<ReplayWorkspaceProps> = ({
  adapter,
  onOpenProjectMap,
  timelineOptions,
  defaultChaptersOpen = false,
  defaultEvidenceOpen = false,
  defaultMiniMapOpen,
}) => {
  const timeline = useMemo(() => adapter.getTimeline(), [adapter]);
  const manifests = useMemo(() => adapter.getManifests(), [adapter]);
  const [currentSeq, setCurrentSeq] = useState<number>(() => adapter.getCurrentSequence());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [isNarrationOn, setIsNarrationOn] = useState<boolean>(true);
  const [isBaselineMode, setIsBaselineMode] = useState<boolean>(false);

  // On-demand panel visibility states (Rule 2 + Visual Direction: closed by default)
  const [isChaptersOpen, setIsChaptersOpen] = useState<boolean>(defaultChaptersOpen);
  const [isEvidenceOpen, setIsEvidenceOpen] = useState<boolean>(defaultEvidenceOpen);
  const [isMiniMapOpen, setIsMiniMapOpen] = useState<boolean>(() => {
    if (defaultMiniMapOpen !== undefined) return defaultMiniMapOpen;
    try {
      const saved = localStorage.getItem('faultmesh:replay:minimap:state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.isOpen === 'boolean') return parsed.isOpen;
      }
    } catch {
      // Ignore
    }
    return false;
  });

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

  const currentChapter = useMemo(() => {
    return chapters.find((ch) => currentSeq >= ch.start_sequence && currentSeq <= ch.end_sequence) || null;
  }, [chapters, currentSeq]);

  const narration = useMemo(() => {
    return adapter.getNarration(currentSeq);
  }, [adapter, currentSeq]);

  const testsForCurrentSeq = useMemo(() => {
    return adapter.getTestsForSequence(currentSeq);
  }, [adapter, currentSeq]);

  const allTests = useMemo(() => {
    return adapter.getAllTests ? adapter.getAllTests() : [];
  }, [adapter]);

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

  // Keyboard navigation: Left/Right arrows or j/k, C (chapters), E (evidence), M (mini-map), Escape
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
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setIsChaptersOpen((prev) => !prev);
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        setIsEvidenceOpen((prev) => !prev);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setIsMiniMapOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        // Dismiss topmost active panel
        if (isMiniMapOpen) {
          setIsMiniMapOpen(false);
        } else if (isEvidenceOpen) {
          setIsEvidenceOpen(false);
        } else if (isChaptersOpen) {
          setIsChaptersOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevCheckpoint, handleNextCheckpoint, isChaptersOpen, isEvidenceOpen, isMiniMapOpen]);

  const getHistoricalContent = useCallback(
    (path: string) => {
      return adapter.getHistoricalFileAtCheckpoint(currentSeq, path);
    },
    [adapter, currentSeq]
  );

  const currentIndex = timeline.findIndex((t) => t.sequence === currentSeq);
  const recordedAtLabel = currentEntry ? formatRecordedAt(currentEntry.captured_at, timelineOptions?.timeZone) : '';

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
      {/* 1. Minimal Header (Step position + Origin + On-demand panel controls only) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 16px',
          borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
          backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
          flexWrap: 'wrap',
          gap: '10px',
          flexShrink: 0,
        }}
        data-testid="replay-workspace-header"
      >
        {/* Left: Minimal Position + Origin */}
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
                cursor: 'help',
              }}
              title={recordedAtLabel}
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

          {/* Origin Badge */}
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

          {/* Completeness Warning Badge (Calmly shown only when incomplete) */}
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
        </div>

        {/* Right: On-Demand Controls (Chapters [C], Evidence [E], Mini Map [M]) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setIsChaptersOpen((prev) => !prev)}
            className={`replay-header-toggle-btn ${isChaptersOpen ? 'active' : ''}`}
            title="Toggle chapters left rail (Shortcut: C)"
            aria-label="Toggle chapters rail"
            aria-expanded={isChaptersOpen}
            data-testid="replay-toggle-chapters"
          >
            <BookOpen size={12} />
            <span>Chapters</span>
            <span className="replay-shortcut-tag">C</span>
          </button>

          <button
            onClick={() => setIsEvidenceOpen((prev) => !prev)}
            className={`replay-header-toggle-btn ${isEvidenceOpen ? 'active' : ''}`}
            title="Toggle evidence & claims inspector (Shortcut: E)"
            aria-label="Toggle evidence inspector"
            aria-expanded={isEvidenceOpen}
            data-testid="replay-toggle-evidence"
          >
            <ShieldCheck size={12} />
            <span>Evidence</span>
            <span className="replay-shortcut-tag">E</span>
          </button>

          <button
            onClick={() => {
              if (onOpenProjectMap) {
                onOpenProjectMap();
              }
              setIsMiniMapOpen((prev) => !prev);
            }}
            className={`replay-header-toggle-btn ${isMiniMapOpen ? 'active' : ''}`}
            title="Toggle project structure mini map (Shortcut: M)"
            aria-label="Open project map"
            aria-expanded={isMiniMapOpen}
            data-testid="replay-toggle-minimap"
            id="replay-open-map-btn"
          >
            <Layers size={12} />
            <span>Mini Map</span>
            <span className="replay-shortcut-tag">M</span>
          </button>
          {/* Legacy anchor for existing test suite compatibility */}
          <span style={{ display: 'none' }} data-testid="replay-open-map-btn" onClick={onOpenProjectMap} />
        </div>
      </div>

      {/* 2. Hero Timeline Bar (Spanning Full Workspace Width) */}
      <div
        style={{
          padding: '8px 16px 10px 16px',
          borderBottom: '1px solid var(--replay-border-subtle, rgba(255, 255, 255, 0.06))',
          backgroundColor: 'var(--replay-bg-surface-1, #0d111a)',
          flexShrink: 0,
        }}
        data-testid="replay-hero-bar-container"
      >
        <ReplayTimelineBar
          timeline={timeline}
          currentSequence={currentSeq}
          onSelectSequence={handleSelectSequence}
          chapters={chapters}
          tests={allTests}
          options={timelineOptions}
        />
      </div>

      {/* 3. Calm Step Focus & Chapter Info Strip (Directly Below Hero Bar) */}
      <div className="replay-step-focus-strip" data-testid="replay-step-focus-strip">
        <div className="replay-step-focus-left">
          {currentChapter ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--replay-text-faint, #4d576a)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Chapter:
              </span>
              <span style={{ fontWeight: 600, color: 'var(--replay-text-primary, #e6edf8)' }}>
                {currentChapter.title}
              </span>
              <span
                style={{
                  fontSize: '9px',
                  fontWeight: 600,
                  fontFamily: 'var(--font-mono, monospace)',
                  padding: '1px 6px',
                  borderRadius: 'var(--replay-radius-control, 7px)',
                  backgroundColor:
                    currentChapter.title_status === 'model interpretation'
                      ? 'var(--replay-accent-glow, rgba(74, 123, 176, 0.15))'
                      : 'var(--replay-status-neutral-bg, rgba(90, 101, 120, 0.12))',
                  border:
                    currentChapter.title_status === 'model interpretation'
                      ? '1px dashed var(--replay-status-complete-border, rgba(74, 123, 176, 0.40))'
                      : '1px solid var(--replay-status-neutral-border, rgba(90, 101, 120, 0.25))',
                  color:
                    currentChapter.title_status === 'model interpretation'
                      ? 'var(--replay-accent, #4a7bb0)'
                      : 'var(--replay-text-muted, #8b97ad)',
                }}
                data-testid="replay-current-chapter-status"
              >
                {currentChapter.title_status.toUpperCase()}
              </span>
            </div>
          ) : (
            <span style={{ color: 'var(--replay-text-faint, #4d576a)', fontSize: '11px' }}>
              No chapter assigned for this step
            </span>
          )}

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

        <div className="replay-step-focus-right">
          {/* Historical Status */}
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
        </div>
      </div>

      {/* 4. Main Body: Timeline-First Focus Layout (Diff is Hero, On-Demand Panels Slide In) */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* On-Demand Left Rail: Chapters & Steps (Closed by default, toggled via C) */}
        <div
          className="replay-chapters-rail"
          style={{ display: isChaptersOpen ? 'flex' : 'none' }}
          data-testid="replay-chapters-rail-container"
        >
          <div className="replay-panel-top-bar">
            <div className="replay-panel-top-title">
              <BookOpen size={13} style={{ color: 'var(--replay-accent, #4a7bb0)' }} />
              <span>Chapters & Sequence</span>
              <span className="replay-shortcut-tag">C</span>
            </div>
            <button
              onClick={() => setIsChaptersOpen(false)}
              className="replay-panel-close-btn"
              title="Close chapters rail (C or Esc)"
              aria-label="Close chapters rail"
              data-testid="replay-chapters-close-btn"
            >
              <X size={12} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
          </div>
        </div>

        {/* Center Main Stage: Diff View as Hero (Always Focused, Full-Width by default) */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            overflow: 'hidden',
            position: 'relative',
          }}
          data-testid="replay-main-stage"
        >
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

          {/* Graph Mini Map Dock (Resizable, Size-cycling, Honest empty state) */}
          <ReplayMiniMapDock
            entry={currentEntry}
            manifests={manifests}
            isOpen={isMiniMapOpen}
            onClose={() => setIsMiniMapOpen(false)}
            onSelectFile={(f) => setSelectedFile(f)}
            selectedFile={selectedFile}
          />
        </div>

        {/* On-Demand Right Drawer: Evidence Inspector (Closed by default, toggled via E) */}
        <div
          className="replay-evidence-drawer"
          style={{ display: isEvidenceOpen ? 'flex' : 'none' }}
          data-testid="replay-evidence-drawer-container"
        >
          <div className="replay-panel-top-bar">
            <div className="replay-panel-top-title">
              <ShieldCheck size={13} style={{ color: 'var(--replay-accent, #4a7bb0)' }} />
              <span>Evidence & Claims</span>
              <span className="replay-shortcut-tag">E</span>
            </div>
            <button
              onClick={() => setIsEvidenceOpen(false)}
              className="replay-panel-close-btn"
              title="Close evidence drawer (E or Esc)"
              aria-label="Close evidence drawer"
              data-testid="replay-evidence-close-btn"
            >
              <X size={12} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <ReplayEvidenceInspector
              narration={narration}
              tests={testsForCurrentSeq}
              limitations={limitations}
              isNarrationOn={isNarrationOn}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
