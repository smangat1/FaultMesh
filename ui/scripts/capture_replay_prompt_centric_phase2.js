import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const currentUiDir = path.resolve(scriptDir, '..');
const uiDir = path.resolve(process.env.FAULTMESH_CAPTURE_UI_DIR || currentUiDir);
const outputRoot = path.resolve(
  process.env.FAULTMESH_CAPTURE_OUTPUT
    || path.join(currentUiDir, '..', 'docs/screenshots/replay-prompt-centric-phase2/after')
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
  tool_name: 'Command',
  tool_response: { aggregatedOutput: 'Inspected the existing guard.' },
});
Object.assign(recordThree, { prompt_id: 'prompt-calculate' });
const entryTwo = fixture.timeline.find((entry) => entry.sequence === 2);
const entryThree = fixture.timeline.find((entry) => entry.sequence === 3);
entryTwo.changed_files = structuredClone(entryThree.changed_files);
entryTwo.changed_symbols = structuredClone(entryThree.changed_symbols);
const fixtureText = JSON.stringify(fixture);

const now = new Date().toISOString();
const history = {
  roots: [{ tool: 'codex', status: 'ok', file_count: 2, message: null }],
  sessions: [{
    session_id: 'synthetic-ui-session',
    tool: 'codex',
    project_group_key: 'faultmesh-demo',
    project_display_name: 'FaultMesh demo',
    project_parent_name: 'workspace',
    started_at: now,
    ended_at: now,
    prompt_count: 2,
    first_prompt_preview: 'Improve the calculation guard [redacted: API key]',
    source_title: 'Calculation guard investigation',
    history_state: 'active',
    project_visibility: 'normal',
    format_version: '1.0',
    parse_status: 'ok',
    unsupported_reason: null,
    source_file_sha256: 'a'.repeat(64),
    redaction_types: ['API key'],
  }],
};

const promptIndex = {
  schema_version: 'history-prompt-index-1.0',
  session_id: 'synthetic-ui-session',
  source_file_sha256: 'a'.repeat(64),
  cached: false,
  prompts: [{
    prompt_id: 'prompt-calculate',
    first_line: 'Improve the calculation guard [redacted: API key]',
    start_sequence: 2,
    end_sequence: 3,
    changed_files: ['src/calc.py'],
    changed_file_count: 1,
    started_at: now,
    ended_at: now,
    test_observation: 'passed',
    grouping: 'prompt_turn',
  }],
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      JSON.stringify({ homePromptDismissed: true, dismissedSessionIds: ['synthetic-ui-session'] }),
    );
    window.faultmeshSpectate = {
      chooseProjectFolder: async () => ({ handle: 'synthetic', displayName: 'FaultMesh demo' }),
      startWatch: async () => ({ watching: true, displayName: 'FaultMesh demo' }),
      stopWatch: async () => ({ watching: false }),
      onSpectateEvent: () => () => {},
      openRecording: async () => null,
      listHistory: async () => payload.history,
      listPrompts: async () => payload.promptIndex,
      importSession: async () => ({
        name: 'synthetic-replay.json',
        size: payload.fixtureText.length,
        text: payload.fixtureText,
      }),
      modelStatus: async () => ({
        ready: false,
        status: 'missing',
        message: 'No local model is configured.',
        preset: 'synthetic',
        modelFilename: null,
      }),
      onNarrationEvent: () => () => {},
    };
  }, { history, promptIndex, fixtureText });
  await page.goto(`file://${distIndex}`, { waitUntil: 'networkidle0' });
  return page;
}

async function openReplay(page) {
  await page.waitForSelector('[data-testid="tool-widget-codex"]');
  await page.click('[data-testid="tool-widget-codex"]');
  await page.waitForSelector('[data-testid="session-row-synthetic-ui-session"]');
  const promptTree = await page.$eval(
    '[data-testid="session-row-synthetic-ui-session"]',
    (element) => element.hasAttribute('aria-expanded'),
  );
  if (promptTree) {
    await page.click('[data-testid="session-row-synthetic-ui-session"]');
    await page.waitForSelector('[data-testid="prompt-row-synthetic-ui-session-0"]');
    await page.click('[data-testid="prompt-row-synthetic-ui-session-0"]');
  } else {
    await page.click('[data-testid="session-row-synthetic-ui-session"]');
  }
  await page.waitForSelector('[data-testid="replay-workspace"]');
  const setup = await page.$('[data-testid="replay-model-setup"]');
  if (setup) {
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((candidate) => candidate.textContent?.includes('Keep plain mode'));
      button?.click();
    });
  }
  await delay(120);
}

async function capture(page, directory, name, waitMs = 100) {
  fs.mkdirSync(directory, { recursive: true });
  await delay(waitMs);
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

    const toolbarPage = await makePage(browser, viewport);
    await openReplay(toolbarPage);
    await capture(toolbarPage, directory, '01-playback-toolbar.png');
    await toolbarPage.close();

    const transitionPage = await makePage(browser, viewport);
    await openReplay(transitionPage);
    await transitionPage.click('[data-testid="replay-next-btn"]');
    await capture(transitionPage, directory, '02-mid-transition.png', 70);
    await transitionPage.close();

    const playingPage = await makePage(browser, viewport);
    await openReplay(playingPage);
    const hasPlayback = Boolean(await playingPage.$('[data-testid="replay-play-toggle"]'));
    if (hasPlayback) {
      await playingPage.click('[data-testid="replay-speed-2"]');
      await playingPage.click('[data-testid="replay-play-toggle"]');
      await capture(playingPage, directory, '03-playing-progress.png', 1300);
    } else {
      await playingPage.click('[data-testid="replay-next-btn"]');
      await capture(playingPage, directory, '03-playing-progress.png');
    }
    await playingPage.close();
  }
  console.log(JSON.stringify({ outputRoot, viewports: viewports.map(({ label }) => label) }));
} finally {
  await browser.close();
}
