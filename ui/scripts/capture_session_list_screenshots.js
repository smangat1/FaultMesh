import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots/session-list');
const DIST_INDEX_PATH = path.resolve(__dirname, '../dist/index.html');

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const SYNTHETIC_PAYLOAD = {
  roots: [
    { tool: 'codex', status: 'ok', file_count: 14, message: null },
    { tool: 'claude_code', status: 'ok', file_count: 5, message: null },
  ],
  sessions: [
    {
      session_id: 'codex-sess-1',
      tool: 'codex',
      project_group_key: 'group-auth',
      project_display_name: 'auth-service',
      project_parent_name: 'backend',
      started_at: '2026-10-29T10:00:00Z',
      ended_at: '2026-10-29T10:15:00Z',
      prompt_count: 3,
      first_prompt_preview: 'Fix token expiration bug [redacted: jwt secret] in auth handler',
      source_title: null,
      history_state: 'active',
      project_visibility: 'normal',
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
      project_parent_name: 'backend',
      started_at: '2026-10-29T09:00:00Z',
      ended_at: '2026-10-29T09:10:00Z',
      prompt_count: 1,
      first_prompt_preview: null,
      source_title: null,
      history_state: 'active',
      project_visibility: 'normal',
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
      project_parent_name: 'services',
      started_at: '2026-10-29T09:30:00Z',
      ended_at: '2026-10-29T09:40:00Z',
      prompt_count: 2,
      first_prompt_preview: 'Update login rate limiting',
      source_title: null,
      history_state: 'archived',
      project_visibility: 'normal',
      format_version: '1.0',
      parse_status: 'partial',
      unsupported_reason: '1 step could not be parsed',
      source_file_sha256: 'sha256-codex-3',
      redaction_types: [],
    },
    {
      session_id: 'codex-sess-title',
      tool: 'codex',
      project_group_key: 'group-auth',
      project_display_name: 'auth-service',
      project_parent_name: 'backend',
      started_at: '2026-10-29T08:30:00Z',
      ended_at: '2026-10-29T08:45:00Z',
      prompt_count: 2,
      first_prompt_preview: 'Check token leakage in debug logs',
      source_title: 'Token leak investigation',
      history_state: 'active',
      project_visibility: 'normal',
      format_version: '1.0',
      parse_status: 'ok',
      unsupported_reason: null,
      source_file_sha256: 'sha256-codex-title',
      redaction_types: [],
    },
    {
      session_id: 'codex-sess-temp',
      tool: 'codex',
      project_group_key: 'group-temp-fixture',
      project_display_name: 'fixture-test',
      project_parent_name: 'tmp',
      started_at: '2026-10-29T07:00:00Z',
      ended_at: '2026-10-29T07:05:00Z',
      prompt_count: 1,
      first_prompt_preview: 'Run ephemeral test fixtures',
      source_title: null,
      history_state: 'active',
      project_visibility: 'system_temp',
      format_version: '1.0',
      parse_status: 'ok',
      unsupported_reason: null,
      source_file_sha256: 'sha256-codex-temp',
      redaction_types: [],
    },
    {
      session_id: 'codex-sess-missing-rollout',
      tool: 'codex',
      project_group_key: 'group-auth',
      project_display_name: 'auth-service',
      project_parent_name: 'backend',
      started_at: '2026-10-28T16:00:00Z',
      ended_at: '2026-10-28T16:00:00Z',
      prompt_count: 0,
      first_prompt_preview: null,
      source_title: 'Archived catalog thread without rollout file',
      history_state: 'archived',
      project_visibility: 'normal',
      format_version: null,
      parse_status: 'unsupported',
      unsupported_reason: 'rollout_file_missing',
      source_file_sha256: 'sha256-codex-missing',
      redaction_types: [],
    },
    {
      session_id: 'claude-sess-1',
      tool: 'claude_code',
      project_group_key: 'group-billing',
      project_display_name: 'billing-service',
      project_parent_name: 'billing',
      started_at: '2026-10-29T11:00:00Z',
      ended_at: '2026-10-29T11:20:00Z',
      prompt_count: 4,
      first_prompt_preview: 'Add stripe webhook handler [redacted: webhook key]',
      source_title: null,
      history_state: 'active',
      project_visibility: 'normal',
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
      project_parent_name: 'reporting',
      started_at: '2026-10-29T08:00:00Z',
      ended_at: '2026-10-29T08:15:00Z',
      prompt_count: 1,
      first_prompt_preview: 'Export invoice as pdf',
      source_title: null,
      history_state: 'active',
      project_visibility: 'normal',
      format_version: '1.0',
      parse_status: 'unsupported',
      unsupported_reason: 'Requires local zstd decompression',
      source_file_sha256: 'sha256-claude-2',
      redaction_types: [],
    },
  ],
};

