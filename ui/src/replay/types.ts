/**
 * Replay contracts strictly versioned for FaultMesh Replay Export 1.0 and 2.0.
 *
 * Replay export format 1.0: deterministic, no-model offline playback document.
 * Replay export format 2.0: enriched offline document with chapters, checked claims,
 * likely-reason inferences, and summary audits.
 */

export type ReplaySchemaVersion = 'replay-export-1.0' | 'replay-export-1.1' | 'replay-export-2.0';

export type ReplayOrigin = 'real_recording' | 'synthetic_fixture' | 'simulated_demo';

export type SessionStatus = 'active' | 'stopped' | (string & {});

export type AttributionStatus =
  | 'not_applicable'
  | 'tool_boundary'
  | 'observed_checkpoint'
  | 'unknown'
  | (string & {});

export type Completeness = 'complete' | 'partial' | 'missing' | 'unsupported' | (string & {});

export type RecordKind =
  | 'initial_snapshot'
  | 'pre_tool'
  | 'post_tool'
  | 'checkpoint'
  | 'gap'
  | 'unsupported'
  | (string & {});

export type TestState =
  | 'pass'
  | 'fail'
  | 'error'
  | 'skipped'
  | 'not_observed'
  | 'incomplete'
  | (string & {});

export type TestAssociation =
  | 'content_identity'
  | 'controlled_no_write'
  | 'nearby_in_time_state_unverified'
  | 'none'
  | (string & {});

export type ChangeType = 'added' | 'modified' | 'deleted' | 'unchanged' | (string & {});

export type ClaimVerdictValue =
  | 'supported'
  | 'contradicted'
  | 'unsupported_or_unknown'
  | (string & {});

export type FinalSource = 'first' | 'repaired' | 'deterministic_fallback' | (string & {});

export type ChapterSource =
  | 'deterministic_prompt_turn'
  | 'deterministic_fixed_group'
  | 'model'
  | (string & {});

export type ChapterTitleStatus =
  | 'deterministic template'
  | 'model interpretation'
  | (string & {});

export type CitationIntegrity =
  | 'valid_exact_quote'
  | 'invalid_source_or_quote'
  | (string & {});

export type CitationStatus = 'valid' | 'invalid' | 'empty' | (string & {});

export type SummaryDisplayStatus =
  | 'supported_recorded_fact'
  | 'contradicted_by_complete_recording'
  | 'not_supported_by_this_recording'
  | (string & {});

export interface CaptureLimits {
  max_file_bytes: number;
  max_snapshot_bytes: number;
  max_files: number;
  max_store_bytes: number;
  max_text_field_bytes: number;
}

export interface ReplaySession {
  schema_version: 'replay-store-1.0';
  id: string;
  created_at: string;
  stopped_at: string | null;
  status: SessionStatus;
  project_root_sha256: string;
  codex_version: string | null;
  raw_logging: boolean;
  limits: CaptureLimits;
  import_source?: 'codex' | 'claude_code' | null;
  format_version?: string | null;
  source_file_sha256?: string | null;
  history_state?: 'active' | 'archived' | null;
  source_title?: string | null;
  timeline_started_at?: string | null;
  timeline_ended_at?: string | null;
  injected_context_messages?: number | null;
  missing_timestamp_fallbacks?: number | null;
  out_of_order_steps?: number | null;
}

export interface ReplayRecord {
  schema_version: 'replay-store-1.0';
  id: string;
  session_id: string;
  sequence: number;
  source_identity: string;
  source_offset: number;
  source_sequence: number | null;
  record_type: RecordKind;
  captured_at: string;
  source_timestamp: string | null;
  timestamp_inferred?: boolean;
  provenance: string;
  completeness: Completeness;
  attribution_status: AttributionStatus;
  turn_id: string | null;
  tool_use_id: string | null;
  tool_name: string | null;
  checkpoint_id: string | null;
  manifest_id: string | null;
  before_manifest_id: string | null;
  after_manifest_id: string | null;
  partial: boolean;
  truncated: boolean;
  redaction_applied: boolean;
  tool_input: unknown | null;
  tool_response: unknown | null;
  gap_reason: string | null;
  test_refs: string[];
  source_item_id?: string | null;
  prompt_id?: string | null;
  prompt_text?: string | null;
  file_state?: 'unknown' | 'reconstructed_from_current_checkout_unverified' | null;
  edit_patch?: string | null;
  edit_command?: string | null;
  redaction_types?: string[] | null;
}

export interface CapturedFile {
  path: string;
  content_sha256: string;
  size: number;
  mtime_ns: number;
  parse_ok: boolean;
  parse_error: string | null;
}

