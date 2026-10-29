import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReplayTimelineBar } from '../components/replay/ReplayTimelineBar';
import type { TimelineEntry, ReplayChapter, StructuredTestEvidence } from '../replay/types';

function createMockTimeline(): TimelineEntry[] {
  return [
    {
      sequence: 1,
      record_id: 'rec-1',
      record_type: 'initial_snapshot',
      captured_at: '2026-10-28T14:00:00.000000Z',
      completeness: 'complete',
      attribution_status: 'observed_checkpoint',
      tool_name: null,
      tool_use_id: null,
      before_manifest_id: null,
      after_manifest_id: 'man-1',
      changed_files: [],
      changed_symbols: [],
      test_evidence: [],
      prompt_or_tool_evidence_redacted: false,
      gap_reason: null,
    },
    {
      sequence: 2,
      record_id: 'rec-2',
      record_type: 'pre_tool',
      captured_at: '2026-10-28T14:01:00.000000Z',
      completeness: 'complete',
      attribution_status: 'tool_boundary',
      tool_name: 'write_file',
      tool_use_id: 'call-101',
      before_manifest_id: 'man-1',
      after_manifest_id: 'man-1',
      changed_files: [],
      changed_symbols: [],
      test_evidence: [],
      prompt_or_tool_evidence_redacted: false,
      gap_reason: null,
    },
    {
      sequence: 3,
      record_id: 'rec-3',
      record_type: 'post_tool',
      captured_at: '2026-10-28T14:01:04.500000Z',
      completeness: 'complete',
      attribution_status: 'tool_boundary',
      tool_name: 'write_file',
      tool_use_id: 'call-101',
      before_manifest_id: 'man-1',
      after_manifest_id: 'man-2',
      changed_files: [
        {
          path: 'src/main.ts',
          change: 'modified',
          before_sha256: 'a'.repeat(64),
          after_sha256: 'b'.repeat(64),
          unified_diff: '+10 -2',
        },
      ],
      changed_symbols: [],
      test_evidence: [],
      prompt_or_tool_evidence_redacted: false,
      gap_reason: null,
    },
    {
      sequence: 4,
      record_id: 'rec-4',
      record_type: 'gap',
      captured_at: '2026-10-28T14:02:00.000000Z',
      completeness: 'partial',
      attribution_status: 'unknown',
      tool_name: null,
      tool_use_id: null,
      before_manifest_id: null,
      after_manifest_id: null,
      changed_files: [],
      changed_symbols: [],
      test_evidence: [],
      prompt_or_tool_evidence_redacted: false,
      gap_reason: 'sequence loss during rotation',
    },
    {
      sequence: 5,
      record_id: 'rec-5',
      record_type: 'checkpoint',
      captured_at: '2026-10-28T14:03:00.000000Z',
      completeness: 'complete',
      attribution_status: 'observed_checkpoint',
      tool_name: null,
      tool_use_id: null,
      before_manifest_id: 'man-2',
      after_manifest_id: 'man-3',
      changed_files: [],
      changed_symbols: [],
      test_evidence: [],
      prompt_or_tool_evidence_redacted: false,
      gap_reason: null,
    },
    {
      sequence: 6,
      record_id: 'rec-6',
      record_type: 'checkpoint',
      captured_at: '2026-10-28T14:35:00.000000Z', // 32 minutes idle break
      completeness: 'complete',
      attribution_status: 'observed_checkpoint',
      tool_name: null,
      tool_use_id: null,
      before_manifest_id: 'man-3',
      after_manifest_id: 'man-4',
      changed_files: [],
      changed_symbols: [],
      test_evidence: [],
      prompt_or_tool_evidence_redacted: false,
      gap_reason: null,
    },
    {
      sequence: 7,
      record_id: 'rec-7',
      record_type: 'checkpoint',
      captured_at: '2026-10-28T14:36:00.000000Z',
      completeness: 'complete',
      attribution_status: 'observed_checkpoint',
      tool_name: null,
      tool_use_id: null,
      before_manifest_id: 'man-4',
      after_manifest_id: 'man-5',
      changed_files: [],
      changed_symbols: [],
      test_evidence: [],
      prompt_or_tool_evidence_redacted: false,
      gap_reason: null,
    },
  ];
}

