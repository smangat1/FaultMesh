import { describe, it, expect } from 'vitest';
import {
  computeTimelineBarGeometry,
  formatRecordedAt,
  formatIdleDuration,
  type TimeModelOptions,
} from '../replay/timeModel';
import type {
  TimelineEntry,
  StructuredTestEvidence,
  ReplayChapter,
} from '../replay/types';

function createEntry(overrides: Partial<TimelineEntry> & { sequence: number }): TimelineEntry {
  return {
    sequence: overrides.sequence,
    record_id: overrides.record_id ?? `rec-${overrides.sequence}`,
    record_type: overrides.record_type ?? 'checkpoint',
    captured_at:
      overrides.captured_at ??
      new Date(Date.UTC(2026, 9, 28, 14, 0, overrides.sequence * 10)).toISOString(),
    completeness: overrides.completeness ?? 'complete',
    attribution_status: overrides.attribution_status ?? 'tool_boundary',
    tool_name: overrides.tool_name ?? null,
    tool_use_id: overrides.tool_use_id ?? null,
    before_manifest_id: overrides.before_manifest_id ?? null,
    after_manifest_id: overrides.after_manifest_id ?? null,
    changed_files: overrides.changed_files ?? [],
    changed_symbols: overrides.changed_symbols ?? [],
    test_evidence: overrides.test_evidence ?? [],
    prompt_or_tool_evidence_redacted: overrides.prompt_or_tool_evidence_redacted ?? false,
    gap_reason: overrides.gap_reason ?? null,
  };
}

function createTestEvidence(
  overrides: Partial<StructuredTestEvidence> & { id: string; state: StructuredTestEvidence['state'] }
): StructuredTestEvidence {
  return {
    schema_version: 'replay-store-1.0',
    id: overrides.id,
    session_id: overrides.session_id ?? 'session-1',
    observed_at: overrides.observed_at ?? '2026-10-28T14:00:00Z',
    state: overrides.state,
    suite_scope: overrides.suite_scope ?? 'unit',
    source: overrides.source ?? 'pytest',
    command_record_id: overrides.command_record_id ?? null,
    command_exit_code: overrides.command_exit_code ?? 0,
    associated_manifest_id: overrides.associated_manifest_id ?? null,
    association: overrides.association ?? 'none',
    counts: overrides.counts ?? null,
    tests: overrides.tests ?? [],
    output_missing: overrides.output_missing ?? false,
    partial: overrides.partial ?? false,
  };
}

