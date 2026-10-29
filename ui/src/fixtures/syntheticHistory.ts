import type { HistoryListPayload, HistoryRoot, HistorySession } from '../spectate/types';
import heroFixture from './fixture_replay_timeline_hero.json';

export const SYNTHETIC_HISTORY_ROOTS: HistoryRoot[] = [
  {
    tool: 'codex',
    status: 'ok',
    file_count: 14,
    message: null,
  },
  {
    tool: 'claude_code',
    status: 'ok',
    file_count: 5,
    message: null,
  },
];

export const SYNTHETIC_HISTORY_SESSIONS: HistorySession[] = [
  {
    session_id: 'codex-sess-1',
    tool: 'codex',
    project_group_key: 'group-auth',
    project_display_name: 'auth-service',
    started_at: '2026-10-29T10:00:00Z',
    ended_at: '2026-10-29T10:15:00Z',
    prompt_count: 3,
    first_prompt_preview: 'Fix token expiration bug [redacted: jwt secret] in auth handler',
    format_version: '1.0',
    parse_status: 'ok',
    unsupported_reason: null,
    source_file_sha256: 'sha256-codex-1',
    redaction_types: ['jwt secret'],
  },
  {
    session_id: 'codex-sess-2',
    tool: 'codex',
    project_group_key: 'group-auth',
    project_display_name: 'auth-service',
    started_at: '2026-10-29T09:00:00Z',
    ended_at: '2026-10-29T09:10:00Z',
    prompt_count: 1,
    first_prompt_preview: null,
    format_version: '1.0',
    parse_status: 'ok',
    unsupported_reason: null,
    source_file_sha256: 'sha256-codex-2',
    redaction_types: [],
  },
  {
    session_id: 'codex-sess-3',
    tool: 'codex',
    project_group_key: 'group-auth-fork',
    project_display_name: 'auth-service',
    started_at: '2026-10-29T09:30:00Z',
    ended_at: '2026-10-29T09:40:00Z',
    prompt_count: 2,
    first_prompt_preview: 'Update login rate limiting',
    format_version: '1.0',
    parse_status: 'partial',
    unsupported_reason: '1 step could not be parsed',
    source_file_sha256: 'sha256-codex-3',
    redaction_types: [],
  },
  {
    session_id: 'claude-sess-1',
    tool: 'claude_code',
    project_group_key: 'group-billing',
    project_display_name: 'billing-service',
    started_at: '2026-10-29T11:00:00Z',
    ended_at: '2026-10-29T11:20:00Z',
    prompt_count: 4,
    first_prompt_preview: 'Add stripe webhook handler [redacted: webhook key]',
    format_version: '1.0',
    parse_status: 'ok',
    unsupported_reason: null,
    source_file_sha256: 'sha256-claude-1',
    redaction_types: ['webhook key'],
  },
  {
    session_id: 'claude-sess-2',
    tool: 'claude_code',
    project_group_key: 'group-reporting',
    project_display_name: 'reporting-service',
    started_at: '2026-10-29T08:00:00Z',
    ended_at: '2026-10-29T08:15:00Z',
    prompt_count: 1,
    first_prompt_preview: 'Export invoice as pdf',
    format_version: '1.0',
    parse_status: 'unsupported',
    unsupported_reason: 'Requires local zstd decompression',
    source_file_sha256: 'sha256-claude-2',
    redaction_types: [],
  },
];

export const SYNTHETIC_HISTORY_PAYLOAD: HistoryListPayload = {
  roots: SYNTHETIC_HISTORY_ROOTS,
  sessions: SYNTHETIC_HISTORY_SESSIONS,
};

export function createSyntheticReplayExport(sessionId: string, tool: string = 'codex'): Record<string, unknown> {
  const session = SYNTHETIC_HISTORY_SESSIONS.find((s) => s.session_id === sessionId) || {
    session_id: sessionId,
    tool,
    project_group_key: 'group-unknown',
    project_display_name: 'imported-project',
    started_at: '2026-10-29T10:00:00.000000Z',
    ended_at: '2026-10-29T10:15:00.000000Z',
    prompt_count: 1,
    first_prompt_preview: 'Imported session preview',
  };

  return {
    ...heroFixture,
    session: {
      ...heroFixture.session,
      id: session.session_id,
    },
  };
}
