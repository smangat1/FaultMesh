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

- [x] **Phase 1.5: Real-Data Session List Fixes & Full-Screen Tool Exploration**
  - [x] Full-screen tool exploration: clicking tool widget ("Codex", "Claude Code") on home transitions into full-screen session view with "← All Tools" back button.
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

- [x] **Phase 2: Timeline Restyle**
  - [x] Minimalist white line bar with quiet ticks for snap points and hairline chapter/gap marks.
  - [x] Start and end circles displaying only clock times (no "start" / "end" text).
  - [x] Clock-time label under cursor at snap points during hover, drag, and keyboard selection.
  - [x] Smooth continuous thumb drag with 150-200ms ease-out snapping on release, respecting `prefers-reduced-motion`.
  - [x] Maintain data honesty (no resting between steps), keyboard accessibility, and dock resize isolation.
  - [x] Tests and screenshots for Phase 2.
  - [x] Phase 2 commit: "Phase 2: timeline restyle".

- [x] **Phase 3: First-Use Tips**
  - [x] First-use spotlight tour / tip cards for autodetect home, live entrance, and replay view.
  - [x] Skip, Escape, and persistent seen-state in `localStorage`.
  - [x] Replay tips via `?` button in header/chrome.
  - [x] Respect `prefers-reduced-motion` and desktop drag clearance.
  - [x] Tests and screenshots for Phase 3.
  - [x] Phase 3 commit: "Phase 3: first-use tips".

---

## Commit & Evidence Log

### Phase 1: autodetect selector widgets
- **Commit SHA**: `fe5e3a2` (rebased onto main) / `718af731ddf1b087408bb0df85e7f91e3654b9ae` (pre-rebase)
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
  | `01-autodetect-home-two-tool-widgets.png` | Full new home with two detected tool widgets (Codex & Claude Code), project folders and sessions inside widgets, plus secondary Open recording and Select project actions | `tool-widget-codex`, `tool-widget-claude_code`, `startup-open-recording-btn`, `startup-select-project-btn` present in DOM | `c4d57bb9dd26eea93ef23ca680aaaf3830b0f55ef8c34d43cd618226ce8a6df6` |
  | `02-autodetect-home-folder-collapsed.png` | Autodetect home with collapsed project folder (auth-service) showing collapsed chevron and hidden sessions list | `folder-sessions-codex:group-auth` is null and `aria-expanded="false"` in DOM | `ca7a2a8f4188a5ae1f701529bac0adea73b277fe815ab8c1eefea9202848e829` |
  | `03-autodetect-home-unsupported-row.png` | Autodetect home displaying honest partial and unsupported status tags with zstd reason and focused row | `session-parse-status-unsupported` with zstd decompression title and `session-parse-status-partial` present in DOM | `1f9f5f71242595b68697959fefc15dde6d9b25d81abeaad59415a55891cd311d` |
  | `10-empty-state-no-bridge.png` | Calm empty state when desktop bridge is absent, explaining desktop app requirement while keeping Open recording (.json) accessible | `autodetect-no-bridge-empty-state` and `startup-open-recording-btn` present in DOM | `388d7bdd901eb306045613bc4b7a27902a1ea8ffb8d636979d665fee1158516b` |

### Phase 1.5: real-data session list fixes & full-screen tool exploration
- **Commit SHA**: `738dbfb` (Phase 1.5: real-data session list fixes) & `62a43f9` (feat(ui): click tool widget to explore sessions in full-screen view)
- **Files Changed**:
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
  - `ui/src/App.tsx`
  - `ui/src/components/AutodetectHomeScreen.tsx`
  - `ui/src/components/StartupScreen.tsx`
  - `ui/src/fixtures/syntheticHistory.ts`
  - `ui/src/spectate/types.ts`
  - `ui/src/test/autodetectHome.test.tsx`
- **Verification Commands & Results**:
  - `npx tsc --noEmit`: Clean (0 errors).
  - `npm test`: 28 test files passed (244 Vitest tests, 10 Electron node tests, 0 failed). Total: 254 tests passing.
  - `npm run build`: `tsc && vite build` built cleanly with zero errors in 1.44s.