describe('timeModel', () => {
  describe('formatRecordedAt', () => {
    it('formats ISO timestamp into local wall-clock time string by default', () => {
      const iso = '2026-10-28T14:03:22.547Z';
      const expectedTime = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(new Date(iso));
      expect(formatRecordedAt(iso)).toBe(`recorded at ${expectedTime}`);
    });

    it('formats timestamp in specified non-UTC time zones', () => {
      // America/New_York is EDT (UTC-4) in October: 14:03 UTC -> 10:03 AM EDT
      const ny = formatRecordedAt('2026-10-28T14:03:22.547Z', 'America/New_York');
      expect(ny).toBe('recorded at 10:03:22 AM');

      // America/Los_Angeles is PDT (UTC-7) in October: 14:03 UTC -> 7:03 AM PDT
      const la = formatRecordedAt('2026-10-28T14:03:22.547Z', 'America/Los_Angeles');
      expect(la).toBe('recorded at 7:03:22 AM');

      // Asia/Tokyo is JST (UTC+9): 14:03 UTC -> 23:03 (11:03 PM) JST
      const tokyo = formatRecordedAt('2026-10-28T14:03:22.547Z', 'Asia/Tokyo');
      expect(tokyo).toBe('recorded at 11:03:22 PM');
    });

    it('formats timestamp in UTC when explicitly requested', () => {
      const utc = formatRecordedAt('2026-10-28T14:03:22.547Z', 'UTC');
      expect(utc).toBe('recorded at 2:03:22 PM');
    });

    it('handles invalid timestamp gracefully', () => {
      const formatted = formatRecordedAt('not-a-date');
      expect(formatted).toBe('recorded at not-a-date');
    });
  });

  describe('formatIdleDuration', () => {
    it('formats minutes idle', () => {
      expect(formatIdleDuration(15 * 60 * 1000)).toBe('15m idle');
    });

    it('formats hours and minutes idle', () => {
      expect(formatIdleDuration(2 * 3600 * 1000 + 14 * 60 * 1000)).toBe('2h 14m idle');
    });

    it('formats seconds idle', () => {
      expect(formatIdleDuration(45 * 1000)).toBe('45s idle');
    });
  });

  describe('computeTimelineBarGeometry', () => {
    it('scenario 1: handles empty session cleanly', () => {
      const geom = computeTimelineBarGeometry({ timeline: [] });
      expect(geom.steps).toHaveLength(0);
      expect(geom.chapterSegments).toHaveLength(0);
      expect(geom.testMarkers).toHaveLength(0);
      expect(geom.axisBreaks).toHaveLength(0);
      expect(geom.gapRegions).toHaveLength(0);
      expect(geom.totalVirtualWeight).toBe(0);
      expect(geom.findNearestStep(0.5)).toBeNull();
      expect(geom.getStepBySequence(1)).toBeNull();
    });

    it('scenario 2: handles single step session', () => {
      const entry = createEntry({
        sequence: 1,
        record_id: 'rec-init',
        record_type: 'initial_snapshot',
        captured_at: '2026-10-28T14:00:00Z',
      });
      const chapter: ReplayChapter = {
        id: 'ch-1',
        title: 'Initial Chapter',
        start_sequence: 1,
        end_sequence: 1,
        source: 'deterministic_prompt_turn',
        title_status: 'deterministic template',
        evidence_refs: [],
      };

      const geom = computeTimelineBarGeometry({
        timeline: [entry],
        chapters: [chapter],
      });

      expect(geom.steps).toHaveLength(1);
      const step = geom.steps[0];
      expect(step.sequence).toBe(1);
      expect(step.positionRatio).toBe(0.0);
      expect(step.timeLabel).toBe(formatRecordedAt(entry.captured_at));
      expect(step.isGap).toBe(false);

      expect(geom.chapterSegments).toHaveLength(1);
      expect(geom.chapterSegments[0].startRatio).toBe(0.0);
      expect(geom.chapterSegments[0].endRatio).toBe(0.0);
      expect(geom.chapterSegments[0].durationMs).toBe(0);

      // Snapping always resolves to the single step
      expect(geom.findNearestStep(0.0)?.sequence).toBe(1);
      expect(geom.findNearestStep(0.75)?.sequence).toBe(1);
      expect(geom.getStepBySequence(1)?.sequence).toBe(1);
      expect(geom.getStepBySequence(99)).toBeNull();
    });

    it('scenario 3: normal run with proportional time spacing', () => {
      // 3 steps: t=0s (seq 0), t=10s (seq 1), t=30s (seq 2)
      const t0 = new Date(Date.UTC(2026, 9, 28, 14, 0, 0)).toISOString();
      const t1 = new Date(Date.UTC(2026, 9, 28, 14, 0, 10)).toISOString();
      const t2 = new Date(Date.UTC(2026, 9, 28, 14, 0, 30)).toISOString();

      const timeline: TimelineEntry[] = [
        createEntry({ sequence: 0, captured_at: t0, record_type: 'initial_snapshot' }),
        createEntry({ sequence: 1, captured_at: t1, record_type: 'checkpoint' }),
        createEntry({ sequence: 2, captured_at: t2, record_type: 'checkpoint' }),
      ];

      const options: TimeModelOptions = {
        minIntervalWeightMs: 1000, // 1s min
        idleThresholdMs: 300000, // 5m
      };

      const geom = computeTimelineBarGeometry({ timeline, options });

      expect(geom.steps).toHaveLength(3);
      expect(geom.steps[0].positionRatio).toBe(0.0);
      expect(geom.steps[2].positionRatio).toBe(1.0);

      // Interval 0->1 is 10s (10000ms), Interval 1->2 is 20s (20000ms).
      // Total virtual weight = 30000ms.
      // Ratio of step 1: 10000 / 30000 = ~0.3333
      expect(geom.steps[1].positionRatio).toBeCloseTo(1 / 3, 3);
      expect(geom.axisBreaks).toHaveLength(0);
      expect(geom.gapRegions).toHaveLength(0);
    });

    it('scenario 4: idle stretch over threshold caps weight and creates AxisBreak', () => {
      // 3 steps:
      // seq 0: t = 0s
      // seq 1: t = 60s (1m later)
      // seq 2: t = 1860s (30m after seq 1: idle stretch exceeding 5m threshold)
      const t0 = new Date(Date.UTC(2026, 9, 28, 14, 0, 0)).toISOString();
      const t1 = new Date(Date.UTC(2026, 9, 28, 14, 1, 0)).toISOString();
      const t2 = new Date(Date.UTC(2026, 9, 28, 14, 31, 0)).toISOString();

      const timeline: TimelineEntry[] = [
        createEntry({ sequence: 0, captured_at: t0 }),
        createEntry({ sequence: 1, captured_at: t1 }),
        createEntry({ sequence: 2, captured_at: t2 }),
      ];

      const geom = computeTimelineBarGeometry({
        timeline,
        options: {
          idleThresholdMs: 5 * 60 * 1000, // 5m
          cappedIdleWeightMs: 30 * 1000, // 30s visual weight
          minIntervalWeightMs: 5 * 1000,
        },
      });

      // Axis break should be created for interval 1 -> 2
      expect(geom.axisBreaks).toHaveLength(1);
      const brk = geom.axisBreaks[0];
      expect(brk.fromSequence).toBe(1);
      expect(brk.toSequence).toBe(2);
      expect(brk.durationMs).toBe(30 * 60 * 1000);
      expect(brk.label).toBe('30m idle');
      expect(brk.startRatio).toBe(geom.steps[1].positionRatio);
      expect(brk.endRatio).toBe(geom.steps[2].positionRatio);
      expect(brk.centerRatio).toBeCloseTo((brk.startRatio + brk.endRatio) / 2, 4);

      // Visual weight for 1->2 was capped to 30s instead of 1800s
      // Interval 0->1 weight = 60s, Interval 1->2 weight = 30s. Total = 90s.
      // Step 1 position should be 60 / 90 = ~0.6667
      expect(geom.steps[1].positionRatio).toBeCloseTo(2 / 3, 3);
    });

    it('scenario 5: gap mid-run uses fixed weight and creates GapRegion with reason', () => {
      const t0 = new Date(Date.UTC(2026, 9, 28, 14, 0, 0)).toISOString();
      const t1 = new Date(Date.UTC(2026, 9, 28, 14, 1, 0)).toISOString();
      const t2 = new Date(Date.UTC(2026, 9, 28, 14, 2, 0)).toISOString();
      const t3 = new Date(Date.UTC(2026, 9, 28, 14, 3, 0)).toISOString();

      const timeline: TimelineEntry[] = [
        createEntry({ sequence: 0, captured_at: t0, record_type: 'initial_snapshot' }),
        createEntry({ sequence: 1, captured_at: t1, record_type: 'pre_tool' }),
        createEntry({
          sequence: 2,
          captured_at: t2,
          record_type: 'gap',
          gap_reason: 'corrupt input',
        }),
        createEntry({ sequence: 3, captured_at: t3, record_type: 'checkpoint' }),
      ];

      const geom = computeTimelineBarGeometry({ timeline });

      // Step 2 is flagged as gap
      expect(geom.steps[2].isGap).toBe(true);
      expect(geom.steps[2].gapReason).toBe('corrupt input');

      // Gap regions created for gap intervals
      expect(geom.gapRegions.length).toBeGreaterThan(0);
      const gapReg = geom.gapRegions.find((g) => g.gapReason === 'corrupt input');
      expect(gapReg).toBeDefined();
      expect(gapReg?.gapReason).toBe('corrupt input');
    });

    it('scenario 6: rotation clock jump preserves monotonic sequence ordering', () => {
      // Clock regresses: seq 1 has earlier timestamp than seq 0 (e.g. rotation or ntp shift)
      const timeline: TimelineEntry[] = [
        createEntry({ sequence: 0, captured_at: '2026-10-28T14:10:00Z' }),
        createEntry({ sequence: 1, captured_at: '2026-10-28T14:05:00Z' }), // regressed 5m earlier
        createEntry({ sequence: 2, captured_at: '2026-10-28T14:15:00Z' }),
      ];

      const geom = computeTimelineBarGeometry({ timeline });

      // Clamping delta to Math.max(0, ...) must ensure monotonically increasing ratios
      expect(geom.steps[0].positionRatio).toBe(0.0);
      expect(geom.steps[1].positionRatio).toBeGreaterThan(geom.steps[0].positionRatio);
      expect(geom.steps[2].positionRatio).toBeGreaterThan(geom.steps[1].positionRatio);
      expect(geom.steps[2].positionRatio).toBe(1.0);
    });

    it('scenario 7: chapter spanning a gap sets spansGap=true and durationMs=null', () => {
      const timeline: TimelineEntry[] = [
        createEntry({ sequence: 0, captured_at: '2026-10-28T14:00:00Z' }),
        createEntry({ sequence: 1, captured_at: '2026-10-28T14:01:00Z' }),
        createEntry({ sequence: 2, captured_at: '2026-10-28T14:02:00Z', record_type: 'gap', gap_reason: 'sequence loss' }),
        createEntry({ sequence: 3, captured_at: '2026-10-28T14:03:00Z' }),
      ];

      const chapters: ReplayChapter[] = [
        {
          id: 'ch-span-gap',
          title: 'Turn through gap',
          start_sequence: 0,
          end_sequence: 3,
          source: 'deterministic_prompt_turn',
          title_status: 'deterministic template',
          evidence_refs: [],
        },
      ];

      const geom = computeTimelineBarGeometry({ timeline, chapters });
      expect(geom.chapterSegments).toHaveLength(1);
      const seg = geom.chapterSegments[0];
      expect(seg.spansGap).toBe(true);
      expect(seg.durationMs).toBeNull();
      expect(seg.durationLabel).toBeNull();
    });

    it('scenario 8: chapters from all three source values and both title statuses', () => {
      const timeline: TimelineEntry[] = [
        createEntry({ sequence: 0, captured_at: '2026-10-28T14:00:00Z' }),
        createEntry({ sequence: 1, captured_at: '2026-10-28T14:01:00Z' }),
        createEntry({ sequence: 2, captured_at: '2026-10-28T14:02:00Z' }),
        createEntry({ sequence: 3, captured_at: '2026-10-28T14:03:00Z' }),
      ];

      const chapters: ReplayChapter[] = [
        {
          id: 'ch-prompt',
          title: 'Turn 1',
          start_sequence: 0,
          end_sequence: 1,
          source: 'deterministic_prompt_turn',
          title_status: 'deterministic template',
          evidence_refs: [],
        },
        {
          id: 'ch-fixed',
          title: 'Tool execution group',
          start_sequence: 1,
          end_sequence: 2,
          source: 'deterministic_fixed_group',
          title_status: 'deterministic template',
          evidence_refs: [],
        },
        {
          id: 'ch-model',
          title: 'Refactoring auth module',
          start_sequence: 2,
          end_sequence: 3,
          source: 'model',
          title_status: 'model interpretation',
          evidence_refs: [],
        },
      ];

      const geom = computeTimelineBarGeometry({ timeline, chapters });
      expect(geom.chapterSegments).toHaveLength(3);

      const [c1, c2, c3] = geom.chapterSegments;
      expect(c1.source).toBe('deterministic_prompt_turn');
      expect(c1.title_status).toBe('deterministic template');
      expect(c1.isModelInterpretation).toBe(false);
      expect(c1.durationMs).toBe(60000);
      expect(c1.durationLabel).toBe('1m');

      expect(c2.source).toBe('deterministic_fixed_group');
      expect(c2.title_status).toBe('deterministic template');
      expect(c2.isModelInterpretation).toBe(false);
      expect(c2.durationMs).toBe(60000);

      expect(c3.source).toBe('model');
      expect(c3.title_status).toBe('model interpretation');
      expect(c3.isModelInterpretation).toBe(true);
      expect(c3.durationMs).toBe(60000);
    });

    it('scenario 9: tool call duration calculated for matching pre_tool and post_tool pairs', () => {
      const timeline: TimelineEntry[] = [
        createEntry({ sequence: 0, captured_at: '2026-10-28T14:00:00Z', record_type: 'initial_snapshot' }),
        createEntry({
          sequence: 1,
          captured_at: '2026-10-28T14:00:10.000Z',
          record_type: 'pre_tool',
          tool_name: 'bash',
          tool_use_id: 'tool-call-123',
        }),
        createEntry({
          sequence: 2,
          captured_at: '2026-10-28T14:00:14.500Z', // 4.5s elapsed
          record_type: 'post_tool',
          tool_name: 'bash',
          tool_use_id: 'tool-call-123',
        }),
      ];

      const geom = computeTimelineBarGeometry({ timeline });

      const preStep = geom.steps[1];
      const postStep = geom.steps[2];

      expect(preStep.toolDurationMs).toBeNull();
      expect(postStep.toolDurationMs).toBe(4500);
      expect(postStep.toolDurationLabel).toBe('4.5s');
    });

    it('scenario 10: findNearestStep snaps accurately to nearest recorded step', () => {
      const t0 = new Date(Date.UTC(2026, 9, 28, 14, 0, 0)).toISOString();
      const t1 = new Date(Date.UTC(2026, 9, 28, 14, 0, 10)).toISOString();
      const t2 = new Date(Date.UTC(2026, 9, 28, 14, 0, 30)).toISOString();

      const timeline: TimelineEntry[] = [
        createEntry({ sequence: 0, captured_at: t0 }),
        createEntry({ sequence: 1, captured_at: t1 }),
        createEntry({ sequence: 2, captured_at: t2 }),
      ];

      const geom = computeTimelineBarGeometry({
        timeline,
        options: { minIntervalWeightMs: 1000 },
      });

      // Ratios are:
      // step 0: 0.0
      // step 1: ~0.3333
      // step 2: 1.0

      // Near step 0
      expect(geom.findNearestStep(0.0)?.sequence).toBe(0);
      expect(geom.findNearestStep(0.15)?.sequence).toBe(0);

      // Near step 1
      expect(geom.findNearestStep(0.25)?.sequence).toBe(1);
      expect(geom.findNearestStep(0.33)?.sequence).toBe(1);
      expect(geom.findNearestStep(0.55)?.sequence).toBe(1);

      // Near step 2
      expect(geom.findNearestStep(0.75)?.sequence).toBe(2);
      expect(geom.findNearestStep(1.0)?.sequence).toBe(2);

      // Clamp out-of-bounds queries
      expect(geom.findNearestStep(-0.5)?.sequence).toBe(0);
      expect(geom.findNearestStep(1.5)?.sequence).toBe(2);
    });

    it('scenario 11: maps test markers with pass/fail/error and neutral states', () => {
      const timeline: TimelineEntry[] = [
        createEntry({ sequence: 0, record_id: 'rec-0', captured_at: '2026-10-28T14:00:00Z' }),
        createEntry({ sequence: 1, record_id: 'rec-1', captured_at: '2026-10-28T14:00:30Z' }),
        createEntry({ sequence: 2, record_id: 'rec-2', captured_at: '2026-10-28T14:01:00Z' }),
      ];

      const tests: StructuredTestEvidence[] = [
        createTestEvidence({
          id: 'test-pass-1',
          observed_at: '2026-10-28T14:00:30Z',
          state: 'pass',
          suite_scope: 'unit',
          source: 'pytest',
          association: 'content_identity',
          command_record_id: 'rec-1',
        }),
        createTestEvidence({
          id: 'test-fail-1',
          observed_at: '2026-10-28T14:01:00Z',
          state: 'fail',
          suite_scope: 'integration',
          source: 'pytest',
          association: 'controlled_no_write',
          command_record_id: 'rec-2',
        }),
        createTestEvidence({
          id: 'test-neutral-1',
          observed_at: '2026-10-28T14:00:15Z',
          state: 'skipped',
          suite_scope: 'unit',
          source: 'pytest',
          association: 'none',
        }),
      ];

      const geom = computeTimelineBarGeometry({ timeline, tests });
      expect(geom.testMarkers).toHaveLength(3);

      const passM = geom.testMarkers.find((m) => m.testId === 'test-pass-1');
      expect(passM?.markerType).toBe('pass');
      expect(passM?.isMatched).toBe(true);
      expect(passM?.associatedSequence).toBe(1);

      const failM = geom.testMarkers.find((m) => m.testId === 'test-fail-1');
      expect(failM?.markerType).toBe('fail');
      expect(failM?.isMatched).toBe(true);
      expect(failM?.associatedSequence).toBe(2);

      const neutralM = geom.testMarkers.find((m) => m.testId === 'test-neutral-1');
      expect(neutralM?.markerType).toBe('neutral');
      expect(neutralM?.isMatched).toBe(false);
    });
  });
});
