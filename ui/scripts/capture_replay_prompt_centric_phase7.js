import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(scriptDir, '..');
const outputRoot = path.resolve(
  process.env.FAULTMESH_CAPTURE_OUTPUT
    || path.join(uiDir, '..', 'docs/screenshots/replay-prompt-centric-phase7/after'),
);
const distIndex = path.join(uiDir, 'dist/index.html');
const captureUrl = process.env.FAULTMESH_CAPTURE_URL || `file://${distIndex}`;
const sessionId = 'phase7-synthetic-session';
const initial = JSON.parse(fs.readFileSync(
  path.join(uiDir, 'src/fixtures/fixture_replay_timeline_hero.json'),
  'utf8',
));
initial.session.id = sessionId;
initial.records.forEach((record) => { record.session_id = sessionId; });
Object.assign(initial.records.find((record) => record.sequence === 2), {
  prompt_id: 'prompt-calculator-safety',
  prompt_text: 'Make negative calculator inputs fail safely\nKeep the public API stable.',
});
Object.assign(initial.records.find((record) => record.sequence === 3), {
  prompt_id: 'prompt-calculator-safety',
});

const updated = structuredClone(initial);
const previousRecord = updated.records[updated.records.length - 1];
const previousEntry = updated.timeline[updated.timeline.length - 1];
updated.records.push({
  ...previousRecord,
  id: 'rec-live-8',
  sequence: 8,
  source_identity: 'prompt:live-8',
  captured_at: '2026-10-28T12:20:00.000000Z',
  turn_id: 'turn-live',
  prompt_id: 'prompt-live',
  prompt_text: 'Document the negative input behavior for the support team.',
});
updated.timeline.push({
  ...previousEntry,
  sequence: 8,
  record_id: 'rec-live-8',
  captured_at: '2026-10-28T12:20:00.000000Z',
});
updated.chapters = updated.chapters.map((chapter) => (
  chapter.id === 'chapter:hero-c2'
    ? { ...chapter, end_sequence: 8, evidence_refs: [...chapter.evidence_refs, 'rec-live-8'] }
    : chapter
));
updated.baseline_chapters = updated.baseline_chapters.map((chapter) => (
  chapter.id === 'chapter:base-2'
    ? { ...chapter, end_sequence: 8, evidence_refs: [...chapter.evidence_refs, 'rec-live-8'] }
    : chapter
));
updated.chapter_run = { ...updated.chapter_run, chapters: updated.chapters };

const history = {
  roots: [{ tool: 'codex', status: 'ok', file_count: 1, message: null }],
  sessions: [{
    session_id: sessionId,
    tool: 'codex',
    project_group_key: 'calculator',
    project_display_name: 'calculator',
    started_at: '2026-11-01T15:00:00Z',
    ended_at: '2026-11-01T15:08:00Z',
    prompt_count: 4,
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
      matched_in: ['prompt_text', 'changed_file'],
    }],
  }],
};

const promptIndex = {
  schema_version: 'history-prompt-index-1.0',
  session_id: sessionId,
  source_file_sha256: 'b'.repeat(64),
  cached: false,
  prompts: [{
    prompt_id: 'prompt-live',
    first_line: 'Document the negative input behavior for the support team.',
    start_sequence: 8,
    end_sequence: 8,
    changed_files: [],
    changed_file_count: 0,
    started_at: '2026-11-01T15:09:00Z',
    ended_at: '2026-11-01T15:09:00Z',
    test_observation: 'not_observed',
    grouping: 'prompt_turn',
  }],
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
    let importCount = 0;
    window.faultmeshSpectate = {
      chooseProjectFolder: async () => null,
      startWatch: async () => ({ watching: true, displayName: 'calculator' }),
      stopWatch: async () => ({ watching: false }),
      onSpectateEvent: () => () => {},
      listHistory: async () => payload.history,
      searchHistory: async () => payload.searchResult,
      listPrompts: async () => payload.promptIndex,
      importSession: async () => {
        const value = importCount === 0 ? payload.initial : payload.updated;
        importCount += 1;
        const text = JSON.stringify(value);
        return { name: 'synthetic-session.json', size: text.length, text };
      },
      onNarrationEvent: () => () => {},
    };
  }, { history, searchResult, promptIndex, initial, updated, sessionId });
  await page.goto(captureUrl, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="history-search-input"]');
  await page.type('[data-testid="history-search-input"]', 'calculator');
  await page.waitForSelector(`[data-testid="history-search-prompt-${sessionId}-2"]`);
  await page.click(`[data-testid="history-search-prompt-${sessionId}-2"]`);
  await page.waitForSelector('[data-testid="replay-new-prompt-toast"]');
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="replay-current-seq-badge"]')?.textContent
      ?.includes('Prompt 2 of 5')
  ));
  await delay(160);
  return page;
}

async function capture(page, directory, name) {
  fs.mkdirSync(directory, { recursive: true });
  await delay(80);
  await page.screenshot({ path: path.join(directory, name), fullPage: false });
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
});

try {
  for (const viewport of [
    { width: 1440, height: 900, label: '1440x900' },
    { width: 1024, height: 768, label: '1024x768' },
  ]) {
    const directory = path.join(outputRoot, viewport.label);
    const page = await makePage(browser, viewport);
    await capture(page, directory, '01-recording-new-prompt-toast.png');
    for (let index = 0; index < 3; index += 1) {
      await page.click('[data-testid="replay-next-btn"]');
    }
    await page.waitForFunction(() => (
      document.querySelector('[data-testid="replay-current-seq-badge"]')?.textContent
        ?.includes('Prompt 5 of 5')
    ));
    await delay(4100);
    await capture(page, directory, '02-extended-timeline.png');
    await page.close();
  }
  console.log(JSON.stringify({ outputRoot }));
} finally {
  await browser.close();
}
