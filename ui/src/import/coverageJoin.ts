import type {
  V3StructureExport,
  V2RunEvidenceExport,
  V3CoverageOverlay,
  V3CoverageOverlayEntry,
  V3CoverageOverlayUnmatched,
  V3SymbolNode,
} from './types';

/**
 * Joins V2 test run evidence coverage with V3 static structure.
 *
 * Rules:
 * 1. If V3 export already embeds coverage_overlay, return it directly without recomputing.
 * 2. Identity is (path, qualified_name).
 * 3. Hash checks per src/faultmesh/structure/export.py:
 *    - In V2, ObservedSymbol.content_sha256 is the containing file's hash, NOT a symbol-body hash!
 *    - Compare V2 source_snapshot.files[].content_sha256 AND each observed symbol's content_sha256
 *      against the V3 FILE content_sha256 for the same path. Never compare against V3 symbol hash.
 * 4. Revision checks:
 *    - Compare V2 run.target.revision or source_snapshot.revision against V3 envelope.head_sha.
 *    - Note dirty/worktree state; a revision mismatch is STALE.
 * 5. Any mismatch: mark entry with stale=true.
 * 6. Missing or duplicate structure identities: add to unmatched list with honest reason.
 * 7. Coverage overlay layer is "observed_coverage" only. Never creates static or runtime call edges.
 */
export function joinV2CoverageToV3(
  v3: V3StructureExport,
  v2: V2RunEvidenceExport
): V3CoverageOverlay {
  // Rule 1: If V3 already has coverage_overlay embedded, preserve it verbatim
  if (v3.coverage_overlay) {
    return v3.coverage_overlay;
  }

  // Build V3 file hash map: path -> content_sha256
  const v3FileHashes = new Map<string, string>();
  for (const f of v3.files) {
    v3FileHashes.set(f.path, f.content_sha256);
  }

  // Build V3 symbol lookup: (path, qualified_name) -> V3SymbolNode[]
  const symbolsByIdentity = new Map<string, V3SymbolNode[]>();
  for (const s of v3.symbols) {
    const key = `${s.path}::${s.qualified_name}`;
    const list = symbolsByIdentity.get(key) || [];
    list.push(s);
    symbolsByIdentity.set(key, list);
  }

  // Build V2 snapshot file hash map if snapshot is available
  const v2SnapshotFileHashes = new Map<string, string>();
  if (v2.source_snapshot?.files) {
    for (const sf of v2.source_snapshot.files) {
      v2SnapshotFileHashes.set(sf.path, sf.content_sha256);
    }
  }

  // Revision comparison: V2 revision vs V3 head_sha
  const v2Revision =
    v2.run.target?.revision ||
    v2.source_snapshot?.revision ||
    (v2.tests[0]?.observation?.source_revision);
  const v3HeadSha = v3.envelope.head_sha;
  const isRevisionMismatch = Boolean(
    v2Revision &&
    v3HeadSha &&
    !v3.envelope.dirty &&
    !v3.envelope.head_is_worktree &&
    v2Revision.toLowerCase() !== v3HeadSha.toLowerCase()
  );

  const entries: V3CoverageOverlayEntry[] = [];
  const unmatched: V3CoverageOverlayUnmatched[] = [];

  for (const testCase of v2.tests) {
    if (!testCase.observation || !Array.isArray(testCase.observation.symbols)) {
      continue;
    }

    const runId = testCase.run_id || v2.run.id;
    const testId = testCase.node_id;

    for (const observed of testCase.observation.symbols) {
      const key = `${observed.path}::${observed.qualified_name}`;
      const candidates = symbolsByIdentity.get(key) || [];

      if (candidates.length !== 1) {
        unmatched.push({
          run_id: runId,
          test_id: testId,
          path: observed.path,
          qualified_name: observed.qualified_name,
          reason:
            candidates.length === 0
              ? 'no matching structure symbol'
              : 'multiple matching structure symbols',
        });
        continue;
      }

      const matchedSymbol = candidates[0];
      const v3FileHash = v3FileHashes.get(observed.path);
      const v2SnapshotHash = v2SnapshotFileHashes.get(observed.path);

      // Check staleness:
      // - If observed.content_sha256 does not match V3 FILE content_sha256
      // - If snapshot file hash does not match V3 FILE content_sha256
      // - If revision mismatch between V2 run and V3 head_sha
      const fileHashMismatch =
        v3FileHash === undefined ||
        v3FileHash !== observed.content_sha256 ||
        (v2SnapshotHash !== undefined && v2SnapshotHash !== v3FileHash);

      const isStale = Boolean(fileHashMismatch || isRevisionMismatch);

      entries.push({
        run_id: runId,
        test_id: testId,
        structure_symbol_id: matchedSymbol.id,
        path: observed.path,
        qualified_name: observed.qualified_name,
        stale: isStale,
        phases: Array.isArray(observed.phases) ? observed.phases : ['call'],
        executed_lines: Array.isArray(observed.executed_lines) ? observed.executed_lines : [],
      });
    }
  }

  // Sort deterministically matching Python export.py ordering
  entries.sort((a, b) => {
    if (a.run_id !== b.run_id) return a.run_id.localeCompare(b.run_id);
    if (a.test_id !== b.test_id) return a.test_id.localeCompare(b.test_id);
    return a.structure_symbol_id.localeCompare(b.structure_symbol_id);
  });

  unmatched.sort((a, b) => {
    if (a.run_id !== b.run_id) return a.run_id.localeCompare(b.run_id);
    if (a.test_id !== b.test_id) return a.test_id.localeCompare(b.test_id);
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return a.qualified_name.localeCompare(b.qualified_name);
  });

  return {
    layer: 'observed_coverage',
    entries,
    unmatched,
  };
}
