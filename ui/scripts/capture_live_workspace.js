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
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, filename),
    fullPage: false,
  });
}

async function run() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log('Ensuring fresh production build...');
  execSync('npm run build --prefix ' + path.resolve(__dirname, '..'), { stdio: 'inherit' });

  const resolutions = [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1024x768', width: 1024, height: 768 },
  ];

  for (const res of resolutions) {
    console.log(`\n=== Running Live Workspace Capture for ${res.name} ===`);
    const browser = await puppeteer.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: res.width, height: res.height, deviceScaleFactor: 2 });

    // Inject mock Electron spectate bridge
    await page.evaluateOnNewDocument(() => {
      const listeners = new Set();
      const emitAll = (record) => {
        listeners.forEach((listener) => {
          try {
            listener(record);
          } catch (e) {
            console.error('listener error', e);
          }
        });
      };

      window.faultmeshSpectate = {
        chooseProjectFolder: async () => ({ handle: '/path/to/vscode_playground', displayName: 'vscode_playground' }),
        startWatch: async () => {
          setTimeout(() => {
            emitAll({
              schema_version: 'spectate-1.1',
              session_id: 'live-sess-1',
              sequence: 1,
              emitted_at: new Date().toISOString(),
              event: 'session_started',
              root_display_name: 'vscode_playground',
            });
            emitAll({
              schema_version: 'spectate-1.1',
              session_id: 'live-sess-1',
              sequence: 2,
              emitted_at: new Date().toISOString(),
              event: 'initial_snapshot',
              files: [
                { id: 'file:src/playground/config.py', path: 'src/playground/config.py', module: 'config', content_sha256: 'c1', line_count: 42, is_test: false, is_test_heuristic: false, parse_error: null, removed: false, revision_side: 'head' },
                { id: 'file:src/playground/pricing.py', path: 'src/playground/pricing.py', module: 'pricing', content_sha256: 'p1', line_count: 120, is_test: false, is_test_heuristic: false, parse_error: null, removed: false, revision_side: 'head' },
                { id: 'file:src/playground/formatting.py', path: 'src/playground/formatting.py', module: 'formatting', content_sha256: 'f1', line_count: 65, is_test: false, is_test_heuristic: false, parse_error: null, removed: false, revision_side: 'head' },
                { id: 'file:src/playground/invoice.py', path: 'src/playground/invoice.py', module: 'invoice', content_sha256: 'i1', line_count: 90, is_test: false, is_test_heuristic: false, parse_error: null, removed: false, revision_side: 'head' },
                { id: 'file:tests/test_pricing.py', path: 'tests/test_pricing.py', module: 'test_pricing', content_sha256: 't1', line_count: 55, is_test: true, is_test_heuristic: true, parse_error: null, removed: false, revision_side: 'head' },
              ],
              structure: {
                files: [
                  { id: 'file:src/playground/config.py', path: 'src/playground/config.py', module: 'config', content_sha256: 'c1', line_count: 42, is_test: false, is_test_heuristic: false, parse_error: null, removed: false, revision_side: 'head' },
                  { id: 'file:src/playground/pricing.py', path: 'src/playground/pricing.py', module: 'pricing', content_sha256: 'p1', line_count: 120, is_test: false, is_test_heuristic: false, parse_error: null, removed: false, revision_side: 'head' },
                  { id: 'file:src/playground/formatting.py', path: 'src/playground/formatting.py', module: 'formatting', content_sha256: 'f1', line_count: 65, is_test: false, is_test_heuristic: false, parse_error: null, removed: false, revision_side: 'head' },
                  { id: 'file:src/playground/invoice.py', path: 'src/playground/invoice.py', module: 'invoice', content_sha256: 'i1', line_count: 90, is_test: false, is_test_heuristic: false, parse_error: null, removed: false, revision_side: 'head' },
                  { id: 'file:tests/test_pricing.py', path: 'tests/test_pricing.py', module: 'test_pricing', content_sha256: 't1', line_count: 55, is_test: true, is_test_heuristic: true, parse_error: null, removed: false, revision_side: 'head' },
                ],
                symbols: [
                  { id: 'symbol:src/playground/config.py:load_config', path: 'src/playground/config.py', qualified_name: 'load_config', name: 'load_config', kind: 'function', disambiguator: 1, parent_id: 'file:src/playground/config.py', start_line: 5, end_line: 20, content_sha256: 's1', signature: '(env=None)', parameter_names: ['env'], decorators: [], docstring: { text: 'Load application configuration settings.', source: 'docstring' }, bases: [], removed: false, revision_side: 'head' },
                  { id: 'symbol:src/playground/pricing.py:calculate_total', path: 'src/playground/pricing.py', qualified_name: 'calculate_total', name: 'calculate_total', kind: 'function', disambiguator: 1, parent_id: 'file:src/playground/pricing.py', start_line: 12, end_line: 45, content_sha256: 's2', signature: '(items, discount=0.0)', parameter_names: ['items', 'discount'], decorators: [], docstring: { text: 'Calculate the gross and net order pricing with applied discounts.', source: 'docstring' }, bases: [], removed: false, revision_side: 'head' },
                  { id: 'symbol:src/playground/pricing.py:apply_tax', path: 'src/playground/pricing.py', qualified_name: 'apply_tax', name: 'apply_tax', kind: 'function', disambiguator: 1, parent_id: 'file:src/playground/pricing.py', start_line: 48, end_line: 70, content_sha256: 's3', signature: '(subtotal, rate=0.08)', parameter_names: ['subtotal', 'rate'], decorators: [], docstring: { text: 'Apply regional VAT / sales tax calculation.', source: 'docstring' }, bases: [], removed: false, revision_side: 'head' },
                  { id: 'symbol:src/playground/formatting.py:format_currency', path: 'src/playground/formatting.py', qualified_name: 'format_currency', name: 'format_currency', kind: 'function', disambiguator: 1, parent_id: 'file:src/playground/formatting.py', start_line: 8, end_line: 25, content_sha256: 's4', signature: '(amount, symbol="$")', parameter_names: ['amount', 'symbol'], decorators: [], docstring: { text: 'Format numeric currency output.', source: 'docstring' }, bases: [], removed: false, revision_side: 'head' },
                  { id: 'symbol:src/playground/invoice.py:generate_invoice', path: 'src/playground/invoice.py', qualified_name: 'generate_invoice', name: 'generate_invoice', kind: 'function', disambiguator: 1, parent_id: 'file:src/playground/invoice.py', start_line: 15, end_line: 60, content_sha256: 's5', signature: '(order_id, recipient)', parameter_names: ['order_id', 'recipient'], decorators: [], docstring: { text: 'Compile and render invoice artifact.', source: 'docstring' }, bases: [], removed: false, revision_side: 'head' },
                ],
                skips: [],
              },
            });
            emitAll({
              schema_version: 'spectate-1.1',
              session_id: 'live-sess-1',
              sequence: 3,
              emitted_at: new Date().toISOString(),
              event: 'relationship_update',
              edges: [
                { id: 'edge:inv-calc', layer: 'static', kind: 'possible_call', source_id: 'symbol:src/playground/invoice.py:generate_invoice', target_id: 'symbol:src/playground/pricing.py:calculate_total', callsite_path: 'src/playground/invoice.py', callsite_line: 25, resolution_reason: 'import_binding', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
                { id: 'edge:calc-tax', layer: 'static', kind: 'possible_call', source_id: 'symbol:src/playground/pricing.py:calculate_total', target_id: 'symbol:src/playground/pricing.py:apply_tax', callsite_path: 'src/playground/pricing.py', callsite_line: 35, resolution_reason: 'local_scope', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
                { id: 'edge:inv-fmt', layer: 'static', kind: 'possible_call', source_id: 'symbol:src/playground/invoice.py:generate_invoice', target_id: 'symbol:src/playground/formatting.py:format_currency', callsite_path: 'src/playground/invoice.py', callsite_line: 45, resolution_reason: 'import_binding', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
              ],
              unresolved: [],
              external_modules: [],
              stale_paths: [],
              complete: true,
              partial_reasons: [],
            });
          }, 30);
          return { watching: true, displayName: 'vscode_playground' };
        },
        stopWatch: async () => ({ watching: false }),
        onSpectateEvent: (cb) => {
          listeners.add(cb);
          return () => {
            listeners.delete(cb);
          };
        },
      };

      window.__emit = (record) => emitAll(record);
    });

    const fileUrl = `file://${DIST_INDEX_PATH}`;
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });

    // Step 1: Click "Select project"
    await page.waitForSelector('button.btn-primary');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('Select project'));
      if (btn) btn.click();
    });

    // Wait for transition into live workspace Map view
    await page.waitForFunction(() => document.body.innerText.includes('LIVE: vscode_playground'), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 800));

    // Scenario 1: Map view after fresh snapshot (fitted and readable)
    await captureState(page, `01_live_workspace_map_${res.name}.png`, res.width, res.height);

    // Scenario 2: Emit a saved file change to show quiet toast over map
    await page.evaluate(() => {
      if (window.__emit) {
        window.__emit({
          schema_version: 'spectate-1.1',
          session_id: 'live-sess-1',
          sequence: 4,
          emitted_at: new Date().toISOString(),
          event: 'file_changed',
          path: 'src/playground/pricing.py',
          kind: 'modified',
          new_sha256: 'p2',
          changed_line_ranges: [{ start_line: 12, end_line: 25 }],
          affected_file_ids: ['file:src/playground/pricing.py'],
          affected_symbol_ids: ['symbol:src/playground/pricing.py:calculate_total'],
        });
      }
    });
    await new Promise((r) => setTimeout(r, 400));
    await captureState(page, `04_live_workspace_toast_${res.name}.png`, res.width, res.height);

    // Provide diff & source for the changed file
    await page.evaluate(() => {
      if (window.__emit) {
        window.__emit({
          schema_version: 'spectate-1.1',
          session_id: 'live-sess-1',
          sequence: 5,
          emitted_at: new Date().toISOString(),
          event: 'diff',
          path: 'src/playground/pricing.py',
          text: '@@ -12,2 +12,3 @@\n-def calculate_total(items, discount=0.0):\n+def calculate_total(items, discount=0.0, loyalty_points=0):\n+    """Calculate gross and net order pricing with loyalty redemption."""\n     subtotal = sum(i["price"] for i in items)',
        });
        window.__emit({
          schema_version: 'spectate-1.1',
          session_id: 'live-sess-1',
          sequence: 6,
          emitted_at: new Date().toISOString(),
          event: 'source',
          path: 'src/playground/pricing.py',
          text: 'def calculate_total(items, discount=0.0, loyalty_points=0):\n    """Calculate gross and net order pricing with loyalty redemption."""\n    subtotal = sum(i["price"] for i in items)\n    return subtotal * (1 - discount)\n\ndef apply_tax(subtotal, rate=0.08):\n    """Apply regional VAT / sales tax calculation."""\n    return subtotal * (1 + rate)',
        });
      }
    });
    await new Promise((r) => setTimeout(r, 400));

    // Scenario 3: Unfold drawer over the map (Diff / Source drawer)
    await page.evaluate(() => {
      const diffDrawerBtn = document.querySelector('button[aria-label="Toggle Diff drawer"]');
      if (diffDrawerBtn) diffDrawerBtn.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `05_live_workspace_drawer_${res.name}.png`, res.width, res.height);

    // Close drawer
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[aria-label="Collapse drawer"]');
      if (closeBtn) closeBtn.click();
    });
    await new Promise((r) => setTimeout(r, 300));

    // Scenario 4: Switch to Files view with recency coloring
    await page.evaluate(() => {
      const filesViewBtn = document.querySelector('button[aria-label="Files view"]');
      if (filesViewBtn) filesViewBtn.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `02_live_workspace_files_${res.name}.png`, res.width, res.height);

    // Scenario 5: Switch to Changes view
    await page.evaluate(() => {
      const changesViewBtn = document.querySelector('button[aria-label="Changes view"]');
      if (changesViewBtn) changesViewBtn.click();
    });
    await new Promise((r) => setTimeout(r, 600));
    await captureState(page, `03_live_workspace_changes_${res.name}.png`, res.width, res.height);

    await browser.close();
  }

  console.log('\nAll live workspace screenshots successfully captured!');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
