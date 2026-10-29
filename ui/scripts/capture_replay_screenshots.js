import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots/replay');
const DIST_INDEX_PATH = path.resolve(__dirname, '../dist/index.html');

const FIXTURE_HERO = path.resolve(__dirname, '../src/fixtures/fixture_replay_timeline_hero.json');
const FIXTURE_HISTORY = path.resolve(__dirname, '../src/fixtures/fixture_replay_history_import.json');

async function captureState(page, filename, width, height) {
  console.log(`Capturing ${filename} (${width}x${height})...`);
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, filename),
    fullPage: false,
  });
}

async function goToStep(page, targetStep) {
  console.log(`Navigating to checkpoint #${targetStep}...`);

  for (let attempt = 0; attempt < 20; attempt++) {
    const currentStep = await page.evaluate(() => {
      const badge = document.querySelector('[data-testid="replay-current-seq-badge"]');
      if (!badge) return null;
      const m = badge.textContent.match(/Checkpoint #(\d+) of/);
      return m ? parseInt(m[1], 10) : null;
    });

    if (currentStep === null) {
      throw new Error('Current checkpoint badge not found in DOM');
    }

    if (currentStep === targetStep) {
      console.log(`Successfully reached checkpoint #${currentStep}`);
      return;
    }

    if (currentStep < targetStep) {
      const clicked = await page.evaluate(() => {
        const btn = document.querySelector('button[data-testid="replay-next-btn"]');
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!clicked) throw new Error('Next button not found');
    } else {
      const clicked = await page.evaluate(() => {
        const btn = document.querySelector('button[data-testid="replay-prev-btn"]');
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!clicked) throw new Error('Prev button not found');
    }

    // Wait for React to re-render and DOM to update
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`Failed to reach checkpoint #${targetStep} after 20 attempts`);
}

async function assertCheckpointInDOM(page, expectedStep, expectedTotal = 7) {
  const result = await page.evaluate((expected) => {
    const badge = document.querySelector('[data-testid="replay-current-seq-badge"]');
    if (!badge) {
      return { ok: false, error: 'replay-current-seq-badge not found in DOM' };
    }
    const text = badge.textContent || '';
    const match = text.match(/Checkpoint #(\d+) of (\d+)/);
    if (!match) {
      return { ok: false, error: `Badge text "${text}" did not match "Checkpoint #X of Y"` };
    }
    const seq = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);
    if (seq !== expected.step) {
      return { ok: false, error: `Checkpoint mismatch: expected #${expected.step}, DOM has #${seq} (text: "${text}")` };
    }
    if (total !== expected.total) {
      return { ok: false, error: `Total checkpoints mismatch: expected ${expected.total}, DOM has ${total}` };
    }
    return { ok: true, text };
  }, { step: expectedStep, total: expectedTotal });

  if (!result.ok) {
    throw new Error(`DOM ASSERTION ERROR: ${result.error}`);
  }
  console.log(`DOM Assertion Verified: ${result.text}`);
}

async function main() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log('Building latest production bundle for replay visual inspection...');
  execSync('npm run build --prefix ' + path.resolve(__dirname, '..'), { stdio: 'inherit' });

  console.log('Launching headless Chrome for zero-localhost file:// capture...');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
  });

  const page = await browser.newPage();
  page.on('console', (m) => console.log('PAGE LOG:', m.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

  const fileUrl = `file://${DIST_INDEX_PATH}`;

  const viewports = [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1024x700', width: 1024, height: 700 },
  ];

  for (const vp of viewports) {
    console.log(`\n=== Capturing Replay Screenshots for ${vp.name} ===`);
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2 });
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await new Promise((r) => setTimeout(r, 600));

    // Upload synthetic hero fixture with real 15m idle stretch, mid-run gap, and deterministic + model chapters
    console.log('Uploading synthetic timeline hero fixture...');
    const fileInput = (await page.$('input[aria-label="Open recording file input"]')) ||
                      (await page.$('input[aria-label="Open JSON file input"]'));
    if (!fileInput) {
      throw new Error('Could not find file input in UI');
    }
    await fileInput.uploadFile(FIXTURE_HERO);
    await new Promise((r) => setTimeout(r, 800));

    // Scenario 1: Normal run (timeline-first default view at step 3: hero bar across top, diff viewer hero, panels closed)
    console.log('Navigating to Scenario 1: Timeline-first normal run at step 3...');
    await goToStep(page, 3);
    await assertCheckpointInDOM(page, 3);

    const diffCheck = await page.evaluate(() => {
      const diffPane = document.querySelector('[data-testid="replay-diff-pane"]');
      const stage = document.querySelector('[data-testid="replay-main-stage"]');
      return Boolean(diffPane && stage);
    });
    if (!diffCheck) {
      throw new Error('Scenario 1 assertion failed: replay-diff-pane not found at step 3');
    }
    await captureState(page, `01_normal_run_${vp.name}.png`, vp.width, vp.height);

    // Scenario 2: Idle break with axis-break squiggle + real label (15m idle) + Evidence drawer open at step 6
    console.log('Navigating to Scenario 2: Idle break axis label (15m idle) and failed test evidence drawer at step 6...');
    await goToStep(page, 6);
    await assertCheckpointInDOM(page, 6);

    const idleCheck = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="replay-timeline-bar"]');
      return bar && bar.textContent.includes('15m idle');
    });
    if (!idleCheck) {
      throw new Error('Scenario 2 assertion failed: 15m idle label not found on hero bar at step 6');
    }

    // Open Evidence right drawer
    await page.evaluate(() => {
      const evBtn = document.querySelector('button[data-testid="replay-toggle-evidence"]');
      if (evBtn) evBtn.click();
    });
    await new Promise((r) => setTimeout(r, 200));

    // Switch to Tests tab in Evidence drawer
    await page.evaluate(() => {
      const testsTab = document.querySelector('button[data-testid="replay-tab-tests"]');
      if (testsTab) testsTab.click();
    });
    await new Promise((r) => setTimeout(r, 200));

    const testCheck = await page.evaluate(() => {
      const drawer = document.querySelector('[data-testid="replay-evidence-inspector-pane"]') ||
                     document.querySelector('[data-testid="replay-evidence-drawer-container"]');
      const text = drawer ? drawer.textContent || '' : '';
      return Boolean(drawer) && (text.includes('test_negative_input_raises') || text.includes('FAIL') || text.includes('fail'));
    });
    if (!testCheck) {
      throw new Error('Scenario 2 assertion failed: Failed test evidence not visible in drawer at step 6');
    }
    await captureState(page, `02_idle_break_axis_label_${vp.name}.png`, vp.width, vp.height);

    // Scenario 3: Mid-run Gap region on hero bar + Chapters left rail open at step 4
    console.log('Navigating to Scenario 3: Mid-run gap region and Chapters rail at step 4...');
    // Close Evidence drawer
    await page.evaluate(() => {
      const evClose = document.querySelector('button[data-testid="replay-evidence-close-btn"]');
      if (evClose) evClose.click();
    });
    await new Promise((r) => setTimeout(r, 200));

    await goToStep(page, 4);
    await assertCheckpointInDOM(page, 4);

    const gapCheck = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="replay-timeline-bar"]');
      const gapRegion = document.querySelector('[data-testid="timeline-gap-region"]');
      const text = bar ? bar.textContent || '' : '';
      return Boolean(gapRegion) && (text.includes('GAP') || text.includes('gap'));
    });
    if (!gapCheck) {
      throw new Error('Scenario 3 assertion failed: Step 4 timeline gap region not found');
    }

    // Open Chapters left rail
    await page.evaluate(() => {
      const chBtn = document.querySelector('button[data-testid="replay-toggle-chapters"]');
      if (chBtn) chBtn.click();
    });
    await new Promise((r) => setTimeout(r, 200));

    const chCheck = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="replay-chapters-rail-container"]');
      return rail && rail.style.display !== 'none';
    });
    if (!chCheck) {
      throw new Error('Scenario 3 assertion failed: Chapters rail is not open');
    }
    await captureState(page, `03_gap_region_${vp.name}.png`, vp.width, vp.height);

    // Scenario 4: Model-interpretation chapter segment on hero bar + Mini Map dock open at step 7
    console.log('Navigating to Scenario 4: Model-interpretation chapter segment and Mini Map dock at step 7...');
    // Close Chapters rail
    await page.evaluate(() => {
      const chClose = document.querySelector('button[data-testid="replay-chapters-close-btn"]');
      if (chClose) chClose.click();
    });
    await new Promise((r) => setTimeout(r, 200));

    await goToStep(page, 7);
    await assertCheckpointInDOM(page, 7);

    const modelCheck = await page.evaluate(() => {
      const statusBadge = document.querySelector('[data-testid="replay-current-chapter-status"]');
      const text = statusBadge ? statusBadge.textContent || '' : '';
      return text.includes('MODEL INTERPRETATION');
    });
    if (!modelCheck) {
      throw new Error('Scenario 4 assertion failed: Chapter status pill does not show MODEL INTERPRETATION at step 7');
    }

    // Open Mini Map dock if not already open
    await page.evaluate(() => {
      const dock = document.querySelector('[data-testid="replay-minimap-dock"]');
      if (!dock) {
        const mapBtn = document.querySelector('button[data-testid="replay-toggle-minimap"]');
        if (mapBtn) mapBtn.click();
      }
    });
    await new Promise((r) => setTimeout(r, 200));

    // Assert Mini Map dock is open INSIDE the replay workspace (and has not navigated away to map view)
    const mapDockCheck = await page.evaluate(() => {
      const dock = document.querySelector('[data-testid="replay-minimap-dock"]');
      const replayStage = document.querySelector('[data-testid="replay-main-stage"]');
      const emptyState = document.querySelector('[data-testid="replay-minimap-empty-state"]');
      return Boolean(dock) && Boolean(replayStage) && Boolean(emptyState);
    });
    if (!mapDockCheck) {
      throw new Error('Scenario 4 assertion failed: Mini Map dock inside replay workspace not found at step 7');
    }
    await captureState(page, `04_model_interpretation_chapter_${vp.name}.png`, vp.width, vp.height);

    // Scenario 5/6: sanitized imported-history prompt and tool evidence cards.
    console.log('Uploading sanitized imported-history fixture...');
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.clear());
    await new Promise((r) => setTimeout(r, 400));
    const historyInput = (await page.$('input[aria-label="Open recording file input"]')) ||
                         (await page.$('input[aria-label="Open JSON file input"]'));
    if (!historyInput) {
      throw new Error('Could not find file input for imported-history fixture');
    }
    await historyInput.uploadFile(FIXTURE_HISTORY);
    await new Promise((r) => setTimeout(r, 700));

    await assertCheckpointInDOM(page, 1, 2);
    const historyPromptCheck = await page.evaluate(() => {
      const prompt = document.querySelector('[data-testid="replay-history-prompt"]');
      const fileState = document.querySelector('[data-testid="replay-history-file-state"]');
      return Boolean(prompt && fileState && prompt.textContent.includes('[redacted: api key]'));
    });
    if (!historyPromptCheck) {
      throw new Error('Scenario 5 assertion failed: imported prompt evidence card is incomplete');
    }
    await captureState(page, `05_history_import_prompt_${vp.name}.png`, vp.width, vp.height);

    await goToStep(page, 2);
    await assertCheckpointInDOM(page, 2, 2);
    const historyToolCheck = await page.evaluate(() => {
      const command = document.querySelector('[data-testid="replay-history-command"]');
      const output = document.querySelector('[data-testid="replay-history-tool-output"]');
      const edit = document.querySelector('[data-testid="replay-history-edit"]');
      return Boolean(command && output && edit && command.textContent.includes('[redacted: token]'));
    });
    if (!historyToolCheck) {
      throw new Error('Scenario 6 assertion failed: imported tool evidence card is incomplete');
    }
    await captureState(page, `06_history_import_tool_${vp.name}.png`, vp.width, vp.height);
  }

  await browser.close();
  console.log('\nAll required sanitized replay screenshots successfully captured and verified in docs/screenshots/replay/!');
}

main().catch((err) => {
  console.error('Screenshot capture failure:', err);
  process.exit(1);
});
