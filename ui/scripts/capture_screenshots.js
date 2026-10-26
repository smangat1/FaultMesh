import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');
const DIST_INDEX_PATH = path.resolve(__dirname, '../dist/index.html');

async function main() {
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

  // Wait for initial artifacts to load
  await page.waitForFunction(() => !document.body.innerText.includes('Loading run artifacts...'), {
    timeout: 5000,
  });
  await new Promise((r) => setTimeout(r, 600));

  // 1. Investigation View at 1440x920
  console.log('Capturing 01_investigation_1440x920.png...');
  await page.setViewport({ width: 1440, height: 920, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '01_investigation_1440x920.png'),
    fullPage: false,
  });

  // 2. Evidence Map View at 1440x920 (with validate_token inspected)
  console.log('Switching to Evidence Map...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const mapBtn = buttons.find((b) => b.textContent && b.textContent.includes('Evidence Map'));
    if (mapBtn) mapBtn.click();
  });
  await new Promise((r) => setTimeout(r, 800));

  // Search/select validate_token to open inspector drawer
  const searchInput = await page.$('input[placeholder="Find symbol..."]');
  if (searchInput) {
    await searchInput.type('validate_token');
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log('Capturing 02_evidence_map_1440x920.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '02_evidence_map_1440x920.png'),
    fullPage: false,
  });

  // 3. Minimum Supported Resolution 1024x700: Investigation
  console.log('Switching to 1024x700 viewport...');
  await page.setViewport({ width: 1024, height: 700, deviceScaleFactor: 2 });
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const invBtn = buttons.find((b) => b.textContent && b.textContent.includes('Investigation'));
    if (invBtn) invBtn.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  console.log('Capturing 03_investigation_1024x700.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '03_investigation_1024x700.png'),
    fullPage: false,
  });

  // 4. Minimum Supported Resolution 1024x700: Evidence Map
  console.log('Capturing 04_evidence_map_1024x700.png...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const mapBtn = buttons.find((b) => b.textContent && b.textContent.includes('Evidence Map'));
    if (mapBtn) mapBtn.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '04_evidence_map_1024x700.png'),
    fullPage: false,
  });

  // 5. 1280x800 Viewport: Run Diagnostics
  console.log('Switching to 1280x800 viewport...');
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const diagBtn = buttons.find((b) => b.textContent && b.textContent.includes('Run Diagnostics'));
    if (diagBtn) diagBtn.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  console.log('Capturing 05_run_diagnostics_1280x800.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '05_run_diagnostics_1280x800.png'),
    fullPage: false,
  });

  // 6. Empty Scan State at 1280x800
  console.log('Switching to run-empty-scan...');
  await page.select('select[aria-label="Select Recorded Run"]', 'run-empty-scan');
  await new Promise((r) => setTimeout(r, 600));

  console.log('Capturing 06_empty_scan_1280x800.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '06_empty_scan_1280x800.png'),
    fullPage: false,
  });

  // 7. Collection Phase Failure at 1280x800
  console.log('Switching to run-failed-harness...');
  await page.select('select[aria-label="Select Recorded Run"]', 'run-failed-harness');
  await new Promise((r) => setTimeout(r, 600));

  console.log('Capturing 07_collection_error_1280x800.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '07_collection_error_1280x800.png'),
    fullPage: false,
  });

  await browser.close();
  console.log('Successfully captured all authoritative screenshots in docs/screenshots/!');
}

main().catch((err) => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});
