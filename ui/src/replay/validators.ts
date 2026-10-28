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
  version?: 'replay-export-1.0' | 'replay-export-2.0';
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
 * Validates a loaded JSON export against the ReplayExport 1.0 or 2.0 contract.
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
  if (schemaVersion !== 'replay-export-1.0' && schemaVersion !== 'replay-export-2.0') {
    return {
      success: false,
      errors: [
        {
          path: 'schema_version',
          message: `Unsupported replay schema_version "${String(schemaVersion)}". Expected "replay-export-1.0" or "replay-export-2.0".`,
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
    if (!session.status || !['recording', 'stopped', 'failed'].includes(session.status)) {
      errors.push({ path: 'session.status', message: 'Field "session.status" must be "recording", "stopped", or "failed"' });
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
    version: schemaVersion as 'replay-export-1.0' | 'replay-export-2.0',
    origin,
    missingContentHashes,
    isPartial,
  };
}
