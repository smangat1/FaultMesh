import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');
const DIST_INDEX_PATH = path.resolve(__dirname, '../dist/index.html');

async function captureState(page, filename, width, height) {
  console.log(`Capturing ${filename} (${width}x${height})...`);
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, filename),
    fullPage: false,
  });
}

async function main() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

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
  console.log(`Navigating to ${fileUrl}...`);
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });

  // Wait for initial load
  await page.waitForFunction(() => !document.body.innerText.includes('Loading run artifacts...'), {
    timeout: 5000,
  });
  await new Promise((r) => setTimeout(r, 600));

  const resolutions = [
    { name: '1440x920', width: 1440, height: 920 },
    { name: '1024x700', width: 1024, height: 700 },
  ];

  for (const res of resolutions) {
    console.log(`\n=== Capturing 7 Visual States for ${res.name} ===`);
    await page.setViewport({ width: res.width, height: res.height, deviceScaleFactor: 2 });
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));

    // 1. Opening state, zoomed out, all clusters visible, no selection
    // Clear test highlight if any preselected
    await page.evaluate(() => {
      const clearBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent && b.textContent.trim() === 'Clear'
      );
      if (clearBtn) clearBtn.click();
    });
    // Click zoom out / fit
    await page.evaluate(() => {
      const fitBtn = document.querySelector('button[aria-label="Fit to view"]');
      if (fitBtn) fitBtn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    await captureState(page, `01_opening_zoomed_out_${res.name}.png`, res.width, res.height);

    // 2. Zoomed in on one expanded cluster with symbol labels, no overlap
    await page.evaluate(() => {
      const zoomInBtn = document.querySelector('button[aria-label="Zoom in"]');
      if (zoomInBtn) {
        zoomInBtn.click();
        zoomInBtn.click();
      }
    });
    await new Promise((r) => setTimeout(r, 500));
    await captureState(page, `02_cluster_zoomed_in_${res.name}.png`, res.width, res.height);

    // 3. Failing test selected: highlight inside the full map, rest dimmed but present
    await page.evaluate(() => {
      const fitBtn = document.querySelector('button[aria-label="Fit to view"]');
      if (fitBtn) fitBtn.click();

      // Click failing test
      const testBtns = Array.from(document.querySelectorAll('button[aria-label*="Test test_login_expired_token"]'));
      if (testBtns.length > 0) testBtns[0].click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await captureState(page, `03_failing_test_highlight_${res.name}.png`, res.width, res.height);

    // 4. A function selected with the inspector open (source lines highlighted, explanation, pin button)
    await page.evaluate(() => {
      // Find validate_token in exercised symbols list or search
      const btns = Array.from(document.querySelectorAll('button'));
      const validateBtn = btns.find((b) => b.textContent && b.textContent.includes('validate_token'));
      if (validateBtn) validateBtn.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await captureState(page, `04_function_inspector_${res.name}.png`, res.width, res.height);

    // 5. Shortlist with a few pinned items
    await page.evaluate(() => {
      // Pin current function
      const pinBtn = document.querySelector('button[aria-label*="Pin validate_token"]');
      if (pinBtn) pinBtn.click();

      // Find and select verify_signature in relationships
      const btns = Array.from(document.querySelectorAll('button'));
      const verifyBtn = btns.find((b) => b.textContent && b.textContent.includes('verify_signature'));
      if (verifyBtn) verifyBtn.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => {
      // Pin second function
      const pinBtn = document.querySelector('button[aria-label*="Pin verify_signature"]');
      if (pinBtn) pinBtn.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await captureState(page, `05_pinned_shortlist_${res.name}.png`, res.width, res.height);

    // 6. A search result jump (typing in sidebar search)
    const sidebarSearchInput = await page.$('input[placeholder*="Filter tests by name or file"]');
    if (sidebarSearchInput) {
      await sidebarSearchInput.focus();
      await sidebarSearchInput.type('login');
      await new Promise((r) => setTimeout(r, 400));
    }
    await captureState(page, `06_search_jump_${res.name}.png`, res.width, res.height);

    // 7. The large sample (60+ symbols) at default zoom
    await page.evaluate(() => {
      // Close search and inspector
      const closeBtn = document.querySelector('button[aria-label="Close inspector"]');
      if (closeBtn) closeBtn.click();
      const clearSearchBtn = document.querySelector('button[aria-label="Clear search"]');
      if (clearSearchBtn) clearSearchBtn.click();
      const fitBtn = document.querySelector('button[aria-label="Fit to view"]');
      if (fitBtn) fitBtn.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await captureState(page, `07_large_sample_default_zoom_${res.name}.png`, res.width, res.height);
  }

  await browser.close();
  console.log('\nAll 14 screenshots successfully captured in docs/screenshots/!');
}

main().catch((err) => {
  console.error('Fatal screenshot capture error:', err);
  process.exit(1);
});
