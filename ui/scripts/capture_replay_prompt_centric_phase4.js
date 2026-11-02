import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(scriptDir, '..');
const outputRoot = path.resolve(
  process.env.FAULTMESH_CAPTURE_OUTPUT
    || path.join(uiDir, '..', 'docs/screenshots/replay-prompt-centric-phase4/after'),
);
const distIndex = path.join(uiDir, 'dist/index.html');
const baseFixture = JSON.parse(fs.readFileSync(
  path.join(uiDir, 'src/fixtures/fixture_replay_timeline_hero.json'),
  'utf8',
));
const now = new Date().toISOString();

function fixtureFor(mode) {
  const fixture = structuredClone(baseFixture);
  const promptRecord = fixture.records.find((record) => record.sequence === 2);
  const nextRecord = fixture.records.find((record) => record.sequence === 3);
  Object.assign(promptRecord, {
    prompt_id: 'prompt-risk-review',
    prompt_text: 'Update authentication configuration safely\nKeep existing callers compatible.',
  });
  Object.assign(nextRecord, { prompt_id: 'prompt-risk-review' });
  fixture.prompt_understanding = null;
  fixture.prompt_risk_flags = mode === 'clean' ? [] : [
    {
      prompt_id: 'prompt-risk-review',
      kind: 'secret_or_config_touched',
      label: 'Sensitive or config files touched',
      files: ['config/auth.yaml', '.env.example'],
      source: 'deterministic rule',
    },
    {
      prompt_id: 'prompt-risk-review',
      kind: 'test_files_changed',
      label: 'Test files changed',
      files: ['tests/test_auth.py'],
      source: 'deterministic rule',
    },
  ];
  fixture.prompt_claim_checks = mode === 'verdicts' ? [{
    prompt_id: 'prompt-risk-review',
    start_sequence: 2,
    end_sequence: 3,
    label: 'Model interpretation + symbolic check',
    claims: {
      schema_version: 'replay-claim-run-1.0',
      final_claims: {
        schema_version: 'replay-claims-1.0',
        claims: [
          {
            id: 'claim-file',
            assertion: {
              predicate: 'file_changed',
              path: 'config/auth.yaml',
              before_sha256: 'a'.repeat(64),
              after_sha256: 'b'.repeat(64),
              change: 'modified',
            },
            evidence_refs: ['file:config/auth.yaml:range-after'],
            statement: null,
          },
          {
            id: 'claim-command',
            assertion: { predicate: 'command_exit', record_id: 'command-12', exit_code: 0 },
            evidence_refs: ['record:command-12'],
            statement: null,
          },
          {
            id: 'claim-function',
            assertion: {
              predicate: 'python_function_added',
              path: 'src/auth.ts',
              qualified_name: 'validateSession',
            },
            evidence_refs: ['ast:src/auth.ts:range'],
            statement: null,
          },
        ],
      },
      final_source: 'first',
      verdicts: [
        {
          claim_id: 'claim-file',
          verdict: 'supported',
          reason_code: 'exact_file_fact',
          reason: 'The atomic file claim matches complete manifests.',
          evidence_refs: ['file:config/auth.yaml:range-after'],
          evidence_source: 'rebuilt_file',
          checker_version: 'replay-checker-1.0',
        },
        {
          claim_id: 'claim-command',
          verdict: 'contradicted',
          reason_code: 'exit_conflict',
          reason: 'The recorded command exit conflicts with the claim.',
          evidence_refs: ['record:command-12'],
          evidence_source: 'command_record',
          checker_version: 'replay-checker-1.0',
        },
        {
          claim_id: 'claim-function',
          verdict: 'unsupported_or_unknown',
          reason_code: 'ast_unavailable',
          reason: 'Python AST evidence is unavailable for this TypeScript file.',
          evidence_refs: ['ast:src/auth.ts:range'],
          evidence_source: 'rebuilt_file',
          checker_version: 'replay-checker-1.0',
        },
      ],
      fallback_used: false,
      repair_attempts: 0,
      backend: 'local',
      model: 'synthetic-3b',
      latency_ms: 1,
    },
  }] : [];
  return fixture;
}

