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

    // Scenario 1: Normal run (timeline-first default view: hero bar across top, diff viewer hero, panels closed)
    console.log('Capturing Scenario 1: Timeline-first normal run at step 3...');
    await page.evaluate(() => {
      // Step to step 3 (calc.py modified)
      const nextBtn = document.querySelector('button[data-testid="replay-next-btn"]');
      if (nextBtn) {
        nextBtn.click(); // step 2
        nextBtn.click(); // step 3
      }
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `01_normal_run_${vp.name}.png`, vp.width, vp.height);

    // Scenario 2: Idle break with axis-break squiggle + real label (15m idle) + Evidence drawer open at step 6
    console.log('Capturing Scenario 2: Idle break axis label (15m idle) and failed test evidence drawer at step 6...');
    await page.evaluate(() => {
      // Step to step 6 (post-idle with failed test)
      const nextBtn = document.querySelector('button[data-testid="replay-next-btn"]');
      if (nextBtn) {
        nextBtn.click(); // step 4
        nextBtn.click(); // step 5
        nextBtn.click(); // step 6
      }
      // Open Evidence right drawer
      const evToggle = document.querySelector('button[data-testid="replay-toggle-evidence"]');
      if (evToggle) evToggle.click();

      // Switch to Tests tab in Evidence drawer
      setTimeout(() => {
        const testsTab = document.querySelector('button[data-testid="replay-tab-tests"]');
        if (testsTab) testsTab.click();
      }, 50);
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `02_idle_break_axis_label_${vp.name}.png`, vp.width, vp.height);

    // Scenario 3: Mid-run Gap region on hero bar + Chapters left rail open at step 4
    console.log('Capturing Scenario 3: Mid-run gap region and Chapters rail at step 4...');
    await page.evaluate(() => {
      // Close Evidence drawer
      const evClose = document.querySelector('button[data-testid="replay-evidence-close-btn"]');
      if (evClose) evClose.click();

      // Step back to step 4 (mid-run gap record)
      const prevBtn = document.querySelector('button[data-testid="replay-prev-btn"]');
      if (prevBtn) {
        prevBtn.click(); // step 5
        prevBtn.click(); // step 4
      }

      // Open Chapters rail on the left
      const chToggle = document.querySelector('button[data-testid="replay-toggle-chapters"]');
      if (chToggle) chToggle.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `03_gap_region_${vp.name}.png`, vp.width, vp.height);

    // Scenario 4: Model-interpretation chapter segment on hero bar + Mini Map dock open at step 7
    console.log('Capturing Scenario 4: Model-interpretation chapter segment and Mini Map dock at step 7...');
    await page.evaluate(() => {
      // Close Chapters rail
      const chClose = document.querySelector('button[data-testid="replay-chapters-close-btn"]');
      if (chClose) chClose.click();

      // Step forward to step 7 (in Chapter 2 - model interpretation)
      const nextBtn = document.querySelector('button[data-testid="replay-next-btn"]');
      if (nextBtn) {
        nextBtn.click(); // step 5
        nextBtn.click(); // step 6
        nextBtn.click(); // step 7
      }

      // Open Mini Map dock
      const mapToggle = document.querySelector('button[data-testid="replay-toggle-minimap"]');
      if (mapToggle) mapToggle.click();
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
