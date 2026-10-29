'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn: spawnProcess } = require('child_process');

const CHANNELS = Object.freeze({
  choose: 'faultmesh:spectate:choose-project',
  start: 'faultmesh:spectate:start',
  stop: 'faultmesh:spectate:stop',
  openRecording: 'faultmesh:spectate:open-recording',
  event: 'faultmesh:spectate:event',
});

const EVENTS = new Set([
  'session_started',
  'initial_snapshot',
  'file_changed',
  'source',
  'diff',
  'structure_update',
  'relationship_update',
  'evidence_stale',
  'watch_error',
  'root_missing',
  'session_ended',
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireKeys(record, keys) {
  for (const key of keys) {
    if (!(key in record)) throw new Error(`spectate record is missing ${key}`);
  }
}

function validateSpectateRecord(record) {
  if (!isPlainObject(record)) throw new Error('spectate line must be a JSON object');
  requireKeys(record, ['schema_version', 'session_id', 'sequence', 'emitted_at', 'event']);
  if (record.schema_version !== 'spectate-1.1') throw new Error('unsupported spectate schema');
  if (typeof record.session_id !== 'string' || record.session_id.length < 1 || record.session_id.length > 128) {
    throw new Error('invalid spectate session id');
  }
  if (!Number.isSafeInteger(record.sequence) || record.sequence < 1) {
    throw new Error('invalid spectate sequence');
  }
  if (typeof record.emitted_at !== 'string' || Number.isNaN(Date.parse(record.emitted_at))) {
    throw new Error('invalid spectate timestamp');
  }
  if (!EVENTS.has(record.event)) throw new Error('unknown spectate event');
  const required = {
    session_started: ['root_display_name', 'limits', 'ignore', 'diff_base', 'tests_rerun'],
    initial_snapshot: ['files', 'structure'],
    file_changed: [
      'path',
      'kind',
      'previous_sha256',
      'new_sha256',
      'changed_line_ranges',
      'affected_file_ids',
      'affected_symbol_ids',
      'parse_ok',
    ],
    source: ['path', 'sha256', 'text', 'complete', 'skipped_reason'],
    diff: ['path', 'base', 'base_sha256', 'new_sha256', 'hunks', 'text', 'truncated'],
    structure_update: [
      'path',
      'file',
      'symbols',
      'added_symbol_ids',
      'modified_symbol_ids',
      'removed_symbol_ids',
      'changed_node_ids',
      'kept_last_good_symbols',
      'parse_ok',
    ],
    relationship_update: [
      'edges',
      'unresolved',
      'external_modules',
      'stale_paths',
      'complete',
      'partial_reasons',
    ],
    evidence_stale: ['path', 'evidence_content_sha256', 'new_content_sha256', 'rule'],
    watch_error: ['reason', 'operation', 'recoverable', 'skipped_count'],
    root_missing: ['reason'],
    session_ended: ['reason'],
  };
  requireKeys(record, required[record.event]);
  const optional = {
    session_started: [],
    initial_snapshot: [],
    file_changed: ['from_path', 'to_path', 'line_count', 'parse_error'],
    source: [],
    diff: ['skipped_reason'],
    structure_update: ['parse_error'],
    relationship_update: [],
    evidence_stale: [],
    watch_error: ['path'],
    root_missing: [],
    session_ended: [],
  };
  const allowed = new Set([
    'schema_version',
    'session_id',
    'sequence',
    'emitted_at',
    'event',
    ...required[record.event],
    ...optional[record.event],
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error('spectate record contains unknown fields');
  }
  if ('path' in record && record.path !== null && typeof record.path !== 'string') {
    throw new Error('invalid spectate path');
  }
  if ('parse_ok' in record && typeof record.parse_ok !== 'boolean') {
    throw new Error('invalid parse status');
  }
  if (record.event === 'file_changed') {
    if (!['created', 'modified', 'deleted', 'renamed'].includes(record.kind)) {
      throw new Error('invalid file change kind');
    }
    if (!Array.isArray(record.changed_line_ranges) || !Array.isArray(record.affected_symbol_ids)) {
      throw new Error('invalid file change arrays');
    }
  }
  if (record.event === 'source') {
    if (typeof record.complete !== 'boolean' || (record.text !== null && typeof record.text !== 'string')) {
      throw new Error('invalid source payload');
    }
  }
  if (record.event === 'diff') {
    if (record.base !== 'previous stable snapshot' || !Array.isArray(record.hunks)) {
      throw new Error('invalid diff payload');
    }
  }
  if (record.event === 'relationship_update') {
    if (
      !Array.isArray(record.edges)
      || !Array.isArray(record.unresolved)
      || !Array.isArray(record.external_modules)
      || !Array.isArray(record.stale_paths)
      || !Array.isArray(record.partial_reasons)
      || typeof record.complete !== 'boolean'
    ) {
      throw new Error('invalid relationship payload');
    }
  }
  return record;
}

class SpectateStreamParser {
  constructor({ maxLineBytes = 1024 * 1024, onRecord, onError }) {
    this.maxLineBytes = maxLineBytes;
    this.onRecord = onRecord;
    this.onError = onError;
    this.buffer = Buffer.alloc(0);
    this.discardingOversized = false;
    this.sessionId = null;
    this.lastSequence = 0;
    this.lastEvent = null;
  }

  push(chunk) {
    let incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this.discardingOversized) {
      const newline = incoming.indexOf(0x0a);
      if (newline === -1) return;
      this.discardingOversized = false;
      incoming = incoming.subarray(newline + 1);
    }
    this.buffer = Buffer.concat([this.buffer, incoming]);
    while (true) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) break;
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      this.parseLine(line);
    }
    if (this.buffer.length > this.maxLineBytes) {
      this.buffer = Buffer.alloc(0);
      this.discardingOversized = true;
      this.onError(new Error('spectate stdout line exceeds configured limit'));
    }
  }

  end() {
    if (this.discardingOversized) return;
    if (this.buffer.length) this.parseLine(this.buffer);
    this.buffer = Buffer.alloc(0);
  }

  parseLine(line) {
    if (line.length === 0) return;
    if (line.length > this.maxLineBytes) {
      this.onError(new Error('spectate stdout line exceeds configured limit'));
      return;
    }
    try {
      const record = validateSpectateRecord(JSON.parse(line.toString('utf8')));
      if (this.sessionId === null) {
        if (record.sequence !== 1 || record.event !== 'session_started') {
          throw new Error('spectate stream must begin with sequence 1 session_started');
        }
        this.sessionId = record.session_id;
      }
      if (record.session_id !== this.sessionId) throw new Error('spectate session id changed');
      if (record.sequence !== this.lastSequence + 1) throw new Error('spectate sequence is not contiguous');
      this.lastSequence = record.sequence;
      this.lastEvent = record.event;
      this.onRecord(record);
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function attachSpectateBridge({
  ipcMain,
  dialog,
  window,
  indexPath,
  command = process.env.FAULTMESH_EXECUTABLE || 'faultmesh',
  spawn = spawnProcess,
  maxLineBytes = 1024 * 1024,
  terminationGraceMs = 750,
}) {
  const expectedUrl = pathToFileURL(path.resolve(indexPath)).href;
  let selectedProject = null;
  let child = null;
  let parser = null;
  let stopping = false;
  let disposed = false;

  function assertTrusted(event, args) {
    if (disposed) throw new Error('spectate bridge is closed');
    if (args.length !== 0) throw new Error('spectate IPC does not accept renderer arguments');
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('untrusted spectate IPC sender');
    }
    if (!event.senderFrame || event.senderFrame.url !== expectedUrl) {
      throw new Error('untrusted spectate IPC origin');
    }
  }

  function sendRecord(record) {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.event, record);
  }

  function syntheticSessionEnd(reason) {
    if (!parser || parser.sessionId === null || parser.lastEvent === 'session_ended') return;
    sendRecord({
      schema_version: 'spectate-1.1',
      session_id: parser.sessionId,
      sequence: parser.lastSequence + 1,
      emitted_at: new Date().toISOString(),
      event: 'session_ended',
      reason,
    });
    parser.lastSequence += 1;
    parser.lastEvent = 'session_ended';
  }

  function terminate(active, reason, immediate = false) {
    if (!active) return Promise.resolve();
    stopping = true;
    child = null;
    if (immediate) {
      try {
        active.stdin.end();
      } catch (_) {
        // The child may already have closed its pipe.
      }
      active.kill('SIGTERM');
      syntheticSessionEnd(reason);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let finished = false;
      let termTimer;
      let killTimer;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        syntheticSessionEnd(reason);
        resolve();
      };
      active.once('close', finish);
      termTimer = setTimeout(() => active.kill('SIGTERM'), terminationGraceMs);
      killTimer = setTimeout(() => {
        active.kill('SIGKILL');
        finish();
      }, terminationGraceMs * 2);
      termTimer.unref?.();
      killTimer.unref?.();
      try {
        active.stdin.end();
      } catch (_) {
        active.kill('SIGTERM');
      }
    });
  }

  ipcMain.handle(CHANNELS.choose, async (event, ...args) => {
    assertTrusted(event, args);
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a Python project to watch',
      properties: ['openDirectory', 'dontAddToRecent'],
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    const chosen = result.filePaths[0];
    const chosenStat = fs.lstatSync(chosen);
    if (chosenStat.isSymbolicLink() || !chosenStat.isDirectory()) {
      throw new Error('selected project must be a real directory');
    }
    const root = fs.realpathSync(chosen);
    selectedProject = {
      handle: crypto.randomUUID(),
      root,
      displayName: path.basename(root),
    };
    return { handle: selectedProject.handle, displayName: selectedProject.displayName };
  });

  ipcMain.handle(CHANNELS.start, async (event, ...args) => {
    assertTrusted(event, args);
    if (!selectedProject) throw new Error('choose a project before starting spectate');
    if (child) return { watching: true, displayName: selectedProject.displayName };
    stopping = false;
    parser = new SpectateStreamParser({
      maxLineBytes,
      onRecord: sendRecord,
      onError: (error) => {
        console.error('Rejected FaultMesh spectate output:', error.message);
        const active = child;
        if (active) void terminate(active, 'invalid_child_output', true);
      },
    });
    const active = spawn(
      command,
      [
        'spectate',
        selectedProject.root,
        '--max-stdout-line-bytes',
        String(maxLineBytes),
      ],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    child = active;
    active.stdout.on('data', (chunk) => parser?.push(chunk));
    active.stdout.on('end', () => parser?.end());
    active.stderr.on('data', (chunk) => {
      const message = String(chunk).slice(0, 4096).trim();
      if (message) console.error(`FaultMesh spectate: ${message}`);
    });
    active.once('error', (error) => {
      console.error('FaultMesh spectate child failed:', error.message);
      if (child === active) child = null;
      syntheticSessionEnd('child_process_error');
    });
    active.once('close', (code, signalName) => {
      if (child === active) child = null;
      if (!stopping) syntheticSessionEnd(`child_exit:${code ?? signalName ?? 'unknown'}`);
      stopping = false;
    });
    return { watching: true, displayName: selectedProject.displayName };
  });

  ipcMain.handle(CHANNELS.stop, async (event, ...args) => {
    assertTrusted(event, args);
    const active = child;
    await terminate(active, 'stopped_by_user');
    return { watching: false };
  });

  ipcMain.handle(CHANNELS.openRecording, async (event, ...args) => {
    assertTrusted(event, args);
    const result = await dialog.showOpenDialog(window, {
      title: 'Open FaultMesh Recording Export',
      filters: [
        { name: 'FaultMesh Recording JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile', 'dontAddToRecent'],
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    const chosen = result.filePaths[0];
    const chosenStat = fs.lstatSync(chosen);
    if (!chosenStat.isFile()) throw new Error('selected recording must be a file');
    if (chosenStat.size > 64 * 1024 * 1024) {
      throw new Error('recording file exceeds 64 MB size limit');
    }
    const text = fs.readFileSync(chosen, 'utf-8');
    return {
      name: path.basename(chosen),
      size: chosenStat.size,
      text,
    };
  });

  return {
    channels: CHANNELS,
    dispose(reason = 'bridge_disposed', immediate = true) {
      if (disposed) return;
      const active = child;
      if (active) void terminate(active, reason, immediate);
      ipcMain.removeHandler(CHANNELS.choose);
      ipcMain.removeHandler(CHANNELS.start);
      ipcMain.removeHandler(CHANNELS.stop);
      ipcMain.removeHandler(CHANNELS.openRecording);
      disposed = true;
    },
  };
}

module.exports = {
  CHANNELS,
  SpectateStreamParser,
  attachSpectateBridge,
  validateSpectateRecord,
};
