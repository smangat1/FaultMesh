import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(scriptDir, '..');
const outputRoot = path.resolve(
  process.env.FAULTMESH_CAPTURE_OUTPUT
    || path.join(uiDir, '..', 'docs/screenshots/replay-prompt-centric-phase6/after'),
);
const distIndex = path.join(uiDir, 'dist/index.html');
const captureUrl = process.env.FAULTMESH_CAPTURE_URL || `file://${distIndex}`;
const fixture = JSON.parse(fs.readFileSync(
  path.join(uiDir, 'src/fixtures/fixture_replay_timeline_hero.json'),
  'utf8',
));
const sessionId = 'phase6-synthetic-session';
fixture.session.id = sessionId;
fixture.records.forEach((record) => { record.session_id = sessionId; });
const promptRecord = fixture.records.find((record) => record.sequence === 2);
const changeRecord = fixture.records.find((record) => record.sequence === 3);
Object.assign(promptRecord, {
  prompt_id: 'prompt-calculator-safety',
  prompt_text: 'Make negative calculator inputs fail safely\nKeep the public API stable.',
});
Object.assign(changeRecord, { prompt_id: 'prompt-calculator-safety' });
const fixtureText = JSON.stringify(fixture);

const history = {
  roots: [{ tool: 'codex', status: 'ok', file_count: 1, message: null }],
  sessions: [{
    session_id: sessionId,
    tool: 'codex',
    project_group_key: 'calculator',
    project_display_name: 'calculator',
    started_at: '2026-11-01T15:00:00Z',
    ended_at: '2026-11-01T15:08:00Z',
    prompt_count: 1,
    first_prompt_preview: 'Make negative calculator inputs fail safely',
    source_title: 'Calculator input safety',
    format_version: '1.0',
    parse_status: 'ok',
    source_file_sha256: 'a'.repeat(64),
    redaction_types: [],
  }],
};

const searchResult = {
  schema_version: 'history-search-1.0',
  query: 'calculator',
  match_count: 1,
  indexed_session_count: 1,
  sessions: [{
    session_id: sessionId,
    tool: 'codex',
    source: 'history',
    title: 'Calculator input safety',
    project_display_name: 'calculator',
    started_at: '2026-11-01T15:00:00Z',
    ended_at: '2026-11-01T15:08:00Z',
    prompts: [{
      prompt_id: 'prompt-calculator-safety',
      first_line: 'Make negative calculator inputs fail safely',
      start_sequence: 2,
      end_sequence: 3,
      changed_files: ['calc.py'],
      changed_file_count: 1,
      started_at: '2026-11-01T15:01:00Z',
      ended_at: '2026-11-01T15:03:00Z',
      matched_in: ['session_title', 'prompt_text', 'changed_file'],
    }],
  }],
};

const revertPlan = {
  schema_version: 'replay-revert-plan-1.0',
  session_id: sessionId,
  start_sequence: 2,
  end_sequence: 3,
  actions: [
    {
      sequence: 3,
      path: 'calc.py',
      action: 'apply_reverse_diff',
      instruction: 'Review and apply the included reverse diff.',
      provenance: 'recorded_patch',
      provenance_label: 'recorded patch',
      reverse_diff: '--- b/calc.py\n+++ a/calc.py\n@@ -1,5 +1,3 @@\n-    if x < 0:\n-        raise ValueError(\'x must be positive\')\n',
      restore_text: null,
    },
    {
      sequence: 3,
      path: 'tests/test_calc.py',
      action: 'restore_file',
      instruction: 'Restore the file using the included before-text.',
      provenance: 'reconstructed_from_current_checkout_unverified',
      provenance_label: 'reconstructed from current checkout (unverified)',
      reverse_diff: null,
      restore_text: 'def test_negative_input():\n    ...\n',
    },
    {
      sequence: 2,
      path: 'unknown.py',
      action: 'manual_review',
      instruction: 'Leave the file unchanged until a trusted earlier version is available.',
      provenance: 'unknown',
      provenance_label: 'unknown file state',
      reverse_diff: null,
      restore_text: null,
    },
  ],
  truncated: false,
  text: [
    'Read-only revert plan for recorded steps 2-3',
    'Derived from recorded evidence. This plan does not write files or run commands.',
    'Apply actions in the listed order; later recorded changes are reversed first.',
    '',
    '1. calc.py',
    '   Action: apply reverse diff',
    '   Provenance: recorded patch',
    '',
    '2. tests/test_calc.py',
    '   Action: restore file',
    '   Provenance: reconstructed from current checkout (unverified)',
    '',
    '3. unknown.py',
    '   Action: manual review',
    '   Provenance: unknown file state',
  ].join('\n'),
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
        dismissedSessionIds: [payload.sessionId],
        links: {
          [payload.sessionId]: { handle: 'opaque-project-handle', displayName: 'calculator' },
        },
      }),
    );
    window.faultmeshSpectate = {
      chooseProjectFolder: async () => null,
      startWatch: async () => ({ watching: true, displayName: 'calculator' }),
      stopWatch: async () => ({ watching: false }),
      onSpectateEvent: () => () => {},
      listHistory: async () => payload.history,
      searchHistory: async () => payload.searchResult,
      importSession: async () => ({
        name: 'synthetic-session.json',
        size: payload.fixtureText.length,
        text: payload.fixtureText,
      }),
      openSessionFile: async () => ({ opened: true, method: 'code' }),
      revertPlan: async () => payload.revertPlan,
      modelStatus: async () => ({
        ready: false,
        status: 'missing',
        message: 'No local model is configured.',
        preset: 'medium-3b',
        modelFilename: null,
      }),
      onNarrationEvent: () => () => {},
    };
  }, { history, searchResult, fixtureText, revertPlan, sessionId });
  await page.goto(captureUrl, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="history-search-input"]');
  await page.type('[data-testid="history-search-input"]', 'calculator');
  await page.waitForSelector(`[data-testid="history-search-prompt-${sessionId}-2"]`);
  await page.click(`[data-testid="history-search-prompt-${sessionId}-2"]`);
  await page.waitForSelector('[data-testid="replay-workspace"]');
  const modelSetup = await page.$('[data-testid="replay-model-setup"]');
  if (modelSetup) {
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((candidate) => candidate.textContent?.includes('Keep plain mode'));
      button?.click();
    });
  }
  await page.waitForSelector('[data-testid="replay-prompt-actions"]');
  await delay(180);
  return page;
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
    const page = await makePage(browser, viewport);
    await capture(page, directory, '01-prompt-actions.png');
    await page.click('[data-testid="replay-generate-revert-plan"]');
    await page.waitForSelector('[data-testid="replay-revert-plan-text"]');
    await capture(page, directory, '02-revert-plan.png');
    await page.close();
  }
  console.log(JSON.stringify({ outputRoot }));
} finally {
  await browser.close();
}
