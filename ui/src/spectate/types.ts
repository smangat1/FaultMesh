import type {
  V3FileNode,
  V3SkipRecord,
  V3StaticEdge,
  V3SymbolNode,
  V3UnresolvedReference,
} from '../import';

export interface ProjectChoice {
  handle: string;
  displayName: string;
}

export interface LineRange {
  start_line: number;
  end_line: number;
}

export interface SpectateFileSnapshot {
  id: string;
  path: string;
  content_sha256: string;
  line_count: number;
  parse_ok: boolean;
  parse_error: string | null;
}

export interface SpectateStructurePayload {
  files: V3FileNode[];
  symbols: V3SymbolNode[];
  skips: V3SkipRecord[];
}

export interface StaleRelationshipPath {
  path: string;
  last_good_sha256: string;
  current_sha256: string;
}

export interface SpectateEvent {
  schema_version: 'spectate-1.1';
  session_id: string;
  sequence: number;
  emitted_at: string;
  event:
    | 'session_started'
    | 'initial_snapshot'
    | 'file_changed'
    | 'source'
    | 'diff'
    | 'structure_update'
    | 'relationship_update'
    | 'evidence_stale'
    | 'watch_error'
    | 'root_missing'
    | 'session_ended';
  root_display_name?: string;
  files?: SpectateFileSnapshot[];
  structure?: SpectateStructurePayload;
  path?: string;
  kind?: 'created' | 'modified' | 'deleted' | 'renamed';
  from_path?: string | null;
  to_path?: string | null;
  previous_sha256?: string | null;
  new_sha256?: string | null;
  changed_line_ranges?: LineRange[];
  affected_file_ids?: string[];
  affected_symbol_ids?: string[];
  changed_node_ids?: string[];
  parse_ok?: boolean;
  parse_error?: string | null;
  file?: V3FileNode | null;
  symbols?: V3SymbolNode[];
  kept_last_good_symbols?: boolean;
  sha256?: string;
  text?: string | null;
  complete?: boolean;
  skipped_reason?: string | null;
  edges?: V3StaticEdge[];
  unresolved?: V3UnresolvedReference[];
  external_modules?: string[];
  stale_paths?: StaleRelationshipPath[];
  partial_reasons?: string[];
  truncated?: boolean;
  evidence_content_sha256?: string;
  reason?: string;
}

export interface HistoryRoot {
  tool: 'codex' | 'claude_code' | string;
  status: 'ok' | 'missing' | 'unreadable';
  file_count: number;
  message?: string | null;
  active_file_count?: number | null;
  archived_file_count?: number | null;
  catalog_status?: 'ok' | 'missing' | 'unsupported' | 'unreadable' | string | null;
  catalog_message?: string | null;
}

export interface HistorySession {
  session_id: string;
  tool: 'codex' | 'claude_code' | string;
  project_group_key: string;
  project_display_name: string;
  started_at: string;
  ended_at: string;
  prompt_count: number;
  first_prompt_preview: string | null;
  format_version?: string | null;
  parse_status: 'ok' | 'partial' | 'unsupported';
  unsupported_reason?: string | null;
  source_file_sha256?: string;
  redaction_types?: string[];
  history_state?: 'active' | 'archived' | string;
  project_visibility?: 'normal' | 'system_temp' | string;
  source_title?: string | null;
  catalog_first_user_message_preview?: string | null;
  catalog_preview?: string | null;
  catalog_matched?: boolean | null;
  injected_context_messages?: number | null;
  project_parent_name?: string | null;
  parent_display_name?: string | null;
  parent_directory?: string | null;
  parent_dir?: string | null;
}

export interface HistoryPromptSummary {
  prompt_id: string;
  first_line: string | null;
  start_sequence: number;
  end_sequence: number;
  changed_files: string[];
  changed_file_count: number;
  started_at: string;
  ended_at: string;
  test_observation: 'passed' | 'failed' | 'not_observed';
  grouping: 'prompt_turn' | 'recorded_events';
}

export interface HistoryPromptIndex {
  schema_version: 'history-prompt-index-1.1';
  session_id: string;
  source_file_sha256: string;
  prompts: HistoryPromptSummary[];
  cached: boolean;
}

export type HistorySearchField = 'session_title' | 'prompt_text' | 'changed_file';

export interface HistorySearchPrompt {
  prompt_id: string;
  first_line: string | null;
  start_sequence: number;
  end_sequence: number;
  changed_files: string[];
  changed_file_count: number;
  started_at: string;
  ended_at: string;
  matched_in: HistorySearchField[];
}

