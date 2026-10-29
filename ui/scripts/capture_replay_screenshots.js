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

    // Upload synthetic hero fixture with real 15m idle stretch, mid-run gap, and deterministic + model chapters
    console.log('Uploading synthetic timeline hero fixture...');
    const fileInput = (await page.$('input[aria-label="Open recording file input"]')) ||
                      (await page.$('input[aria-label="Open JSON file input"]'));
    if (!fileInput) {
      throw new Error('Could not find file input in UI');
    }
    await fileInput.uploadFile(FIXTURE_HERO);
    await new Promise((r) => setTimeout(r, 800));

    // View 1: Normal run (hero bar, diff view, chapters, summary audit)
    console.log('Capturing Scenario 1: Normal run overview at step 3...');
    await page.evaluate(() => {
      const cp3 = document.querySelector('div[data-testid="replay-checkpoint-row-3"]');
      if (cp3) cp3.click();
      const summaryTab = document.querySelector('button[data-testid="replay-tab-summary"]');
      if (summaryTab) summaryTab.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `01_normal_run_${vp.name}.png`, vp.width, vp.height);

    // View 2: Idle break with axis-break squiggle + real label computed from timestamps (15m idle) + failed test marker
    console.log('Capturing Scenario 2: Idle break axis label (15m idle) and failed test at step 6...');
    await page.evaluate(() => {
      const cp6 = document.querySelector('div[data-testid="replay-checkpoint-row-6"]');
      if (cp6) cp6.click();
      const testsTab = document.querySelector('button[data-testid="replay-tab-tests"]');
      if (testsTab) testsTab.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `02_idle_break_axis_label_${vp.name}.png`, vp.width, vp.height);

    // View 3: Mid-run Gap region on hero bar with warning hatch pattern and GAP badge at step 4
    console.log('Capturing Scenario 3: Mid-run gap region at step 4...');
    await page.evaluate(() => {
      const cp4 = document.querySelector('div[data-testid="replay-checkpoint-row-4"]');
      if (cp4) cp4.click();
      const summaryTab = document.querySelector('button[data-testid="replay-tab-summary"]');
      if (summaryTab) summaryTab.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `03_gap_region_${vp.name}.png`, vp.width, vp.height);

    // View 4: Model-interpretation chapter segment on hero bar with dashed bracket and [model] badge at step 7
    console.log('Capturing Scenario 4: Model-interpretation chapter segment with claims reasoning at step 7...');
    await page.evaluate(() => {
      const cp7 = document.querySelector('div[data-testid="replay-checkpoint-row-7"]');
      if (cp7) cp7.click();
      const claimsTab = document.querySelector('button[data-testid="replay-tab-claims"]');
      if (claimsTab) claimsTab.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `04_model_interpretation_chapter_${vp.name}.png`, vp.width, vp.height);
  }

  await browser.close();
  console.log('\nAll required sanitized replay screenshots successfully captured in docs/screenshots/replay/!');
}

main().catch((err) => {
  console.error('Screenshot capture failure:', err);
  process.exit(1);
});