function createMockChapters(): ReplayChapter[] {
  return [
    {
      id: 'ch-1',
      start_sequence: 1,
      end_sequence: 3,
      title: 'Initialize workspace and configure tools',
      evidence_refs: [],
      source: 'deterministic_prompt_turn',
      title_status: 'deterministic template',
    },
    {
      id: 'ch-2',
      start_sequence: 4,
      end_sequence: 7,
      title: 'Refactor core modules and verify tests',
      evidence_refs: [],
      source: 'model',
      title_status: 'model interpretation',
    },
  ];
}

function createMockTests(): StructuredTestEvidence[] {
  return [
    {
      schema_version: 'replay-store-1.0',
      id: 'test-ev-1',
      session_id: 'session-001',
      observed_at: '2026-10-28T14:01:05.000000Z',
      state: 'pass',
      suite_scope: 'tests/test_tools.py',
      source: 'pytest',
      association: 'content_identity',
      command_record_id: 'rec-3',
      command_exit_code: 0,
      associated_manifest_id: 'man-2',
      counts: null,
      tests: [],
      output_missing: false,
      partial: false,
    },
    {
      schema_version: 'replay-store-1.0',
      id: 'test-ev-2',
      session_id: 'session-001',
      observed_at: '2026-10-28T14:35:01.000000Z',
      state: 'fail',
      suite_scope: 'tests/test_core.py',
      source: 'pytest',
      association: 'content_identity',
      command_record_id: 'rec-6',
      command_exit_code: 1,
      associated_manifest_id: 'man-4',
      counts: null,
      tests: [],
      output_missing: false,
      partial: false,
    },
  ];
}