export interface SnapshotManifest {
  schema_version: 'replay-store-1.0';
  id: string;
  files: CapturedFile[];
  skipped: Array<{ path: string; reason: string }>;
  partial: boolean;
}

export interface ChangedFileView {
  path: string;
  change: ChangeType;
  before_sha256: string | null;
  after_sha256: string | null;
  unified_diff: string | null;
  derived_from?: 'recorded_patch' | null;
  file_state?: 'recorded' | 'reconstructed_from_current_checkout_unverified' | 'unknown';
  reconstruction_label?: 'reconstructed from current checkout (unverified)' | null;
  before_text?: string | null;
  after_text?: string | null;
}

export interface TranscriptSpan {
  id: string;
  record_id: string;
  sequence: number;
  kind: 'prompt' | 'agent_message' | 'command_output';
  text: string;
  start_offset: number;
  end_offset: number;
  redacted: boolean;
  truncated: boolean;
}

export interface ChangedSymbolView {
  path: string;
  qualified_name: string;
  kind: string;
  change: 'added' | 'modified' | 'deleted';
  before_content_sha256: string | null;
  after_content_sha256: string | null;
  verified: boolean;
}

export interface TestCounts {
  passed: number | null;
  failed: number | null;
  errors: number | null;
  skipped: number | null;
}

export interface IndividualTestResult {
  node_id: string;
  state: TestState;
  duration_ms?: number | null;
  error_text?: string | null;
}

export interface StructuredTestEvidence {
  schema_version: 'replay-store-1.0';
  id: string;
  session_id: string;
  observed_at: string;
  state: TestState;
  suite_scope: string;
  source: string;
  command_record_id: string | null;
  command_exit_code: number | null;
  associated_manifest_id: string | null;
  association: TestAssociation;
  counts: TestCounts | null;
  tests: IndividualTestResult[];
  output_missing: boolean;
  partial: boolean;
}

export interface TimelineEntry {
  sequence: number;
  record_id: string;
  record_type: RecordKind;
  captured_at: string;
  timestamp_inferred?: boolean;
  completeness: Completeness;
  attribution_status: AttributionStatus;
  tool_name: string | null;
  tool_use_id: string | null;
  before_manifest_id: string | null;
  after_manifest_id: string | null;
  changed_files: ChangedFileView[];
  changed_symbols: ChangedSymbolView[];
  test_evidence: StructuredTestEvidence[];
  prompt_or_tool_evidence_redacted: boolean;
  gap_reason: string | null;
}

export interface ReplayExportV1 {
  schema_version: 'replay-export-1.0' | 'replay-export-1.1';
  exported_at: string;
  session: ReplaySession;
  records: ReplayRecord[];
  manifests: SnapshotManifest[];
  content_base64_by_sha256: Record<string, string>;
  tests: StructuredTestEvidence[];
  timeline: TimelineEntry[];
  limitations: string[];
  transcript_spans?: TranscriptSpan[];
  sanitized?: boolean;
}

// --- V2 Enriched Narration Contracts ---

export interface ReplayChapter {
  id: string;
  start_sequence: number;
  end_sequence: number;
  title: string;
  evidence_refs: string[];
  source: ChapterSource;
  title_status: ChapterTitleStatus;
}

export interface ChapterRunRecord {
  schema_version: 'replay-chapter-run-1.0';
  chapters: ReplayChapter[];
  raw_model_output: string | null;
  parsed_model_output: unknown | null;
  error: string | null;
  fallback_used: boolean;
  backend: string | null;
  model: string | null;
  latency_ms: number;
}

export type FileChangedAssertion = {
  predicate: 'file_changed';
  path: string;
  before_sha256: string | null;
  after_sha256: string | null;
  change: ChangeType;
};

export type FunctionAddedAssertion = {
  predicate: 'python_function_added';
  path: string;
  qualified_name: string;
};

export type FunctionRemovedAssertion = {
  predicate: 'python_function_removed';
  path: string;
  qualified_name: string;
};

export type CommandExitAssertion = {
  predicate: 'command_exit';
  record_id: string;
  exit_code: number;
};

export type StructuredPytestCountsAssertion = {
  predicate: 'structured_pytest_counts';
  test_evidence_id: string;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
};

export type ClaimAssertion =
  | FileChangedAssertion
  | FunctionAddedAssertion
  | FunctionRemovedAssertion
  | CommandExitAssertion
  | StructuredPytestCountsAssertion;

export interface TypedClaim {
  id: string;
  assertion: ClaimAssertion;
  evidence_refs: string[];
  statement: string | null;
}

