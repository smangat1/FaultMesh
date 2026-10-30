import type { ReplayRecord, TimelineEntry } from './types';

const PATCH_PATH = /^\*\*\*\s+(?:update|add|delete|move|type):\s+(.+)$/im;

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0].trim();
}

function commandFromInput(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const command = (input as Record<string, unknown>).command;
  return typeof command === 'string' && command.trim() ? command.trim() : null;
}

export function plainReplayStepLabel(
  record: ReplayRecord | null | undefined,
  entry: TimelineEntry
): string {
  if (record?.prompt_text?.trim()) {
    return firstLine(record.prompt_text);
  }

  const patchPath = record?.edit_patch?.match(PATCH_PATH)?.[1]?.trim()
    ?? entry.changed_files[0]?.path;
  if (patchPath) {
    return `Edited ${patchPath}`;
  }

  const command = record?.edit_command?.trim() || commandFromInput(record?.tool_input);
  if (command) {
    return `Ran: ${firstLine(command)}`;
  }

  const toolName = entry.tool_name?.trim();
  if (toolName && toolName.toLowerCase() !== 'tool') {
    return `Ran: ${toolName}`;
  }
  if (entry.tool_use_id || toolName) {
    return 'Ran a tool action';
  }
  if (entry.record_type === 'gap') {
    return 'Recording gap';
  }
  return 'Recorded step';
}