- **Full-Screen Tool Exploration Confirmation**:
  - Normal startup displays sleek, focused tool widget cards (Codex, Claude Code) displaying tool name, icon, source file counts, session counts, and "Explore sessions →".
  - Clicking any detected tool widget transitions into a full-screen view for that tool (`data-testid="tool-fullscreen-<tool>"`), with prominent "← All Tools" back button (`data-testid="back-to-tools-btn"`).
  - Pressing Escape or clicking "← All Tools" returns to the tools overview.
  - Secondary utilities ("Open recording (.json)", "Select project", and "Return to workspace") remain reachable on all states.
- **Screenshots Captured (Headless Chrome against real built bundle)**:
  | File | What it shows | DOM Assertion | SHA-256 Checksum |
  |---|---|---|---|
  | `01-autodetect-home-two-tool-widgets.png` | Full new home with two detected tool widgets (Codex & Claude Code) showing source file counts, session counts, "Explore sessions", and secondary actions | `asserted tool-widget-codex, tool-widget-claude_code, startup-open-recording-btn, startup-select-project-btn in DOM` | `c4d57bb9dd26eea93ef23ca680aaaf3830b0f55ef8c34d43cd618226ce8a6df6` |
  | `04-autodetect-home-hidden-system-collapsed.png` | Codex full-screen view with system temp folder hidden by default, showing quiet "Show 1 hidden system folder" toggle | `asserted toggle-hidden-system-codex is present, project-folder-codex:group-temp-fixture is null, and group-auth-fork is collapsed` | `7447271166a7d623fc4599c40a62e8caacc426d80038a30ab36caec93645fd3a` |
  | `05-autodetect-home-system-temp-revealed.png` | Codex full-screen view with system temp folder revealed, displaying muted "system temp" badge and "Hide 1 hidden system folder" toggle | `asserted project-folder-codex:group-temp-fixture present, system-temp-badge text is "system temp", and toggle reads "Hide 1 hidden system folder"` | `f9cf3b926e081d19d9eeaee58ff551314f5c3cda0980cb4d6b65d30b59547cc7` |
  | `06-autodetect-home-archived-and-source-title.png` | Codex full-screen view showing duplicate-folder disambiguation ("auth-service / backend" and "auth-service / services"), quiet "archived" badge on session row, and preferred source_title with secondary redacted preview line | `asserted folder names disambiguated with parent dirs, session-history-state-archived present, session-title is "Token leak investigation", and session-preview-secondary is "Check token leakage in debug logs"` | `eea669eb32a1ff3b241e6e2db9c1c919e253817c30236d609aedcaf84f02b7b1` |
  | `02-autodetect-home-folder-collapsed.png` | Codex full-screen view with collapsed project folder (auth-service) showing collapsed chevron and hidden sessions list | `asserted folder-sessions-codex:group-auth is null and aria-expanded="false"` | `ca7a2a8f4188a5ae1f701529bac0adea73b277fe815ab8c1eefea9202848e829` |
  | `03-autodetect-home-unsupported-row.png` | Claude Code full-screen view displaying honest unsupported status tag with zstd reason | `asserted session-row-claude-sess-2 and session-parse-status-unsupported with zstd decompression title in DOM` | `1f9f5f71242595b68697959fefc15dde6d9b25d81abeaad59415a55891cd311d` |
  | `10-empty-state-no-bridge.png` | Calm empty state when desktop bridge is absent, explaining desktop app requirement while keeping Open recording (.json) accessible | `asserted autodetect-no-bridge-empty-state and startup-open-recording-btn in DOM` | `388d7bdd901eb306045613bc4b7a27902a1ea8ffb8d636979d665fee1158516b` |

