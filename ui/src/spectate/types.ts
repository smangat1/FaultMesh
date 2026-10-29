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

export interface SpectateBridge {
  chooseProjectFolder(): Promise<ProjectChoice | null>;
  startWatch(): Promise<{ watching: boolean; displayName: string }>;
  stopWatch(): Promise<{ watching: false }>;
  onSpectateEvent(callback: (event: SpectateEvent) => void): () => void;
  openRecording?(): Promise<HistoryImportPayload | null>;
  listHistory?(): Promise<HistoryListPayload>;
  importSession?(sessionId: string, tool: string): Promise<HistoryImportPayload>;
}

declare global {
  interface Window {
    faultmeshSpectate?: SpectateBridge;
  }
}
