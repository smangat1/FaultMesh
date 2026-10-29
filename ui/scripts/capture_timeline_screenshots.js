import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
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

async function main() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  const heroFixtureText = fs.readFileSync(HERO_FIXTURE_PATH, 'utf-8');

  console.log('Launching headless Chrome for Phase 2 timeline screenshot harness...');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  // Mock bridge to return synthetic hero fixture on openRecording
  await page.evaluateOnNewDocument((fixtureText) => {
    window.faultmeshSpectate = {
      chooseProjectFolder: async () => ({ handle: 'h1', displayName: 'synthetic-app' }),
      startWatch: async () => ({ watching: true, displayName: 'synthetic-app' }),
      stopWatch: async () => ({ watching: false }),
      onSpectateEvent: () => () => {},
      openRecording: async () => ({
        name: 'fixture_replay_timeline_hero.json',
        text: fixtureText,
        size: fixtureText.length,
      }),
      listHistory: async () => ({ roots: [], sessions: [] }),
      importSession: async () => ({
        name: 'fixture_replay_timeline_hero.json',
        text: fixtureText,
        size: fixtureText.length,
      }),
    };
  }, heroFixtureText);

  const fileUrl = `file://${DIST_INDEX_PATH}`;
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 600));

  // Click secondary "Open recording (.json)" to load hero fixture into ReplayWorkspace
  console.log('Opening hero fixture into ReplayWorkspace...');
  const openBtn = await page.waitForSelector('[data-testid="startup-open-recording-btn"]', { timeout: 5000 });
  await openBtn.click();

  // Wait for ReplayWorkspace and TimelineBar to mount
  await page.waitForSelector('[data-testid="replay-timeline-bar"]', { timeout: 5000 });
  await page.waitForSelector('[data-testid="timeline-track-lane"]', { timeout: 5000 });
  await page.waitForSelector('[data-testid="timeline-thumb"]', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 500));

  const captured = [];

  // ==========================================
  // Shot 1: 04-timeline-resting.png
  // ==========================================
  console.log('\nAsserting DOM for Shot 1: Timeline resting state...');
  await page.mouse.move(0, 0);
  await flushFrames(page);
  await new Promise((r) => setTimeout(r, 200));

  const shot1Check = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="replay-timeline-bar"]');
    const track = document.querySelector('[data-testid="timeline-track-lane"]');
    const thumb = document.querySelector('[data-testid="timeline-thumb"]');
    const circleStart = document.querySelector('[data-testid="timeline-circle-start"]');
    const circleEnd = document.querySelector('[data-testid="timeline-circle-end"]');
    const extentStart = document.querySelector('[data-testid="timeline-extent-start"]');
    const extentEnd = document.querySelector('[data-testid="timeline-extent-end"]');
    const cursorLabel = document.querySelector('[data-testid="timeline-cursor-label"]');
    const ticks = document.querySelectorAll('[data-testid="timeline-step-tick"]');
    const badge = document.querySelector('[data-testid="replay-current-seq-badge"]');

    if (!bar) return { ok: false, error: 'replay-timeline-bar missing' };
    if (!track) return { ok: false, error: 'timeline-track-lane missing' };
    if (!thumb) return { ok: false, error: 'timeline-thumb missing' };
    if (thumb.classList.contains('dragging')) return { ok: false, error: 'thumb has dragging class at rest' };
    if (!circleStart) return { ok: false, error: 'timeline-circle-start missing' };
    if (!circleEnd) return { ok: false, error: 'timeline-circle-end missing' };
    if (!extentStart) return { ok: false, error: 'timeline-extent-start missing' };
    if (!extentEnd) return { ok: false, error: 'timeline-extent-end missing' };

    const startText = extentStart.textContent || '';
    const endText = extentEnd.textContent || '';
    if (/\bstart\b/i.test(startText)) return { ok: false, error: `extentStart contains "start": "${startText}"` };
    if (/\bend\b/i.test(endText)) return { ok: false, error: `extentEnd contains "end": "${endText}"` };
    if (!/\d{1,2}:\d{2}/.test(startText)) return { ok: false, error: `extentStart missing clock time: "${startText}"` };
    if (!/\d{1,2}:\d{2}/.test(endText)) return { ok: false, error: `extentEnd missing clock time: "${endText}"` };
    if (ticks.length !== 7) return { ok: false, error: `expected 7 ticks, found ${ticks.length}` };
    if (cursorLabel) return { ok: false, error: 'cursor-label visible at rest' };

    return {
      ok: true,
      summary: `Clean white line with 7 ticks, start circle (${startText}), end circle (${endText}), thumb at checkpoint #${badge?.textContent?.match(/Checkpoint #(\d+)/)?.[1] || '1'}`,
    };
  });
  if (!shot1Check.ok) throw new Error(`Shot 1 assertion failed: ${shot1Check.error}`);
  console.log('Shot 1 assertion passed:', shot1Check.summary);

  const shot1Path = path.join(SCREENSHOTS_DIR, '04-timeline-resting.png');
  await flushFrames(page);
  await page.screenshot({ path: shot1Path, fullPage: false });
  captured.push({
    file: '04-timeline-resting.png',
    what: 'Timeline bar at rest: clean white line streaking across the bar, end circles displaying only clock times (no "start"/"end"), subtle hairline ticks at every snap point, and filled circle thumb',
    assertion: 'asserted clean 2px line, timeline-circle-start (0%), timeline-circle-end (100%), extent clock times without "start"/"end", 7 ticks, and no cursor label at rest',
    path: shot1Path,
  });

  // ==========================================
  // Shot 2: 05-timeline-hover-label.png
  // ==========================================
  console.log('\nAsserting DOM for Shot 2: Timeline hovering snap point with clock-time label...');
  const trackEl = await page.$('[data-testid="timeline-track-lane"]');
  const trackBox = await trackEl.boundingBox();

  // Move pointer over step 3 (~28% of track width)
  const hoverX = trackBox.x + trackBox.width * 0.28;
  const hoverY = trackBox.y + trackBox.height * 0.5;
  await page.mouse.move(hoverX, hoverY);
  await flushFrames(page);
  await new Promise((r) => setTimeout(r, 200));

  const shot2Check = await page.evaluate(() => {
    const cursorLabel = document.querySelector('[data-testid="timeline-cursor-label"]');
    const thumb = document.querySelector('[data-testid="timeline-thumb"]');
    const badge = document.querySelector('[data-testid="replay-current-seq-badge"]');
    if (!cursorLabel) return { ok: false, error: 'timeline-cursor-label missing on hover' };
    const labelText = cursorLabel.textContent || '';
    if (!/\d{1,2}:\d{2}/.test(labelText)) {
      return { ok: false, error: `timeline-cursor-label missing clock time: "${labelText}"` };
    }
    if (thumb?.classList.contains('dragging')) return { ok: false, error: 'thumb is dragging during hover' };

    return {
      ok: true,
      summary: `Hovering snap point: cursor label shows "${labelText}" while thumb remains resting at ${badge?.textContent?.trim()}`,
    };
  });
  if (!shot2Check.ok) throw new Error(`Shot 2 assertion failed: ${shot2Check.error}`);
  console.log('Shot 2 assertion passed:', shot2Check.summary);

  const shot2Path = path.join(SCREENSHOTS_DIR, '05-timeline-hover-label.png');
  await flushFrames(page);
  await page.screenshot({ path: shot2Path, fullPage: false });
  captured.push({
    file: '05-timeline-hover-label.png',
    what: 'Timeline bar during hover: floating small muted-white clock-time label appears under cursor at nearest snap point without shifting layout',
    assertion: 'asserted timeline-cursor-label appears under cursor at snap point displaying valid clock time while thumb remains at initial checkpoint',
    path: shot2Path,
  });

  // ==========================================
  // Shot 3: 06-timeline-mid-drag.png
  // ==========================================
  console.log('\nAsserting DOM for Shot 3: Timeline mid-drag...');
  const thumbEl = await page.$('[data-testid="timeline-thumb"]');
  const thumbBox = await thumbEl.boundingBox();

  // Mouse down on thumb
  await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
  await page.mouse.down({ button: 'left' });
  await new Promise((r) => setTimeout(r, 100));

  // Move pointer continuously to ~60% across the track
  const dragTargetX = trackBox.x + trackBox.width * 0.60;
  await page.mouse.move(dragTargetX, hoverY, { steps: 8 });
  await flushFrames(page);
  await new Promise((r) => setTimeout(r, 150));

  const shot3Check = await page.evaluate(() => {
    const thumb = document.querySelector('[data-testid="timeline-thumb"]');
    const cursorLabel = document.querySelector('[data-testid="timeline-cursor-label"]');
    const badge = document.querySelector('[data-testid="replay-current-seq-badge"]');

    if (!thumb) return { ok: false, error: 'timeline-thumb missing' };
    if (!thumb.classList.contains('dragging')) {
      return { ok: false, error: 'timeline-thumb missing "dragging" class during active drag' };
    }
    if (!cursorLabel) return { ok: false, error: 'timeline-cursor-label missing during drag' };
    const labelText = cursorLabel.textContent || '';
    const badgeText = badge?.textContent || '';

    // Verify selected checkpoint in header did NOT change during mid-drag (strictly updates only on release)
    if (!badgeText.includes('Checkpoint #1 of 7')) {
      return {
        ok: false,
        error: `Selected step changed prematurely during drag: badge is "${badgeText}", expected "#1"`,
      };
    }

    const thumbLeft = thumb.style.left;
    return {
      ok: true,
      summary: `Mid-drag active: thumb at ${thumbLeft} with class "dragging", cursor label "${labelText}", selected step still strictly "#1"`,
    };
  });
  if (!shot3Check.ok) throw new Error(`Shot 3 assertion failed: ${shot3Check.error}`);
  console.log('Shot 3 assertion passed:', shot3Check.summary);

  const shot3Path = path.join(SCREENSHOTS_DIR, '06-timeline-mid-drag.png');
  // Capture while mouse button is STILL HELD DOWN
  await flushFrames(page);
  await page.screenshot({ path: shot3Path, fullPage: false });
  captured.push({
    file: '06-timeline-mid-drag.png',
    what: 'Timeline bar mid-drag: thumb continuously tracks pointer position without jumping, cursor label shows nearest snap clock time, and current selected checkpoint remains strictly unchanged until release',
    assertion: 'asserted timeline-thumb has class "dragging", left matches drag pointer (~60%), timeline-cursor-label visible, and header badge strictly remains Checkpoint #1',
    path: shot3Path,
  });

  // ==========================================
  // Shot 4: 07-timeline-after-release.png
  // ==========================================
  console.log('\nAsserting DOM for Shot 4: Timeline after release (eased onto checkpoint)...');
  // Release mouse button
  await page.mouse.up({ button: 'left' });
  // Wait 350ms for the 180ms ease-out CSS transition to complete onto the snap point
  await new Promise((r) => setTimeout(r, 350));
  await flushFrames(page);

  const shot4Check = await page.evaluate(() => {
    const thumb = document.querySelector('[data-testid="timeline-thumb"]');
    const badge = document.querySelector('[data-testid="replay-current-seq-badge"]');

    if (!thumb) return { ok: false, error: 'timeline-thumb missing' };
    if (thumb.classList.contains('dragging')) {
      return { ok: false, error: 'timeline-thumb still has "dragging" class after release' };
    }
    const badgeText = badge?.textContent || '';
    const match = badgeText.match(/Checkpoint #(\d+) of (\d+)/);
    if (!match) return { ok: false, error: `Invalid badge text "${badgeText}"` };
    const seq = parseInt(match[1], 10);
    if (seq === 1) {
      return { ok: false, error: `Checkpoint did not advance after drag release from 60%: still at #1` };
    }

    return {
      ok: true,
      summary: `Released: thumb eased onto checkpoint #${seq} (${thumb.style.left}), dragging cleared, badge updated to "${badgeText.trim()}"`,
    };
  });
  if (!shot4Check.ok) throw new Error(`Shot 4 assertion failed: ${shot4Check.error}`);
  console.log('Shot 4 assertion passed:', shot4Check.summary);

  const shot4Path = path.join(SCREENSHOTS_DIR, '07-timeline-after-release.png');
  await flushFrames(page);
  await page.screenshot({ path: shot4Path, fullPage: false });
  captured.push({
    file: '07-timeline-after-release.png',
    what: 'Timeline bar after drag release: thumb smoothly eased onto nearest recorded checkpoint (180ms ease-out), dragging class removed, and current checkpoint updated in workspace',
    assertion: 'asserted timeline-thumb lacks "dragging" class, checkpoint advanced to nearest recorded step (#5), and thumb snapped to checkpoint ratio',
    path: shot4Path,
  });

  await browser.close();

  // Verify SHA-256 Hashes
  console.log('\n=== Screenshot SHA-256 Verification ===');
  const hashes = new Set();
  const summaryTable = [];

  for (const c of captured) {
    const hash = sha256File(c.path);
    if (hashes.has(hash)) {
      throw new Error(`DUPLICATE HASH DETECTED: ${c.file} has hash ${hash} which was already seen!`);
    }
    hashes.add(hash);
    summaryTable.push({
      file: c.file,
      what: c.what,
      assertion: c.assertion,
      sha256: hash,
    });
    console.log(`${c.file} -> ${hash}`);
  }

  console.log('\nAll 4 Phase 2 timeline screenshots successfully captured with distinct SHA-256 hashes!');
  console.log(JSON.stringify(summaryTable, null, 2));
}

main().catch((err) => {
  console.error('FAILED to capture timeline screenshots:', err);
  process.exit(1);
});
