import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const currentUiDir = path.resolve(scriptDir, '..');
const uiDir = path.resolve(process.env.FAULTMESH_CAPTURE_UI_DIR || currentUiDir);
const outputDir = path.resolve(
  process.env.FAULTMESH_CAPTURE_OUTPUT
    || path.join(currentUiDir, '..', 'docs/screenshots/replay-ui-simplify/after')
);
const distIndex = path.join(uiDir, 'dist/index.html');
const fixturePath = path.join(uiDir, 'src/fixtures/fixture_replay_timeline_hero.json');
const fixtureText = fs.readFileSync(fixturePath, 'utf8');

fs.mkdirSync(outputDir, { recursive: true });

const history = {
  roots: [{ tool: 'codex', status: 'ok', file_count: 2, message: null }],
  sessions: [{
    session_id: 'synthetic-ui-session',
    tool: 'codex',
    project_group_key: 'faultmesh-demo',
    project_display_name: 'FaultMesh demo',
    project_parent_name: 'workspace',
    started_at: '2026-10-30T12:00:00Z',
    ended_at: '2026-10-30T12:08:00Z',
    prompt_count: 3,
    first_prompt_preview: 'Improve the calculation guard [redacted: API key]',
    source_title: 'Calculation guard investigation',
    history_state: 'active',
    project_visibility: 'normal',
    format_version: '1.0',
    parse_status: 'partial',
    unsupported_reason: null,
    redaction_types: ['API key'],
  }],
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function makePage(browser, { modelReady = true, importDelay = 0 } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((payload) => {
    localStorage.setItem(
      'faultmesh:first_use_tips:seen',
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true })
    );
    localStorage.setItem(
      'faultmesh:replay:project_links:v1',
      JSON.stringify({ homePromptDismissed: true, dismissedSessionIds: ['synthetic-ui-session'] })
    );
    let narrationListener = null;
    window.faultmeshSpectate = {
      chooseProjectFolder: async () => ({ handle: 'synthetic', displayName: 'FaultMesh demo' }),
      startWatch: async () => ({ watching: true, displayName: 'FaultMesh demo' }),
      stopWatch: async () => ({ watching: false }),
      onSpectateEvent: () => () => {},
      openRecording: async () => null,
      listHistory: async () => payload.history,
      importSession: async () => {
        if (payload.importDelay) await new Promise((resolve) => setTimeout(resolve, payload.importDelay));
        return { name: 'synthetic-replay.json', size: payload.fixtureText.length, text: payload.fixtureText };
      },
      modelStatus: async () => ({
        ready: payload.modelReady,
        status: payload.modelReady ? 'ready' : 'missing',
        message: payload.modelReady ? 'Local narration is ready.' : 'No local model is configured.',
        preset: 'synthetic',
        modelFilename: payload.modelReady ? 'synthetic.gguf' : null,
      }),
      startNarration: async () => {
        setTimeout(() => {
          narrationListener?.({ scope: 'narration', event: 'done', export: JSON.parse(payload.fixtureText) });
        }, 50);
        return { started: true };
      },
      cancelNarration: async () => ({ cancelled: true }),
      onNarrationEvent: (callback) => {
        narrationListener = callback;
        return () => { narrationListener = null; };
      },
    };
  }, { history, fixtureText, modelReady, importDelay });
  await page.goto(`file://${distIndex}`, { waitUntil: 'networkidle0' });
  return page;
}

async function openSessionList(page) {
  await page.waitForSelector('[data-testid="tool-widget-codex"]');
  await page.click('[data-testid="tool-widget-codex"]');
  await page.waitForSelector('[data-testid="session-row-synthetic-ui-session"]');
}

async function importSession(page) {
  await openSessionList(page);
  await page.click('[data-testid="session-row-synthetic-ui-session"]');
  await page.waitForSelector('[data-testid="replay-workspace"]');
  await delay(150);
}

async function capture(page, name) {
  const target = path.join(outputDir, name);
  await delay(120);
  await page.screenshot({ path: target, fullPage: false });
  return target;
}

async function advance(page, count) {
  for (let index = 0; index < count; index += 1) {
    await page.click('[data-testid="replay-next-btn"]');
    await delay(80);
  }
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
});

const captured = [];
try {
  const listPage = await makePage(browser);
  await openSessionList(listPage);
  captured.push(await capture(listPage, '01-session-list.png'));
  await listPage.close();

  const loadingPage = await makePage(browser, { importDelay: 5000 });
  await openSessionList(loadingPage);
  await loadingPage.click('[data-testid="session-row-synthetic-ui-session"]');
  await loadingPage.waitForFunction(() => document.body.textContent?.includes('Importing'));
  captured.push(await capture(loadingPage, '09-loading-import.png'));
  await loadingPage.close();

  const page = await makePage(browser);
  await importSession(page);
  captured.push(await capture(page, '02-replay-default.png'));

  await page.click('[data-testid="replay-toggle-chapters"]');
  await page.waitForSelector('[data-testid="replay-chapters-rail-container"]');
  captured.push(await capture(page, '03-chapters-open.png'));
  await page.click('[data-testid="replay-chapters-close-btn"]');

  await page.click('[data-testid="replay-toggle-evidence"]');
  captured.push(await capture(page, '04-evidence-open.png'));
  await page.click('[data-testid="replay-evidence-close-btn"]');

  await page.click('[data-testid="replay-toggle-minimap"]');
  await page.waitForSelector('[data-testid="replay-minimap-dock"]');
  captured.push(await capture(page, '05-project-map-open.png'));
  await page.click('[data-testid="replay-minimap-close"]');

  await advance(page, 2);
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="replay-file-explorer"]')
    || document.querySelector('[data-testid="replay-diff-pane"]')
  ));
  captured.push(await capture(page, '06-file-explorer-mid-step.png'));

  await page.click('[data-testid="replay-toggle-evidence"]');
  await page.waitForSelector('[data-testid="replay-likely-reason-label"]');
  captured.push(await capture(page, '07-model-provenance.png'));
  await page.click('[data-testid="replay-evidence-close-btn"]');

  await advance(page, 1);
  await page.waitForSelector('[data-testid="replay-empty-diff"]');
  captured.push(await capture(page, '08-empty-state.png'));
  await page.close();

  const noModelPage = await makePage(browser, { modelReady: false });
  await importSession(noModelPage);
  await noModelPage.waitForSelector('[data-testid="replay-model-setup"]');
  const clickedPlainMode = await noModelPage.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('Keep plain mode'));
    button?.click();
    return Boolean(button);
  });
  if (!clickedPlainMode) throw new Error('Keep plain mode button was not found');
  await advance(noModelPage, 2);
  await noModelPage.waitForSelector('[data-testid="replay-step-deterministic-note"]');
  captured.push(await capture(noModelPage, '10-model-not-ready-note.png'));
  await noModelPage.close();

  console.log(JSON.stringify({ outputDir, screenshots: captured.map((item) => path.basename(item)) }));
} finally {
  await browser.close();
}
