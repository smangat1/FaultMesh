'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const {
  CHANNELS,
  SpectateStreamParser,
  attachSpectateBridge,
  validateSpectateRecord,
} = require('./spectate-main.cjs');

function sessionStarted(sequence = 1) {
  return {
    schema_version: 'spectate-1.1',
    session_id: 'session-test',
    sequence,
    emitted_at: '2026-10-26T20:00:00Z',
    event: 'session_started',
    root_display_name: 'project',
    limits: {},
    ignore: {},
    diff_base: 'previous stable snapshot',
    tests_rerun: false,
  };
}

function sessionEnded(sequence = 2) {
  return {
    schema_version: 'spectate-1.1',
    session_id: 'session-test',
    sequence,
    emitted_at: '2026-10-26T20:00:01Z',
    event: 'session_ended',
    reason: 'test',
  };
}

test('stream parser accepts fragmented ordered records', () => {
  const records = [];
  const errors = [];
  const parser = new SpectateStreamParser({
    maxLineBytes: 4096,
    onRecord: (record) => records.push(record),
    onError: (error) => errors.push(error),
  });
  const stream = `${JSON.stringify(sessionStarted())}\n${JSON.stringify(sessionEnded())}\n`;
  parser.push(Buffer.from(stream.slice(0, 19)));
  parser.push(Buffer.from(stream.slice(19)));

  assert.deepEqual(records.map((record) => record.event), ['session_started', 'session_ended']);
  assert.equal(errors.length, 0);
});

test('stream parser rejects malformed, oversized, and out-of-order lines', () => {
  const records = [];
  const errors = [];
  const parser = new SpectateStreamParser({
    maxLineBytes: 256,
    onRecord: (record) => records.push(record),
    onError: (error) => errors.push(error.message),
  });
  parser.push(Buffer.from('{bad json}\n'));
  parser.push(Buffer.from(`${'x'.repeat(300)}\n`));
  parser.push(Buffer.from(`${JSON.stringify(sessionStarted(2))}\n`));

  assert.equal(records.length, 0);
  assert.equal(errors.length, 3);
  assert.ok(errors.some((message) => message.includes('exceeds')));
  assert.ok(errors.some((message) => message.includes('sequence 1')));
});

test('record validation rejects unknown event names and fields', () => {
  assert.throws(
    () => validateSpectateRecord({ ...sessionStarted(), event: 'model_explanation' }),
    /unknown spectate event/,
  );
  assert.throws(
    () => validateSpectateRecord({ ...sessionStarted(), renderer_path: '/tmp' }),
    /unknown fields/,
  );
});

test('record validation accepts bounded relationship updates', () => {
  const record = validateSpectateRecord({
    schema_version: 'spectate-1.1',
    session_id: 'session-test',
    sequence: 2,
    emitted_at: '2026-10-26T20:00:01Z',
    event: 'relationship_update',
    edges: [],
    unresolved: [],
    external_modules: [],
    stale_paths: [],
    complete: true,
    partial_reasons: [],
  });

  assert.equal(record.event, 'relationship_update');
});

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, callback) {
    this.handlers.set(channel, callback);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kills = [];
  child.stdin = {
    end() {
      queueMicrotask(() => child.emit('close', 0, null));
    },
  };
  child.kill = (signalName) => {
    child.kills.push(signalName);
    queueMicrotask(() => child.emit('close', null, signalName));
  };
  return child;
}

function harness() {
  const ipcMain = new FakeIpcMain();
  const sent = [];
  const webContents = {
    mainFrame: null,
    send(channel, record) {
      sent.push([channel, record]);
    },
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faultmesh-electron-test-'));
  const indexPath = path.join(root, 'index.html');
  fs.writeFileSync(indexPath, '<!doctype html>');
  webContents.mainFrame = { url: pathToFileURL(indexPath).href };
  const window = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  const children = [];
  const spawns = [];
  const bridge = attachSpectateBridge({
    ipcMain,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) },
    window,
    indexPath,
    command: '/fixed/faultmesh',
    spawn: (...args) => {
      spawns.push(args);
      const child = fakeChild();
      children.push(child);
      return child;
    },
    terminationGraceMs: 10,
    projectLinksPath: path.join(root, 'replay-project-links.json'),
  });
  return { ipcMain, sent, root, window, event, children, spawns, bridge };
}

test('IPC keeps paths in main and spawns fixed command arguments', async (context) => {
  const value = harness();
  context.after(() => {
    value.bridge.dispose();
    fs.rmSync(value.root, { recursive: true, force: true });
  });
  const choose = value.ipcMain.handlers.get(CHANNELS.choose);
  const start = value.ipcMain.handlers.get(CHANNELS.start);
  const openRec = value.ipcMain.handlers.get(CHANNELS.openRecording);
  assert.deepEqual(
    new Set(value.ipcMain.handlers.keys()),
    new Set([
      CHANNELS.choose,
      CHANNELS.start,
      CHANNELS.stop,
      CHANNELS.openRecording,
      CHANNELS.listHistory,
      CHANNELS.importSession,
      CHANNELS.linkSessionProject,
    ])
  );
  const project = await choose(value.event);
  assert.equal(project.displayName, path.basename(value.root));
  assert.equal('root' in project, false);
  await start(value.event);

  assert.equal(value.spawns[0][0], '/fixed/faultmesh');
  assert.deepEqual(value.spawns[0][1].slice(0, 2), ['spectate', fs.realpathSync(value.root)]);
  assert.equal(value.spawns[0][2].shell, false);
});

