import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseAndValidateV3,
  validateV3Structure,
  parseAndValidateV2,
  validateV2RunEvidence,
  joinV2CoverageToV3,
  isSafeProjectRelativePath,
  MAX_V3_SIZE_BYTES,
  MAX_V2_SIZE_BYTES,
} from '../import';

describe('Phase 1: Pure Importer & Validation Engine', () => {
  const FIXTURES_DIR = path.resolve(__dirname, '../../../docs/fixtures');

  // Load real fixture documents
  const v3ExampleJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v3-structure-example.json'), 'utf-8');
  const v3HpackJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v3-hpack-structure.json'), 'utf-8');
  const v2ParentJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v2-run-evidence-hpack-parent.json'), 'utf-8');
  const v2ReplayJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v2-run-evidence-hpack-replay.json'), 'utf-8');

  describe('1. Valid V3 Structure Import', () => {
    it('successfully parses and validates v3-structure-example.json', () => {
      const res = parseAndValidateV3(v3ExampleJson);
      expect(res.success).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.data).toBeDefined();
      expect(res.data?.envelope.project_name).toBe('buggy_python_project');
      expect(res.data?.files).toHaveLength(3);
      expect(res.data?.symbols).toHaveLength(3);
      expect(res.data?.edges).toHaveLength(7);
      expect(res.data?.schema_version).toBe('3.0');
    });

    it('successfully parses and validates real hpack V3 structure export', () => {
      const res = parseAndValidateV3(v3HpackJson);
      expect(res.success).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.data?.envelope.project_name).toBe('hpack-repo');
      expect(res.data?.files).toHaveLength(19);
      expect(res.data?.symbols).toHaveLength(171);
      expect(res.data?.counts.current_symbols).toBe(171);
      expect(res.data?.unresolved).toHaveLength(461);
    });
  });

  describe('2. Schema Version Enforcements', () => {
    it('rejects V3 exports with unsupported schema_version (e.g. 1.0, 2.0, 4.0)', () => {
      const parsed = JSON.parse(v3ExampleJson);

      parsed.schema_version = '1.0';
      const res1 = validateV3Structure(parsed);
      expect(res1.success).toBe(false);
      expect(res1.errors.some((e) => e.code === 'UNSUPPORTED_VERSION')).toBe(true);

      parsed.schema_version = '2.0';
      const res2 = validateV3Structure(parsed);
      expect(res2.success).toBe(false);
      expect(res2.errors.some((e) => e.code === 'UNSUPPORTED_VERSION')).toBe(true);

      parsed.schema_version = '4.0';
      const res4 = validateV3Structure(parsed);
      expect(res4.success).toBe(false);
      expect(res4.errors.some((e) => e.code === 'UNSUPPORTED_VERSION')).toBe(true);
    });

    it('rejects V2 exports with unsupported schema_version', () => {
      const parsed = JSON.parse(v2ParentJson);

      parsed.schema_version = '3.0';
      const res = validateV2RunEvidence(parsed);
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.code === 'UNSUPPORTED_VERSION')).toBe(true);
    });
  });

  describe('3. Oversized Payloads & Malformed JSON', () => {
    it('rejects payloads exceeding the 64 MB V3 safety limit', () => {
      // Simulate by calling validator with a byteLength exceeding cap
      const parsed = JSON.parse(v3ExampleJson);
      const res = validateV3Structure(parsed, MAX_V3_SIZE_BYTES + 100);
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.code === 'OVERSIZED_PAYLOAD')).toBe(true);
    });

    it('rejects payloads exceeding the 32 MB V2 safety limit', () => {
      const parsed = JSON.parse(v2ParentJson);
      const res = validateV2RunEvidence(parsed, MAX_V2_SIZE_BYTES + 100);
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.code === 'OVERSIZED_PAYLOAD')).toBe(true);
    });

    it('handles malformed JSON with clear, friendly syntax error message', () => {
      const malformed = '{"schema_version": "3.0", "envelope": { "unclosed": true ';
      const res = parseAndValidateV3(malformed);
      expect(res.success).toBe(false);
      expect(res.errors[0].code).toBe('MALFORMED_JSON');
      expect(res.errors[0].message).toContain('Failed to parse V3 JSON');
    });
  });

  describe('4. Project-Relative Safe Paths & Security Validation', () => {
    it('validates project-relative paths and rejects traversal attacks', () => {
      expect(isSafeProjectRelativePath('src/auth/service.py').ok).toBe(true);
      expect(isSafeProjectRelativePath('tests/unit/test_auth.py').ok).toBe(true);

      // Traversal attacks
      expect(isSafeProjectRelativePath('../secret.py').ok).toBe(false);
      expect(isSafeProjectRelativePath('src/../../etc/passwd').ok).toBe(false);
      expect(isSafeProjectRelativePath('/absolute/path.py').ok).toBe(false);
      expect(isSafeProjectRelativePath('win\\path\\foo.py').ok).toBe(false);
      expect(isSafeProjectRelativePath('foo\0bar.py').ok).toBe(false);
    });

    it('rejects V3 exports containing traversal paths in files', () => {
      const parsed = JSON.parse(v3ExampleJson);
      parsed.files[0].path = '../escaped.py';
      const res = validateV3Structure(parsed);
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.code === 'UNSAFE_PATH')).toBe(true);
    });

    it('rejects V3 exports containing absolute paths in callsite_path', () => {
      const parsed = JSON.parse(v3ExampleJson);
      parsed.edges[0].callsite_path = '/usr/bin/python';
      const res = validateV3Structure(parsed);
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.code === 'UNSAFE_PATH')).toBe(true);
    });
  });

  describe('5. Duplicate IDs and Dangling Endpoints', () => {
    it('detects and rejects duplicate file IDs', () => {
      const parsed = JSON.parse(v3ExampleJson);
      parsed.files.push({ ...parsed.files[0] });
      const res = validateV3Structure(parsed);
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.code === 'DUPLICATE_ID')).toBe(true);
    });

    it('detects and rejects duplicate symbol IDs', () => {
      const parsed = JSON.parse(v3ExampleJson);
      parsed.symbols.push({ ...parsed.symbols[0] });
      const res = validateV3Structure(parsed);
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.code === 'DUPLICATE_ID')).toBe(true);
    });

    it('detects and rejects duplicate edge IDs', () => {
      const parsed = JSON.parse(v3ExampleJson);
      parsed.edges.push({ ...parsed.edges[0] });
      const res = validateV3Structure(parsed);
      expect(res.success).toBe(false);
      expect(res.errors.some((e) => e.code === 'DUPLICATE_ID')).toBe(true);
    });

    it('counts and reports dangling edge endpoints and parent IDs without crashing', () => {
      const parsed = JSON.parse(v3ExampleJson);
      // Introduce a dangling edge target and dangling symbol parent
      parsed.edges[0].target_id = 'symbol:nonexistent:fn';
      parsed.symbols[0].parent_id = 'file:nonexistent.py';

      const res = validateV3Structure(parsed);
      // Should succeed overall because dangling endpoints are reported as warnings, not crashes!
      expect(res.success).toBe(true);
      expect(res.warnings.some((w) => w.code === 'DANGLING_EDGE_TARGET')).toBe(true);
      expect(res.warnings.some((w) => w.code === 'DANGLING_PARENT_ID')).toBe(true);
    });
  });

  describe('6. Ghost Symbols and Ambiguous Edges', () => {
    it('correctly tracks ghost files and symbols (removed=true, revision_side=base)', () => {
      const parsed = JSON.parse(v3ExampleJson);
      // Add a ghost symbol
      parsed.symbols.push({
        bases: [],
        content_sha256: 'deadbeef1234',
        decorators: [],
        disambiguator: 1,
        docstring: null,
        end_line: 12,
        id: 'symbol:src/buggy_python_project/bounds.py:old_helper',
        kind: 'function',
        name: 'old_helper',
        parameter_names: [],
        parent_id: 'file:src/buggy_python_project/bounds.py',
        path: 'src/buggy_python_project/bounds.py',
        qualified_name: 'old_helper',
        removed: true,
        revision_side: 'base',
        signature: '() -> None',
        start_line: 10,
      });

      const res = validateV3Structure(parsed);
      expect(res.success).toBe(true);
      const ghost = res.data?.symbols.find((s) => s.id.includes('old_helper'));
      expect(ghost?.removed).toBe(true);
      expect(ghost?.revision_side).toBe('base');
    });

    it('preserves ambiguous edge confidence and static provenance', () => {
      const parsed = JSON.parse(v3ExampleJson);
      parsed.edges.push({
        callsite_line: 10,
        callsite_path: 'tests/test_bounds.py',
        confidence: 'ambiguous',
        external_module: null,
        id: 'edge:ambiguous_test_1',
        kind: 'possible_call',
        layer: 'static',
        removed: false,
        resolution_reason: 'conditional_branch_import',
        revision_side: 'head',
        source_id: 'symbol:tests/test_bounds.py:test_increments_an_ordinary_value',
        target_id: 'symbol:src/buggy_python_project/bounds.py:bounded_increment',
      });

      const res = validateV3Structure(parsed);
      expect(res.success).toBe(true);
      const ambiguousEdge = res.data?.edges.find((e) => e.id === 'edge:ambiguous_test_1');
      expect(ambiguousEdge?.confidence).toBe('ambiguous');
      expect(ambiguousEdge?.layer).toBe('static');
      expect(ambiguousEdge?.resolution_reason).toBe('conditional_branch_import');
    });
  });

  describe('7. V2 Run Evidence & Coverage Join Logic', () => {
    it('successfully parses valid V2 parent and replay run evidence exports', () => {
      const parentRes = parseAndValidateV2(v2ParentJson);
      expect(parentRes.success).toBe(true);
      expect(parentRes.data?.run.id).toBe('run-1c31adf64626');
      expect(parentRes.data?.tests).toHaveLength(3);

      const replayRes = parseAndValidateV2(v2ReplayJson);
      expect(replayRes.success).toBe(true);
      expect(replayRes.data?.run.id).toBe('run-9de6b4cb5a58');
      expect(replayRes.data?.run.replay?.parent_run_id).toBe('run-1c31adf64626');
      expect(replayRes.data?.run.replay?.comparison).toBe('SAME_FAILURE');
    });

    it('joins V2 coverage to V3 structure matching Python export.py behavior', () => {
      const v3 = parseAndValidateV3(v3HpackJson).data!;
      const v2 = parseAndValidateV2(v2ParentJson).data!;

      const overlay = joinV2CoverageToV3(v3, v2);
      expect(overlay.layer).toBe('observed_coverage');
      expect(overlay.entries.length).toBeGreaterThan(0);

      // Verify matched symbol encode_integer is present
      const encodeEntry = overlay.entries.find((e) => e.qualified_name === 'encode_integer');
      expect(encodeEntry).toBeDefined();
      expect(encodeEntry?.structure_symbol_id).toBe('symbol:src/hpack/hpack.py:encode_integer');
      expect(encodeEntry?.stale).toBe(false);

      // Verify injected test file correctly remains unmatched (disposable injected test in clean tree)
      const unmatchedInjected = overlay.unmatched.find((u) => u.path.includes('test_faultmesh_injected_failure'));
      expect(unmatchedInjected).toBeDefined();
      expect(unmatchedInjected?.reason).toBe('no matching structure symbol');
    });

    it('marks coverage as stale when file hash differs (hash mismatch check)', () => {
      const v3 = parseAndValidateV3(v3HpackJson).data!;
      const v2 = parseAndValidateV2(v2ParentJson).data!;

      // Artificially change the file hash in V3 to simulate modified file on disk
      const hpackFile = v3.files.find((f) => f.path === 'src/hpack/hpack.py');
      if (hpackFile) {
        hpackFile.content_sha256 = '0000000000000000000000000000000000000000000000000000000000000000';
      }

      const overlay = joinV2CoverageToV3(v3, v2);
      const encodeEntry = overlay.entries.find((e) => e.qualified_name === 'encode_integer');
      expect(encodeEntry?.stale).toBe(true);
    });

    it('marks coverage as stale when revisions mismatch and worktree is not dirty', () => {
      const v3 = parseAndValidateV3(v3HpackJson).data!;
      const v2 = parseAndValidateV2(v2ParentJson).data!;

      v3.envelope.head_sha = 'ffffffffffffffffffffffffffffffffffffffff';
      v3.envelope.dirty = false;
      v3.envelope.head_is_worktree = false;

      const overlay = joinV2CoverageToV3(v3, v2);
      const encodeEntry = overlay.entries.find((e) => e.qualified_name === 'encode_integer');
      expect(encodeEntry?.stale).toBe(true);
    });

    it('preserves embedded coverage_overlay as given without recomputation', () => {
      const v3WithCoverageJson = fs.readFileSync(path.join(FIXTURES_DIR, 'v3-hpack-with-coverage.json'), 'utf-8');
      const v3 = parseAndValidateV3(v3WithCoverageJson).data!;
      const v2 = parseAndValidateV2(v2ParentJson).data!;

      expect(v3.coverage_overlay).toBeDefined();
      const overlay = joinV2CoverageToV3(v3, v2);
      // Must return the exact embedded overlay reference
      expect(overlay).toBe(v3.coverage_overlay);
    });
  });

  describe('8. Regression: Clean Separation from Demo & Sample Artifacts', () => {
    it('verifies real imports contain no demo IDs, no SAMPLE labels, no runtime_observed edges, and no step badges', () => {
      const v3 = parseAndValidateV3(v3HpackJson).data!;

      // 1. No demo node IDs
      const demoNodeIds = ['fn-validate-token', 'fn-login-expired', 'fn-create-session'];
      for (const node of v3.symbols) {
        expect(demoNodeIds.includes(node.id)).toBe(false);
      }

      // 2. All edges are static, none are runtime_observed
      for (const edge of v3.edges) {
        expect(edge.layer).toBe('static');
        expect((edge as unknown as { category?: string }).category).not.toBe('runtime_observed');
      }

      // 3. No step badges or order
      for (const edge of v3.edges) {
        expect((edge as unknown as { stepNumber?: number }).stepNumber).toBeUndefined();
      }

      // 4. No demo run IDs
      const v2 = parseAndValidateV2(v2ParentJson).data!;
      expect(v2.run.id).not.toBe('run-demo-001');
      expect(v2.run.id).not.toBe('run-001');
    });
  });
});
