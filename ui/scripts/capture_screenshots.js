import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');

async function main() {
  console.log('Launching Chrome via puppeteer-core...');
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
  });

  const page = await browser.newPage();
  page.on('console', (m) => console.log('PAGE LOG:', m.text()));
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

  // Wait for initial data to load
  await page.waitForFunction(() => !document.body.innerText.includes('Loading run artifacts...'), {
    timeout: 5000,
  });
  await new Promise((r) => setTimeout(r, 400));

  // Screenshot 1: Runs Screen
  console.log('Capturing 01_runs_screen.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '01_runs_screen.png'),
    fullPage: false,
  });

  // Screenshot 2: Failing Test Details
  console.log('Switching to Tests tab...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const testTab = buttons.find((b) => b.textContent && b.textContent.includes('Tests'));
    if (testTab) testTab.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  // Click test_login_expired_token
  await page.evaluate(() => {
    const allDivs = Array.from(document.querySelectorAll('div'));
    const testRow = allDivs.find(
      (el) => el.textContent && el.textContent.includes('test_login_expired_token') && el.textContent.includes('fail')
    );
    if (testRow) testRow.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  // Expand exercised node validate_token to show diff
  const validateBtn = await page.$('[data-testid="exercised-node-validate_token"]');
  if (validateBtn) {
    await validateBtn.click();
    await new Promise((r) => setTimeout(r, 400));
  }

  // Scroll details pane down to reveal the expanded git diff
  await page.evaluate(() => {
    const scrollContainers = Array.from(document.querySelectorAll('div')).filter(
      (el) => el.style && el.style.overflowY === 'auto'
    );
    // Find right pane container
    const rightPane = scrollContainers.find((el) => el.textContent && el.textContent.includes('Failure Message'));
    if (rightPane) {
      rightPane.scrollTop = 500;
    }
  });
  await new Promise((r) => setTimeout(r, 400));

  console.log('Capturing 02_failing_test_details.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '02_failing_test_details.png'),
    fullPage: false,
  });

  // Screenshot 3: Graph View with Test Selected & Node Drawer Open
  console.log('Switching to Graph tab...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const graphTab = buttons.find((b) => b.textContent && b.textContent.includes('Execution Graph'));
    if (graphTab) graphTab.click();
  });
  await new Promise((r) => setTimeout(r, 700));

  // Highlight test_login_expired_token and inspect validate_token symbol
  await page.select(
    'select[aria-label="Highlight Test Trace"]',
    'tests/test_auth.py::test_login_expired_token'
  );
  await new Promise((r) => setTimeout(r, 400));

  await page.select(
    'select[aria-label="Inspect Symbol"]',
    'auth/tokens.py::validate_token'
  );
  await new Promise((r) => setTimeout(r, 700));

  console.log('Capturing 03_graph_test_selected.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '03_graph_test_selected.png'),
    fullPage: false,
  });

  // Screenshot 4: Empty State
  console.log('Switching to empty scan run...');
  await page.select('select[aria-label="Select Run"]', 'run-empty-scan');
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const runTab = buttons.find((b) => b.textContent && b.textContent.includes('Run Overview'));
    if (runTab) runTab.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  console.log('Capturing 04_empty_state.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '04_empty_state.png'),
    fullPage: false,
  });

  // Screenshot 5: Error State
  console.log('Switching to failed harness run...');
  await page.select('select[aria-label="Select Run"]', 'run-failed-harness');
  await new Promise((r) => setTimeout(r, 500));

  console.log('Capturing 05_error_state.png...');
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '05_error_state.png'),
    fullPage: false,
  });

  await browser.close();
  console.log('Finished capturing all screenshots!');
}

main().catch((err) => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});