### Phase 2: timeline restyle
- **Commit SHA**: `713d431`
- **Files Changed (11 files)**:
  - `docs/session-list-progress.md`
  - `docs/screenshots/session-list/04-timeline-resting.png`
  - `docs/screenshots/session-list/05-timeline-hover-label.png`
  - `docs/screenshots/session-list/06-timeline-mid-drag.png`
  - `docs/screenshots/session-list/07-timeline-after-release.png`
  - `ui/scripts/capture_timeline_screenshots.js`
  - `ui/src/components/replay/ReplayTimelineBar.tsx`
  - `ui/src/replay/timeModel.ts`
  - `ui/src/styles/replay.css`
  - `ui/src/test/replayTimelineBar.test.tsx`
  - `ui/src/test/setup.ts`
- **Verification Commands & Results**:
  - `npx tsc --noEmit`: Clean (0 errors).
  - `npm test`: 28 test files passed (249 Vitest tests, 10 Electron node tests, 0 failed). Total: 259 tests passing.
  - `npm run build`: `tsc && vite build` built cleanly with zero errors in 1.46s.
- **Visual & Behavioral Restyle Confirmation**:
  - Clean white line (`2px`, `#ffffff`) streaking across the timeline bar with no heavy track rail background.
  - Start circle at 0% and end circle at 100% displaying strictly clock times (e.g. `8:00:00 AM` and `8:19:00 AM`), with zero "start" or "end" text.
  - Subtle hairline ticks (`.replay-timeline-step-tick`) at every snap point along the line.
  - Current checkpoint displayed as a slightly larger filled circle thumb (`.replay-timeline-thumb`).
  - Small floating clock-time label under cursor at snap points (`.replay-timeline-cursor-label`) during hover, continuous pointer drag, and keyboard focus without layout shift.
  - Smooth continuous drag tracking the pointer coordinates, updating the nearest snap clock-time label without advancing the selected step; on release, thumb smoothly eases (180ms ease-out) onto the nearest checkpoint and updates the selected step.
  - Prefers-reduced-motion enforced via `@media (prefers-reduced-motion: reduce) { .replay-timeline-thumb { transition: none !important; } }`.
  - Full keyboard accessibility and dock resize isolation preserved.
- **Screenshots Captured (Headless Chrome against real built bundle with zero duplicate hashes)**:
  | File | What it shows | DOM Assertion | SHA-256 Checksum |
  |---|---|---|---|
  | `04-timeline-resting.png` | Timeline bar at rest: clean white line streaking across the bar, end circles displaying only clock times (no "start"/"end"), subtle hairline ticks at every snap point, and filled circle thumb | `asserted clean 2px line, timeline-circle-start (0%), timeline-circle-end (100%), extent clock times without "start"/"end", 7 ticks, and no cursor label at rest` | `8d4cf180e6467a9c0221d8561840e99c1d8517a5115a08b0a172b10ffbca2401` |
  | `05-timeline-hover-label.png` | Timeline bar during hover: floating small muted-white clock-time label appears under cursor at nearest snap point without shifting layout | `asserted timeline-cursor-label appears under cursor at snap point displaying valid clock time while thumb remains at initial checkpoint` | `24e39b11533e85d65700932159b5c91345292a5c21aa0304f8812aada0e99ac4` |
  | `06-timeline-mid-drag.png` | Timeline bar mid-drag: thumb continuously tracks pointer position without jumping, cursor label shows nearest snap clock time, and current selected checkpoint remains strictly unchanged until release | `asserted timeline-thumb has class "dragging", left matches drag pointer (~60%), timeline-cursor-label visible, and header badge strictly remains Checkpoint #1` | `c4c8bb6bae605da6eb7a4f1ab246443368622d6908b3ef648548e3183c4ed92b` |
  | `07-timeline-after-release.png` | Timeline bar after drag release: thumb smoothly eased onto nearest recorded checkpoint (180ms ease-out), dragging class removed, and current checkpoint updated in workspace | `asserted timeline-thumb lacks "dragging" class, checkpoint advanced to nearest recorded step (#5), and thumb snapped to checkpoint ratio` | `6ae3856b9c8457a0a5ba1bee8c2c17edb41c9acb0a5144b8d099750008a7f2bf` |