test('session project links persist in main without returning a local path', async (context) => {
  const value = harness();
  context.after(() => {
    value.bridge.dispose();
    fs.rmSync(value.root, { recursive: true, force: true });
  });
  const choose = value.ipcMain.handlers.get(CHANNELS.choose);
  const link = value.ipcMain.handlers.get(CHANNELS.linkSessionProject);
  const selected = await choose(value.event);

  await assert.rejects(
    () => link(value.event, 'session-1', 'wrong-handle'),
    /not the selected project/,
  );
  const result = await link(value.event, 'session-1', selected.handle);
  assert.deepEqual(result, { linked: true, displayName: path.basename(value.root) });
  assert.equal('root' in result, false);

  const stored = JSON.parse(fs.readFileSync(path.join(value.root, 'replay-project-links.json'), 'utf8'));
  assert.equal(stored['session-1'].root, fs.realpathSync(value.root));
});

test('IPC rejects renderer paths, wrong frames, and unknown channels', async (context) => {
  const value = harness();
  context.after(() => {
    value.bridge.dispose();
    fs.rmSync(value.root, { recursive: true, force: true });
  });
  const start = value.ipcMain.handlers.get(CHANNELS.start);
  await assert.rejects(() => start(value.event, '/renderer/supplied'), /does not accept/);
  await assert.rejects(
    () => start({ sender: value.window.webContents, senderFrame: { url: value.event.senderFrame.url } }),
    /untrusted spectate IPC sender/,
  );
  assert.equal(value.ipcMain.handlers.has('faultmesh:shell'), false);
  assert.equal(value.ipcMain.handlers.has('faultmesh:fs'), false);
});

test('stop, window disposal, and child crash leave no active child', async (context) => {
  const value = harness();
  context.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const choose = value.ipcMain.handlers.get(CHANNELS.choose);
  const start = value.ipcMain.handlers.get(CHANNELS.start);
  const stop = value.ipcMain.handlers.get(CHANNELS.stop);
  await choose(value.event);
  await start(value.event);
  value.children[0].stdout.emit('data', Buffer.from(`${JSON.stringify(sessionStarted())}\n`));
  assert.deepEqual(await stop(value.event), { watching: false });
  assert.equal(value.children[0].kills.length, 0);

  await start(value.event);
  value.children[1].stdout.emit('data', Buffer.from(`${JSON.stringify(sessionStarted())}\n`));
  value.children[1].emit('close', 1, null);
  assert.equal(value.sent.at(-1)[1].reason, 'child_exit:1');
  value.bridge.dispose('window_closed');
  assert.equal(value.ipcMain.handlers.size, 0);
});

test('openRecording allows safe selection of recording file and returns text only', async (context) => {
  const value = harness();
  const testFile = path.join(value.root, 'recording.json');
  fs.writeFileSync(testFile, '{"schema_version":"replay-export-1.0"}', 'utf-8');
  value.bridge.dispose();
  const bridge = attachSpectateBridge({
    ipcMain: value.ipcMain,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [testFile] }) },
    window: value.window,
    indexPath: path.join(value.root, 'index.html'),
  });
  context.after(() => {
    bridge.dispose();
    fs.rmSync(value.root, { recursive: true, force: true });
  });
  const openRec = value.ipcMain.handlers.get(CHANNELS.openRecording);
  const result = await openRec(value.event);
  assert.equal(result.name, 'recording.json');
  assert.equal(result.text, '{"schema_version":"replay-export-1.0"}');
  assert.equal('path' in result, false);
});

