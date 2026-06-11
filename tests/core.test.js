const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { toIsoUtc, toLocalIso, getNowIso, stripMs, diffMs } = require('../src/time');
const { formatIdleSystemMessage, formatTimingBlock } = require('../src/format');
const {
  getSessionFilePath,
  loadSessionState,
  saveSessionState,
  updateSessionState,
  mutateSessionState
} = require('../src/state');

test('toIsoUtc normalizes a date-like value to UTC ISO 8601', () => {
  assert.equal(toIsoUtc('2026-04-12T18:34:56.789Z'), '2026-04-12T18:34:56.789Z');
});

test('getNowIso prefers the deterministic test override', () => {
  assert.equal(
    getNowIso({ CLAUDE_TIMING_NOW_ISO: '2026-04-12T18:34:56.789Z' }),
    '2026-04-12T18:34:56.789Z'
  );
});

test('diffMs returns null when either side is unavailable', () => {
  assert.equal(diffMs('2026-04-12T18:34:56.789Z', undefined), null);
  assert.equal(diffMs(undefined, '2026-04-12T18:34:56.789Z'), null);
});

test('diffMs returns whole millisecond deltas', () => {
  assert.equal(
    diffMs('2026-04-12T18:34:56.789Z', '2026-04-12T18:34:40.000Z'),
    16789
  );
});

test('diffMs returns null for malformed timestamps', () => {
  assert.equal(diffMs('not-a-timestamp', '2026-04-12T18:34:40.000Z'), null);
  assert.equal(diffMs('2026-04-12T18:34:56.789Z', 'not-a-timestamp'), null);
});

test('formatTimingBlock includes only available numeric fields', () => {
  const block = formatTimingBlock({
    userMessageTime: '2026-04-13T04:34:56.789+10:00',
    isFirstPrompt: true,
    idleSinceLastAssistantMs: null,
    idleSinceLastStopMs: 14890,
    lastTurnExecMs: 4321
  });

  assert.equal(
    block,
    [
      '[timing]',
      'local_time=2026-04-13T04:34:56+10:00',
      'idle_for=14.9s',
      'last_turn_dur=4.3s',
      '[/timing]'
    ].join('\n')
  );
});

test('formatTimingBlock omits the local_time line on turn 2+', () => {
  const block = formatTimingBlock({
    userMessageTime: '2026-04-13T04:34:56.789+10:00',
    isFirstPrompt: false,
    idleSinceLastAssistantMs: null,
    idleSinceLastStopMs: 14890,
    lastTurnExecMs: 4321
  });

  assert.equal(
    block,
    [
      '[timing]',
      'idle_for=14.9s',
      'last_turn_dur=4.3s',
      '[/timing]'
    ].join('\n')
  );
});

test('formatTimingBlock omits non-finite numeric fields', () => {
  const block = formatTimingBlock({
    userMessageTime: '2026-04-13T04:34:56.789+10:00',
    isFirstPrompt: true,
    idleSinceLastAssistantMs: Number.NaN,
    idleSinceLastStopMs: Number.POSITIVE_INFINITY,
    lastTurnExecMs: 4321
  });

  assert.equal(
    block,
    [
      '[timing]',
      'local_time=2026-04-13T04:34:56+10:00',
      'last_turn_dur=4.3s',
      '[/timing]'
    ].join('\n')
  );
});

test('stripMs drops fractional seconds while preserving Z or offset suffix', () => {
  assert.equal(stripMs('2026-04-13T04:34:56.789+10:00'), '2026-04-13T04:34:56+10:00');
  assert.equal(stripMs('2026-04-13T04:34:56.789Z'), '2026-04-13T04:34:56Z');
  assert.equal(stripMs('2026-04-13T04:34:56+10:00'), '2026-04-13T04:34:56+10:00');
});

test('toLocalIso emits explicit offset and millisecond precision', () => {
  const fakeDate = {
    getFullYear: () => 2026,
    getMonth: () => 3,
    getDate: () => 13,
    getHours: () => 4,
    getMinutes: () => 34,
    getSeconds: () => 56,
    getMilliseconds: () => 789,
    getTimezoneOffset: () => -600
  };
  assert.equal(toLocalIso(fakeDate), '2026-04-13T04:34:56.789+10:00');

  const negativeOffset = { ...fakeDate, getTimezoneOffset: () => 300 };
  assert.equal(toLocalIso(negativeOffset), '2026-04-13T04:34:56.789-05:00');
});