describe('ReplayTimelineBar Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders clean empty state when timeline is empty', () => {
    const onSelect = vi.fn();
    render(
      <ReplayTimelineBar
        timeline={[]}
        currentSequence={1}
        onSelectSequence={onSelect}
      />
    );

    const bar = screen.getByTestId('replay-timeline-bar');
    expect(bar).toBeDefined();
    expect(bar.getAttribute('role')).toBe('slider');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('0');
    expect(screen.getByText('No recorded steps in timeline')).toBeDefined();
  });

  it('renders single step session correctly', () => {
    const singleStepTimeline: TimelineEntry[] = [createMockTimeline()[0]];
    const onSelect = vi.fn();

    render(
      <ReplayTimelineBar
        timeline={singleStepTimeline}
        currentSequence={1}
        onSelectSequence={onSelect}
      />
    );

    const bar = screen.getByTestId('replay-timeline-bar');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemin')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('1');

    const thumb = screen.getByTestId('timeline-thumb');
    expect(thumb).toBeDefined();
    expect(thumb.style.left).toBe('0%');

    const ticks = screen.getAllByTestId('timeline-step-tick');
    expect(ticks).toHaveLength(1);
    expect(screen.getByText('Step #1 of 1')).toBeDefined();
  });

  it('renders all hero bar visual elements for multi-step session', () => {
    const timeline = createMockTimeline();
    const chapters = createMockChapters();
    const tests = createMockTests();
    const onSelect = vi.fn();

    render(
      <ReplayTimelineBar
        timeline={timeline}
        currentSequence={3}
        onSelectSequence={onSelect}
        chapters={chapters}
        tests={tests}
        options={{ timeZone: 'UTC' }}
      />
    );

    // 1. Accessibility attributes
    const bar = screen.getByTestId('replay-timeline-bar');
    expect(bar.getAttribute('role')).toBe('slider');
    expect(bar.getAttribute('aria-label')).toBe('Timeline scrubber');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemin')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('7');
    expect(bar.getAttribute('aria-valuetext')).toContain('Step 3 of 7');

    // 2. Chapter Lane & Segments
    const chapterLane = screen.getByTestId('timeline-chapter-lane');
    expect(chapterLane).toBeDefined();

    const chapterSegments = screen.getAllByTestId('timeline-chapter-segment');
    expect(chapterSegments).toHaveLength(2);
    expect(chapterSegments[0].textContent).toContain('Initialize workspace and configure tools');
    expect(chapterSegments[0].classList.contains('replay-timeline-chapter-model')).toBe(false);

    expect(chapterSegments[1].textContent).toContain('Refactor core modules and verify tests');
    expect(chapterSegments[1].classList.contains('replay-timeline-chapter-model')).toBe(true);
    expect(chapterSegments[1].textContent).toContain('model');

    // 3. Step Ticks
    const ticks = screen.getAllByTestId('timeline-step-tick');
    expect(ticks).toHaveLength(7);
    expect(ticks[2].classList.contains('tick-selected')).toBe(true); // step 3 is selected
    expect(ticks[2].classList.contains('tick-tool')).toBe(true); // step 3 is post_tool

    // 4. Axis Break (32m idle between step 5 and 6)
    const axisBreaks = screen.getAllByTestId('timeline-axis-break');
    expect(axisBreaks.length).toBeGreaterThan(0);
    expect(axisBreaks[0].textContent).toContain('32m idle');

    // 5. Gap Region (Step 4 is gap)
    const gapRegions = screen.getAllByTestId('timeline-gap-region');
    expect(gapRegions.length).toBeGreaterThanOrEqual(1);
    expect(gapRegions[0].textContent).toContain('GAP');

    // 6. Test Markers
    const testMarkers = screen.getAllByTestId('timeline-test-marker');
    expect(testMarkers).toHaveLength(2);
    expect(testMarkers[0].classList.contains('test-pass')).toBe(true);
    expect(testMarkers[1].classList.contains('test-fail')).toBe(true);

    // 7. Hero Thumb Scrubber
    const thumb = screen.getByTestId('timeline-thumb');
    expect(thumb).toBeDefined();

    // 8. Footer Strip
    expect(screen.getByTestId('timeline-bar-footer')).toBeDefined();
    expect(screen.getByTestId('timeline-step-indicator').textContent).toContain('Step #3 of 7');
    expect(screen.getByTestId('timeline-step-indicator').textContent).toContain('tool: write_file');
    expect(screen.getByTestId('timeline-step-indicator').textContent).toContain('(4.5s)');
  });

  it('honors Rule 2: clicking track snaps to the nearest recorded step', () => {
    const timeline = createMockTimeline();
    const onSelect = vi.fn();

    render(
      <ReplayTimelineBar
        timeline={timeline}
        currentSequence={1}
        onSelectSequence={onSelect}
      />
    );

    const track = screen.getByTestId('timeline-track-lane');

    // Mock bounding rect: 1000px wide, from x=0 to x=1000
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 100,
      right: 1000,
      bottom: 132,
      width: 1000,
      height: 32,
      x: 0,
      y: 100,
      toJSON: () => {},
    });

    // Click at clientX = 0 (beginning)
    fireEvent.click(track, { clientX: 0 });
    expect(onSelect).toHaveBeenCalledWith(1);

    // Click near step 7 (end) at clientX = 1000
    fireEvent.click(track, { clientX: 1000 });
    expect(onSelect).toHaveBeenCalledWith(7);

    // Verify all selected sequences are strictly recorded steps
    for (const call of onSelect.mock.calls) {
      const selectedSeq = call[0];
      const stepExists = timeline.some((s) => s.sequence === selectedSeq);
      expect(stepExists).toBe(true);
    }
  });

  it('honors Rule 2: dragging thumb snaps sequentially to nearest steps', () => {
    const timeline = createMockTimeline();
    const onSelect = vi.fn();

    render(
      <ReplayTimelineBar
        timeline={timeline}
        currentSequence={1}
        onSelectSequence={onSelect}
      />
    );

    const track = screen.getByTestId('timeline-track-lane');

    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 100,
      right: 1000,
      bottom: 132,
      width: 1000,
      height: 32,
      x: 0,
      y: 100,
      toJSON: () => {},
    });

    // Start drag at step 1
    fireEvent.pointerDown(track, { clientX: 10, button: 0 });

    // Move pointer across track
    fireEvent.pointerMove(track, { clientX: 300 });
    fireEvent.pointerMove(track, { clientX: 600 });
    fireEvent.pointerMove(track, { clientX: 950 });

    // End drag
    fireEvent.pointerUp(track, { clientX: 950 });

    // Check that onSelect was called and all calls were valid monotonic step sequences
    expect(onSelect).toHaveBeenCalled();
    for (const call of onSelect.mock.calls) {
      const seq = call[0];
      expect(typeof seq).toBe('number');
      expect(seq).toBeGreaterThanOrEqual(1);
      expect(seq).toBeLessThanOrEqual(7);
    }
  });

  it('clicking a chapter segment navigates to its start_sequence', () => {
    const timeline = createMockTimeline();
    const chapters = createMockChapters();
    const onSelect = vi.fn();

    render(
      <ReplayTimelineBar
        timeline={timeline}
        currentSequence={1}
        onSelectSequence={onSelect}
        chapters={chapters}
      />
    );

    const chapterSegments = screen.getAllByTestId('timeline-chapter-segment');

    // Click chapter 2 (start_sequence: 4)
    fireEvent.click(chapterSegments[1]);
    expect(onSelect).toHaveBeenCalledWith(4);
  });

  it('clicking a test marker navigates to its associated sequence', () => {
    const timeline = createMockTimeline();
    const tests = createMockTests();
    const onSelect = vi.fn();

    render(
      <ReplayTimelineBar
        timeline={timeline}
        currentSequence={1}
        onSelectSequence={onSelect}
        tests={tests}
      />
    );

    const testMarkers = screen.getAllByTestId('timeline-test-marker');

    // Test marker 0 is linked to rec-3 (sequence 3)
    fireEvent.click(testMarkers[0]);
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('supports full keyboard navigation (arrows, j/k, Home/End, PgUp/PgDn)', () => {
    const timeline = createMockTimeline();
    const chapters = createMockChapters();
    const onSelect = vi.fn();

    const { rerender } = render(
      <ReplayTimelineBar
        timeline={timeline}
        currentSequence={3}
        onSelectSequence={onSelect}
        chapters={chapters}
      />
    );

    const bar = screen.getByTestId('replay-timeline-bar');

    // 1. ArrowLeft / j (previous step)
    fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledWith(2);

    fireEvent.keyDown(bar, { key: 'j' });
    expect(onSelect).toHaveBeenCalledWith(2);

    // 2. ArrowRight / k (next step)
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith(4);

    fireEvent.keyDown(bar, { key: 'k' });
    expect(onSelect).toHaveBeenCalledWith(4);

    // 3. Home (first step)
    fireEvent.keyDown(bar, { key: 'Home' });
    expect(onSelect).toHaveBeenCalledWith(1);

    // 4. End (last step)
    fireEvent.keyDown(bar, { key: 'End' });
    expect(onSelect).toHaveBeenCalledWith(7);

    // 5. PageDown (next chapter start)
    // From sequence 3 (in chapter 1), PageDown jumps to chapter 2 start (sequence 4)
    fireEvent.keyDown(bar, { key: 'PageDown' });
    expect(onSelect).toHaveBeenCalledWith(4);

    // 6. PageUp (previous chapter start or current chapter start)
    // Rerender at sequence 5 (in middle of chapter 2, start is 4)
    rerender(
      <ReplayTimelineBar
        timeline={timeline}
        currentSequence={5}
        onSelectSequence={onSelect}
        chapters={chapters}
      />
    );
    fireEvent.keyDown(bar, { key: 'PageUp' });
    expect(onSelect).toHaveBeenCalledWith(4); // jumps to current chapter start

    // Rerender at sequence 4 (at chapter 2 start)
    rerender(
      <ReplayTimelineBar
        timeline={timeline}
        currentSequence={4}
        onSelectSequence={onSelect}
        chapters={chapters}
      />
    );
    fireEvent.keyDown(bar, { key: 'PageUp' });
    expect(onSelect).toHaveBeenCalledWith(1); // jumps to previous chapter start
  });

  it('prevents boundary overshoots during keyboard navigation', () => {
    const timeline = createMockTimeline();
    const onSelect = vi.fn();

    // At step 1, ArrowLeft should not call with 0
    const { rerender } = render(
      <ReplayTimelineBar
        timeline={timeline}
        currentSequence={1}
        onSelectSequence={onSelect}
      />
    );

    const bar = screen.getByTestId('replay-timeline-bar');
    fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(onSelect).not.toHaveBeenCalled();

    // At step 7 (last), ArrowRight should not call with 8
    rerender(
      <ReplayTimelineBar
        timeline={timeline}
        currentSequence={7}
        onSelectSequence={onSelect}
      />
    );

    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders hover tooltips for chapters, gaps, idle breaks, and test markers', () => {
    const timeline = createMockTimeline();
    const chapters = createMockChapters();
    const tests = createMockTests();
    const onSelect = vi.fn();

    render(
      <ReplayTimelineBar
        timeline={timeline}
        currentSequence={1}
        onSelectSequence={onSelect}
        chapters={chapters}
        tests={tests}
        options={{ timeZone: 'UTC' }}
      />
    );

    const track = screen.getByTestId('timeline-track-lane');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 100,
      right: 1000,
      bottom: 132,
      width: 1000,
      height: 32,
      x: 0,
      y: 100,
      toJSON: () => {},
    });

    // 1. Chapter 1 hover (clean deterministic chapter)
    const chapterSegments = screen.getAllByTestId('timeline-chapter-segment');
    fireEvent.mouseEnter(chapterSegments[0]);

    let tooltip = screen.getByTestId('timeline-tooltip');
    expect(tooltip).toBeDefined();
    expect(tooltip.textContent).toContain('Initialize workspace and configure tools');
    expect(tooltip.textContent).toContain('Steps #1–#3');
    expect(tooltip.textContent).toContain('Deterministic template');

    // 2. Chapter 2 hover (spans gap step 4 -> shows discontinuous)
    fireEvent.mouseEnter(chapterSegments[1]);
    tooltip = screen.getByTestId('timeline-tooltip');
    expect(tooltip.textContent).toContain('Refactor core modules and verify tests');
    expect(tooltip.textContent).toContain('Steps #4–#7');
    expect(tooltip.textContent).toContain('Discontinuous (contains unrecorded gap)');
    expect(tooltip.textContent).toContain('Model interpretation');

    // 3. Gap region hover
    const gapRegions = screen.getAllByTestId('timeline-gap-region');
    fireEvent.mouseEnter(gapRegions[0]);
    tooltip = screen.getByTestId('timeline-tooltip');
    expect(tooltip.textContent).toContain('Unrecorded Gap: sequence loss during rotation');
    expect(tooltip.textContent).toContain('Elapsed wall-clock time unknown');

    // 4. Axis break hover
    const axisBreaks = screen.getAllByTestId('timeline-axis-break');
    fireEvent.mouseEnter(axisBreaks[0]);
    tooltip = screen.getByTestId('timeline-tooltip');
    expect(tooltip.textContent).toContain('Idle Break: 32m idle');
    expect(tooltip.textContent).toContain('Between step #5 and #6');

    // 5. Test marker hover
    const testMarkers = screen.getAllByTestId('timeline-test-marker');
    fireEvent.mouseEnter(testMarkers[1]); // failing test
    tooltip = screen.getByTestId('timeline-tooltip');
    expect(tooltip.textContent).toContain('Test: test-ev-2 [FAIL]');
    expect(tooltip.textContent).toContain('Scope: tests/test_core.py');

    // 6. Mouse leave clears tooltip
    const bar = screen.getByTestId('replay-timeline-bar');
    fireEvent.mouseLeave(bar);
    expect(screen.queryByTestId('timeline-tooltip')).toBeNull();
  });
});