test('listHistory spawns replay-history-list with fixed argv, no paths, and bounded output', async (context) => {
  const value = harness();
  context.after(() => {
    value.bridge.dispose();
    fs.rmSync(value.root, { recursive: true, force: true });
  });
  const listHistory = value.ipcMain.handlers.get(CHANNELS.listHistory);
  assert.ok(listHistory);

  // Untrusted args rejection
  await assert.rejects(() => listHistory(value.event, '--extra-arg'), /does not accept renderer arguments/);

  // Successful listing
  const listPromise = listHistory(value.event);
  assert.equal(value.spawns.at(-1)[0], '/fixed/faultmesh');
  assert.deepEqual(value.spawns.at(-1)[1], ['replay-history-list']);
  assert.equal(value.spawns.at(-1)[2].shell, false);

  const mockPayload = {
    roots: [
      { tool: 'codex', status: 'ok', file_count: 12, message: null },
      { tool: 'claude_code', status: 'missing', file_count: 0, message: 'Not found' },
    ],
    sessions: [
      {
        session_id: 'sess-1',
        tool: 'codex',
        project_group_key: 'proj-group-1',
        project_display_name: 'test-project',
        started_at: '2026-10-29T10:00:00Z',
        ended_at: '2026-10-29T10:15:00Z',
        prompt_count: 3,
        first_prompt_preview: 'Fix [redacted: secret] bug',
        format_version: '1.0',
        parse_status: 'ok',
        unsupported_reason: null,
        redaction_types: ['secret'],
      },
    ],
  };

  const child = value.children.at(-1);
  child.stdout.emit('data', Buffer.from(JSON.stringify(mockPayload)));
  child.emit('close', 0, null);

  const result = await listPromise;
  assert.equal(result.roots.length, 2);
  assert.equal(result.roots[0].tool, 'codex');
  assert.equal(result.roots[0].file_count, 12);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].session_id, 'sess-1');
  assert.equal(result.sessions[0].first_prompt_preview, 'Fix [redacted: secret] bug');
  assert.equal('source_file' in result.sessions[0], false);
  assert.equal('root_path' in result.roots[0], false);
});

test('importSession validates inputs, spawns fixed argv, cleans up temp file, and returns export text without paths', async (context) => {
  const value = harness();
  context.after(() => {
    value.bridge.dispose();
    fs.rmSync(value.root, { recursive: true, force: true });
  });
  const importSession = value.ipcMain.handlers.get(CHANNELS.importSession);
  assert.ok(importSession);

  // Input validation tests: bad tools, path traversal, bad frame
  await assert.rejects(() => importSession(value.event), /requires exactly/);
  await assert.rejects(() => importSession(value.event, 'sess-1', 'unsupported_tool'), /unsupported or invalid tool/);
  await assert.rejects(() => importSession(value.event, '../traversal', 'codex'), /invalid or unsafe sessionId/);
  await assert.rejects(() => importSession(value.event, '/absolute/path', 'codex'), /invalid or unsafe sessionId/);

  // Successful import test
  let tempOutFile = null;
  const originalSpawn = value.bridge;
  const importPromise = importSession(value.event, 'valid-session-123', 'codex');

  const lastSpawn = value.spawns.at(-1);
  assert.equal(lastSpawn[0], '/fixed/faultmesh');
  assert.equal(lastSpawn[1][0], 'replay-history-import');
  assert.equal(lastSpawn[1][1], 'valid-session-123');
  assert.equal(lastSpawn[1][2], '--tool');
  assert.equal(lastSpawn[1][3], 'codex');
  assert.equal(lastSpawn[1][4], '--out');
  tempOutFile = lastSpawn[1][5];
  assert.ok(tempOutFile.includes('faultmesh-import-'));

  // Simulate writing validated replay-export document to temp file
  const mockExport = {
    schema_version: 'replay-export-1.0',
    session: { id: 'valid-session-123', created_at: '2026-10-29T10:00:00Z' },
    records: [],
    timeline: [],
  };
  fs.writeFileSync(tempOutFile, JSON.stringify(mockExport), 'utf8');

  const child = value.children.at(-1);
  child.emit('close', 0, null);

  const result = await importPromise;
  assert.equal(result.name, 'valid-session-123.json');
  assert.equal(JSON.parse(result.text).schema_version, 'replay-export-1.0');
  assert.equal(typeof result.size, 'number');
  assert.equal('path' in result, false);

  // Verify temp file was cleaned up
  assert.equal(fs.existsSync(tempOutFile), false);
});

test('importSession applies a persisted project link without exposing the path to renderer', async (context) => {
  const value = harness();
  context.after(() => {
    value.bridge.dispose();
    fs.rmSync(value.root, { recursive: true, force: true });
  });
  const choose = value.ipcMain.handlers.get(CHANNELS.choose);
  const link = value.ipcMain.handlers.get(CHANNELS.linkSessionProject);
  const importSession = value.ipcMain.handlers.get(CHANNELS.importSession);
  const selected = await choose(value.event);
  await link(value.event, 'linked-session', selected.handle);

  const imported = importSession(value.event, 'linked-session', 'codex');
  const lastSpawn = value.spawns.at(-1);
  const projectRootIndex = lastSpawn[1].indexOf('--project-root');
  assert.notEqual(projectRootIndex, -1);
  assert.equal(lastSpawn[1][projectRootIndex + 1], fs.realpathSync(value.root));
  const outIndex = lastSpawn[1].indexOf('--out');
  fs.writeFileSync(
    lastSpawn[1][outIndex + 1],
    JSON.stringify({ schema_version: 'replay-export-1.1' }),
    'utf8',
  );
  value.children.at(-1).emit('close', 0, null);

  const result = await imported;
  assert.equal('path' in result, false);
  assert.equal(JSON.parse(result.text).schema_version, 'replay-export-1.1');
});
