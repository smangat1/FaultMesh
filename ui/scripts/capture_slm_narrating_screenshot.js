import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(uiDir, '..');
const screenshotPath = path.join(
  repoDir,
  'docs/screenshots/replay-history-ux/phase4-local-narration-running.png'
);
const fixturePath = path.join(uiDir, 'src/fixtures/fixture_replay_timeline_hero.json');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faultmesh-slm-screenshot-'));
const fakeCli = path.join(tempDir, 'faultmesh-synthetic-cli');
const debugPort = 9337;

fs.writeFileSync(fakeCli, `#!/usr/bin/env python3
import json
import os
import shutil
import sys
import time

command = sys.argv[1]
fixture = os.environ["FAULTMESH_SCREENSHOT_FIXTURE"]
if command == "replay-history-list":
    print(json.dumps({
        "roots": [{"tool": "codex", "status": "ok", "file_count": 1, "message": None}],
        "sessions": [{
            "session_id": "synthetic-ui-session",
            "tool": "codex",
            "project_group_key": "synthetic-project",
            "project_display_name": "synthetic-project",
            "started_at": "2026-10-30T12:00:00Z",
            "ended_at": "2026-10-30T12:08:00Z",
            "prompt_count": 3,
            "first_prompt_preview": "Improve the calculation guard",
            "parse_status": "partial",
            "source_title": "Synthetic local narration session"
        }]
    }))
elif command == "replay-history-import":
    target = sys.argv[sys.argv.index("--out") + 1]
    shutil.copyfile(fixture, target)
elif command == "replay-model-status":
    print(json.dumps({
        "ready": True,
        "status": "ready",
        "message": "Local narration is ready.",
        "preset": "medium-3b",
        "model_filename": "synthetic-model.gguf"
    }))
elif command == "replay-narrate-session":
    with open(fixture, encoding="utf-8") as handle:
        export = json.load(handle)
    step = export["narration"][0]
    step["explanation"] = {
        "text": "The agent added a guard and checked the recorded change against the available file evidence.",
        "label": "model interpretation"
    }
    export["chapters"][0]["title"] = "Guard invalid calculations"
    print(json.dumps({
        "event": "progress",
        "done": 3,
        "total": 8,
        "step": step,
        "chapters": export["chapters"]
    }), flush=True)
    time.sleep(45)
else:
    raise SystemExit(2)
`, { mode: 0o700 });

const electron = spawn(
  path.join(uiDir, 'node_modules/.bin/electron'),
  ['electron/main.cjs', `--remote-debugging-port=${debugPort}`],
  {
    cwd: uiDir,
    env: {
      ...process.env,
      FAULTMESH_EXECUTABLE: fakeCli,
      FAULTMESH_SCREENSHOT_FIXTURE: fixturePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let browser;
try {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${debugPort}` });
      break;
    } catch {
      await delay(250);
    }
  }
  if (!browser) throw new Error('Electron debugging endpoint did not start');
  const pages = await browser.pages();
  const page = pages.find((candidate) => candidate.url().includes('index.html'));
  if (!page) throw new Error('FaultMesh renderer page was not found');
  await page.evaluate(() => {
    localStorage.setItem(
      'faultmesh:first_use_tips:seen',
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true })
    );
    localStorage.setItem(
      'faultmesh:replay:project_links:v1',
      JSON.stringify({ dismissedSessionIds: ['synthetic-ui-session'] })
    );
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const fileInput = await page.$('input[aria-label="Open recording file input"]');
  if (!fileInput) throw new Error('Recording input was not found');
  await fileInput.uploadFile(fixturePath);
  await page.waitForSelector('[data-testid="replay-workspace"]');
  await page.evaluate(async () => {
    await window.faultmeshSpectate.startNarration('synthetic-ui-session', 'codex');
  });
  await page.waitForSelector('[data-testid="replay-narration-progress"]');
  await page.click('[data-testid="replay-next-btn"]');
  await page.click('[data-testid="replay-next-btn"]');
  await page.click('[data-testid="replay-toggle-chapters"]');
  await page.waitForSelector('[data-testid="replay-ai-summary"]');
  const state = await page.evaluate(() => ({
    progress: document.querySelector('[data-testid="replay-narration-progress"]')?.textContent,
    summary: document.querySelector('[data-testid="replay-ai-summary"]')?.textContent,
    overlays: document.querySelectorAll(
      '[data-testid="first-use-tip-overlay"], [data-testid="replay-model-setup"], [data-testid="watch-project-prompt"]'
    ).length,
  }));
  if (state.progress !== 'Narrating 3/8' || !state.summary?.includes('AI summary') || state.overlays !== 0) {
    throw new Error(`Unexpected narrating UI state: ${JSON.stringify(state)}`);
  }
  await delay(400);
  await page.screenshot({ path: screenshotPath });
  console.log(JSON.stringify({ screenshot: path.basename(screenshotPath), ...state }));
} finally {
  if (browser) await browser.disconnect();
  electron.kill('SIGTERM');
  fs.rmSync(tempDir, { recursive: true, force: true });
}
