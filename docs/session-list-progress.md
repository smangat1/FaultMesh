# Session list progress note

The session-list phase checklist is owned by the parallel `session-list-timeline-tips` work and is
not reproduced or modified on this branch.

## Backend integration note — 2026-10-29

The history discovery contract now provides optional active/archive state, system-temp project
classification, read-only SQLite catalog enrichment, redacted source titles and injected-context
counts. Catalog rows with missing rollout files remain visible as unsupported. The replay checkpoint
card renders imported prompt, tool/output and edit evidence, and timeline extent labels use the
minimum and maximum captured times. The session-list UI should hide `system_temp` groups by default,
prefer `source_title` when present, and preserve access to unsupported rows and explicit reveal
controls. This note does not alter the parallel branch's phase ownership or checklist.
