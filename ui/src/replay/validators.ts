import type {
  AnyReplayExport,
  ReplayOrigin,
  ReplaySession,
} from './types';

export const MAX_REPLAY_SIZE_BYTES = 64 * 1024 * 1024; // 64 MB

export interface ValidationErrorItem {
  path: string;
  message: string;
}

export interface ReplayValidationResult {
  success: boolean;
  data?: AnyReplayExport;
  version?: 'replay-export-1.0' | 'replay-export-1.1' | 'replay-export-2.0';
  origin?: ReplayOrigin;
  errors?: ValidationErrorItem[];
  missingContentHashes?: string[];
  isPartial?: boolean;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isValidIsoDate(str: unknown): boolean {
  if (typeof str !== 'string' || !str) return false;
  const time = Date.parse(str);
  return !Number.isNaN(time);
}

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;

/**
 * Validates a loaded JSON export against the ReplayExport 1.x or 2.0 contract.
 * Rejects unsupported versions, malformed structures, and verifies integrity.
 */
export function validateReplayExport(
  rawJson: unknown,
  fileSizeBytes?: number,
  fileNameHint?: string
): ReplayValidationResult {
  const errors: ValidationErrorItem[] = [];

  if (fileSizeBytes !== undefined && fileSizeBytes > MAX_REPLAY_SIZE_BYTES) {
    return {
      success: false,
      errors: [
        {
          path: '',
          message: `Replay export exceeds maximum size limit of 64 MB (${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB)`,
        },
      ],
    };
  }

  if (!isPlainObject(rawJson)) {
    return {
      success: false,
      errors: [{ path: '', message: 'Replay document must be a JSON object' }],
    };
  }

  const schemaVersion = rawJson.schema_version;
  if (
    schemaVersion !== 'replay-export-1.0'
    && schemaVersion !== 'replay-export-1.1'
    && schemaVersion !== 'replay-export-2.0'
  ) {
    return {
      success: false,
      errors: [
        {
          path: 'schema_version',
          message: `Unsupported replay schema_version "${String(schemaVersion)}". Expected "replay-export-1.0", "replay-export-1.1", or "replay-export-2.0".`,
        },
      ],
    };
  }

  // Validate exported_at
  if (!isValidIsoDate(rawJson.exported_at)) {
    errors.push({ path: 'exported_at', message: 'Field "exported_at" must be a valid ISO 8601 date-time string' });
  }

  // Validate session
  if (!isPlainObject(rawJson.session)) {
    errors.push({ path: 'session', message: 'Field "session" must be a valid ReplaySession object' });
  } else {
    const session = rawJson.session as Partial<ReplaySession>;
    if (typeof session.id !== 'string' || !session.id.trim()) {
      errors.push({ path: 'session.id', message: 'Field "session.id" must be a non-empty string' });
    }
    if (typeof session.status !== 'string' || !session.status.trim()) {
      errors.push({ path: 'session.status', message: 'Field "session.status" must be a non-empty string ("active" or "stopped")' });
    }
    if (typeof session.project_root_sha256 !== 'string' || !SHA256_HEX_REGEX.test(session.project_root_sha256)) {
      errors.push({ path: 'session.project_root_sha256', message: 'Field "session.project_root_sha256" must be a 64-character SHA-256 hex string' });
    }
  }

  // Validate records
  if (!Array.isArray(rawJson.records)) {
    errors.push({ path: 'records', message: 'Field "records" must be an array' });
  }

  // Validate manifests
  if (!Array.isArray(rawJson.manifests)) {
    errors.push({ path: 'manifests', message: 'Field "manifests" must be an array' });
  }

  // Validate content_base64_by_sha256
  if (!isPlainObject(rawJson.content_base64_by_sha256)) {
    errors.push({ path: 'content_base64_by_sha256', message: 'Field "content_base64_by_sha256" must be an object' });
  }

  // Validate tests
  if (!Array.isArray(rawJson.tests)) {
    errors.push({ path: 'tests', message: 'Field "tests" must be an array' });
  }

  // Validate timeline
  if (!Array.isArray(rawJson.timeline)) {
    errors.push({ path: 'timeline', message: 'Field "timeline" must be an array' });
  }

  if (schemaVersion === 'replay-export-1.1') {
    if (!Array.isArray(rawJson.transcript_spans)) {
      errors.push({ path: 'transcript_spans', message: 'Field "transcript_spans" must be an array in replay-export-1.1' });
    } else {
      rawJson.transcript_spans.forEach((span, index) => {
        if (!isPlainObject(span)) {
          errors.push({ path: `transcript_spans.${index}`, message: 'Transcript span must be an object' });
          return;
        }
        const text = span.text;
        if (
          typeof text !== 'string'
          || span.start_offset !== 0
          || span.end_offset !== text.length
          || !['prompt', 'agent_message', 'command_output'].includes(String(span.kind))
        ) {
          errors.push({ path: `transcript_spans.${index}`, message: 'Transcript span text, offsets, or kind are invalid' });
        }
      });
    }
    if (Array.isArray(rawJson.timeline)) {
      rawJson.timeline.forEach((entry, entryIndex) => {
        if (!isPlainObject(entry) || !Array.isArray(entry.changed_files)) return;
        entry.changed_files.forEach((changed, changedIndex) => {
          if (!isPlainObject(changed) || changed.derived_from !== 'recorded_patch') return;
          const path = `timeline.${entryIndex}.changed_files.${changedIndex}`;
          if (!['unknown', 'reconstructed_from_current_checkout_unverified'].includes(String(changed.file_state))) {
            errors.push({ path, message: 'Derived changed file must declare an honest file_state' });
          }
          if (
            changed.file_state === 'reconstructed_from_current_checkout_unverified'
            && changed.reconstruction_label !== 'reconstructed from current checkout (unverified)'
          ) {
            errors.push({ path, message: 'Reconstructed file must carry the unverified reconstruction label' });
          }
        });
      });
    }
  }

  // Validate limitations
  if (!Array.isArray(rawJson.limitations)) {
    errors.push({ path: 'limitations', message: 'Field "limitations" must be an array' });
  }

  // Additional v2 checks
  if (schemaVersion === 'replay-export-2.0') {
    if (!Array.isArray(rawJson.narration)) {
      errors.push({ path: 'narration', message: 'Field "narration" must be an array in replay-export-2.0' });
    }
    if (!Array.isArray(rawJson.baseline_chapters)) {
      errors.push({ path: 'baseline_chapters', message: 'Field "baseline_chapters" must be an array in replay-export-2.0' });
    }
    if (!Array.isArray(rawJson.chapters)) {
      errors.push({ path: 'chapters', message: 'Field "chapters" must be an array in replay-export-2.0' });
    }
    if (!isPlainObject(rawJson.chapter_run)) {
      errors.push({ path: 'chapter_run', message: 'Field "chapter_run" must be an object in replay-export-2.0' });
    }
    if (rawJson.summary !== undefined && rawJson.summary !== null) {
      if (
        !isPlainObject(rawJson.summary)
        || !Array.isArray(rawJson.summary.sentences)
        || rawJson.summary.sentences.length < 3
        || rawJson.summary.sentences.length > 5
        || rawJson.summary.sentences.some((sentence) => typeof sentence !== 'string')
      ) {
        errors.push({ path: 'summary', message: 'Optional narration summary must contain 3 to 5 sentences' });
      }
    }
    if (Array.isArray(rawJson.narration)) {
      rawJson.narration.forEach((step, stepIndex) => {
        if (!isPlainObject(step)) return;
        if (step.explanation !== undefined && step.explanation !== null) {
          if (
            !isPlainObject(step.explanation)
            || typeof step.explanation.text !== 'string'
            || step.explanation.label !== 'model interpretation'
          ) {
            errors.push({ path: `narration.${stepIndex}.explanation`, message: 'Explanation must be labeled model interpretation' });
          }
        }
        if (isPlainObject(step.claims) && Array.isArray(step.claims.verdicts)) {
          step.claims.verdicts.forEach((verdict, verdictIndex) => {
            if (!isPlainObject(verdict) || verdict.evidence_source == null) return;
            if (!['rebuilt_file', 'transcript_span', 'command_record'].includes(String(verdict.evidence_source))) {
              errors.push({ path: `narration.${stepIndex}.claims.verdicts.${verdictIndex}.evidence_source`, message: 'Unknown claim evidence source' });
            }
          });
        }
      });
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  // Check content availability
  const contentMap = rawJson.content_base64_by_sha256 as Record<string, string>;
  const missingContentHashes: string[] = [];
  const manifests = rawJson.manifests as Array<{ files?: Array<{ content_sha256?: string }> }>;

  for (const m of manifests) {
    if (Array.isArray(m.files)) {
      for (const f of m.files) {
        if (f.content_sha256 && typeof contentMap[f.content_sha256] !== 'string') {
          missingContentHashes.push(f.content_sha256);
        }
      }
    }
  }

  // Detect explicit origin: real recording vs synthetic fixture vs simulated demo
  let origin: ReplayOrigin = 'real_recording';
  const nameLower = (fileNameHint || '').toLowerCase();
  const session = rawJson.session as ReplaySession;

  if (
    rawJson.sanitized === true ||
    nameLower.includes('fixture') ||
    nameLower.includes('synthetic') ||
    session.id.startsWith('synthetic') ||
    session.codex_version === 'synthetic'
  ) {
    origin = 'synthetic_fixture';
  } else if (session.id.startsWith('demo') || nameLower.includes('demo')) {
    origin = 'simulated_demo';
  }

  const isPartial = missingContentHashes.length > 0 || (rawJson.timeline as Array<{ completeness?: string }>).some(
    (t) => t.completeness === 'partial' || t.completeness === 'missing'
  );

  return {
    success: true,
    data: (rawJson as unknown) as AnyReplayExport,
    version: schemaVersion as 'replay-export-1.0' | 'replay-export-1.1' | 'replay-export-2.0',
    origin,
    missingContentHashes,
    isPartial,
  };
}
