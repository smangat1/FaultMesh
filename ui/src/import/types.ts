/**
 * Types corresponding strictly to FaultMesh V3 Static Structure (schema_version "3.0")
 * and V2 Run Evidence (schema_version "2.0") JSON exports.
 */

// --- V3 Static Structure Types (schema_version "3.0") ---

export interface V3DocstringMetadata {
  text: string;
  source?: 'docstring';
}

export interface V3StructureEnvelope {
  project_name: string;
  base_sha?: string | null;
  head_sha?: string | null;
  head_is_worktree?: boolean;
  dirty?: boolean | null;
  content_sha256: string;
}

export interface V3FileNode {
  id: string; // "file:<path>"
  path: string;
  module: string;
  content_sha256: string;
  line_count: number;
  is_test: boolean;
  is_test_heuristic?: boolean;
  parse_error?: string | null;
  removed?: boolean;
  revision_side?: 'head' | 'base';
}

export type V3SymbolKind =
  | 'class'
  | 'function'
  | 'method'
  | 'async_function'
  | 'async_method'
  | 'nested_function'
  | 'nested_async_function';

export interface V3SymbolNode {
  id: string; // "symbol:<path>:<qualified_name>" (@N when repeated)
  path: string;
  qualified_name: string;
  name: string;
  kind: V3SymbolKind;
  disambiguator: number;
  parent_id: string;
  start_line: number;
  end_line: number;
  content_sha256: string;
  signature?: string | null;
  parameter_names?: string[];
  decorators?: string[];
  docstring?: V3DocstringMetadata | null;
  bases?: string[];
  removed?: boolean;
  revision_side?: 'head' | 'base';
}

export type V3EdgeKind = 'defines' | 'contains' | 'imports' | 'possible_call';
export type V3EdgeConfidence = 'resolved' | 'ambiguous' | 'unresolved';

export interface V3StaticEdge {
  id: string;
  layer: 'static';
  kind: V3EdgeKind;
  source_id: string;
  target_id?: string | null;
  callsite_path: string;
  callsite_line: number;
  resolution_reason: string;
  confidence: V3EdgeConfidence;
  external_module?: string | null;
  removed?: boolean;
  revision_side?: 'head' | 'base';
}

export interface V3UnresolvedReference {
  path: string;
  line: number;
  text: string;
  reason: string;
}

export interface V3SkipRecord {
  path: string;
  reason: string;
  count: number;
}

export interface V3ParseErrorRecord {
  path: string;
  line?: number | null;
  message: string;
}

export type V3FileChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'unchanged';

export interface V3FileGitStatus {
  path: string;
  status: V3FileChangeKind;
  old_path?: string | null;
  similarity?: number | null;
  untracked?: boolean;
  python?: boolean;
}

export type V3SymbolChangeStatus = 'added' | 'modified' | 'removed' | 'unchanged';

export interface V3SymbolGitStatus {
  symbol_id: string;
  status: V3SymbolChangeStatus;
  old_symbol_id?: string | null;
  method?: string;
}

export interface V3GitComparison {
  available: boolean;
  error?: string | null;
  base?: string | null;
  head?: string | null;
  head_is_worktree?: boolean;
  detached?: boolean | null;
  shallow?: boolean | null;
  dirty?: boolean | null;
  worktree_content_sha256?: string | null;
  files: V3FileGitStatus[];
  symbols: V3SymbolGitStatus[];
  non_python_changes?: number;
  skipped_submodules?: number;
}

export interface V3ImpactNeighbor {
  changed_symbol_id: string;
  neighbor_symbol_id: string;
  edge_id: string;
  direction: 'incoming' | 'outgoing';
  label?: 'possible_static_impact';
}

export interface V3CoverageOverlayEntry {
  run_id: string;
  test_id: string;
  structure_symbol_id: string;
  path: string;
  qualified_name: string;
  stale: boolean;
  phases: string[];
  executed_lines: number[];
}

export interface V3CoverageOverlayUnmatched {
  run_id: string;
  test_id: string;
  path: string;
  qualified_name: string;
  reason: string;
}

export interface V3CoverageOverlay {
  layer: 'observed_coverage';
  entries: V3CoverageOverlayEntry[];
  unmatched: V3CoverageOverlayUnmatched[];
}

export interface V3StructureCounts {
  files: number;
  current_files?: number;
  ghost_files?: number;
  symbols: number;
  current_symbols?: number;
  ghost_symbols?: number;
  edges_by_kind_and_confidence: Record<string, number>;
  unresolved: number;
  external_modules: number;
  skipped: number;
  parse_errors: number;
}

