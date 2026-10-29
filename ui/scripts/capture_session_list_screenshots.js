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
      started_at: '2026-10-29T10:00:00Z',
      ended_at: '2026-10-29T10:15:00Z',
      prompt_count: 3,
      first_prompt_preview: 'Fix token expiration bug [redacted: jwt secret] in auth handler',
      format_version: '1.0',
      parse_status: 'ok',
      unsupported_reason: null,
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

  // Pass 1: With Synthetic Bridge (Tool widgets, collapsed folder, unsupported row)
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

    await page.evaluateOnNewDocument((payload) => {
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
    console.log('Asserting DOM for Shot 3: Unsupported & partial session rows...');
    // Focus the unsupported session row in Claude Code widget
    await page.evaluate(() => {
      const unsuppRow = document.querySelector('[data-testid="session-row-claude-sess-2"]');
      if (unsuppRow) {
        unsuppRow.focus();
      }
    });
    // Move mouse over the unsupported status badge
    await page.hover('[data-testid="session-parse-status-unsupported"]');
    await new Promise((r) => setTimeout(r, 300));

    const shot3Check = await page.evaluate(() => {
      const unsupported = document.querySelector('[data-testid="session-parse-status-unsupported"]');
      const partial = document.querySelector('[data-testid="session-parse-status-partial"]');
      if (!unsupported) return { ok: false, error: 'session-parse-status-unsupported missing' };
      if (!partial) return { ok: false, error: 'session-parse-status-partial missing' };
      const unsuppTitle = unsupported.getAttribute('title');
      if (!unsuppTitle || !unsuppTitle.includes('zstd')) {
        return { ok: false, error: `Unexpected unsupported reason: ${unsuppTitle}` };
      }
      return { ok: true, summary: `Found unsupported row (${unsuppTitle}) and partial row` };
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