export interface ClaimVerdict {
  claim_id: string;
  verdict: ClaimVerdictValue;
  reason_code: string;
  reason: string;
  evidence_refs: string[];
  evidence_source?: 'rebuilt_file' | 'transcript_span' | 'command_record' | null;
  checker_version: string;
}

export interface ClaimBatch {
  schema_version: 'replay-claims-1.0' | (string & {});
  claims: TypedClaim[];
}

export interface ClaimRunRecord {
  schema_version: 'replay-claim-run-1.0' | (string & {});
  cache_key?: string;
  evidence_hash?: string;
  model_config_id?: string | null;
  raw_first_output?: string | null;
  parsed_first_claims?: ClaimBatch | TypedClaim[] | null;
  first_error?: string | null;
  raw_repaired_output?: string | null;
  parsed_repaired_claims?: ClaimBatch | TypedClaim[] | null;
  repair_error?: string | null;
  final_claims: ClaimBatch | TypedClaim[];
  final_source: FinalSource;
  verdicts: ClaimVerdict[];
  fallback_used: boolean;
  repair_attempts: number;
  backend: string | null;
  model: string | null;
  latency_ms: number;
}

export interface SourceCitation {
  source_id: string;
  start: number;
  end: number;
  quote: string;
}

export interface CheckedCitation {
  citation: SourceCitation;
  integrity: CitationIntegrity;
  reason_code: string;
  source_text: string | null;
  policy_version: string;
}

export interface CheckedLikelyReason {
  label: 'likely reason (model inference)';
  text: string;
  citations: CheckedCitation[];
  citation_status: CitationStatus;
  entailment_status: 'not_deterministically_assessed';
  verified_intent: false;
}

export interface ReasonRunRecord {
  schema_version: 'replay-reason-run-1.0';
  raw_model_output: string | null;
  parsed_reason: { text: string; citations: SourceCitation[] } | null;
  checked_reason: CheckedLikelyReason | null;
  error: string | null;
  fallback_used: boolean;
  backend: string | null;
  model: string | null;
  latency_ms: number;
}

export interface SummaryStatement {
  start: number;
  end: number;
  exact_text: string;
  claim: TypedClaim;
}

export interface SummaryStatementAudit {
  statement: SummaryStatement;
  span_valid: boolean;
  canonical_mapping_valid: boolean;
  atomic_boundary_valid: boolean;
  claim_verdict: ClaimVerdict | null;
  display_status: SummaryDisplayStatus;
}

export interface AgentSummaryAudit {
  schema_version: 'replay-summary-audit-1.0';
  summary_text: string;
  statements: SummaryStatementAudit[];
  supported_claims: TypedClaim[];
  auditor_version: string;
  limitations: string[];
}

export interface EvidenceSource {
  id: string;
  kind: string;
  session_id: string;
  sequence: number;
  content_sha256: string;
  text: string;
  redacted: boolean;
  truncated: boolean;
}

export interface EvidencePacket {
  schema_version: string;
  session_id: string;
  checkpoint_id: string;
  sequence: number;
  before_manifest_id: string | null;
  after_manifest_id: string | null;
  record_complete: boolean;
  selection_truncated: boolean;
  redaction_present: boolean;
  files: Array<{
    path: string;
    before_sha256: string | null;
    after_sha256: string | null;
    change: ChangeType;
  }>;
  functions: Array<{
    path: string;
    before_functions: string[];
    after_functions: string[];
    before_ast_complete: boolean;
    after_ast_complete: boolean;
  }>;
  sources: EvidenceSource[];
  evidence_hash: string;
}

export interface StepNarration {
  sequence: number;
  packet: EvidencePacket;
  claims: ClaimRunRecord;
  reason?: ReasonRunRecord | null;
  summary_audit?: AgentSummaryAudit | null;
  explanation?: {
    text: string;
    label: 'model interpretation';
  } | null;
}

export interface SessionSummary {
  sentences: string[];
  source: 'deterministic_facts' | 'model';
  fallback_used: boolean;
}

export type ReplayExportV2 = Omit<ReplayExportV1, 'schema_version'> & {
  schema_version: 'replay-export-2.0';
  narration: StepNarration[];
  baseline_chapters: ReplayChapter[];
  chapters: ReplayChapter[];
  chapter_run: ChapterRunRecord;
  summary?: SessionSummary | null;
};

export type AnyReplayExport = ReplayExportV1 | ReplayExportV2;
export type ReplayExportDocument = AnyReplayExport;

export function isReplayExportV2(exportDoc: AnyReplayExport): exportDoc is ReplayExportV2 {
  return exportDoc.schema_version === 'replay-export-2.0';
}