export interface V3StructureExport {
  schema_version: '3.0';
  envelope: V3StructureEnvelope;
  files: V3FileNode[];
  symbols: V3SymbolNode[];
  edges: V3StaticEdge[];
  unresolved: V3UnresolvedReference[];
  external_modules: string[];
  git: V3GitComparison;
  skips: V3SkipRecord[];
  parse_errors: V3ParseErrorRecord[];
  limitations: string[];
  counts: V3StructureCounts;
  possible_impact?: V3ImpactNeighbor[];
  coverage_overlay?: V3CoverageOverlay | null;
}

// --- V2 Run Evidence Types (schema_version "2.0") ---

export type V2RunOutcome =
  | 'PASSED'
  | 'FAILED'
  | 'COLLECTION_ERROR'
  | 'INFRASTRUCTURE_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'MALFORMED_REPORT'
  | 'NO_TESTS';

export type V2TestOutcome = 'PASSED' | 'FAILED' | 'SKIPPED' | 'ERROR';

export type V2ReplayComparison =
  | 'SAME_FAILURE'
  | 'DIFFERENT_FAILURE'
  | 'PASSED_ON_REPLAY'
  | 'MISSING_OR_DESELECTED'
  | 'INCONCLUSIVE';

export interface V2ReplayProvenance {
  parent_run_id: string;
  parent_test_id: string;
  original_failure_fingerprint: string;
  original_installed_packages?: string[] | null;
  comparison?: V2ReplayComparison | null;
}

export interface V2TestPhaseResult {
  phase: string; // 'setup' | 'call' | 'teardown'
  outcome: string; // 'PASSED' | 'FAILED' | 'SKIPPED'
  duration_ms: number;
  failure_text?: string | null;
  failure_truncated?: boolean;
}

export interface V2ObservedLine {
  line: number;
  phases: string[];
}

export interface V2ObservedFile {
  path: string;
  content_sha256: string;
  lines: V2ObservedLine[];
  mapping_status?: string;
}

export interface V2ObservedSymbol {
  path: string;
  content_sha256: string; // Note: In V2 this is containing file's hash!
  qualified_name: string;
  start_line: number;
  end_line: number;
  executed_lines: number[];
  phases: string[];
  evidence_type?: string;
}

export interface V2TestObservation {
  status: string; // 'COMPLETE' | 'INCOMPLETE' | 'INSTRUMENTATION_ERROR'
  instrumentation_version: string;
  source_revision: string;
  source_content_sha256: string;
  files?: V2ObservedFile[];
  symbols: V2ObservedSymbol[];
  unknown_contexts?: string[];
  unmapped?: V2ObservedFile[];
  outside_root_files?: number;
  error?: string | null;
}

export interface V2TestCaseRecord {
  schema_version?: '2.0';
  run_id: string;
  node_id: string;
  outcome: V2TestOutcome;
  phases: V2TestPhaseResult[];
  duration_ms?: number;
  failure_text?: string | null;
  failure_truncated?: boolean;
  failure_fingerprint?: string | null;
  observation?: V2TestObservation | null;
}

export interface V2SourceSymbolSnapshot {
  path: string;
  qualified_name: string;
  kind: string;
  start_line: number;
  end_line: number;
  executable_lines: number[];
}

export interface V2SourceFileSnapshot {
  path: string;
  content_sha256: string;
  line_count: number;
  parse_error?: string | null;
  symbols?: V2SourceSymbolSnapshot[];
}

export interface V2SourceSnapshot {
  schema_version?: '2.0';
  revision: string;
  content_sha256: string;
  files: V2SourceFileSnapshot[];
}

export interface V2ProjectTestRun {
  schema_version?: '2.0';
  id: string;
  config_version?: string;
  target?: {
    root_name: string;
    revision: string;
    dirty: boolean;
    content_sha256: string;
  };
  command?: string[];
  working_directory?: string;
  limits?: {
    timeout_seconds?: number;
    memory?: string;
    cpus?: number;
    pids?: number;
    max_output_bytes?: number;
    max_evidence_bytes?: number;
  };
  environment?: {
    base_image?: string;
    resolved_image_id?: string;
    installed_packages?: string[];
    dependency_pins?: string[];
  };
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  exit_code?: number | null;
  termination?: string;
  outcome: V2RunOutcome;
  summary?: {
    collected: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
  } | null;
  stdout_truncated?: boolean;
  stderr_truncated?: boolean;
  error?: string | null;
  artifacts?: {
    directory: string;
    run_record: string;
    config: string;
    stdout: string;
    stderr: string;
    dockerfile?: string;
  };
  observation_requested?: boolean;
  observation_status?: string;
  test_case_count?: number;
  replay?: V2ReplayProvenance | null;
}

export interface V2RunEvidenceExport {
  schema_version: '2.0';
  run: V2ProjectTestRun;
  tests: V2TestCaseRecord[];
  source_snapshot?: V2SourceSnapshot | null;
  missing_artifacts?: string[];
}

// --- Import Validation & Integration Results ---

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  field?: string;
  count?: number;
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}
