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
    const fileInput = await page.$('input[aria-label="Open recording file input"]') ||
                      await page.$('input[aria-label="Open JSON file input"]');
    if (!fileInput) {
      throw new Error('Could not find file input in UI');
    }
    await fileInput.uploadFile(FIXTURE_V2);
    await new Promise((r) => setTimeout(r, 800));

    // Ensure we are at checkpoint #2 (diff & narration)
    await page.evaluate(() => {
      const cp2 = document.querySelector('div[data-testid="replay-checkpoint-row-2"]');
      if (cp2) cp2.click();
      else {
        const nextBtn = document.querySelector('button[data-testid="replay-next-btn"]');
        if (nextBtn && !nextBtn.disabled) nextBtn.click();
      }
    });
    await new Promise((r) => setTimeout(r, 600));

    // View 1: Whole recording, chapters/timeline, historical diff and Summary Audit
    // Switch to Summary Audit tab so View 1 is distinct from View 3
    await page.evaluate(() => {
      const summaryTab = document.querySelector('button[data-testid="replay-tab-summary"]');
      if (summaryTab) summaryTab.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `01_whole_recording_chapters_diff_${vp.name}.png`, vp.width, vp.height);

    // View 2: Selected failed test, exact snapshot-match or unverified-state label
    // Advance to checkpoint #4 where structured test evidence is recorded
    await page.evaluate(() => {
      const cp4 = document.querySelector('div[data-testid="replay-checkpoint-row-4"]');
      if (cp4) cp4.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // Switch to Nearby Tests tab
    await page.evaluate(() => {
      const testsTab = document.querySelector('button[data-testid="replay-tab-tests"]');
      if (testsTab) testsTab.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `02_failed_test_state_match_${vp.name}.png`, vp.width, vp.height);

    // View 3: Evidence inspector: supported, contradicted/struck, unknown and likely-reason inference labels
    // Return to checkpoint #2 where model narration, checked claims, and citations are recorded
    await page.evaluate(() => {
      const cp2 = document.querySelector('div[data-testid="replay-checkpoint-row-2"]');
      if (cp2) cp2.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // Switch to Claims & Reason tab
    await page.evaluate(() => {
      const claimsTab = document.querySelector('button[data-testid="replay-tab-claims"]');
      if (claimsTab) claimsTab.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `03_evidence_inspector_verdicts_reason_${vp.name}.png`, vp.width, vp.height);

    // View 4: No-model / model-unavailable and partial/missing evidence
    // Reload page and upload V1 no-model fixture
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));
    const fileInputV1 = await page.$('input[aria-label="Open recording file input"]') ||
                        await page.$('input[aria-label="Open JSON file input"]');
    if (fileInputV1) {
      await fileInputV1.uploadFile(FIXTURE_V1);
      await new Promise((r) => setTimeout(r, 800));
    }

    // Go to checkpoint #2 to see the partial snapshot gap
    await page.evaluate(() => {
      const nextBtn = document.querySelector('button[data-testid="replay-next-btn"]');
      if (nextBtn && !nextBtn.disabled) nextBtn.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `04_nomodel_partial_missing_evidence_${vp.name}.png`, vp.width, vp.height);
  }

  await browser.close();
  console.log('\nAll required sanitized replay screenshots successfully captured in docs/screenshots/replay/!');
}

main().catch((err) => {
  console.error('Screenshot capture failure:', err);
  process.exit(1);
});