test('formatIdleSystemMessage returns a minimal bracketed note after 10 seconds', () => {
  assert.equal(formatIdleSystemMessage(11000), '[after 11s]');
  assert.equal(formatIdleSystemMessage(63000), '[after 1m 3s]');
  assert.equal(formatIdleSystemMessage(302000), '[after 5m 2s]');
});

test('formatIdleSystemMessage omits short or unavailable idle gaps', () => {
  assert.equal(formatIdleSystemMessage(10000), null);
  assert.equal(formatIdleSystemMessage(9999), null);
  assert.equal(formatIdleSystemMessage(null), null);
  assert.equal(formatIdleSystemMessage(Number.NaN), null);
});

test('loadSessionState returns a default object when the session is new', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));

  const state = await loadSessionState({ dataDir, sessionId: 'session-1' });

  assert.deepEqual(state, { sessionId: 'session-1' });
});

test('getSessionFilePath keeps session files inside the sessions directory', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));
  const filePath = getSessionFilePath(dataDir, '../session-1');

  assert.equal(path.dirname(filePath), path.join(dataDir, 'sessions'));
  assert.equal(filePath, path.join(dataDir, 'sessions', '.._session-1.json'));
});

test('saveSessionState persists a session record that can be loaded again', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));

  await saveSessionState({
    dataDir,
    sessionId: 'session-1',
    state: {
      lastUserPromptAt: '2026-04-12T18:34:56.789Z',
      lastTurnExecMs: 4321
    }
  });

  const filePath = getSessionFilePath(dataDir, 'session-1');
  assert.ok(fs.existsSync(filePath), 'expected persisted state file to exist');

  const reloaded = await loadSessionState({ dataDir, sessionId: 'session-1' });
  assert.deepEqual(reloaded, {
    sessionId: 'session-1',
    lastUserPromptAt: '2026-04-12T18:34:56.789Z',
    lastTurnExecMs: 4321
  });

  const sessionDirEntries = fs.readdirSync(path.join(dataDir, 'sessions'));
  assert.deepEqual(sessionDirEntries, ['session-1.json']);
});

test('concurrent saveSessionState calls for the same session do not collide on the temp file', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));
  const sessionId = 'session-1';

  const writes = Array.from({ length: 25 }, (_, i) =>
    saveSessionState({
      dataDir,
      sessionId,
      state: { lastUserPromptAt: `2026-04-12T18:34:${String(i % 60).padStart(2, '0')}.000Z` }
    })
  );

  await assert.doesNotReject(Promise.all(writes));

  const reloaded = await loadSessionState({ dataDir, sessionId });
  assert.equal(reloaded.sessionId, 'session-1');
  assert.ok(reloaded.lastUserPromptAt, 'expected lastUserPromptAt to be set');

  const sessionDir = path.join(dataDir, 'sessions');
  const entries = fs.readdirSync(sessionDir);
  assert.ok(
    !entries.some((entry) => entry.endsWith('.tmp')),
    `expected no leftover .tmp files, got: ${entries.join(', ')}`
  );
});

test('loadSessionState quarantines a corrupt JSON file and returns a default state', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));
  const sessionId = 'session-1';
  const sessionDir = path.join(dataDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, 'session-1.json');
  fs.writeFileSync(filePath, '{ this is not valid json');

  const captured = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };

  let state;
  try {
    state = await loadSessionState({ dataDir, sessionId });
  } finally {
    process.stderr.write = originalWrite;
  }

  assert.deepEqual(state, { sessionId: 'session-1' });
  assert.ok(
    captured.some((line) => /quarantined corrupt state file/.test(line)),
    `expected a quarantine message, got: ${captured.join('')}`
  );

  const entries = fs.readdirSync(sessionDir);
  assert.ok(!entries.includes('session-1.json'), 'expected the corrupt file to be moved');
  assert.ok(
    entries.some((name) => name.startsWith('session-1.json.corrupt-')),
    `expected a .corrupt-<ts> file, got: ${entries.join(', ')}`
  );
});

test('saveSessionState drops fields that are not in the persisted schema', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));
  const sessionId = 'session-1';

  await saveSessionState({
    dataDir,
    sessionId,
    state: {
      lastUserPromptAt: '2026-04-12T18:34:56.000Z',
      lastTurnExecMs: 4321,
      session_id: 'spoofed',
      arbitrary: 'should be dropped',
      cwd: '/tmp'
    }
  });

  const reloaded = await loadSessionState({ dataDir, sessionId });
  assert.deepEqual(reloaded, {
    sessionId: 'session-1',
    lastUserPromptAt: '2026-04-12T18:34:56.000Z',
    lastTurnExecMs: 4321
  });
});

