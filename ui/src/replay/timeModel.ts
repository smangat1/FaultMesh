import type {
  TimelineEntry,
  RecordKind,
  ReplayChapter,
  ChapterSource,
  ChapterTitleStatus,
  StructuredTestEvidence,
  TestState,
  TestAssociation,
} from './types';
import { formatDuration } from '../utils/format';

export interface TimeModelOptions {
  /**
   * Threshold in ms above which an idle stretch between consecutive steps
   * is capped to a fixed visual weight and drawn with an axis-break squiggle.
   * Default: 5 minutes (300,000ms).
   */
  idleThresholdMs?: number;

  /**
   * Virtual visual weight assigned to gap stretches where elapsed time is unknown.
   * Default: 30,000ms.
   */
  fixedGapWeightMs?: number;

  /**
   * Visual weight assigned to capped idle intervals.
   * Default: 30,000ms.
   */
  cappedIdleWeightMs?: number;

  /**
   * Minimum visual weight assigned to any step interval so rapid consecutive steps
   * (e.g. 0ms to 2ms) remain distinct and clickable on the bar.
   * Default: 5,000ms.
   */
  minIntervalWeightMs?: number;
}

export interface StepPosition {
  sequence: number;
  record_id: string;
  record_type: RecordKind;
  captured_at: string;
  timestampMs: number;
  positionRatio: number; // 0.0 to 1.0 along the bar
  timeLabel: string; // e.g. "recorded at 2:03:22 PM"
  isGap: boolean;
  gapReason: string | null;
  toolName: string | null;
  toolUseId: string | null;
  toolDurationMs: number | null; // calculated only for pre/post tool pair
  toolDurationLabel: string | null; // e.g. "1.2s"
}

export interface ChapterSegment {
  id: string;
  title: string;
  source: ChapterSource;
  title_status: ChapterTitleStatus;
  start_sequence: number;
  end_sequence: number;
  startRatio: number; // 0.0 to 1.0
  endRatio: number; // 0.0 to 1.0
  isModelInterpretation: boolean;
  spansGap: boolean;
  durationMs: number | null; // null if spansGap is true
  durationLabel: string | null; // e.g. "2m 15s" or null if spansGap
}

export interface TestMarker {
  id: string;
  testId: string;
  suiteScope: string;
  observedAt: string;
  timestampMs: number;
  state: TestState;
  positionRatio: number; // 0.0 to 1.0
  association: TestAssociation;
  isMatched: boolean;
  markerType: 'pass' | 'fail' | 'error' | 'neutral';
  commandRecordId: string | null;
  associatedSequence: number | null;
}

export interface AxisBreak {
  id: string;
  breakType: 'idle';
  fromSequence: number;
  toSequence: number;
  startRatio: number;
  endRatio: number;
  centerRatio: number;
  durationMs: number;
  label: string; // e.g. "2h 14m idle"
  startCapturedAt: string;
  endCapturedAt: string;
}

export interface GapRegion {
  id: string;
  sequence: number;
  startRatio: number;
  endRatio: number;
  centerRatio: number;
  gapReason: string;
  capturedAt: string;
}

export interface TimelineBarGeometry {
  steps: StepPosition[];
  chapterSegments: ChapterSegment[];
  testMarkers: TestMarker[];
  axisBreaks: AxisBreak[];
  gapRegions: GapRegion[];
  totalVirtualWeight: number;
  findNearestStep: (ratio: number) => StepPosition | null;
  getStepBySequence: (sequence: number) => StepPosition | null;
}

/**
 * Formats a timestamp into a strict wall-clock time hover string:
 * "recorded at H:MM:SS AM/PM" (UTC).
 */
export function formatRecordedAt(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return `recorded at ${isoString}`;
    const hours = d.getUTCHours();
    const minutes = d.getUTCMinutes();
    const seconds = d.getUTCSeconds();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    const mStr = String(minutes).padStart(2, '0');
    const sStr = String(seconds).padStart(2, '0');
    return `recorded at ${h12}:${mStr}:${sStr} ${ampm}`;
  } catch {
    return `recorded at ${isoString}`;
  }
}

/**
 * Formats an idle duration in milliseconds into a concise axis-break label:
 * e.g., "2h 14m idle", "15m idle", "45s idle".
 */
export function formatIdleDuration(ms: number): string {
  const dur = formatDuration(ms);
  return `${dur} idle`;
}

/**
 * Computes the complete timeline bar geometry from recorded timeline entries,
 * structured tests, and replay chapters.
 */
