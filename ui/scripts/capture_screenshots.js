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
    console.log(`\n=== Capturing Visual Scenarios for ${res.name} ===`);
    await page.setViewport({ width: res.width, height: res.height, deviceScaleFactor: 2 });
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 600));

    // Scenario 0: Selector Page — Clean FaultMesh title, instructions, project/run selector
    await captureState(page, `00_project_selector_${res.name}.png`, res.width, res.height);

    // Enter Workspace Map
    await page.evaluate(() => {
      const openBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent && b.textContent.includes('Open Project Map')
      );
      if (openBtn) openBtn.click();
    });
    await new Promise((r) => setTimeout(r, 600));

    // Scenario 1: Opening state — clean Obsidian-style constellation in Structure mode (no FM logo in header)
    await page.evaluate(() => {
      const fitBtn = document.querySelector('button[aria-label="Fit to view"]');
      if (fitBtn) fitBtn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    await captureState(page, `01_opening_zoomed_out_${res.name}.png`, res.width, res.height);

    // Scenario 2: Zoomed into tokens.py — expand tokens cluster into functions while other files remain collapsed
    await page.evaluate(() => {
      const expandBtn = document.querySelector('button[aria-label*="Expand tokens.py"]');
      if (expandBtn) expandBtn.click();
      const zoomInBtn = document.querySelector('button[aria-label="Zoom in"]');
      if (zoomInBtn) {
        zoomInBtn.click();
        zoomInBtn.click();
      }
    });
    await new Promise((r) => setTimeout(r, 500));
    await captureState(page, `02_cluster_zoomed_in_${res.name}.png`, res.width, res.height);

    // Scenario 3: Failing test selected — highlight inside full map, step badges [1] -> [2] -> [3], rest dimmed
    await page.evaluate(() => {
      const fitBtn = document.querySelector('button[aria-label="Fit to view"]');
      if (fitBtn) fitBtn.click();

      // Click failing test in sidebar
      const testBtns = Array.from(document.querySelectorAll('button[aria-label*="Test test_login_expired_token"]'));
      if (testBtns.length > 0) testBtns[0].click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await captureState(page, `03_failing_test_highlight_${res.name}.png`, res.width, res.height);

    // Scenario 4: Function inspector — validate_token selected with inspector open (diff, source, traceback)
    const searchInputForInspect = await page.$('input[placeholder*="Filter tests by name or file"]');
    if (searchInputForInspect) {
      await searchInputForInspect.focus();
      await searchInputForInspect.type('validate_token');
      await new Promise((r) => setTimeout(r, 300));
      await page.keyboard.press('Enter');
      await new Promise((r) => setTimeout(r, 600));
    }
    await captureState(page, `04_function_inspector_${res.name}.png`, res.width, res.height);

    // Scenario 5: Changes mode overlay — modified and added files/functions highlighted
    await page.evaluate(() => {
      const changesBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent && b.textContent.trim().toLowerCase() === 'changes'
      );
      if (changesBtn) changesBtn.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await captureState(page, `05_pinned_shortlist_${res.name}.png`, res.width, res.height);

    // Scenario 6: Search result jump — typing in sidebar search to navigate
    const sidebarSearchInput = await page.$('input[placeholder*="Filter tests by name or file"]');
    if (sidebarSearchInput) {
      await sidebarSearchInput.focus();
      await sidebarSearchInput.type('tokens');
      await new Promise((r) => setTimeout(r, 400));
    }
    await captureState(page, `06_search_jump_${res.name}.png`, res.width, res.height);

    // Scenario 7: Full repository at default overview with closed panels
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[aria-label="Close inspector"]');
      if (closeBtn) closeBtn.click();
      const clearSearchBtn = document.querySelector('button[aria-label="Clear search"]');
      if (clearSearchBtn) clearSearchBtn.click();
      const structureBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent && b.textContent.trim().toLowerCase() === 'structure'
      );
      if (structureBtn) structureBtn.click();
      const fitBtn = document.querySelector('button[aria-label="Fit to view"]');
      if (fitBtn) fitBtn.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    await captureState(page, `07_large_sample_default_zoom_${res.name}.png`, res.width, res.height);

    // Scenario 8: Agent Live Auto-Repair Simulation — Autonomous live code patching, radar beacon, and thought stream
    await page.evaluate(() => {
      const agentBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent && b.textContent.includes('Agent Auto-Repair')
      );
      if (agentBtn) agentBtn.click();
    });
    await new Promise((r) => setTimeout(r, 400));

    // Pause playback so we can position precisely at patch phase
    await page.evaluate(() => {
      const pauseBtn = document.querySelector('button[aria-label="Pause"]');
      if (pauseBtn) pauseBtn.click();
    });
    await new Promise((r) => setTimeout(r, 200));

    // Step forward 3 times to reach Step 4 (Live Patching of validate_token)
    for (let s = 0; s < 3; s++) {
      await page.evaluate(() => {
        const stepBtn = document.querySelector('button[aria-label="Step Forward"]');
        if (stepBtn) stepBtn.click();
      });
      await new Promise((r) => setTimeout(r, 250));
    }

    // Open thought streamer drawer
    await page.evaluate(() => {
      const thoughtBtn = document.querySelector('button[aria-label="Toggle Agent Thought Stream"]');
      if (thoughtBtn) thoughtBtn.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `08_agent_live_simulation_${res.name}.png`, res.width, res.height);
  }

  await browser.close();
  console.log('\nAll screenshots successfully captured in docs/screenshots/!');
}

main().catch((err) => {
  console.error('Fatal screenshot capture error:', err);
  process.exit(1);
});