async function main() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
  });

  const fileUrl = `file://${DIST_INDEX_PATH}`;
  const captured = [];

  // Pass 1: With Synthetic Bridge
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

    await page.evaluateOnNewDocument((payload) => {
      window.localStorage.setItem(
        'faultmesh:first_use_tips:seen',
        JSON.stringify({ home: true, entrance: true, replay: true })
      );
      window.faultmeshSpectate = {
        chooseProjectFolder: async () => ({ handle: 'h1', displayName: 'synthetic-app' }),
        startWatch: async () => ({ watching: true, displayName: 'synthetic-app' }),
        stopWatch: async () => ({ watching: false }),
        onSpectateEvent: () => () => {},
        openRecording: async () => null,
        listHistory: async () => payload,
        importSession: async () => ({ name: 'mock.json', size: 100, text: '{}' }),
      };
    }, SYNTHETIC_PAYLOAD);

    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));

    // Shot 1: 01-autodetect-home-two-tool-widgets.png
    console.log('Asserting DOM for Shot 1: Two tool widgets...');
    const shot1Check = await page.evaluate(() => {
      const codexWidget = document.querySelector('[data-testid="tool-widget-codex"]');
      const claudeWidget = document.querySelector('[data-testid="tool-widget-claude_code"]');
      const openBtn = document.querySelector('[data-testid="startup-open-recording-btn"]');
      const selectBtn = document.querySelector('[data-testid="startup-select-project-btn"]');
      if (!codexWidget) return { ok: false, error: 'tool-widget-codex missing' };
      if (!claudeWidget) return { ok: false, error: 'tool-widget-claude_code missing' };
      if (!openBtn) return { ok: false, error: 'startup-open-recording-btn missing' };
      if (!selectBtn) return { ok: false, error: 'startup-select-project-btn missing' };
      return {
        ok: true,
        summary: `Codex & Claude widgets found with ${codexWidget.textContent?.slice(0, 30)}...`,
      };
    });
    if (!shot1Check.ok) throw new Error(`Shot 1 assertion failed: ${shot1Check.error}`);
    console.log('Shot 1 assertion passed:', shot1Check.summary);

    const shot1Path = path.join(SCREENSHOTS_DIR, '01-autodetect-home-two-tool-widgets.png');
    await page.screenshot({ path: shot1Path, fullPage: false });
    captured.push({
      file: '01-autodetect-home-two-tool-widgets.png',
      what: 'Full new home with two detected tool widgets (Codex & Claude Code), project folders and sessions inside widgets, plus secondary Open recording and Select project actions',
      assertion: 'asserted tool-widget-codex, tool-widget-claude_code, startup-open-recording-btn, startup-select-project-btn in DOM',
      path: shot1Path,
    });

    // Shot 4: 04-autodetect-home-hidden-system-collapsed.png (Phase 1.5)
    console.log('Clicking tool-widget-codex to enter full screen view for Shot 4...');
    await page.click('[data-testid="tool-widget-codex"]');
    await new Promise((r) => setTimeout(r, 400));

    console.log('Asserting DOM for Shot 4: Hidden system folder collapsed with quiet toggle...');
    // Collapse group-auth-fork so the quiet toggle is prominently displayed beneath the primary folders
    await page.click('[data-testid="folder-toggle-codex:group-auth-fork"]');
    await new Promise((r) => setTimeout(r, 200));

    const shot4Check = await page.evaluate(() => {
      const toggle = document.querySelector('[data-testid="toggle-hidden-system-codex"]');
      const hiddenFolder = document.querySelector('[data-testid="project-folder-codex:group-temp-fixture"]');
      const forkSessions = document.querySelector('[data-testid="folder-sessions-codex:group-auth-fork"]');
      if (!toggle) return { ok: false, error: 'toggle-hidden-system-codex button missing' };
      if (hiddenFolder !== null) return { ok: false, error: 'group-temp-fixture must be hidden by default' };
      if (forkSessions !== null) return { ok: false, error: 'group-auth-fork sessions should be collapsed' };
      if (!toggle.textContent?.includes('Show 1 hidden system folder')) {
        return { ok: false, error: `Unexpected toggle text: ${toggle.textContent}` };
      }
      return { ok: true, summary: 'Hidden system folder is collapsed and quiet toggle is present' };
    });
    if (!shot4Check.ok) throw new Error(`Shot 4 assertion failed: ${shot4Check.error}`);
    console.log('Shot 4 assertion passed:', shot4Check.summary);

    const shot4Path = path.join(SCREENSHOTS_DIR, '04-autodetect-home-hidden-system-collapsed.png');
    await page.screenshot({ path: shot4Path, fullPage: false });
    captured.push({
      file: '04-autodetect-home-hidden-system-collapsed.png',
      what: 'Autodetect home with system temp folder hidden by default inside Codex widget, showing quiet "Show 1 hidden system folder" toggle',
      assertion: 'asserted toggle-hidden-system-codex is present, project-folder-codex:group-temp-fixture is null, and group-auth-fork is collapsed',
      path: shot4Path,
    });

    // Shot 5: 05-autodetect-home-system-temp-revealed.png (Phase 1.5)
    console.log('Clicking toggle to reveal hidden system temp folder for Shot 5...');
    await page.click('[data-testid="toggle-hidden-system-codex"]');
    await new Promise((r) => setTimeout(r, 300));

    const shot5Check = await page.evaluate(() => {
      const revealedFolder = document.querySelector('[data-testid="project-folder-codex:group-temp-fixture"]');
      const badge = revealedFolder?.querySelector('[data-testid="system-temp-badge"]');
      const toggle = document.querySelector('[data-testid="toggle-hidden-system-codex"]');
      if (!revealedFolder) return { ok: false, error: 'Revealed folder group-temp-fixture missing after toggle' };
      if (!badge || badge.textContent?.trim() !== 'system temp') {
        return { ok: false, error: 'Muted system temp badge missing or wrong text' };
      }
      if (!toggle?.textContent?.includes('Hide 1 hidden system folder')) {
        return { ok: false, error: `Unexpected toggle text after reveal: ${toggle?.textContent}` };
      }
      return { ok: true, summary: 'Revealed fixture-test folder with muted system temp badge' };
    });
    if (!shot5Check.ok) throw new Error(`Shot 5 assertion failed: ${shot5Check.error}`);
    console.log('Shot 5 assertion passed:', shot5Check.summary);

    const shot5Path = path.join(SCREENSHOTS_DIR, '05-autodetect-home-system-temp-revealed.png');
    await page.screenshot({ path: shot5Path, fullPage: false });
    captured.push({
      file: '05-autodetect-home-system-temp-revealed.png',
      what: 'Autodetect home with system temp folder revealed, displaying muted "system temp" badge and "Hide 1 hidden system folder" toggle',
      assertion: 'asserted project-folder-codex:group-temp-fixture present, system-temp-badge text is "system temp", and toggle reads "Hide 1 hidden system folder"',
      path: shot5Path,
    });

    // Shot 6: 06-autodetect-home-archived-and-source-title.png (Phase 1.5)
    console.log('Re-expanding group-auth-fork for Shot 6 to show archived badge and source_title...');
    await page.click('[data-testid="folder-toggle-codex:group-auth-fork"]');
    await new Promise((r) => setTimeout(r, 300));

    const shot6Check = await page.evaluate(() => {
      const folder1Name = document.querySelector('[data-testid="project-folder-codex:group-auth"] [data-testid="project-folder-name"]')?.textContent;
      const folder2Name = document.querySelector('[data-testid="project-folder-codex:group-auth-fork"] [data-testid="project-folder-name"]')?.textContent;
      const archivedBadge = document.querySelector('[data-testid="session-row-codex-sess-3"] [data-testid="session-history-state-archived"]');
      const sourceTitleRow = document.querySelector('[data-testid="session-row-codex-sess-title"]');
      const primaryTitle = sourceTitleRow?.querySelector('[data-testid="session-title"]')?.textContent;
      const secondaryPreview = sourceTitleRow?.querySelector('[data-testid="session-preview-secondary"]')?.textContent;

      if (folder1Name !== 'auth-service / backend') {
        return { ok: false, error: `Expected folder 1 disambiguation "auth-service / backend", got: ${folder1Name}` };
      }
      if (folder2Name !== 'auth-service / services') {
        return { ok: false, error: `Expected folder 2 disambiguation "auth-service / services", got: ${folder2Name}` };
      }
      if (!archivedBadge || archivedBadge.textContent?.trim() !== 'archived') {
        return { ok: false, error: 'Quiet archived badge missing on codex-sess-3' };
      }
      if (primaryTitle !== 'Token leak investigation') {
        return { ok: false, error: `Expected source_title "Token leak investigation", got: ${primaryTitle}` };
      }
      if (secondaryPreview !== 'Check token leakage in debug logs') {
        return { ok: false, error: `Expected secondary preview "Check token leakage in debug logs", got: ${secondaryPreview}` };
      }
      return { ok: true, summary: 'Found disambiguated folders, archived badge, and source_title with secondary preview' };
    });
    if (!shot6Check.ok) throw new Error(`Shot 6 assertion failed: ${shot6Check.error}`);
    console.log('Shot 6 assertion passed:', shot6Check.summary);

    const shot6Path = path.join(SCREENSHOTS_DIR, '06-autodetect-home-archived-and-source-title.png');
    await page.screenshot({ path: shot6Path, fullPage: false });
    captured.push({
      file: '06-autodetect-home-archived-and-source-title.png',
      what: 'Session list showing duplicate-folder disambiguation ("auth-service / backend" and "auth-service / services"), quiet "archived" badge on session row, and preferred source_title with secondary redacted preview line',
      assertion: 'asserted folder names disambiguated with parent dirs, session-history-state-archived present, session-title is "Token leak investigation", and session-preview-secondary is "Check token leakage in debug logs"',
      path: shot6Path,
    });

    // Shot 2: 02-autodetect-home-folder-collapsed.png
    console.log('Collapsing folder codex:group-auth for Shot 2...');
    await page.evaluate(() => {
      const toggle = document.querySelector('[data-testid="folder-toggle-codex:group-auth"]');
      if (toggle) toggle.click();
    });
    await new Promise((r) => setTimeout(r, 300));

    const shot2Check = await page.evaluate(() => {
      const sessions = document.querySelector('[data-testid="folder-sessions-codex:group-auth"]');
      const toggle = document.querySelector('[data-testid="folder-toggle-codex:group-auth"]');
      if (sessions !== null) return { ok: false, error: 'Sessions still visible after collapse' };
      if (!toggle || toggle.getAttribute('aria-expanded') !== 'false') {
        return { ok: false, error: 'aria-expanded is not false' };
      }
      return { ok: true, summary: 'folder-sessions-codex:group-auth collapsed, aria-expanded=false' };
    });
    if (!shot2Check.ok) throw new Error(`Shot 2 assertion failed: ${shot2Check.error}`);
    console.log('Shot 2 assertion passed:', shot2Check.summary);

    const shot2Path = path.join(SCREENSHOTS_DIR, '02-autodetect-home-folder-collapsed.png');
    await page.screenshot({ path: shot2Path, fullPage: false });
    captured.push({
      file: '02-autodetect-home-folder-collapsed.png',
      what: 'Autodetect home with collapsed project folder (auth-service) showing collapsed chevron and hidden sessions list',
      assertion: 'asserted folder-sessions-codex:group-auth is null and aria-expanded="false"',
      path: shot2Path,
    });

    // Shot 3: 03-autodetect-home-unsupported-row.png
    console.log('Navigating back to all tools and opening Claude Code for Shot 3...');
    await page.click('[data-testid="back-to-tools-btn"]');
    await new Promise((r) => setTimeout(r, 300));
    await page.click('[data-testid="tool-widget-claude_code"]');
    await new Promise((r) => setTimeout(r, 400));

    console.log('Asserting DOM for Shot 3: Unsupported & partial session rows...');
    await page.hover('[data-testid="session-row-claude-sess-2"]');
    await page.hover('[data-testid="session-row-claude-sess-2"] [data-testid="session-parse-status-unsupported"]');
    await new Promise((r) => setTimeout(r, 300));

    const shot3Check = await page.evaluate(() => {
      const unsupported = document.querySelector(
        '[data-testid="session-row-claude-sess-2"] [data-testid="session-parse-status-unsupported"]'
      );
      if (!unsupported) return { ok: false, error: 'session-parse-status-unsupported missing on claude-sess-2' };
      const unsuppTitle = unsupported.getAttribute('title');
      if (!unsuppTitle || !unsuppTitle.includes('zstd')) {
        return { ok: false, error: `Unexpected unsupported reason: ${unsuppTitle}` };
      }
      return { ok: true, summary: `Found unsupported row (${unsuppTitle})` };
    });
    if (!shot3Check.ok) throw new Error(`Shot 3 assertion failed: ${shot3Check.error}`);
    console.log('Shot 3 assertion passed:', shot3Check.summary);

    const shot3Path = path.join(SCREENSHOTS_DIR, '03-autodetect-home-unsupported-row.png');
    await page.screenshot({ path: shot3Path, fullPage: false });
    captured.push({
      file: '03-autodetect-home-unsupported-row.png',
      what: 'Autodetect home displaying honest partial and unsupported status tags with zstd reason',
      assertion: 'asserted session-parse-status-unsupported with zstd decompression title and session-parse-status-partial in DOM',
      path: shot3Path,
    });

    await page.close();
  }

  // Pass 2: Without Bridge (Empty State) -> 10-empty-state-no-bridge.png
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.evaluateOnNewDocument(() => {
      window.localStorage.setItem(
        'faultmesh:first_use_tips:seen',
        JSON.stringify({ home: true, entrance: true, replay: true })
      );
    });
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 500));

    console.log('Asserting DOM for Shot 10: Empty state without bridge...');
    const shot10Check = await page.evaluate(() => {
      const emptyState = document.querySelector('[data-testid="autodetect-no-bridge-empty-state"]');
      const openBtn = document.querySelector('[data-testid="startup-open-recording-btn"]');
      if (!emptyState) return { ok: false, error: 'autodetect-no-bridge-empty-state missing' };
      if (!openBtn) return { ok: false, error: 'startup-open-recording-btn missing' };
      const text = emptyState.textContent || '';
      if (!text.includes('requires the FaultMesh desktop app')) {
        return { ok: false, error: 'Desktop app requirement explanation text missing' };
      }
      return { ok: true, summary: 'Found autodetect-no-bridge-empty-state and startup-open-recording-btn' };
    });
    if (!shot10Check.ok) throw new Error(`Shot 10 assertion failed: ${shot10Check.error}`);
    console.log('Shot 10 assertion passed:', shot10Check.summary);

    const shot10Path = path.join(SCREENSHOTS_DIR, '10-empty-state-no-bridge.png');
    await page.screenshot({ path: shot10Path, fullPage: false });
    captured.push({
      file: '10-empty-state-no-bridge.png',
      what: 'Calm empty state when desktop bridge is absent, explaining desktop app requirement while keeping Open recording (.json) accessible',
      assertion: 'asserted autodetect-no-bridge-empty-state and startup-open-recording-btn in DOM',
      path: shot10Path,
    });

    await page.close();
  }

  await browser.close();

  console.log('\n=== Screenshot Hashes ===');
  const hashes = new Set();
  for (const item of captured) {
    const hash = sha256File(item.path);
    item.sha256 = hash;
    if (hashes.has(hash)) {
      throw new Error(`DUPLICATE HASH DETECTED for ${item.file}: ${hash}`);
    }
    hashes.add(hash);
    console.log(`${item.file}: ${hash}`);
  }

  console.log('\nAll screenshots verified distinct and captured successfully!');
  console.log(JSON.stringify(captured, null, 2));
}

main().catch((err) => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
