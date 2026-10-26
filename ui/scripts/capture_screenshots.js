import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

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

  // Ensure production bundle is freshly built
  console.log('Building latest production bundle...');
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

    // Scenario 1: Opening state — clean Obsidian-style constellation in Structure mode
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

    // Scenario 8: Autonomous Agent Live Storytelling & 6 Investigation Stages
    console.log(`Capturing 6 Investigation Stages for ${res.name}...`);
    // Launch Agent Mode
    await page.evaluate(() => {
      const agentBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent && b.textContent.includes('Agent Auto-Repair')
      );
      if (agentBtn) agentBtn.click();
    });
    await new Promise((r) => setTimeout(r, 700));

    // Pause playback so we can step through each phase cleanly
    await page.evaluate(() => {
      const pauseBtn = document.querySelector('button[aria-label="Pause Investigation"]');
      if (pauseBtn) pauseBtn.click();
    });
    await new Promise((r) => setTimeout(r, 200));

    // Phase 0: Diagnosing
    await page.evaluate(() => {
      const step0Btn = document.querySelector('button[aria-label^="Step 1:"]');
      if (step0Btn) step0Btn.click();
    });
    await new Promise((r) => setTimeout(r, 700));
    await captureState(page, `08_agent_phase0_diagnosing_${res.name}.png`, res.width, res.height);

    // Phase 1: Tracing
    await page.evaluate(() => {
      const step1Btn = document.querySelector('button[aria-label^="Step 2:"]');
      if (step1Btn) step1Btn.click();
    });
    await new Promise((r) => setTimeout(r, 700));
    await captureState(page, `08_agent_phase1_tracing_${res.name}.png`, res.width, res.height);

    // Phase 2: Inspecting (Candidate Defect Site)
    await page.evaluate(() => {
      const step2Btn = document.querySelector('button[aria-label^="Step 3:"]');
      if (step2Btn) step2Btn.click();
    });
    await new Promise((r) => setTimeout(r, 700));
    await captureState(page, `08_agent_phase2_inspecting_${res.name}.png`, res.width, res.height);

    // Expand the "Why this step?" popup to capture full 5-section rationale
    await page.evaluate(() => {
      const whyBtn = document.querySelector('button[aria-label="Why this step?"]');
      if (whyBtn) whyBtn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    await captureState(page, `08_agent_phase2_expanded_explanation_${res.name}.png`, res.width, res.height);

    // Collapse back so subsequent stages are clean
    await page.evaluate(() => {
      const collapseBtn = document.querySelector('button[aria-label="Collapse step explanation"]');
      if (collapseBtn) collapseBtn.click();
    });
    await new Promise((r) => setTimeout(r, 300));

    // Phase 3: Patching (Candidate Patch formulation & live diff viewer)
    await page.evaluate(() => {
      const step3Btn = document.querySelector('button[aria-label^="Step 4:"]');
      if (step3Btn) step3Btn.click();
    });
    await new Promise((r) => setTimeout(r, 700));
    await captureState(page, `08_agent_phase3_patching_${res.name}.png`, res.width, res.height);

    // Phase 4: Verifying (Pytest trial replay)
    await page.evaluate(() => {
      const step4Btn = document.querySelector('button[aria-label^="Step 5:"]');
      if (step4Btn) step4Btn.click();
    });
    await new Promise((r) => setTimeout(r, 700));
    await captureState(page, `08_agent_phase4_verifying_${res.name}.png`, res.width, res.height);

    // Phase 5: Resolved (Emerald confirmation, 0 regressions, full resolution summary)
    await page.evaluate(() => {
      const step5Btn = document.querySelector('button[aria-label^="Step 6:"]');
      if (step5Btn) step5Btn.click();
    });
    await new Promise((r) => setTimeout(r, 700));
    await captureState(page, `08_agent_phase5_resolved_${res.name}.png`, res.width, res.height);

    // Also update 08_agent_live_simulation overview
    await captureState(page, `08_agent_live_simulation_${res.name}.png`, res.width, res.height);
  }

  await browser.close();
  console.log('\nAll scenario and phase screenshots successfully captured in docs/screenshots/!');
}

main().catch((err) => {
  console.error('Fatal screenshot capture error:', err);
  process.exit(1);
});
