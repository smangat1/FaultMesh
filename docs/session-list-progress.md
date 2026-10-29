# Session List, Timeline Restyle & First-Use Tips Progress

## Baseline Configuration

- **BASE_SHA**: `f5cda9650936c1e6767edbc830e4ec086f480f49`
- **Branch**: `session-list-timeline-tips`
- **Revert Baseline**: All work across Phase 1, Phase 2, and Phase 3 is branched from and revertible to `f5cda9650936c1e6767edbc830e4ec086f480f49`.
- **Target PR**: Draft PR [#27](https://github.com/smangat1/FaultMesh/pull/27) on `session-list-timeline-tips` opened after Phase 1 commit.

## Backend Integration Note (PR #28)

The history discovery contract now provides optional active/archive state, system-temp project
classification, read-only SQLite catalog enrichment, redacted source titles and injected-context
counts. Catalog rows with missing rollout files remain visible as unsupported. The replay checkpoint
card renders imported prompt, tool/output and edit evidence, and timeline extent labels use the
minimum and maximum captured times. The session-list UI should hide `system_temp` groups by default,
prefer `source_title` when present, and preserve access to unsupported rows and explicit reveal
controls. This note does not alter the parallel branch's phase ownership or checklist.

---

## Phase Checklist

- [x] **Phase 1: Replace Selector with Full-Screen Autodetect Widgets**
  - [x] Electron bridge channels for `replay-history-list` and `replay-history-import` in `ui/electron/spectate-main.cjs`, `ui/electron/spectate-preload.cjs`.
  - [x] Node tests with fake spawn for bridge security, trust, limits, and arguments in `ui/electron/spectate-main.test.cjs`.
  - [x] Synthetic fixtures for history roots, sessions, redacting, and status under `ui/src/fixtures/syntheticHistory.ts`.
  - [x] Autodetect Home view replacing `StartupScreen` at normal startup route in `ui/src/App.tsx`.
  - [x] Large calm tool widget per detected coding tool root (`codex`, `claude_code`).
  - [x] Project folders inside each tool widget grouped by `(tool, project_group_key)` and labeled by `project_display_name`.
  - [x] Collapsible folders, sorted by newest session; sessions sorted newest first with stable tie breaks.
  - [x] Session rows showing redacted `first_prompt_preview` (or "Untitled session"), relative time with exact timestamp hover, prompt count labeled strictly as prompts, and partial/unsupported badge with reason.
  - [x] On-demand session import via bridge, validating export through `validateReplayExport`, then opening `ReplayWorkspace`.
  - [x] Quiet secondary utilities on home: "Open recording (.json)", "Select project" for live watching, "Return to workspace" when active run exists.
  - [x] Bridge absent / empty states with file input fallback.
  - [x] Full unit & integration test coverage in Vitest (`ui/src/test/autodetectHome.test.tsx`, `startup.test.tsx`, `startHelpAndEmptyState.test.tsx`) and Node tests.
  - [x] Headless screenshot harness capturing required Phase 1 scenarios with DOM assertions and unique SHA-256 hashes.
  - [x] Phase 1 commit: "Phase 1: autodetect selector widgets" and open Draft PR.

- [x] **Phase 1.5: Real-Data Session List Fixes**
  - [x] Hide `system_temp` project folders by default inside each tool widget.
  - [x] Quiet "Show N hidden system folder(s)" / "Hide N hidden system folder(s)" toggle per tool widget with collapse state persisting for session.
  - [x] Muted "system temp" badge (`data-testid="system-temp-badge"`) displayed on revealed system temp folders.
  - [x] Disambiguate duplicate project display names within one tool by appending sanitized parent directory (e.g. `auth-service / backend` vs `auth-service / services`).
  - [x] Safe `sanitizeParentDirectory` utility ensuring full paths and home directories (`~`, `Users`, `home`, root) are never rendered.
  - [x] Quiet "archived" badge on session row when `history_state == "archived"`.
  - [x] Prefer `source_title` over `first_prompt_preview` as primary row title when present, with redacted preview on secondary line.
  - [x] Preserve visible redaction markers (`[redacted: ...]`) verbatim without recovery or stripping.
  - [x] Honest unsupported row handling for `unsupported_reason: "rollout_file_missing"`.
  - [x] Secondary utilities ("Open recording (.json)" and "Select project") remain reachable in all states.
  - [x] Full unit test coverage in `ui/src/test/autodetectHome.test.tsx` (all 22 tests passing).
  - [x] Updated screenshot capture script with DOM assertions and verified unique SHA-256 hashes.
  - [x] Phase 1.5 commit: "Phase 1.5: real-data session list fixes".

- [ ] **Phase 2: Timeline Restyle**
  - [ ] Minimalist white line bar with quiet ticks for snap points and hairline chapter/gap marks.
  - [ ] Start and end circles displaying only clock times (no "start" / "end" text).
  - [ ] Clock-time label under cursor at snap points during hover, drag, and keyboard selection.
  - [ ] Smooth continuous thumb drag with 150-200ms ease-out snapping on release, respecting `prefers-reduced-motion`.
  - [ ] Maintain data honesty (no resting between steps), keyboard accessibility, and dock resize isolation.
  - [ ] Tests and screenshots for Phase 2.
  - [ ] Phase 2 commit: "Phase 2: timeline restyle".

- [ ] **Phase 3: First-Use Tips**
  - [ ] First-use spotlight tour / tip cards for autodetect home, live entrance, and replay view.
  - [ ] Skip, Escape, and persistent seen-state in `localStorage`.
  - [ ] Replay tips via `?` button in header/chrome.
  - [ ] Respect `prefers-reduced-motion` and desktop drag clearance.
  - [ ] Tests and screenshots for Phase 3.
  - [ ] Phase 3 commit: "Phase 3: first-use tips".

---

## Commit & Evidence Log

### Phase 1: autodetect selector widgets
- **Commit SHA**: `718af731ddf1b087408bb0df85e7f91e3654b9ae`
- **Files Changed (12 files)**:
  - `docs/session-list-progress.md`
  - `docs/screenshots/session-list/01-autodetect-home-two-tool-widgets.png`
  - `docs/screenshots/session-list/02-autodetect-home-folder-collapsed.png`
  - `docs/screenshots/session-list/03-autodetect-home-unsupported-row.png`
  - `docs/screenshots/session-list/10-empty-state-no-bridge.png`
  - `ui/electron/spectate-main.cjs`
  - `ui/electron/spectate-preload.cjs`
  - `ui/electron/spectate-main.test.cjs`
  - `ui/scripts/capture_session_list_screenshots.js`
  - `ui/src/App.tsx`
  - `ui/src/components/AutodetectHomeScreen.tsx`
  - `ui/src/components/StartupScreen.tsx`
  - `ui/src/fixtures/syntheticHistory.ts`
  - `ui/src/spectate/types.ts`
  - `ui/src/test/autodetectHome.test.tsx`
  - `ui/src/test/startup.test.tsx`
- **Verification Commands & Results**:
  - `npx tsc --noEmit`: Clean (0 errors).
  - `npm test`: 28 test files passed (238 Vitest tests, 10 Electron node tests, 0 failed). Total: 248 tests passing.
  - `npm run build`: `tsc && vite build` built in 1.64s with zero errors.
- **Normal Launch & Navigation Confirmation**:
  - Normal startup (`App.tsx` with `currentScreen === 'selector'`) directly displays `AutodetectHomeScreen` with full-screen autodetect tool widgets instead of the old selector.
  - Secondary utilities area keeps "Open recording (.json)" reachable across all states (with desktop dialog and browser file input fallback).
  - "Select project" for opt-in live Python watching remains reachable and transitions to `LiveEntranceScreen` on `initial_snapshot`.
  - "Return to workspace" is displayed when an active run exists.
- **Screenshots Captured (Headless Chrome against real built bundle)**:
  | File | What it shows | DOM Assertion | SHA-256 Checksum |
  |---|---|---|---|
  | `01-autodetect-home-two-tool-widgets.png` | Full new home with two detected tool widgets (Codex & Claude Code), project folders and sessions inside widgets, plus secondary Open recording and Select project actions | `tool-widget-codex`, `tool-widget-claude_code`, `startup-open-recording-btn`, `startup-select-project-btn` present in DOM | `17c89b120c0c6da7822850f1215d5db72f8e61ea2c29c7e6e130649c58c497c6` |
  | `02-autodetect-home-folder-collapsed.png` | Autodetect home with collapsed project folder (auth-service) showing collapsed chevron and hidden sessions list | `folder-sessions-codex:group-auth` is null and `aria-expanded="false"` in DOM | `f3784683f437317aededdc0ce67e30b7353adae517f6c2e9bafe91a01e9252fe` |
  | `03-autodetect-home-unsupported-row.png` | Autodetect home displaying honest partial and unsupported status tags with zstd reason and focused row | `session-parse-status-unsupported` with zstd decompression title and `session-parse-status-partial` present in DOM | `c565dfd8d2b2b8e5ddd7b87131e78505b5fb7e97f80771851d41930041a94bf7` |
  | `10-empty-state-no-bridge.png` | Calm empty state when desktop bridge is absent, explaining desktop app requirement while keeping Open recording (.json) accessible | `autodetect-no-bridge-empty-state` and `startup-open-recording-btn` present in DOM | `f09af2ee719b84445bdfddab5610bf0839586bf12772b05bb908245593ae2fd3` |

### Phase 1.5: real-data session list fixes
- **Commit SHA**: `91d27e361be5c6f39385ceb5be9d37537b98d249`
- **Files Changed (6 files)**:
  - `docs/session-list-progress.md`
  - `docs/screenshots/session-list/01-autodetect-home-two-tool-widgets.png`
  - `docs/screenshots/session-list/02-autodetect-home-folder-collapsed.png`
  - `docs/screenshots/session-list/03-autodetect-home-unsupported-row.png`
  - `docs/screenshots/session-list/04-autodetect-home-hidden-system-collapsed.png`
  - `docs/screenshots/session-list/05-autodetect-home-system-temp-revealed.png`
  - `docs/screenshots/session-list/06-autodetect-home-archived-and-source-title.png`
  - `docs/screenshots/session-list/10-empty-state-no-bridge.png`
  - `ui/electron/spectate-main.cjs`
  - `ui/scripts/capture_session_list_screenshots.js`
  - `ui/src/components/AutodetectHomeScreen.tsx`
  - `ui/src/fixtures/syntheticHistory.ts`
  - `ui/src/spectate/types.ts`
  - `ui/src/test/autodetectHome.test.tsx`
- **Verification Commands & Results**:
  - `npm test`: 28 test files passed (244 Vitest tests, 10 Electron node tests, 0 failed). Total: 254 tests passing.
  - `npm run build`: `tsc && vite build` built cleanly with zero errors.
- **Screenshots Captured (Headless Chrome against real built bundle)**:
  | File | What it shows | DOM Assertion | SHA-256 Checksum |
  |---|---|---|---|
  | `01-autodetect-home-two-tool-widgets.png` | Full new home with two detected tool widgets (Codex & Claude Code), project folders and sessions inside widgets, plus secondary Open recording and Select project actions | `asserted tool-widget-codex, tool-widget-claude_code, startup-open-recording-btn, startup-select-project-btn in DOM` | `d35cd3b7ea4877446aad53c10acbd975b8c50b6dbb3f91147f532dedcd427f69` |
  | `04-autodetect-home-hidden-system-collapsed.png` | Autodetect home with system temp folder hidden by default inside Codex widget, showing quiet "Show 1 hidden system folder" toggle | `asserted toggle-hidden-system-codex is present, project-folder-codex:group-temp-fixture is null, and group-auth-fork is collapsed` | `af7449ec558908b9a99e6245684e478948a5d4c5db360aeff0c542395b34e3b4` |
  | `05-autodetect-home-system-temp-revealed.png` | Autodetect home with system temp folder revealed, displaying muted "system temp" badge and "Hide 1 hidden system folder" toggle | `asserted project-folder-codex:group-temp-fixture present, system-temp-badge text is "system temp", and toggle reads "Hide 1 hidden system folder"` | `13b8fa19729bcd59e67615c5cfbafdabf048f25d21dd26d7b620d410e9383229` |
  | `06-autodetect-home-archived-and-source-title.png` | Session list showing duplicate-folder disambiguation ("auth-service / backend" and "auth-service / services"), quiet "archived" badge on session row, and preferred source_title with secondary redacted preview line | `asserted folder names disambiguated with parent dirs, session-history-state-archived present, session-title is "Token leak investigation", and session-preview-secondary is "Check token leakage in debug logs"` | `6fcfb6c844758e43f5f5f73ffa91338714ea2e7baa414c5708a246fe13458e64` |
  | `02-autodetect-home-folder-collapsed.png` | Autodetect home with collapsed project folder (auth-service) showing collapsed chevron and hidden sessions list | `asserted folder-sessions-codex:group-auth is null and aria-expanded="false"` | `ff3a9bb8081454af09d249c1ad3b602c02c805911fb797f9a1ead1ee5d010d1d` |
  | `03-autodetect-home-unsupported-row.png` | Autodetect home displaying honest partial and unsupported status tags with zstd reason | `asserted session-parse-status-unsupported with zstd decompression title and session-parse-status-partial in DOM` | `8cdb651fde4553afe241953f5a09785f48f35f9b9998fd3282ddb6b2cdf69112` |
  | `10-empty-state-no-bridge.png` | Calm empty state when desktop bridge is absent, explaining desktop app requirement while keeping Open recording (.json) accessible | `asserted autodetect-no-bridge-empty-state and startup-open-recording-btn in DOM` | `f09af2ee719b84445bdfddab5610bf0839586bf12772b05bb908245593ae2fd3` |