export function computeTimelineBarGeometry(params: {
  timeline: TimelineEntry[];
  tests?: StructuredTestEvidence[];
  chapters?: ReplayChapter[];
  options?: TimeModelOptions;
}): TimelineBarGeometry {
  const { timeline, tests = [], chapters = [], options = {} } = params;

  const idleThresholdMs = options.idleThresholdMs ?? 5 * 60 * 1000; // 5 min
  const fixedGapWeightMs = options.fixedGapWeightMs ?? 30 * 1000; // 30s visual weight
  const cappedIdleWeightMs = options.cappedIdleWeightMs ?? 30 * 1000; // 30s visual weight
  const minIntervalWeightMs = options.minIntervalWeightMs ?? 5 * 1000; // 5s min visual weight

  // 1. Handle Empty Session
  if (!timeline || timeline.length === 0) {
    return {
      steps: [],
      chapterSegments: [],
      testMarkers: [],
      axisBreaks: [],
      gapRegions: [],
      totalVirtualWeight: 0,
      findNearestStep: () => null,
      getStepBySequence: () => null,
    };
  }

  // Ensure entries are ordered by sequence
  const sortedEntries = [...timeline].sort((a, b) => a.sequence - b.sequence);
  const n = sortedEntries.length;

  // 2. Parse timestamps & identify pre/post tool pairs for real tool duration
  const parsedTimestamps: number[] = [];
  const preToolMap = new Map<string, { sequence: number; timestampMs: number }>();
  const toolDurationsBySeq = new Map<number, number>();

  for (const entry of sortedEntries) {
    const ts = Date.parse(entry.captured_at);
    const validTs = isNaN(ts) ? 0 : ts;
    parsedTimestamps.push(validTs);

    if (entry.record_type === 'pre_tool' && entry.tool_use_id) {
      preToolMap.set(entry.tool_use_id, { sequence: entry.sequence, timestampMs: validTs });
    } else if (entry.record_type === 'post_tool' && entry.tool_use_id) {
      const pre = preToolMap.get(entry.tool_use_id);
      if (pre) {
        const dur = Math.max(0, validTs - pre.timestampMs);
        toolDurationsBySeq.set(entry.sequence, dur);
      }
    }
  }

  // 3. Handle Single Step
  if (n === 1) {
    const entry = sortedEntries[0];
    const singleStep: StepPosition = {
      sequence: entry.sequence,
      record_id: entry.record_id,
      record_type: entry.record_type,
      captured_at: entry.captured_at,
      timestampMs: parsedTimestamps[0],
      positionRatio: 0.0,
      timeLabel: formatRecordedAt(entry.captured_at),
      isGap: entry.record_type === 'gap' || entry.record_type === 'unsupported',
      gapReason: entry.gap_reason,
      toolName: entry.tool_name,
      toolUseId: entry.tool_use_id,
      toolDurationMs: null,
      toolDurationLabel: null,
    };

    const chapterSegments = chapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      source: ch.source,
      title_status: ch.title_status,
      start_sequence: ch.start_sequence,
      end_sequence: ch.end_sequence,
      startRatio: 0.0,
      endRatio: 0.0,
      isModelInterpretation: ch.title_status === 'model interpretation',
      spansGap: singleStep.isGap,
      durationMs: singleStep.isGap ? null : 0,
      durationLabel: singleStep.isGap ? null : '0s',
    }));

    return {
      steps: [singleStep],
      chapterSegments,
      testMarkers: [],
      axisBreaks: [],
      gapRegions: [],
      totalVirtualWeight: 0,
      findNearestStep: () => singleStep,
      getStepBySequence: (seq) => (seq === entry.sequence ? singleStep : null),
    };
  }

  // 4. Multi-step Layout: Compute interval weights, AxisBreaks, and GapRegions
  interface IntervalInfo {
    weight: number;
    isGap: boolean;
    gapReason: string | null;
    isAxisBreak: boolean;
    idleDurationMs: number;
  }

  const intervals: IntervalInfo[] = [];
  const axisBreaks: AxisBreak[] = [];
  const gapRegions: GapRegion[] = [];

  for (let i = 0; i < n - 1; i++) {
    const cur = sortedEntries[i];
    const next = sortedEntries[i + 1];
    const curTs = parsedTimestamps[i];
    const nextTs = parsedTimestamps[i + 1];

    const isCurGap = cur.record_type === 'gap';
    const isNextGap = next.record_type === 'gap';

    if (isCurGap || isNextGap) {
      // Gap stretch: elapsed time is UNKNOWN. Assign fixed gap weight.
      const reason = next.gap_reason || cur.gap_reason || 'unknown gap';
      intervals.push({
        weight: fixedGapWeightMs,
        isGap: true,
        gapReason: reason,
        isAxisBreak: false,
        idleDurationMs: 0,
      });
    } else {
      // Normal or idle interval: non-negative delta (rotation clock jumps clamped)
      const rawDeltaMs = Math.max(0, nextTs - curTs);

      if (rawDeltaMs > idleThresholdMs) {
        // Capped idle interval with axis-break squiggle
        intervals.push({
          weight: cappedIdleWeightMs,
          isGap: false,
          gapReason: null,
          isAxisBreak: true,
          idleDurationMs: rawDeltaMs,
        });
      } else {
        // Proportional elapsed time with minimum visual separation
        const weight = Math.max(minIntervalWeightMs, rawDeltaMs);
        intervals.push({
          weight,
          isGap: false,
          gapReason: null,
          isAxisBreak: false,
          idleDurationMs: 0,
        });
      }
    }
  }

  // Total virtual weight across the bar
  const totalWeight = intervals.reduce((acc, it) => acc + it.weight, 0);

  // 5. Compute Step Positions along [0.0, 1.0]
  const steps: StepPosition[] = [];
  const cumulativeRatios: number[] = [0.0];

  let cumulativeWeight = 0;
  for (let i = 0; i < intervals.length; i++) {
    cumulativeWeight += intervals[i].weight;
    const ratio = totalWeight > 0 ? cumulativeWeight / totalWeight : (i + 1) / (n - 1);
    cumulativeRatios.push(Math.min(1.0, ratio));
  }

  // Force exact boundaries
  cumulativeRatios[0] = 0.0;
  cumulativeRatios[n - 1] = 1.0;

  for (let i = 0; i < n; i++) {
    const entry = sortedEntries[i];
    const durMs = toolDurationsBySeq.get(entry.sequence) ?? null;
    steps.push({
      sequence: entry.sequence,
      record_id: entry.record_id,
      record_type: entry.record_type,
      captured_at: entry.captured_at,
      timestampMs: parsedTimestamps[i],
      positionRatio: cumulativeRatios[i],
      timeLabel: formatRecordedAt(entry.captured_at),
      isGap: entry.record_type === 'gap' || entry.record_type === 'unsupported',
      gapReason: entry.gap_reason,
      toolName: entry.tool_name,
      toolUseId: entry.tool_use_id,
      toolDurationMs: durMs,
      toolDurationLabel: durMs !== null ? formatDuration(durMs) : null,
    });
  }

  // Populate AxisBreaks and GapRegions with their exact layout ratios
  for (let i = 0; i < intervals.length; i++) {
    const it = intervals[i];
    const startRatio = steps[i].positionRatio;
    const endRatio = steps[i + 1].positionRatio;
    const centerRatio = (startRatio + endRatio) / 2;

    if (it.isAxisBreak) {
      axisBreaks.push({
        id: `axis-break-${steps[i].sequence}-${steps[i + 1].sequence}`,
        breakType: 'idle',
        fromSequence: steps[i].sequence,
        toSequence: steps[i + 1].sequence,
        startRatio,
        endRatio,
        centerRatio,
        durationMs: it.idleDurationMs,
        label: formatIdleDuration(it.idleDurationMs),
        startCapturedAt: steps[i].captured_at,
        endCapturedAt: steps[i + 1].captured_at,
      });
    } else if (it.isGap) {
      gapRegions.push({
        id: `gap-region-${steps[i].sequence}-${steps[i + 1].sequence}`,
        sequence: steps[i + 1].record_type === 'gap' ? steps[i + 1].sequence : steps[i].sequence,
        startRatio,
        endRatio,
        centerRatio,
        gapReason: it.gapReason || 'unknown gap',
        capturedAt: steps[i + 1].captured_at,
      });
    }
  }

  // Step lookup maps
  const stepBySeq = new Map<number, StepPosition>();
  for (const step of steps) {
    stepBySeq.set(step.sequence, step);
  }

  // 6. Map Chapter Segments
  const chapterSegments: ChapterSegment[] = [];
  for (const ch of chapters) {
    const startStep = stepBySeq.get(ch.start_sequence) || steps[0];
    const endStep = stepBySeq.get(ch.end_sequence) || steps[steps.length - 1];

    // Determine if any step within the chapter range is a gap
    let spansGap = false;
    for (const step of steps) {
      if (step.sequence >= ch.start_sequence && step.sequence <= ch.end_sequence) {
        if (step.record_type === 'gap') {
          spansGap = true;
          break;
        }
      }
    }

    const startRatio = startStep.positionRatio;
    const endRatio = endStep.positionRatio;

    let durationMs: number | null = null;
    let durationLabel: string | null = null;

    if (!spansGap) {
      durationMs = Math.max(0, endStep.timestampMs - startStep.timestampMs);
      durationLabel = formatDuration(durationMs);
    }

    chapterSegments.push({
      id: ch.id,
      title: ch.title,
      source: ch.source,
      title_status: ch.title_status,
      start_sequence: ch.start_sequence,
      end_sequence: ch.end_sequence,
      startRatio,
      endRatio,
      isModelInterpretation: ch.title_status === 'model interpretation',
      spansGap,
      durationMs,
      durationLabel,
    });
  }

  // 7. Map Test Markers
  // Collect all tests (from explicit tests array or embedded in timeline entries)
  const allTestsMap = new Map<string, StructuredTestEvidence>();
  for (const test of tests) {
    allTestsMap.set(test.id, test);
  }
  for (const entry of sortedEntries) {
    for (const t of entry.test_evidence || []) {
      if (!allTestsMap.has(t.id)) {
        allTestsMap.set(t.id, t);
      }
    }
  }

  const testMarkers: TestMarker[] = [];
  for (const test of allTestsMap.values()) {
    const testTs = Date.parse(test.observed_at);
    const validTestTs = isNaN(testTs) ? 0 : testTs;

    // Determine positionRatio:
    // Prefer linking to command record id or associated manifest
    let mappedRatio: number | null = null;
    let associatedSeq: number | null = null;

    if (test.command_record_id) {
      const match = steps.find((s) => s.record_id === test.command_record_id);
      if (match) {
        mappedRatio = match.positionRatio;
        associatedSeq = match.sequence;
      }
    }

    if (mappedRatio === null && test.associated_manifest_id) {
      const match = sortedEntries.find(
        (s) => s.after_manifest_id === test.associated_manifest_id
      );
      if (match) {
        const stepMatch = stepBySeq.get(match.sequence);
        if (stepMatch) {
          mappedRatio = stepMatch.positionRatio;
          associatedSeq = stepMatch.sequence;
        }
      }
    }

    // Fall back to timestamp interpolation across timeline steps
    if (mappedRatio === null) {
      if (validTestTs <= parsedTimestamps[0]) {
        mappedRatio = 0.0;
        associatedSeq = steps[0].sequence;
      } else if (validTestTs >= parsedTimestamps[n - 1]) {
        mappedRatio = 1.0;
        associatedSeq = steps[n - 1].sequence;
      } else {
        // Find interval
        for (let i = 0; i < n - 1; i++) {
          const t0 = parsedTimestamps[i];
          const t1 = parsedTimestamps[i + 1];
          if (validTestTs >= t0 && validTestTs <= t1) {
            associatedSeq = steps[i].sequence;
            if (intervals[i].isAxisBreak || intervals[i].isGap || t1 === t0) {
              mappedRatio = steps[i].positionRatio;
            } else {
              const alpha = (validTestTs - t0) / (t1 - t0);
              mappedRatio =
                steps[i].positionRatio +
                alpha * (steps[i + 1].positionRatio - steps[i].positionRatio);
            }
            break;
          }
        }
      }
    }

    const finalRatio = mappedRatio !== null ? Math.max(0, Math.min(1, mappedRatio)) : 0.0;

    const markerType: 'pass' | 'fail' | 'error' | 'neutral' =
      test.state === 'pass'
        ? 'pass'
        : test.state === 'fail'
        ? 'fail'
        : test.state === 'error'
        ? 'error'
        : 'neutral';

    const isMatched =
      test.association === 'content_identity' || test.association === 'controlled_no_write';

    testMarkers.push({
      id: `test-marker-${test.id}`,
      testId: test.id,
      suiteScope: test.suite_scope,
      observedAt: test.observed_at,
      timestampMs: validTestTs,
      state: test.state,
      positionRatio: finalRatio,
      association: test.association,
      isMatched,
      markerType,
      commandRecordId: test.command_record_id,
      associatedSequence: associatedSeq,
    });
  }

  // Sort test markers by positionRatio
  testMarkers.sort((a, b) => a.positionRatio - b.positionRatio);

  // 8. Snap to Nearest Step Helper
  const findNearestStep = (ratio: number): StepPosition | null => {
    if (steps.length === 0) return null;
    const clampedRatio = Math.max(0, Math.min(1, ratio));

    let closest = steps[0];
    let minDiff = Math.abs(steps[0].positionRatio - clampedRatio);

    for (let i = 1; i < steps.length; i++) {
      const diff = Math.abs(steps[i].positionRatio - clampedRatio);
      if (diff < minDiff) {
        minDiff = diff;
        closest = steps[i];
      }
    }

    return closest;
  };

  const getStepBySequence = (seq: number): StepPosition | null => {
    return stepBySeq.get(seq) || null;
  };

  return {
    steps,
    chapterSegments,
    testMarkers,
    axisBreaks,
    gapRegions,
    totalVirtualWeight: totalWeight,
    findNearestStep,
    getStepBySequence,
  };
}
