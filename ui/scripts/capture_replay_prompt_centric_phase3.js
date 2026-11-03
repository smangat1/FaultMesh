import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(scriptDir, '..');
const outputRoot = path.resolve(
  process.env.FAULTMESH_CAPTURE_OUTPUT
    || path.join(uiDir, '..', 'docs/screenshots/replay-prompt-centric-phase3'),
);
const distIndex = path.join(uiDir, 'dist/index.html');
const fixture = JSON.parse(fs.readFileSync(
  path.join(uiDir, 'src/fixtures/fixture_replay_timeline_hero.json'),
  'utf8',
));

const recordTwo = fixture.records.find((record) => record.sequence === 2);
const recordThree = fixture.records.find((record) => record.sequence === 3);
Object.assign(recordTwo, {
  prompt_id: 'prompt-calculate',
  prompt_text: 'Improve the calculation guard [redacted: API key]\nKeep existing callers compatible.',
});
Object.assign(recordThree, { prompt_id: 'prompt-calculate' });
fixture.chapters = structuredClone(fixture.baseline_chapters);
fixture.narration = [];
fixture.summary = {
  sentences: [
    'This session contains recorded work.',
    'Recorded changes remain visible below.',
    'Unknown details remain unknown.',
  ],
  source: 'deterministic_facts',
  fallback_used: true,
};
fixture.prompt_understanding = null;
const baseline = structuredClone(fixture);
const interpreted = structuredClone(fixture);
interpreted.prompt_understanding = {
  summary: {
    sentences: [
      'The recorded prompts focused on a calculation guard.',
      'The session preserved recorded file and test evidence.',
      'Unrecorded intent remains unknown.',
    ],
    source: 'model',
    fallback_used: false,
  },
  prompts: [{
    prompt_id: 'prompt-calculate',
    start_sequence: 2,
    end_sequence: 3,
    text: 'The recorded request focused on strengthening the calculation guard while retaining compatibility.',
    label: 'model interpretation',
  }],
  total_prompts: 2,
  included_prompts: 2,
  truncated: false,
};
interpreted.summary = interpreted.prompt_understanding.summary;

