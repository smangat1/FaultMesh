import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(scriptDir, '..');
const outputRoot = path.resolve(
  process.env.FAULTMESH_CAPTURE_OUTPUT
    || path.join(uiDir, '..', 'docs/screenshots/replay-prompt-centric-phase5/after'),
);
const distIndex = path.join(uiDir, 'dist/index.html');
const fixture = JSON.parse(fs.readFileSync(
  path.join(uiDir, 'src/fixtures/fixture_replay_timeline_hero.json'),
  'utf8',
));
const recordTwo = fixture.records.find((record) => record.sequence === 2);
const recordThree = fixture.records.find((record) => record.sequence === 3);
Object.assign(recordTwo, {
  prompt_id: 'prompt-auth-review',
  prompt_text: 'Review authentication middleware and token expiry handling\nKeep the public API stable.',
});
Object.assign(recordThree, { prompt_id: 'prompt-auth-review' });
const fixtureText = JSON.stringify(fixture);

const history = {
  roots: [{ tool: 'codex', status: 'ok', file_count: 18, message: null }],
  sessions: [
    {
      session_id: 'search-auth-new',
      tool: 'codex',
      project_group_key: 'auth-service',
      project_display_name: 'auth-service',
      started_at: '2026-11-01T15:00:00Z',
      ended_at: '2026-11-01T15:18:00Z',
      prompt_count: 3,
      first_prompt_preview: 'Review authentication middleware and token expiry handling',
      source_title: 'Authentication hardening',
      format_version: '1.0',
      parse_status: 'ok',
      source_file_sha256: 'a'.repeat(64),
      redaction_types: [],
    },
    {
      session_id: 'search-auth-old',
      tool: 'codex',
      project_group_key: 'dashboard',
      project_display_name: 'dashboard',
      started_at: '2026-10-30T12:00:00Z',
      ended_at: '2026-10-30T12:12:00Z',
      prompt_count: 2,
      first_prompt_preview: 'Add auth state to the account settings page',
      source_title: 'Account settings authentication',
      format_version: '1.0',
      parse_status: 'ok',
      source_file_sha256: 'b'.repeat(64),
      redaction_types: [],
    },
  ],
};

