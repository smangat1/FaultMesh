import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(scriptDir, '..');
const outputRoot = path.resolve(
  process.env.FAULTMESH_CAPTURE_OUTPUT
    || path.join(uiDir, '..', 'docs/screenshots/replay-prompt-centric-fixes'),
);
const distIndex = path.join(uiDir, 'dist/index.html');
const sessionId = 'prompt-fixes-synthetic-session';
const replay = JSON.parse(fs.readFileSync(
  path.join(uiDir, 'src/fixtures/fixture_replay_timeline_hero.json'),
  'utf8',
));
const now = new Date().toISOString();
replay.session.id = sessionId;
replay.records.forEach((record) => { record.session_id = sessionId; });
for (const sequence of [1, 2, 3, 4]) {
  const record = replay.records.find((item) => item.sequence === sequence);
  Object.assign(record, {
    prompt_id: 'prompt-calculator',
    turn_id: 'turn-calculator',
    prompt_text: sequence === 1
      ? 'Make negative calculator inputs fail safely\nKeep existing callers compatible.'
      : null,
  });
}
Object.assign(replay.records.find((item) => item.sequence === 2), {
  tool_name: 'Command',
  tool_input: { command: 'rg "calculate" src tests' },
  tool_response: { aggregatedOutput: 'src/calc.py: calculate' },
});
for (const sequence of [5, 6, 7]) {
  const record = replay.records.find((item) => item.sequence === sequence);
  Object.assign(record, {
    prompt_id: 'prompt-tests',
    turn_id: 'turn-tests',
    prompt_text: sequence === 5 ? 'Run only the parser tests and report the result.' : null,
  });
  const entry = replay.timeline.find((item) => item.sequence === sequence);
  entry.changed_files = [];
  entry.changed_symbols = [];
  entry.test_evidence = [];
}
replay.timeline.find((item) => item.sequence === 6).test_evidence = [{
  schema_version: 'replay-store-1.0',
  id: 'test-parser-pass',
  session_id: sessionId,
  observed_at: now,
  state: 'pass',
  suite_scope: 'tests/unit/test_parser.py',
  source: 'recorded command output',
  command_record_id: replay.records.find((item) => item.sequence === 6).id,
  command_exit_code: 0,
  associated_manifest_id: null,
  association: 'content_identity',
  counts: { passed: 4, failed: 0, errors: 0, skipped: 0 },
  tests: [],
  output_missing: false,
  partial: false,
}];
Object.assign(replay.records.find((item) => item.sequence === 6), {
  tool_name: 'Command',
  tool_input: { command: 'python -m pytest tests/unit/test_parser.py -q' },
  tool_response: { aggregatedOutput: '4 tests passed' },
});

const history = {
  roots: [{ tool: 'codex', status: 'ok', file_count: 1, message: null }],
  sessions: [{
    session_id: sessionId,
    tool: 'codex',
    project_group_key: 'calculator',
    project_display_name: 'calculator',
    project_parent_name: 'workspace',
    started_at: now,
    ended_at: now,
    prompt_count: 3,
    first_prompt_preview: 'Make negative calculator inputs fail safely',
    source_title: 'Calculator safety review',
    history_state: 'active',
    project_visibility: 'normal',
    format_version: '1.0',
    parse_status: 'ok',
    unsupported_reason: null,
    source_file_sha256: 'a'.repeat(64),
    redaction_types: [],
  }],
};
const promptBase = {
  changed_files: ['src/calc.py'],
  changed_file_count: 1,
  started_at: now,
  ended_at: now,
  test_observation: 'not_observed',
  grouping: 'prompt_turn',
};
const promptIndex = {
  schema_version: 'history-prompt-index-1.1',
  session_id: sessionId,
  source_file_sha256: 'a'.repeat(64),
  cached: false,
  prompts: [
    {
      ...promptBase,
      prompt_id: 'prompt-calculator',
      first_line: 'Make negative calculator inputs fail safely',
      start_sequence: 1,
      end_sequence: 2,
    },
    {
      ...promptBase,
      prompt_id: 'prompt-calculator',
      first_line: null,
      start_sequence: 1,
      end_sequence: 4,
    },
    {
      ...promptBase,
      prompt_id: 'prompt-tests',
      first_line: 'Run only the parser tests and report the result.',
      start_sequence: 5,
      end_sequence: 7,
      changed_files: [],
      changed_file_count: 0,
      test_observation: 'passed',
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
      JSON.stringify({ homePromptDismissed: true, dismissedSessionIds: [payload.sessionId] }),
    );
    window.faultmeshSpectate = {
      chooseProjectFolder: async () => null,
      startWatch: async () => ({ watching: true, displayName: 'calculator' }),
      stopWatch: async () => ({ watching: false }),
      onSpectateEvent: () => () => {},
      openRecording: async () => null,
      listHistory: async () => payload.history,
      listPrompts: async () => payload.promptIndex,
      importSession: async () => {
        const text = JSON.stringify(payload.replay);
        return { name: 'synthetic-replay.json', size: text.length, text };
      },
      modelStatus: async () => ({
        ready: false,
        status: 'missing',
        message: 'No local model is configured.',
        preset: 'synthetic',
        modelFilename: null,
      }),
      onNarrationEvent: () => () => {},
    };
  }, { history, promptIndex, replay, sessionId });
  await page.goto(`file://${distIndex}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="tool-widget-codex"]');
  await page.click('[data-testid="tool-widget-codex"]');
  await page.waitForSelector(`[data-testid="session-row-${sessionId}"]`);
  await page.click(`[data-testid="session-row-${sessionId}"]`);
  await page.waitForSelector(`[data-testid="prompt-row-${sessionId}-1"]`);
  return page;
}

async function openReplay(page) {
  await page.click(`[data-testid="prompt-row-${sessionId}-0"]`);
  await page.waitForSelector('[data-testid="replay-workspace"]');
  const setup = await page.$('[data-testid="replay-model-setup"]');
  if (setup) {
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((candidate) => candidate.textContent?.includes('Keep plain mode'));
      button?.click();
    });
  }
  await page.waitForSelector('[data-testid="replay-prompt-rail"]');
  await page.click('[data-testid="replay-next-btn"]');
  await delay(120);
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
    const home = await makePage(browser, viewport);
    await capture(home, directory, '01-deduplicated-prompt-list.png');
    await openReplay(home);
    await capture(home, directory, '02-selected-prompt-action-timeline.png');
    await home.click('[data-testid="replay-prompt-nav-1"]');
    await home.waitForSelector('[data-testid="replay-prompt-no-files"]');
    await capture(home, directory, '03-no-code-to-review.png');
    await home.close();
  }
  console.log(JSON.stringify({ outputRoot }));
} finally {
  await browser.close();
}
