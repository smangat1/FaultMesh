import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.resolve(scriptDir, '..');
const repoDir = path.resolve(uiDir, '..');
const screenshotsDir = path.join(repoDir, 'docs/screenshots/replay-history-ux');
const fixturePath = path.join(uiDir, 'src/fixtures/fixture_replay_timeline_hero.json');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faultmesh-chapter-first-'));
const fakeCli = path.join(tempDir, 'faultmesh-synthetic-cli');
const debugPort = 9341;

fs.mkdirSync(screenshotsDir, { recursive: true });
fs.writeFileSync(fakeCli, `#!/usr/bin/env python3
import json
import os
import shutil
import sys
import time

command = sys.argv[1]
fixture = os.environ["FAULTMESH_SCREENSHOT_FIXTURE"]

def baseline_export():
    with open(fixture, encoding="utf-8") as handle:
        export = json.load(handle)
    export["chapters"] = export["baseline_chapters"]
    export["chapter_run"]["chapters"] = export["chapters"]
    export["chapter_run"]["fallback_used"] = True
    export["narration"] = []
    export["summary"] = {
        "sentences": [
            "This session contains seven recorded steps.",
            "The replay groups those steps into two chapters.",
            "Recorded evidence identifies changed files.",
            "Structured test evidence is shown separately."
        ],
        "source": "deterministic_facts",
        "fallback_used": True
    }
    return export

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
            "source_title": "Synthetic chapter-first session"
        }]
    }))
elif command == "replay-history-import":
    target = sys.argv[sys.argv.index("--out") + 1]
    with open(target, "w", encoding="utf-8") as handle:
        json.dump(baseline_export(), handle)
elif command == "replay-model-status":
    print(json.dumps({
        "ready": True,
        "status": "ready",
        "message": "Local narration is ready.",
        "preset": "medium-3b",
        "model_filename": "synthetic-model.gguf"
    }))
elif command == "replay-narrate-session":
    export = baseline_export()
    print(json.dumps({"event": "baseline", "export": export}), flush=True)
    time.sleep(2)
    chapter = dict(export["chapters"][-1])
    chapter["title"] = "Validate the recorded calculation changes"
    chapter["source"] = "model"
    chapter["title_status"] = "model interpretation"
    export["chapters"][-1] = chapter
    export["chapter_run"]["chapters"] = export["chapters"]
    export["chapter_run"]["fallback_used"] = False
    print(json.dumps({
        "event": "chapter",
        "done": 1,
        "total": len(export["chapters"]),
        "chapter": chapter,
        "chapter_run": export["chapter_run"]
    }), flush=True)
    time.sleep(45)
elif command == "replay-explain-step":
    sequence = int(sys.argv[3])
    with open(fixture, encoding="utf-8") as handle:
        source = json.load(handle)
    step = dict(source["narration"][0])
    step["sequence"] = sequence
    step["packet"]["sequence"] = sequence
    step["explanation"] = {
        "text": "The recorded step changed a file and the checked claims reflect the available evidence.",
        "label": "model interpretation",
        "fallback_used": False,
        "error": None
    }
    print(json.dumps({"event": "result", "step": step}))
elif command == "replay-summarize-selection":
    start = int(sys.argv[3])
    end = int(sys.argv[4])
    print(json.dumps({"event": "result", "summary": {
        "schema_version": "replay-selection-summary-1.0",
        "start_sequence": start,
        "end_sequence": end,
        "total_steps": end - start + 1,
        "non_trivial_steps": 2,
        "checked_claim_steps": 2,
        "text": "Summarized 2 of 3 steps with checked claims. The selection records a file change and its verification evidence.",
        "source": "model",
        "fallback_used": False,
        "error": None
    }}))
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
const shots = [];
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
  let page;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const pages = await browser.pages();
    page = pages.find((candidate) => candidate.url().includes('index.html'));
    if (page) break;
    await delay(100);
  }
  if (!page) throw new Error('FaultMesh renderer page was not found');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(() => {
    localStorage.setItem(
      'faultmesh:first_use_tips:seen',
      JSON.stringify({ home: true, entrance: true, replay: true, replayHistory: true })
    );
    localStorage.setItem(
      'faultmesh:replay:project_links:v1',
      JSON.stringify({
        homePromptDismissed: true,
        dismissedSessionIds: ['synthetic-ui-session'],
      })
    );
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="tool-widget-codex"]');
  await page.click('[data-testid="tool-widget-codex"]');
  await delay(400);
  if (!await page.$('[data-testid="session-row-synthetic-ui-session"]')) {
    await page.waitForSelector('[data-testid^="folder-toggle-codex:"]');
    await page.click('[data-testid^="folder-toggle-codex:"]');
  }
  await page.waitForSelector('[data-testid="session-row-synthetic-ui-session"]');
  await page.click('[data-testid="session-row-synthetic-ui-session"]');
  await page.waitForSelector('[data-testid="replay-workspace"]');
  await page.click('[data-testid="replay-toggle-chapters"]');
  await page.waitForSelector('[data-testid="replay-chapters-list"]');

  const baselinePath = path.join(screenshotsDir, 'chapter-first-baseline-open.png');
  await page.screenshot({ path: baselinePath });
  shots.push(baselinePath);

  await page.waitForFunction(() => (
    document.querySelector('[data-testid="replay-narration-progress"]')?.textContent?.includes('1/')
  ), { timeout: 10000 });
  const progressPath = path.join(screenshotsDir, 'chapter-first-titling-progress.png');
  await page.screenshot({ path: progressPath });
  shots.push(progressPath);

  await page.click('[data-testid="replay-checkpoint-row-1"]');
  await page.evaluate(() => {
    const row = document.querySelector('[data-testid="replay-checkpoint-row-3"]');
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  });
  await page.click('[data-testid="replay-summarize-selection"]');
  await page.waitForSelector('[data-testid="replay-selection-checked-counts"]');
  const selectionPath = path.join(screenshotsDir, 'chapter-first-selection-summary.png');
  await page.screenshot({ path: selectionPath });
  shots.push(selectionPath);
  const selectionText = await page.$eval(
    '[data-testid="replay-selection-checked-counts"]',
    (node) => node.textContent
  );

  await page.click('[data-testid="replay-checkpoint-row-3"]');
  await page.waitForSelector('[data-testid="replay-ai-summary"]');
  const explanationPath = path.join(screenshotsDir, 'chapter-first-step-explanation.png');
  await page.screenshot({ path: explanationPath });
  shots.push(explanationPath);

  const state = await page.evaluate(() => ({
    progress: document.querySelector('[data-testid="replay-narration-progress"]')?.textContent,
    explanation: document.querySelector('[data-testid="replay-ai-summary"]')?.textContent,
    overlays: document.querySelectorAll(
      '[data-testid="first-use-tip-overlay"], [data-testid="replay-model-setup"], [data-testid="watch-project-prompt"]'
    ).length,
  }));
  if (!state.progress?.startsWith('Titling chapters 1/')) throw new Error('missing titling progress');
  if (!selectionText?.includes('2 of 3')) throw new Error('missing selection checked counts');
  if (!state.explanation?.includes('checked claims')) throw new Error('missing step explanation');
  if (state.overlays !== 0) throw new Error('overlay collision detected');
  console.log(JSON.stringify({
    screenshots: shots.map((item) => path.basename(item)),
    selection: selectionText,
    ...state,
  }));
} finally {
  if (browser) await browser.disconnect();
  electron.kill('SIGTERM');
  fs.rmSync(tempDir, { recursive: true, force: true });
}