const groupedSearch = {
  schema_version: 'history-search-1.0',
  query: 'auth',
  match_count: 3,
  indexed_session_count: 12,
  sessions: [
    {
      session_id: 'search-auth-new',
      tool: 'codex',
      source: 'history',
      title: 'Authentication hardening',
      project_display_name: 'auth-service',
      started_at: '2026-11-01T15:00:00Z',
      ended_at: '2026-11-01T15:18:00Z',
      prompts: [
        {
          prompt_id: 'prompt-auth-review',
          first_line: 'Review authentication middleware and token expiry handling',
          start_sequence: 2,
          end_sequence: 3,
          changed_files: ['src/auth/middleware.ts', 'tests/auth/middleware.test.ts'],
          changed_file_count: 2,
          started_at: '2026-11-01T15:08:00Z',
          ended_at: '2026-11-01T15:18:00Z',
          matched_in: ['session_title', 'prompt_text', 'changed_file'],
        },
        {
          prompt_id: 'prompt-token-storage',
          first_line: 'Remove the legacy auth token fallback [redacted: token]',
          start_sequence: 2,
          end_sequence: 4,
          changed_files: ['src/auth/token-store.ts'],
          changed_file_count: 1,
          started_at: '2026-11-01T15:00:00Z',
          ended_at: '2026-11-01T15:07:00Z',
          matched_in: ['prompt_text', 'changed_file'],
        },
      ],
    },
    {
      session_id: 'search-auth-old',
      tool: 'codex',
      source: 'history',
      title: 'Account settings authentication',
      project_display_name: 'dashboard',
      started_at: '2026-10-30T12:00:00Z',
      ended_at: '2026-10-30T12:12:00Z',
      prompts: [{
        prompt_id: 'prompt-account-auth',
        first_line: 'Add auth state to the account settings page',
        start_sequence: 2,
        end_sequence: 4,
        changed_files: ['ui/account/AuthSettings.tsx'],
        changed_file_count: 1,
        started_at: '2026-10-30T12:00:00Z',
        ended_at: '2026-10-30T12:12:00Z',
        matched_in: ['session_title', 'prompt_text', 'changed_file'],
      }],
    },
  ],
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function makePage(browser, viewport) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((payload) => {
    localStorage.setItem(
      'faultmesh:first_use_tips:seen',
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true }),
    );
    localStorage.setItem(
      'faultmesh:replay:project_links:v1',
      JSON.stringify({
        homePromptDismissed: true,
        dismissedSessionIds: ['search-auth-new', 'search-auth-old'],
      }),
    );
    window.faultmeshSpectate = {
      chooseProjectFolder: async () => null,
      startWatch: async () => ({ watching: true, displayName: 'project' }),
      stopWatch: async () => ({ watching: false }),
      onSpectateEvent: () => () => {},
      listHistory: async () => payload.history,
      searchHistory: async (query) => (
        query.toLowerCase().includes('auth')
          ? payload.groupedSearch
          : {
            schema_version: 'history-search-1.0',
            query,
            match_count: 0,
            indexed_session_count: 12,
            sessions: [],
          }
      ),
      importSession: async () => ({
        name: 'search-session.json',
        size: payload.fixtureText.length,
        text: payload.fixtureText,
      }),
      modelStatus: async () => ({
        ready: false,
        status: 'missing',
        message: 'No local model is configured.',
        preset: 'medium-3b',
        modelFilename: null,
      }),
      onNarrationEvent: () => () => {},
    };
  }, { history, groupedSearch, fixtureText });
  await page.goto(`file://${distIndex}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="history-search-input"]');
  return page;
}

async function search(page, query) {
  await page.click('[data-testid="history-search-input"]');
  await page.type('[data-testid="history-search-input"]', query);
  await page.waitForSelector('[data-testid="history-search-results"]');
  await delay(260);
}

async function capture(page, directory, name) {
  fs.mkdirSync(directory, { recursive: true });
  await delay(100);
  await page.screenshot({ path: path.join(directory, name), fullPage: false });
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
});

try {
  for (const viewport of [
    { width: 1440, height: 900, label: '1440x900' },
    { width: 1024, height: 768, label: '1024x768' },
  ]) {
    const directory = path.join(outputRoot, viewport.label);

    const grouped = await makePage(browser, viewport);
    await search(grouped, 'auth');
    await grouped.waitForSelector('[data-testid="history-search-session-search-auth-new"]');
    await capture(grouped, directory, '01-grouped-search-results.png');
    await grouped.close();

    const empty = await makePage(browser, viewport);
    await search(empty, 'websocket migration');
    await empty.waitForSelector('[data-testid="history-search-empty"]');
    await capture(empty, directory, '02-empty-search-results.png');
    await empty.close();

    const landing = await makePage(browser, viewport);
    await search(landing, 'auth');
    await landing.click('[data-testid="history-search-prompt-search-auth-new-2"]');
    await landing.waitForSelector('[data-testid="replay-workspace"]');
    const modelSetup = await landing.$('[data-testid="replay-model-setup"]');
    if (modelSetup) {
      await landing.evaluate(() => {
        const button = Array.from(document.querySelectorAll('button'))
          .find((candidate) => candidate.textContent?.includes('Keep plain mode'));
        button?.click();
      });
    }
    await landing.waitForFunction(() => (
      document.querySelector('[data-testid="replay-current-seq-badge"]')?.textContent
        ?.includes('Prompt 2 of')
    ));
    await capture(landing, directory, '03-jump-to-prompt-landing.png');
    await landing.close();
  }
  console.log(JSON.stringify({ outputRoot }));
} finally {
  await browser.close();
}
