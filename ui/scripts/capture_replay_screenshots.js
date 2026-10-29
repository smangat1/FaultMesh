import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots/replay');
const DIST_INDEX_PATH = path.resolve(__dirname, '../dist/index.html');

const FIXTURE_V2 = path.resolve(__dirname, '../../tests/fixtures/replay/fixture_replay_v2_enriched.json');
const FIXTURE_V1 = path.resolve(__dirname, '../../tests/fixtures/replay/fixture_replay_v1_nomodel.json');

async function captureState(page, filename, width, height) {
  console.log(`Capturing ${filename} (${width}x${height})...`);
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, filename),
    fullPage: false,
  });
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
    await new Promise((r) => setTimeout(r, 600));

    // Upload V2 Enriched Fixture
    console.log('Uploading V2 enriched fixture...');
    const fileInput = (await page.$('input[aria-label="Open recording file input"]')) ||
                      (await page.$('input[aria-label="Open JSON file input"]'));
    if (!fileInput) {
      throw new Error('Could not find file input in UI');
    }
    await fileInput.uploadFile(FIXTURE_V2);
    await new Promise((r) => setTimeout(r, 800));

    // View 1: Normal run (hero bar, diff view, chapters, summary audit)
    await page.evaluate(() => {
      const cp2 = document.querySelector('div[data-testid="replay-checkpoint-row-2"]');
      if (cp2) cp2.click();
      const summaryTab = document.querySelector('button[data-testid="replay-tab-summary"]');
      if (summaryTab) summaryTab.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `01_whole_recording_chapters_diff_${vp.name}.png`, vp.width, vp.height);
    await captureState(page, `01_normal_run_${vp.name}.png`, vp.width, vp.height);

    // View 2: Idle break with axis-break label + failed test marker
    console.log('Activating axis-break on hero timeline bar and navigating to failed test...');
    await page.evaluate(() => {
      window.__FAULTMESH_TIMELINE_OPTIONS__ = { idleThresholdMs: 0.5, idleLabel: '15m idle' };
      window.dispatchEvent(new Event('timeline-options-changed'));

      const cp4 = document.querySelector('div[data-testid="replay-checkpoint-row-4"]');
      if (cp4) cp4.click();

      const testsTab = document.querySelector('button[data-testid="replay-tab-tests"]');
      if (testsTab) testsTab.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `02_failed_test_state_match_${vp.name}.png`, vp.width, vp.height);
    await captureState(page, `02_idle_break_axis_label_${vp.name}.png`, vp.width, vp.height);

    // View 3: Chapter segments including a model-interpretation chapter + claims reasoning
    console.log('Capturing model-interpretation chapter segment on hero bar...');
    await page.evaluate(() => {
      window.__FAULTMESH_TIMELINE_OPTIONS__ = undefined;
      window.dispatchEvent(new Event('timeline-options-changed'));

      const cp2 = document.querySelector('div[data-testid="replay-checkpoint-row-2"]');
      if (cp2) cp2.click();

      const claimsTab = document.querySelector('button[data-testid="replay-tab-claims"]');
      if (claimsTab) claimsTab.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `03_evidence_inspector_verdicts_reason_${vp.name}.png`, vp.width, vp.height);
    await captureState(page, `04_model_interpretation_chapter_${vp.name}.png`, vp.width, vp.height);

    // View 4: Gap region on hero bar + no-model missing evidence
    console.log('Uploading V1 no-model fixture to demonstrate gap regions on hero bar...');
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));
    const fileInputV1 = (await page.$('input[aria-label="Open recording file input"]')) ||
                        (await page.$('input[aria-label="Open JSON file input"]'));
    if (fileInputV1) {
      await fileInputV1.uploadFile(FIXTURE_V1);
      await new Promise((r) => setTimeout(r, 800));
    }

    // Go to checkpoint #2 to highlight the gap region with hatch pattern and warning state
    await page.evaluate(() => {
      const nextBtn = document.querySelector('button[data-testid="replay-next-btn"]');
      if (nextBtn && !nextBtn.disabled) nextBtn.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `04_nomodel_partial_missing_evidence_${vp.name}.png`, vp.width, vp.height);
    await captureState(page, `03_gap_region_${vp.name}.png`, vp.width, vp.height);
  }

  await browser.close();
  console.log('\nAll required sanitized replay screenshots successfully captured in docs/screenshots/replay/!');
}

main().catch((err) => {
  console.error('Screenshot capture failure:', err);
  process.exit(1);
});
