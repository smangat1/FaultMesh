export interface ProjectChoice {
  handle: string;
  displayName: string;
}

export interface LineRange {
  start_line: number;
  end_line: number;
}

export interface SpectateEvent {
  schema_version: 'spectate-1.0';
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
    | 'evidence_stale'
    | 'watch_error'
    | 'root_missing'
    | 'session_ended';
  path?: string;
  kind?: 'created' | 'modified' | 'deleted' | 'renamed';
  new_sha256?: string | null;
  changed_line_ranges?: LineRange[];
  affected_file_ids?: string[];
  affected_symbol_ids?: string[];
  changed_node_ids?: string[];
  parse_ok?: boolean;
  parse_error?: string | null;
  sha256?: string;
  text?: string | null;
  complete?: boolean;
  skipped_reason?: string | null;
  truncated?: boolean;
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