test('updateSessionState merges a patch into existing state atomically', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));
  const sessionId = 'session-1';

  await saveSessionState({
    dataDir,
    sessionId,
    state: {
      lastUserPromptAt: '2026-04-12T18:00:00.000Z',
      lastTurnExecMs: 1000
    }
  });

  const next = await updateSessionState({
    dataDir,
    sessionId,
    patch: { lastStopAt: '2026-04-12T18:00:05.000Z' }
  });

  assert.deepEqual(next, {
    sessionId: 'session-1',
    lastUserPromptAt: '2026-04-12T18:00:00.000Z',
    lastTurnExecMs: 1000,
    lastStopAt: '2026-04-12T18:00:05.000Z'
  });
});

test('concurrent updateSessionState calls preserve every patch', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));
  const sessionId = 'session-1';

  await Promise.all([
    updateSessionState({ dataDir, sessionId, patch: { lastUserPromptAt: 'A' } }),
    updateSessionState({ dataDir, sessionId, patch: { lastStopAt: 'B' } }),
    updateSessionState({ dataDir, sessionId, patch: { lastTurnExecMs: 4321 } }),
    updateSessionState({ dataDir, sessionId, patch: { lastAssistantMessageAt: 'C' } }),
    updateSessionState({ dataDir, sessionId, patch: { modelAtLastStop: 'opus-4-7' } })
  ]);

  const reloaded = await loadSessionState({ dataDir, sessionId });
  assert.equal(reloaded.lastUserPromptAt, 'A');
  assert.equal(reloaded.lastStopAt, 'B');
  assert.equal(reloaded.lastTurnExecMs, 4321);
  assert.equal(reloaded.lastAssistantMessageAt, 'C');
  assert.equal(reloaded.modelAtLastStop, 'opus-4-7');
});

test('mutateSessionState runs the mutator inside the per-session lock', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));
  const sessionId = 'session-1';

  await saveSessionState({
    dataDir,
    sessionId,
    state: { lastUserPromptAt: '2026-04-12T18:00:00.000Z' }
  });

  let observed;
  const result = await mutateSessionState({
    dataDir,
    sessionId,
    mutator: (existing) => {
      observed = existing;
      return { lastTurnExecMs: 5000 };
    }
  });

  assert.equal(observed.lastUserPromptAt, '2026-04-12T18:00:00.000Z');
  assert.equal(result.lastTurnExecMs, 5000);

  const reloaded = await loadSessionState({ dataDir, sessionId });
  assert.equal(reloaded.lastUserPromptAt, '2026-04-12T18:00:00.000Z');
  assert.equal(reloaded.lastTurnExecMs, 5000);
});

test('getSessionFilePath rejects empty, null, and overlong session ids', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));

  assert.throws(() => getSessionFilePath(dataDir, ''), /between 1 and/);
  assert.throws(() => getSessionFilePath(dataDir, null), /required/);
  assert.throws(() => getSessionFilePath(dataDir, undefined), /required/);
  assert.throws(
    () => getSessionFilePath(dataDir, 'x'.repeat(257)),
    /between 1 and 256/
  );
});

test('saveSessionState sweeps stale .tmp files older than an hour', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));
  const sessionDir = path.join(dataDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });

  const staleTmp = path.join(sessionDir, 'session-1.json.deadbeef.tmp');
  const freshTmp = path.join(sessionDir, 'session-1.json.fresh1234.tmp');
  fs.writeFileSync(staleTmp, '{}');
  fs.writeFileSync(freshTmp, '{}');

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(staleTmp, twoHoursAgo, twoHoursAgo);

  await saveSessionState({
    dataDir,
    sessionId: 'session-1',
    state: { lastUserPromptAt: '2026-04-12T18:00:00.000Z' }
  });

  const entries = fs.readdirSync(sessionDir);
  assert.ok(!entries.includes(path.basename(staleTmp)), 'stale .tmp should be swept');
  assert.ok(
    entries.includes(path.basename(freshTmp)),
    `fresh .tmp should be left alone, got: ${entries.join(', ')}`
  );
});

test('saveSessionState uses compact JSON, not pretty-printed', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));
  const sessionId = 'session-1';

  await saveSessionState({
    dataDir,
    sessionId,
    state: { lastUserPromptAt: '2026-04-12T18:00:00.000Z' }
  });

  const filePath = getSessionFilePath(dataDir, sessionId);
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.ok(!raw.includes('\n  '), `expected single-line JSON, got: ${raw}`);
});