const history = {
  roots: [{ tool: 'codex', status: 'ok', file_count: 1, message: null }],
  sessions: [{
    session_id: 'synthetic-phase4-session',
    tool: 'codex',
    project_group_key: 'faultmesh-demo',
    project_display_name: 'FaultMesh demo',
    project_parent_name: 'workspace',
    started_at: now,
    ended_at: now,
    prompt_count: 1,
    first_prompt_preview: 'Update authentication configuration safely',
    source_title: 'Authentication configuration review',
    history_state: 'active',
    project_visibility: 'normal',
    format_version: '1.0',
    parse_status: 'ok',
    unsupported_reason: null,
    source_file_sha256: 'a'.repeat(64),
    redaction_types: [],
  }],
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function makePage(browser, viewport, mode) {
  const fixture = fixtureFor(mode);
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((payload) => {
    localStorage.setItem(
      'faultmesh:first_use_tips:seen',
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true }),
    );
    localStorage.setItem(
      'faultmesh:replay:project_links:v1',
      JSON.stringify({ homePromptDismissed: true, dismissedSessionIds: ['synthetic-phase4-session'] }),
    );
    let listener = null;
    window.faultmeshSpectate = {
      chooseProjectFolder: async () => null,
      startWatch: async () => ({ watching: true, displayName: 'FaultMesh demo' }),
      stopWatch: async () => ({ watching: false }),
      onSpectateEvent: () => () => {},
      listHistory: async () => payload.history,
      listPrompts: async () => ({
        schema_version: 'history-prompt-index-1.0',
        session_id: 'synthetic-phase4-session',
        source_file_sha256: 'a'.repeat(64),
        cached: false,
        prompts: [{
          prompt_id: 'prompt-risk-review',
          first_line: 'Update authentication configuration safely',
          start_sequence: 2,
          end_sequence: 3,
          changed_files: ['config/auth.yaml'],
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
        ready: true,
        status: 'ready',
        message: 'Ready.',
        preset: 'synthetic',
        modelFilename: 'synthetic.gguf',
      }),
      startNarration: async () => {
        setTimeout(() => listener?.({ scope: 'narration', event: 'done', export: payload.fixture }), 20);
        return { started: true };
      },
      onNarrationEvent: (callback) => {
        listener = callback;
        return () => { listener = null; };
      },
    };
  }, { history, fixture, fixtureText: JSON.stringify(fixture) });
  await page.goto(`file://${distIndex}`, { waitUntil: 'networkidle0' });
  return page;
}

async function openReplay(page) {
  await page.waitForSelector('[data-testid="tool-widget-codex"]');
  await page.click('[data-testid="tool-widget-codex"]');
  await page.waitForSelector('[data-testid="session-row-synthetic-phase4-session"]');
  await page.click('[data-testid="session-row-synthetic-phase4-session"]');
  await page.waitForSelector('[data-testid="prompt-row-synthetic-phase4-session-0"]');
  await page.click('[data-testid="prompt-row-synthetic-phase4-session-0"]');
  await page.waitForSelector('[data-testid="replay-workspace"]');
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
    for (const [mode, name, selector] of [
      ['risks', '01-rule-risk-flags.png', '.replay-risk-chip'],
      ['verdicts', '02-checked-verdicts.png', '[data-testid="replay-prompt-claims"]'],
      ['clean', '03-all-clean-card.png', '.replay-risk-clean'],
    ]) {
      const page = await makePage(browser, viewport, mode);
      await openReplay(page);
      await page.waitForSelector(selector);
      await delay(180);
      fs.mkdirSync(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, name), fullPage: false });
      await page.close();
    }
  }
  console.log(JSON.stringify({ outputRoot }));
} finally {
  await browser.close();
}
