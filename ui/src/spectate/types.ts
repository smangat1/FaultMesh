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

export interface SpectateBridge {
  chooseProjectFolder(): Promise<ProjectChoice | null>;
  startWatch(): Promise<{ watching: boolean; displayName: string }>;
  stopWatch(): Promise<{ watching: false }>;
  onSpectateEvent(callback: (event: SpectateEvent) => void): () => void;
}

declare global {
  interface Window {
    faultmeshSpectate?: SpectateBridge;
  }
}