### Phase 3: first-use tips
- **Commit SHA**: `b3adaa3` (Phase 3: first-use tips)
- **Files Changed (14 files)**:
  - `docs/session-list-progress.md`
  - `docs/screenshots/session-list/04-timeline-resting.png`
  - `docs/screenshots/session-list/05-timeline-hover-label.png`
  - `docs/screenshots/session-list/06-timeline-mid-drag.png`
  - `docs/screenshots/session-list/07-timeline-after-release.png`
  - `docs/screenshots/session-list/08-tip-session-list.png`
  - `docs/screenshots/session-list/09-tip-replay-timeline.png`
  - `ui/scripts/capture_tips_screenshots.js`
  - `ui/src/components/AutodetectHomeScreen.tsx`
  - `ui/src/components/FirstUseTipOverlay.tsx`
  - `ui/src/components/LiveEntranceScreen.tsx`
  - `ui/src/components/replay/ReplayTimelineBar.tsx`
  - `ui/src/components/replay/ReplayWorkspace.tsx`
  - `ui/src/styles/replay.css`
  - `ui/src/styles/theme.css`
  - `ui/src/test/firstUseTips.test.tsx`
  - `ui/src/test/replayTimelineBar.test.tsx`
  - `ui/src/test/setup.ts`
  - `ui/src/utils/firstUseTipsStorage.ts`
- **Verification Commands & Results**:
  - `npx tsc --noEmit`: Clean (0 errors).
  - `npm test`: 29 test files passed (265 Vitest tests, 10 Electron node tests, 0 failed). Total: 275 tests passing.
  - `npm run build`: `tsc && vite build` built cleanly with zero errors in 1.69s.
- **Visual & Behavioral First-Use Tips Confirmation**:
  - First-use spotlight tour overlay (`FirstUseTipOverlay`) with dimmed backdrop, SVG mask cutout, and focus ring around target element.
  - Interactive tip card showing title, description, step dots, Skip button, and Next ("Got it") button.
  - Keyboard navigation: Escape key dismisses tips and marks screen as seen.
  - Persistent seen-state stored per screen under namespaced localStorage key (`faultmesh:first_use_tips:seen`), with corrupt or missing storage safely treated as unseen.
  - Replay tips on demand via small "?" button (`.first-use-help-btn`) in header across Autodetect Home, Live Entrance, and Replay Workspace.
  - Gracefully skips missing targets without crashes or blocking user actions.
  - Does not block the app: pointer events pass through overlay to underlying components except on tip card.
  - Avoids mac traffic lights and desktop window drag clearance (`top >= 50px`, `left >= 20px`).
  - Respects `prefers-reduced-motion` with transition suppression.
  - Phase 2 follow-ups verified: pointer release clears hovered step to prevent stale cursor label, and cursor label is positioned 7px above footer text with zero overlap.
- **Screenshots Captured (Headless Chrome against real built bundle with zero duplicate hashes)**:
  | File | What it shows | DOM Assertion | SHA-256 Checksum |
  |---|---|---|---|
  | `08-tip-session-list.png` | Autodetect Home first-use tip overlay: dimmed backdrop, SVG cutout, tip card with title ("Welcome to FaultMesh"), description, step dots, Skip, and header "?" button | `asserted first-use-tip-overlay, first-use-spotlight-svg, first-use-tip-card, tip-card-title is "Welcome to FaultMesh", desc contains autodetect explanation, and home-help-tips-btn present in header` | `c5e4595238cc7d89d381eccc81f78fd411495167af818b15b6e507b056712b5c` |
  | `09-tip-replay-timeline.png` | Replay Workspace first-use tip overlay: spotlight ring highlighting Hero Timeline bar (`replay-timeline-bar`), tip card with title ("Hero Timeline"), description, and header "?" button in toolbar | `asserted first-use-tip-overlay with data-screen="replay", first-use-spotlight-ring, replay-timeline-bar, tip-card-title is "Hero Timeline", and replay-help-tips-btn in header tools` | `8de4f682d63a9e978474e09ed323dd408e93da3e7c1d2e54b964dd187e4008ba` |