export interface HistorySearchSession {
  session_id: string;
  tool: 'codex' | 'claude_code';
  source: 'history' | 'replay_store';
  title: string;
  project_display_name: string;
  started_at: string;
  ended_at: string;
  prompts: HistorySearchPrompt[];
}

export interface HistorySearchResult {
  schema_version: 'history-search-1.0';
  query: string;
  sessions: HistorySearchSession[];
  match_count: number;
  indexed_session_count: number;
}

export interface HistoryListPayload {
  roots: HistoryRoot[];
  sessions: HistorySession[];
}

export interface HistoryImportPayload {
  name: string;
  text: string;
  size: number;
}

export interface RevertPlanAction {
  sequence: number;
  path: string;
  action: 'delete_file' | 'restore_file' | 'apply_reverse_diff' | 'manual_review';
  instruction: string;
  provenance:
    | 'recorded_patch'
    | 'reconstructed_from_current_checkout_unverified'
    | 'unknown';
  provenance_label: string;
  reverse_diff: string | null;
  restore_text: string | null;
}

export interface RevertPlan {
  schema_version: 'replay-revert-plan-1.0';
  session_id: string;
  start_sequence: number;
  end_sequence: number;
  actions: RevertPlanAction[];
  truncated: boolean;
  text: string;
}

export interface ReplayModelStatus {
  ready: boolean;
  status: string;
  message: string;
  preset: string;
  modelFilename: string | null;
}

export type NarrationEvent =
  | { scope: 'download'; event: 'progress'; downloaded_bytes: number; total_bytes: number }
  | { scope: 'download'; event: 'done'; model_id: string; artifacts: number }
  | { scope: 'download' | 'narration'; event: 'error'; message: string }
  | {
      scope: 'narration';
      event: 'baseline';
      export: unknown;
    }
  | {
      scope: 'narration';
      event: 'chapter';
      done: number;
      total: number;
      chapter: unknown;
      chapter_run: unknown;
    }
  | {
      scope: 'narration';
      event: 'prompt';
      done: number;
      total: number;
      prompt: unknown;
      prompt_understanding: unknown;
    }
  | {
      scope: 'narration';
      event: 'prompt-check';
      done: number;
      total: number;
      prompt_check: unknown;
    }
  | { scope: 'narration'; event: 'summary'; done: number; total: number; summary: unknown }
  | { scope: 'narration'; event: 'done'; export: unknown };

export interface SpectateBridge {
  chooseProjectFolder(): Promise<ProjectChoice | null>;
  startWatch(): Promise<{ watching: boolean; displayName: string }>;
  stopWatch(): Promise<{ watching: false }>;
  onSpectateEvent(callback: (event: SpectateEvent) => void): () => void;
  openRecording?(): Promise<HistoryImportPayload | null>;
  listHistory?(): Promise<HistoryListPayload>;
  listPrompts?(sessionId: string, tool: string): Promise<HistoryPromptIndex>;
  searchHistory?(query: string): Promise<HistorySearchResult>;
  importSession?(
    sessionId: string,
    tool: string,
    source?: 'history' | 'replay_store',
  ): Promise<HistoryImportPayload>;
  linkSessionProject?(sessionId: string, projectHandle: string): Promise<{ linked: true; displayName: string }>;
  openSessionFile?(
    sessionId: string,
    relativePath: string,
  ): Promise<{ opened: true; method: 'code' | 'finder' }>;
  revertPlan?(
    sessionId: string,
    tool: string,
    start: number,
    end: number,
    source?: 'history' | 'replay_store',
  ): Promise<RevertPlan>;
  modelStatus?(): Promise<ReplayModelStatus>;
  downloadModel?(modelId: string): Promise<{ started: boolean; reason?: string }>;
  chooseModel?(): Promise<{ selected: true; modelFilename: string } | null>;
  startNarration?(sessionId: string, tool: string): Promise<{ started: true }>;
  cancelNarration?(): Promise<{ cancelled: boolean }>;
  rerunNarration?(sessionId: string, tool: string): Promise<{ started: true }>;
  explainStep?(
    sessionId: string,
    tool: string,
    sequence: number,
  ): Promise<{ step: unknown } | { superseded: true }>;
  summarizeSelection?(
    sessionId: string,
    tool: string,
    start: number,
    end: number,
  ): Promise<{ summary: unknown } | { superseded: true }>;
  onNarrationEvent?(callback: (event: NarrationEvent) => void): () => void;
}

declare global {
  interface Window {
    faultmeshSpectate?: SpectateBridge;
  }
}