const now = new Date().toISOString();
const history = {
  roots: [{ tool: 'codex', status: 'ok', file_count: 1, message: null }],
  sessions: [{
    session_id: 'synthetic-phase3-session',
    tool: 'codex',
    project_group_key: 'faultmesh-demo',
    project_display_name: 'FaultMesh demo',
    project_parent_name: 'workspace',
    started_at: now,
    ended_at: now,
    prompt_count: 2,
    first_prompt_preview: 'Improve the calculation guard [redacted: API key]',
    source_title: 'Calculation guard review',
    history_state: 'active',
    project_visibility: 'normal',
    format_version: '1.0',
    parse_status: 'ok',
    unsupported_reason: null,
    source_file_sha256: 'a'.repeat(64),
    redaction_types: ['API key'],
  }],
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function makePage(browser, viewport, mode) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((payload) => {
    localStorage.setItem(
      'faultmesh:first_use_tips:seen',
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true }),
    );
    localStorage.setItem(
      'faultmesh:replay:project_links:v1',
      JSON.stringify({ homePromptDismissed: true, dismissedSessionIds: ['synthetic-phase3-session'] }),
    );
    let narrationListener = null;
    window.faultmeshSpectate = {
      chooseProjectFolder: async () => ({ handle: 'synthetic', displayName: 'FaultMesh demo' }),
      startWatch: async () => ({ watching: true, displayName: 'FaultMesh demo' }),
      stopWatch: async () => ({ watching: false }),
      onSpectateEvent: () => () => {},
      listHistory: async () => payload.history,
      listPrompts: async () => ({
        schema_version: 'history-prompt-index-1.1',
        session_id: 'synthetic-phase3-session',
        source_file_sha256: 'a'.repeat(64),
        cached: false,
        prompts: [{
          prompt_id: 'prompt-calculate',
          first_line: 'Improve the calculation guard [redacted: API key]',
          start_sequence: 2,
          end_sequence: 3,
          changed_files: ['src/calc.py'],
          changed_file_count: 1,
          started_at: payload.history.sessions[0].started_at,
          ended_at: payload.history.sessions[0].ended_at,
          test_observation: 'passed',
          grouping: 'prompt_turn',
        }],
      }),
      importSession: async () => ({
        name: 'synthetic-replay.json',
        size: payload.fixtureText.length,
        text: payload.fixtureText,
      }),
      modelStatus: async () => ({
        ready: payload.mode !== 'not-ready',
        status: payload.mode === 'not-ready' ? 'missing' : 'ready',
        message: payload.mode === 'not-ready' ? 'No local model is configured.' : 'Ready.',
        preset: 'synthetic',
        modelFilename: payload.mode === 'not-ready' ? null : 'synthetic.gguf',
      }),
      startNarration: async () => {
        setTimeout(() => narrationListener?.({
          scope: 'narration', event: 'baseline', export: payload.baseline,
        }), 20);
        if (payload.mode === 'model') {
          setTimeout(() => narrationListener?.({
            scope: 'narration',
            event: 'prompt',
            done: 1,
            total: 2,
            prompt: payload.interpreted.prompt_understanding.prompts[0],
            prompt_understanding: payload.interpreted.prompt_understanding,
          }), 80);
          setTimeout(() => narrationListener?.({
            scope: 'narration', event: 'done', export: payload.interpreted,
          }), 140);
        } else if (payload.mode === 'progress') {
          setTimeout(() => narrationListener?.({
            scope: 'narration',
            event: 'prompt',
            done: 1,
            total: 2,
            prompt: payload.interpreted.prompt_understanding.prompts[0],
            prompt_understanding: payload.interpreted.prompt_understanding,
          }), 80);
        }
        return { started: true };
      },
      cancelNarration: async () => ({ cancelled: true }),
      onNarrationEvent: (callback) => {
        narrationListener = callback;
        return () => { narrationListener = null; };
      },
    };
  }, {
    mode,
    history,
    fixtureText: JSON.stringify(fixture),
    baseline,
    interpreted,
  });
  await page.goto(`file://${distIndex}`, { waitUntil: 'networkidle0' });
  return page;
}

async function openReplay(page) {
  await page.waitForSelector('[data-testid="tool-widget-codex"]');
  await page.click('[data-testid="tool-widget-codex"]');
  await page.waitForSelector('[data-testid="session-row-synthetic-phase3-session"]');
  const promptTree = await page.$eval(
    '[data-testid="session-row-synthetic-phase3-session"]',
    (element) => element.hasAttribute('aria-expanded'),
  );
  await page.click('[data-testid="session-row-synthetic-phase3-session"]');
  if (promptTree) {
    await page.waitForSelector('[data-testid="prompt-row-synthetic-phase3-session-0"]');
    await page.click('[data-testid="prompt-row-synthetic-phase3-session-0"]');
  }
  await page.waitForSelector('[data-testid="replay-workspace"]');
}

async function capture(page, directory, name, selector) {
  await page.waitForSelector(selector);
  await delay(180);
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name), fullPage: false });
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
});

const viewports = [
  { width: 1440, height: 900, label: '1440x900' },
  { width: 1024, height: 768, label: '1024x768' },
];

try {
  for (const viewport of viewports) {
    const directory = path.join(outputRoot, viewport.label);
    for (const scenario of [
      ['deterministic', '01-deterministic-prompt-card.png', '[data-testid="replay-prompt-card"]'],
      ['model', '02-model-interpretation-lines.png', '[data-testid="replay-prompt-interpretation"]'],
      ['progress', '03-summary-progress-stop.png', '[data-testid="replay-narration-progress"]'],
      ['not-ready', '04-model-not-ready.png', '[data-testid="replay-model-setup"]'],
    ]) {
      const [mode, name, selector] = scenario;
      const page = await makePage(browser, viewport, mode);
      await openReplay(page);
      await capture(page, directory, name, selector);
      await page.close();
    }
  }
  console.log(JSON.stringify({ outputRoot, viewports: viewports.map(({ label }) => label) }));
} finally {
  await browser.close();
}
