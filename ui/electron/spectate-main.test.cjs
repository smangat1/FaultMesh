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
  assert.deepEqual(new Set(value.ipcMain.handlers.keys()), new Set([CHANNELS.choose, CHANNELS.start, CHANNELS.stop]));
  const project = await choose(value.event);
  assert.equal(project.displayName, path.basename(value.root));
  assert.equal('root' in project, false);
  await start(value.event);

  assert.equal(value.spawns[0][0], '/fixed/faultmesh');
  assert.deepEqual(value.spawns[0][1].slice(0, 2), ['spectate', fs.realpathSync(value.root)]);
  assert.equal(value.spawns[0][2].shell, false);
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
