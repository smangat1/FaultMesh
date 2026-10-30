import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots/session-list');
const DIST_INDEX_PATH = path.resolve(__dirname, '../dist/index.html');
const HERO_FIXTURE_PATH = path.resolve(__dirname, '../src/fixtures/fixture_replay_timeline_hero.json');

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function flushFrames(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
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
  ],
};

async function main() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const heroFixtureText = fs.readFileSync(HERO_FIXTURE_PATH, 'utf-8');

  console.log('Launching headless Chrome for Phase 3 first-use tips screenshots...');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // Setup desktop bridge mock
  await page.evaluateOnNewDocument((payload, fixtureText) => {
    // Ensure clean localStorage so tips are unseen on first visit
    window.localStorage.removeItem('faultmesh:first_use_tips:seen');

    window.faultmeshSpectate = {
      chooseProjectFolder: async () => ({ handle: 'h1', displayName: 'auth-service' }),
      startWatch: async () => ({ watching: true, displayName: 'auth-service' }),
      stopWatch: async () => ({ watching: false }),
      onSpectateEvent: () => () => {},
      openRecording: async () => ({
        name: 'fixture_replay_timeline_hero.json',
        text: fixtureText,
        size: fixtureText.length,
      }),
      listHistory: async () => payload,
      importSession: async () => ({
        name: 'fixture_replay_timeline_hero.json',
        text: fixtureText,
        size: fixtureText.length,
      }),
    };
  }, SYNTHETIC_PAYLOAD, heroFixtureText);

  const fileUrl = `file://${DIST_INDEX_PATH}`;
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });

  // -------------------------------------------------------------
  // Capture 1: 08-tip-session-list.png (Autodetect Home First-Use Tip)
  // -------------------------------------------------------------
  console.log('Verifying DOM for 08-tip-session-list.png...');
  await page.waitForSelector('[data-testid="first-use-tip-overlay"]');
  await page.waitForSelector('[data-testid="home-help-tips-btn"]');
  await page.waitForSelector('[data-testid="tip-card-title"]');

  const homeTipInfo = await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="first-use-tip-overlay"]');
    const svg = document.querySelector('[data-testid="first-use-spotlight-svg"]');
    const card = document.querySelector('[data-testid="first-use-tip-card"]');
    const title = document.querySelector('[data-testid="tip-card-title"]')?.textContent?.trim();
    const desc = document.querySelector('[data-testid="tip-card-description"]')?.textContent?.trim();
    const helpBtn = document.querySelector('[data-testid="home-help-tips-btn"]');
    const header = document.querySelector('[data-testid="autodetect-home-header"]');
    const nextBtn = document.querySelector('[data-testid="tip-next-btn"]')?.textContent?.trim();
    const skipBtn = document.querySelector('[data-testid="tip-skip-btn"]')?.textContent?.trim();

    return {
      hasOverlay: Boolean(overlay),
      hasSvg: Boolean(svg),
      hasCard: Boolean(card),
      hasHelpBtn: Boolean(helpBtn),
      hasHeader: Boolean(header),
      screen: overlay?.getAttribute('data-screen'),
      title,
      desc,
      nextBtn,
      skipBtn,
    };
  });

  assert.strictEqual(homeTipInfo.hasOverlay, true, 'Overlay root must be present');
  assert.strictEqual(homeTipInfo.hasSvg, true, 'Spotlight SVG cutout must be present');
  assert.strictEqual(homeTipInfo.hasCard, true, 'Tip card must be present');
  assert.strictEqual(homeTipInfo.hasHelpBtn, true, 'Home help ? button must be present in header');
  assert.strictEqual(homeTipInfo.hasHeader, true, 'Home header must be present');
  assert.strictEqual(homeTipInfo.screen, 'home', 'Overlay screen attribute must be home');
  assert.strictEqual(homeTipInfo.title, 'Welcome to FaultMesh', 'Title must match step 1');
  assert.ok(
    homeTipInfo.desc?.includes('FaultMesh discovers local Codex and Claude Code session histories automatically'),
    `Description should match step 1, got: "${homeTipInfo.desc}"`
  );
  assert.strictEqual(homeTipInfo.nextBtn, 'Next', 'Next button should read Next');
  assert.strictEqual(homeTipInfo.skipBtn, 'Skip', 'Skip button should read Skip');

  console.log('DOM assertion passed for 08-tip-session-list.png:', homeTipInfo);

  await flushFrames(page);
  const path08 = path.join(SCREENSHOTS_DIR, '08-tip-session-list.png');
  await page.screenshot({ path: path08 });
  const hash08 = sha256File(path08);
  console.log(`Saved 08-tip-session-list.png (SHA256: ${hash08})`);

  // -------------------------------------------------------------
  // Transition to Replay Workspace
  // -------------------------------------------------------------
  // Dismiss home tips via Skip button
  console.log('Dismissing home tips and transitioning to Replay Workspace...');
  await page.click('[data-testid="tip-skip-btn"]');
  await page.waitForFunction(() => !document.querySelector('[data-testid="first-use-tip-overlay"]'));

  // Ensure replay tips seen state is unset
  await page.evaluate(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem('faultmesh:first_use_tips:seen') || '{}');
      delete saved.replay;
      window.localStorage.setItem('faultmesh:first_use_tips:seen', JSON.stringify(saved));
    } catch {
      // Ignore
    }
  });

  // Open recording to transition to Replay Workspace
  await page.waitForSelector('[data-testid="startup-open-recording-btn"]');
  await page.click('[data-testid="startup-open-recording-btn"]');

  // Wait for Replay Workspace and replay tip overlay
  await page.waitForSelector('[data-testid="replay-timeline-bar"]');
  await page.waitForSelector('[data-testid="first-use-tip-overlay"]');
  await page.waitForSelector('[data-testid="replay-help-tips-btn"]');

  // -------------------------------------------------------------
  // Capture 2: 09-tip-replay-timeline.png (Replay Hero Timeline Tip)
  // -------------------------------------------------------------
  console.log('Verifying DOM for 09-tip-replay-timeline.png...');
  const replayTipInfo = await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="first-use-tip-overlay"]');
    const svg = document.querySelector('[data-testid="first-use-spotlight-svg"]');
    const card = document.querySelector('[data-testid="first-use-tip-card"]');
    const ring = document.querySelector('[data-testid="first-use-spotlight-ring"]');
    const title = document.querySelector('[data-testid="tip-card-title"]')?.textContent?.trim();
    const desc = document.querySelector('[data-testid="tip-card-description"]')?.textContent?.trim();
    const helpBtn = document.querySelector('[data-testid="replay-help-tips-btn"]');
    const timelineBar = document.querySelector('[data-testid="replay-timeline-bar"]');

    return {
      hasOverlay: Boolean(overlay),
      hasSvg: Boolean(svg),
      hasCard: Boolean(card),
      hasRing: Boolean(ring),
      hasHelpBtn: Boolean(helpBtn),
      hasTimelineBar: Boolean(timelineBar),
      screen: overlay?.getAttribute('data-screen'),
      title,
      desc,
    };
  });

  assert.strictEqual(replayTipInfo.hasOverlay, true, 'Overlay root must be present');
  assert.strictEqual(replayTipInfo.hasSvg, true, 'Spotlight SVG cutout must be present');
  assert.strictEqual(replayTipInfo.hasCard, true, 'Tip card must be present');
  assert.strictEqual(replayTipInfo.hasHelpBtn, true, 'Replay help ? button must be present in header');
  assert.strictEqual(replayTipInfo.hasTimelineBar, true, 'Hero timeline bar must be present');
  assert.strictEqual(replayTipInfo.screen, 'replay', 'Overlay screen attribute must be replay');
  assert.strictEqual(replayTipInfo.title, 'Hero Timeline', 'Title must match step 1 of replay');
  assert.ok(
    replayTipInfo.desc?.includes('Scrub through checkpoints with real timestamps, idle breaks, and gaps'),
    `Description should match step 1 of replay, got: "${replayTipInfo.desc}"`
  );

  console.log('DOM assertion passed for 09-tip-replay-timeline.png:', replayTipInfo);

  await flushFrames(page);
  const path09 = path.join(SCREENSHOTS_DIR, '09-tip-replay-timeline.png');
  await page.screenshot({ path: path09 });
  const hash09 = sha256File(path09);
  console.log(`Saved 09-tip-replay-timeline.png (SHA256: ${hash09})`);

  await browser.close();

  // -------------------------------------------------------------
  // Verify Unique Hashes Across All Screenshots
  // -------------------------------------------------------------
  console.log('\n--- Final Screenshot Hash Verification ---');
  const allPngs = fs.readdirSync(SCREENSHOTS_DIR).filter((f) => f.endsWith('.png')).sort();
  const hashes = new Map();
  for (const png of allPngs) {
    const fullPath = path.join(SCREENSHOTS_DIR, png);
    const hash = sha256File(fullPath);
    console.log(`${hash}  ${png}`);
    if (hashes.has(hash)) {
      throw new Error(`Duplicate SHA256 detected! "${png}" matches "${hashes.get(hash)}" (${hash})`);
    }
    hashes.set(hash, png);
  }

  console.log(`\nSuccessfully verified ${hashes.size} distinct screenshot files with 0 duplicates.`);
}

main().catch((err) => {
  console.error('Screenshot harness failed:', err);
  process.exit(1);
});
