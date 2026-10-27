import type {
  V3StructureExport,
  V2RunEvidenceExport,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './types';

export const MAX_V3_SIZE_BYTES = 64 * 1024 * 1024; // 64 MB size cap for V3 static structure
export const MAX_V2_SIZE_BYTES = 32 * 1024 * 1024; // 32 MB size cap for V2 test run evidence

/**
 * Validates that a path is strictly project-relative and safe from traversal attacks.
 * Reject:
 * - Empty paths or non-string paths
 * - Absolute paths (starting with '/')
 * - Directory traversal ('..' component anywhere in path)
 * - Windows-style backslashes ('\')
 * - Null bytes ('\0')
 */
export function isSafeProjectRelativePath(
  path: unknown,
  label = 'path'
): { ok: boolean; reason?: string } {
  if (typeof path !== 'string' || path.trim().length === 0) {
    return { ok: false, reason: `${label} must be a non-empty string` };
  }

  if (path.includes('\0')) {
    return { ok: false, reason: `${label} must not contain NUL bytes: "${path}"` };
  }

  if (path.includes('\\')) {
    return { ok: false, reason: `${label} must use forward slashes, not backslashes: "${path}"` };
  }

  if (path.startsWith('/')) {
    return { ok: false, reason: `${label} must be project-relative, not absolute: "${path}"` };
  }

  const parts = path.split('/');
  if (parts.includes('..')) {
    return { ok: false, reason: `${label} must not contain ".." path traversal segments: "${path}"` };
  }

  return { ok: true };
}

/**
 * Parse and validate a raw V3 static structure export JSON string.
 */
export function parseAndValidateV3(jsonText: string): ValidationResult<V3StructureExport> {
  const byteLength = new TextEncoder().encode(jsonText).length;
  if (byteLength > MAX_V3_SIZE_BYTES) {
    return {
      success: false,
      errors: [
        {
          code: 'OVERSIZED_PAYLOAD',
          message: `V3 structure export size (${(byteLength / (1024 * 1024)).toFixed(1)} MB) exceeds 64 MB safety limit`,
        },
      ],
      warnings: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      success: false,
      errors: [
        {
          code: 'MALFORMED_JSON',
          message: `Failed to parse V3 JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      warnings: [],
    };
  }

  return validateV3Structure(parsed, byteLength);
}

/**
 * Validate an already parsed V3 static structure object.
 */
export function validateV3Structure(
  raw: unknown,
  byteLength?: number
): ValidationResult<V3StructureExport> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (byteLength !== undefined && byteLength > MAX_V3_SIZE_BYTES) {
    errors.push({
      code: 'OVERSIZED_PAYLOAD',
      message: `V3 structure export size (${(byteLength / (1024 * 1024)).toFixed(1)} MB) exceeds 64 MB safety limit`,
    });
    return { success: false, errors, warnings };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({
      code: 'INVALID_ROOT',
      message: 'V3 export must be a JSON object',
    });
    return { success: false, errors, warnings };
  }

  const obj = raw as Record<string, unknown>;

  // 1. Check schema_version exactly equals "3.0"
  if (obj.schema_version !== '3.0') {
    errors.push({
      code: 'UNSUPPORTED_VERSION',
      field: 'schema_version',
      message: `Invalid schema_version: expected exactly "3.0", found ${JSON.stringify(obj.schema_version)}`,
    });
    return { success: false, errors, warnings };
  }

  // 2. Required top-level fields
  const requiredKeys = [
    'envelope',
    'files',
    'symbols',
    'edges',
    'unresolved',
    'external_modules',
    'git',
    'skips',
    'parse_errors',
    'limitations',
    'counts',
  ];

  for (const key of requiredKeys) {
    if (!(key in obj)) {
      errors.push({
        code: 'MISSING_REQUIRED_FIELD',
        field: key,
        message: `Missing required top-level field "${key}" in V3 structure export`,
      });
    }
  }

  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  // Envelope validation
  const envelope = obj.envelope as Record<string, unknown>;
  if (!envelope || typeof envelope !== 'object' || typeof envelope.project_name !== 'string' || typeof envelope.content_sha256 !== 'string') {
    errors.push({
      code: 'INVALID_ENVELOPE',
      field: 'envelope',
      message: 'Envelope must contain valid project_name and content_sha256',
    });
  }

  const files = Array.isArray(obj.files) ? (obj.files as Record<string, unknown>[]) : [];
  const symbols = Array.isArray(obj.symbols) ? (obj.symbols as Record<string, unknown>[]) : [];
  const edges = Array.isArray(obj.edges) ? (obj.edges as Record<string, unknown>[]) : [];

  // 3. ID Uniqueness and Path Safety for Files
  const fileIds = new Set<string>();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (typeof f.id !== 'string') {
      errors.push({ code: 'INVALID_FILE_ID', field: `files[${i}].id`, message: 'File id must be a string' });
      continue;
    }
    if (fileIds.has(f.id)) {
      errors.push({ code: 'DUPLICATE_ID', field: `files[${i}].id`, message: `Duplicate file id detected: "${f.id}"` });
    }
    fileIds.add(f.id);

    const pathCheck = isSafeProjectRelativePath(f.path, `files[${i}].path`);
    if (!pathCheck.ok) {
      errors.push({ code: 'UNSAFE_PATH', field: `files[${i}].path`, message: pathCheck.reason! });
    }
  }

  // 4. ID Uniqueness and Path Safety for Symbols
  const symbolIds = new Set<string>();
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    if (typeof s.id !== 'string') {
      errors.push({ code: 'INVALID_SYMBOL_ID', field: `symbols[${i}].id`, message: 'Symbol id must be a string' });
      continue;
    }
    if (symbolIds.has(s.id) || fileIds.has(s.id)) {
      errors.push({ code: 'DUPLICATE_ID', field: `symbols[${i}].id`, message: `Duplicate symbol id detected: "${s.id}"` });
    }
    symbolIds.add(s.id);

    const pathCheck = isSafeProjectRelativePath(s.path, `symbols[${i}].path`);
    if (!pathCheck.ok) {
      errors.push({ code: 'UNSAFE_PATH', field: `symbols[${i}].path`, message: pathCheck.reason! });
    }
  }

  const allNodeIds = new Set<string>([...fileIds, ...symbolIds]);

  // 5. Dangling parent_id check for symbols (count and report, do not crash)
  let danglingParentCount = 0;
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    if (typeof s.parent_id === 'string' && !allNodeIds.has(s.parent_id)) {
      danglingParentCount++;
    }
  }
  if (danglingParentCount > 0) {
    warnings.push({
      code: 'DANGLING_PARENT_ID',
      count: danglingParentCount,
      message: `${danglingParentCount} symbols reference a parent_id that does not exist in files or symbols`,
    });
  }

  // 6. ID Uniqueness, Path Safety, and Dangling Endpoints for Edges
  const edgeIds = new Set<string>();
  let danglingSourceCount = 0;
  let danglingTargetCount = 0;

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (typeof e.id !== 'string') {
      errors.push({ code: 'INVALID_EDGE_ID', field: `edges[${i}].id`, message: 'Edge id must be a string' });
      continue;
    }
    if (edgeIds.has(e.id)) {
      errors.push({ code: 'DUPLICATE_ID', field: `edges[${i}].id`, message: `Duplicate edge id detected: "${e.id}"` });
    }
    edgeIds.add(e.id);

    const callsiteCheck = isSafeProjectRelativePath(e.callsite_path, `edges[${i}].callsite_path`);
    if (!callsiteCheck.ok) {
      errors.push({ code: 'UNSAFE_PATH', field: `edges[${i}].callsite_path`, message: callsiteCheck.reason! });
    }

    if (typeof e.source_id === 'string' && !allNodeIds.has(e.source_id)) {
      danglingSourceCount++;
    }
    if (e.target_id && typeof e.target_id === 'string' && !allNodeIds.has(e.target_id)) {
      // Unresolved/external targets might not be in allNodeIds if external_module is set
      if (!e.external_module) {
        danglingTargetCount++;
      }
    }
  }

  if (danglingSourceCount > 0) {
    warnings.push({
      code: 'DANGLING_EDGE_SOURCE',
      count: danglingSourceCount,
      message: `${danglingSourceCount} edges reference a source_id not found in files or symbols`,
    });
  }
  if (danglingTargetCount > 0) {
    warnings.push({
      code: 'DANGLING_EDGE_TARGET',
      count: danglingTargetCount,
      message: `${danglingTargetCount} edges reference a target_id not found in files or symbols`,
    });
  }

  // 7. Path safety for unresolved references
  const unresolved = Array.isArray(obj.unresolved) ? (obj.unresolved as Record<string, unknown>[]) : [];
  for (let i = 0; i < unresolved.length; i++) {
    const u = unresolved[i];
    const pathCheck = isSafeProjectRelativePath(u.path, `unresolved[${i}].path`);
    if (!pathCheck.ok) {
      errors.push({ code: 'UNSAFE_PATH', field: `unresolved[${i}].path`, message: pathCheck.reason! });
    }
  }

  // 8. Path safety for git files
  const git = obj.git as Record<string, unknown> | undefined;
  if (git && Array.isArray(git.files)) {
    const gitFiles = git.files as Record<string, unknown>[];
    for (let i = 0; i < gitFiles.length; i++) {
      const gf = gitFiles[i];
      const pathCheck = isSafeProjectRelativePath(gf.path, `git.files[${i}].path`);
      if (!pathCheck.ok) {
        errors.push({ code: 'UNSAFE_PATH', field: `git.files[${i}].path`, message: pathCheck.reason! });
      }
      if (gf.old_path) {
        const oldCheck = isSafeProjectRelativePath(gf.old_path, `git.files[${i}].old_path`);
        if (!oldCheck.ok) {
          errors.push({ code: 'UNSAFE_PATH', field: `git.files[${i}].old_path`, message: oldCheck.reason! });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  return {
    success: true,
    data: raw as V3StructureExport,
    errors,
    warnings,
  };
}

/**
 * Parse and validate a raw V2 run evidence export JSON string.
 */
export function parseAndValidateV2(jsonText: string): ValidationResult<V2RunEvidenceExport> {
  const byteLength = new TextEncoder().encode(jsonText).length;
  if (byteLength > MAX_V2_SIZE_BYTES) {
    return {
      success: false,
      errors: [
        {
          code: 'OVERSIZED_PAYLOAD',
          message: `V2 run evidence export size (${(byteLength / (1024 * 1024)).toFixed(1)} MB) exceeds 32 MB safety limit`,
        },
      ],
      warnings: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      success: false,
      errors: [
        {
          code: 'MALFORMED_JSON',
          message: `Failed to parse V2 JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      warnings: [],
    };
  }

  return validateV2RunEvidence(parsed, byteLength);
}

/**
 * Validate an already parsed V2 run evidence object.
 */
export function validateV2RunEvidence(
  raw: unknown,
  byteLength?: number
): ValidationResult<V2RunEvidenceExport> {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (byteLength !== undefined && byteLength > MAX_V2_SIZE_BYTES) {
    errors.push({
      code: 'OVERSIZED_PAYLOAD',
      message: `V2 run evidence export size (${(byteLength / (1024 * 1024)).toFixed(1)} MB) exceeds 32 MB safety limit`,
    });
    return { success: false, errors, warnings };
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({
      code: 'INVALID_ROOT',
      message: 'V2 export must be a JSON object',
    });
    return { success: false, errors, warnings };
  }

  const obj = raw as Record<string, unknown>;

  // Check schema_version exactly equals "2.0"
  if (obj.schema_version !== '2.0') {
    errors.push({
      code: 'UNSUPPORTED_VERSION',
      field: 'schema_version',
      message: `Invalid schema_version: expected exactly "2.0", found ${JSON.stringify(obj.schema_version)}`,
    });
    return { success: false, errors, warnings };
  }

  if (!obj.run || typeof obj.run !== 'object') {
    errors.push({
      code: 'MISSING_REQUIRED_FIELD',
      field: 'run',
      message: 'Missing required field "run" in V2 run evidence export',
    });
  }

  if (!Array.isArray(obj.tests)) {
    errors.push({
      code: 'MISSING_REQUIRED_FIELD',
      field: 'tests',
      message: 'Missing or invalid required array "tests" in V2 run evidence export',
    });
  }

  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  const tests = obj.tests as Record<string, unknown>[];
  const testNodeIds = new Set<string>();

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    if (typeof t.node_id !== 'string') {
      errors.push({
        code: 'INVALID_TEST_NODE_ID',
        field: `tests[${i}].node_id`,
        message: 'Test node_id must be a string',
      });
      continue;
    }
    if (testNodeIds.has(t.node_id)) {
      warnings.push({
        code: 'DUPLICATE_TEST_ID',
        field: `tests[${i}].node_id`,
        message: `Duplicate test node_id detected: "${t.node_id}"`,
      });
    }
    testNodeIds.add(t.node_id);

    // Validate path inside test node_id (e.g. "tests/test_foo.py::test_fn")
    const testFilePath = t.node_id.split('::')[0];
    const pathCheck = isSafeProjectRelativePath(testFilePath, `tests[${i}].node_id file component`);
    if (!pathCheck.ok) {
      errors.push({ code: 'UNSAFE_PATH', field: `tests[${i}].node_id`, message: pathCheck.reason! });
    }

    // Validate observed symbols paths
    const obs = t.observation as Record<string, unknown> | undefined;
    if (obs && Array.isArray(obs.symbols)) {
      for (let j = 0; j < obs.symbols.length; j++) {
        const sym = obs.symbols[j] as Record<string, unknown>;
        if (sym && sym.path) {
          const symPathCheck = isSafeProjectRelativePath(sym.path, `tests[${i}].observation.symbols[${j}].path`);
          if (!symPathCheck.ok) {
            errors.push({
              code: 'UNSAFE_PATH',
              field: `tests[${i}].observation.symbols[${j}].path`,
              message: symPathCheck.reason!,
            });
          }
        }
      }
    }
  }

  // Validate source snapshot paths if present
  const snapshot = obj.source_snapshot as Record<string, unknown> | undefined;
  if (snapshot && Array.isArray(snapshot.files)) {
    for (let i = 0; i < snapshot.files.length; i++) {
      const sf = snapshot.files[i] as Record<string, unknown>;
      if (sf && sf.path) {
        const snapPathCheck = isSafeProjectRelativePath(sf.path, `source_snapshot.files[${i}].path`);
        if (!snapPathCheck.ok) {
          errors.push({
            code: 'UNSAFE_PATH',
            field: `source_snapshot.files[${i}].path`,
            message: snapPathCheck.reason!,
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  return {
    success: true,
    data: raw as V2RunEvidenceExport,
    errors,
    warnings,
  };
}
