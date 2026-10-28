import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../docs/screenshots');
const DIST_INDEX_PATH = path.resolve(__dirname, '../dist/index.html');

const layoutAData = {
  sessionId: 'live-layout-a',
  displayName: 'layout_a',
  files: [
    { id: 'file:a.py', path: 'a.py', content_sha256: 'sha-a', line_count: 5, parse_ok: true, parse_error: null },
    { id: 'file:b.py', path: 'b.py', content_sha256: 'sha-b', line_count: 8, parse_ok: true, parse_error: null },
    { id: 'file:sub/c.py', path: 'sub/c.py', content_sha256: 'sha-c', line_count: 14, parse_ok: true, parse_error: null },
    { id: 'file:sub/d.py', path: 'sub/d.py', content_sha256: 'sha-d', line_count: 6, parse_ok: true, parse_error: null },
  ],
  structure: {
    files: [
      { id: 'file:a.py', path: 'a.py', module: 'a', content_sha256: 'sha-a', line_count: 5, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
      { id: 'file:b.py', path: 'b.py', module: 'b', content_sha256: 'sha-b', line_count: 8, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
      { id: 'file:sub/c.py', path: 'sub/c.py', module: 'sub.c', content_sha256: 'sha-c', line_count: 14, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
      { id: 'file:sub/d.py', path: 'sub/d.py', module: 'sub.d', content_sha256: 'sha-d', line_count: 6, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
    ],
    symbols: [
      { id: 'symbol:a.py:a_func', path: 'a.py', qualified_name: 'a_func', name: 'a_func', kind: 'function', disambiguator: 1, parent_id: 'file:a.py', start_line: 1, end_line: 5, content_sha256: 'sa', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
      { id: 'symbol:b.py:b_func', path: 'b.py', qualified_name: 'b_func', name: 'b_func', kind: 'function', disambiguator: 1, parent_id: 'file:b.py', start_line: 1, end_line: 8, content_sha256: 'sb', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
      { id: 'symbol:sub/c.py:c_func', path: 'sub/c.py', qualified_name: 'c_func', name: 'c_func', kind: 'function', disambiguator: 1, parent_id: 'file:sub/c.py', start_line: 1, end_line: 14, content_sha256: 'sc', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
      { id: 'symbol:sub/d.py:d_func', path: 'sub/d.py', qualified_name: 'd_func', name: 'd_func', kind: 'function', disambiguator: 1, parent_id: 'file:sub/d.py', start_line: 1, end_line: 6, content_sha256: 'sd', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
    ],
    skips: [],
  },
  edges: [
    { id: 'edge:b-call-a', layer: 'static', kind: 'possible_call', source_id: 'symbol:b.py:b_func', target_id: 'symbol:a.py:a_func', callsite_path: 'b.py', callsite_line: 2, resolution_reason: 'import_binding', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
    { id: 'edge:c-call-d', layer: 'static', kind: 'possible_call', source_id: 'symbol:sub/c.py:c_func', target_id: 'symbol:sub/d.py:d_func', callsite_path: 'sub/c.py', callsite_line: 2, resolution_reason: 'import_binding', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
    { id: 'edge:c-call-a-cross', layer: 'static', kind: 'possible_call', source_id: 'symbol:sub/c.py:c_func', target_id: 'symbol:a.py:a_func', callsite_path: 'sub/c.py', callsite_line: 3, resolution_reason: 'cross_folder_call', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
  ],
  changePath: 'sub/c.py',
  diff: '--- sub/c.py\n+++ sub/c.py\n@@ -1,3 +1,4 @@\n from sub.d import d_func\n+from a import a_func\n def c_func():\n-    return d_func()\n+    return d_func() + a_func()\n',
};

const layoutBData = {
  sessionId: 'live-layout-b',
  displayName: 'layout_b',
  files: [
    { id: 'file:outer/a.py', path: 'outer/a.py', content_sha256: 'sha-oa', line_count: 10, parse_ok: true, parse_error: null },
    { id: 'file:outer/inner/b.py', path: 'outer/inner/b.py', content_sha256: 'sha-oib', line_count: 18, parse_ok: true, parse_error: null },
    { id: 'file:outer/inner/deep/c.py', path: 'outer/inner/deep/c.py', content_sha256: 'sha-oidc', line_count: 24, parse_ok: true, parse_error: null },
  ],
  structure: {
    files: [
      { id: 'file:outer/a.py', path: 'outer/a.py', module: 'outer.a', content_sha256: 'sha-oa', line_count: 10, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
      { id: 'file:outer/inner/b.py', path: 'outer/inner/b.py', module: 'outer.inner.b', content_sha256: 'sha-oib', line_count: 18, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
      { id: 'file:outer/inner/deep/c.py', path: 'outer/inner/deep/c.py', module: 'outer.inner.deep.c', content_sha256: 'sha-oidc', line_count: 24, is_test: false, parse_error: null, removed: false, revision_side: 'head' },
    ],
    symbols: [
      { id: 'symbol:outer/a.py:outer_a', path: 'outer/a.py', qualified_name: 'outer_a', name: 'outer_a', kind: 'function', disambiguator: 1, parent_id: 'file:outer/a.py', start_line: 1, end_line: 10, content_sha256: 'soa', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
      { id: 'symbol:outer/inner/b.py:inner_b', path: 'outer/inner/b.py', qualified_name: 'inner_b', name: 'inner_b', kind: 'function', disambiguator: 1, parent_id: 'file:outer/inner/b.py', start_line: 1, end_line: 18, content_sha256: 'soib', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
      { id: 'symbol:outer/inner/deep/c.py:deep_c', path: 'outer/inner/deep/c.py', qualified_name: 'deep_c', name: 'deep_c', kind: 'function', disambiguator: 1, parent_id: 'file:outer/inner/deep/c.py', start_line: 1, end_line: 24, content_sha256: 'soidc', signature: '()', parameter_names: [], decorators: [], docstring: null, bases: [], removed: false, revision_side: 'head' },
    ],
    skips: [],
  },
  edges: [
    { id: 'edge:b-call-a', layer: 'static', kind: 'possible_call', source_id: 'symbol:outer/inner/b.py:inner_b', target_id: 'symbol:outer/a.py:outer_a', callsite_path: 'outer/inner/b.py', callsite_line: 5, resolution_reason: 'import_binding', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
    { id: 'edge:c-call-b', layer: 'static', kind: 'possible_call', source_id: 'symbol:outer/inner/deep/c.py:deep_c', target_id: 'symbol:outer/inner/b.py:inner_b', callsite_path: 'outer/inner/deep/c.py', callsite_line: 5, resolution_reason: 'import_binding', confidence: 'resolved', external_module: null, removed: false, revision_side: 'head' },
  ],
  changePath: 'outer/inner/deep/c.py',
  diff: '--- outer/inner/deep/c.py\n+++ outer/inner/deep/c.py\n@@ -1,3 +1,4 @@\n def deep_c():\n-    return 30\n+    return 42\n',
};

async function main() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log('Building latest production bundle...');
  execSync('npm run build --prefix ' + path.resolve(__dirname, '..'), { stdio: 'inherit' });

  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
  });

  const resolutions = [
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1024x768', width: 1024, height: 768 },
  ];

  const scenarios = [
    { name: 'layout_a', data: layoutAData },
    { name: 'layout_b', data: layoutBData },
  ];

  for (const scenario of scenarios) {
    for (const res of resolutions) {
      console.log(`\n=== Capturing ${scenario.name} at ${res.name} ===`);
      const page = await browser.newPage();
      await page.setViewport({ width: res.width, height: res.height, deviceScaleFactor: 2 });

      // Inject spectate bridge
      await page.evaluateOnNewDocument((payload) => {
        let callback = null;
        window.faultmeshSpectate = {
          chooseProjectFolder: async () => ({ handle: payload.displayName, displayName: payload.displayName }),
          startWatch: async () => {
            setTimeout(() => {
              if (callback) {
                callback({
                  schema_version: 'spectate-1.1',
                  session_id: payload.sessionId,
                  sequence: 1,
                  emitted_at: new Date().toISOString(),
                  event: 'session_started',
                  root_display_name: payload.displayName,
                });
                callback({
                  schema_version: 'spectate-1.1',
                  session_id: payload.sessionId,
                  sequence: 2,
                  emitted_at: new Date().toISOString(),
                  event: 'initial_snapshot',
                  files: payload.files,
                  structure: payload.structure,
                });
                callback({
                  schema_version: 'spectate-1.1',
                  session_id: payload.sessionId,
                  sequence: 3,
                  emitted_at: new Date().toISOString(),
                  event: 'relationship_update',
                  edges: payload.edges,
                  unresolved: [],
                  external_modules: [],
                  stale_paths: [],
                  complete: true,
                  partial_reasons: [],
                });
                // Emit an observed change on disk
                callback({
                  schema_version: 'spectate-1.1',
                  session_id: payload.sessionId,
                  sequence: 4,
                  emitted_at: new Date().toISOString(),
                  event: 'file_changed',
                  path: payload.changePath,
                  kind: 'modified',
                  new_sha256: 'sha-mod',
                  affected_file_ids: [`file:${payload.changePath}`],
                });
                callback({
                  schema_version: 'spectate-1.1',
                  session_id: payload.sessionId,
                  sequence: 5,
                  emitted_at: new Date().toISOString(),
                  event: 'diff',
                  path: payload.changePath,
                  text: payload.diff,
                });
              }
            }, 50);
            return { watching: true, displayName: payload.displayName };
          },
          stopWatch: async () => ({ watching: false }),
          onSpectateEvent: (cb) => {
            callback = cb;
            return () => { callback = null; };
          },
          emitEvent: (evt) => {
            if (callback) callback(evt);
          },
        };
      }, scenario.data);

      const fileUrl = `file://${DIST_INDEX_PATH}`;
      await page.goto(fileUrl, { waitUntil: 'networkidle0' });
      await new Promise((r) => setTimeout(r, 400));

      // Click "Select project" on startup screen
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(
          (b) => b.textContent && b.textContent.includes('Select project')
        );
        if (btn) btn.click();
      });

      // Wait for entrance screen
      await page.waitForFunction(() => {
        return document.querySelector('[data-testid="entrance-card-map"]') !== null ||
               document.querySelector('header') !== null;
      }, { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 400));

      // Click Map card to enter workspace mode
      await page.evaluate(() => {
        const mapCard = document.querySelector('[data-testid="entrance-card-map"]');
        if (mapCard) mapCard.click();
      });

      // Wait for workspace header and map container
      await page.waitForFunction(() => document.querySelector('header') !== null, { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 600));

      // Trigger a fresh file_changed event so the toast is visibly active at the bottom
      await page.evaluate((payload) => {
        if (window.faultmeshSpectate && window.faultmeshSpectate.emitEvent) {
          window.faultmeshSpectate.emitEvent({
            schema_version: 'spectate-1.1',
            session_id: payload.sessionId,
            sequence: 100,
            emitted_at: new Date().toISOString(),
            event: 'file_changed',
            path: payload.changePath,
            kind: 'modified',
            new_sha256: 'sha-mod-live',
            affected_file_ids: [`file:${payload.changePath}`],
          });
        }
      }, scenario.data);
      await new Promise((r) => setTimeout(r, 200));

      // 1. Map View (with toast visible at bottom)
      console.log(`Saving ${scenario.name}_map_${res.name}.png...`);
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, `${scenario.name}_map_${res.name}.png`),
        fullPage: false,
      });

      if (scenario.name === 'layout_a') {
        console.log(`Saving change_toast_bottom_${res.name}.png...`);
        await page.screenshot({
          path: path.join(SCREENSHOTS_DIR, `change_toast_bottom_${res.name}.png`),
          fullPage: false,
        });
      }

      // 2. Switch to Files View
      await page.evaluate(() => {
        const filesBtn = document.querySelector('button[aria-label="Files view"]') ||
          Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('Files'));
        if (filesBtn) filesBtn.click();
      });
      await new Promise((r) => setTimeout(r, 400));

      console.log(`Saving ${scenario.name}_files_${res.name}.png...`);
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, `${scenario.name}_files_${res.name}.png`),
        fullPage: false,
      });

      // 3. Switch to Changes View
      await page.evaluate(() => {
        const changesBtn = document.querySelector('button[aria-label="Changes view"]') ||
          Array.from(document.querySelectorAll('button')).find((b) => b.textContent && b.textContent.includes('Changes'));
        if (changesBtn) changesBtn.click();
      });
      await new Promise((r) => setTimeout(r, 400));

      console.log(`Saving ${scenario.name}_changes_${res.name}.png...`);
      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, `${scenario.name}_changes_${res.name}.png`),
        fullPage: false,
      });

      await page.close();
    }
  }

  await browser.close();
  console.log('All screenshots captured successfully in', SCREENSHOTS_DIR);
}

main().catch((err) => {
  console.error('Capture failed:', err);
  process.exit(1);
});
