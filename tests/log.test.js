const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { logError, logInfo, getLogPath, readLog } = require('../src/log');
const { trySanitizeSessionId: sanitizeSessionId } = require('../src/sanitize');

function tempDataDir(prefix = 'idle-timing-log-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('logError creates the log dir on first call', () => {
  const dataDir = tempDataDir();
  const logDir = path.join(dataDir, 'logs');
  assert.equal(fs.existsSync(logDir), false);

  logError({ dataDir, sessionId: 'session-1', hook: 'Test', error: new Error('boom') });

  assert.equal(fs.existsSync(logDir), true);
  assert.equal(fs.statSync(logDir).isDirectory(), true);
});

test('logError appends a single NDJSON line with the expected fields', () => {
  const dataDir = tempDataDir();
  const sessionId = 'session-1';

  const error = new Error('explosion');
  error.contextTag = 'unit-test';
  logError({ dataDir, sessionId, hook: 'UserPromptSubmit', error, context: { foo: 'bar' } });

  const filePath = getLogPath({ dataDir, sessionId });
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 1);

  const entry = JSON.parse(lines[0]);
  assert.equal(entry.hook, 'UserPromptSubmit');
  assert.equal(entry.sessionId, sessionId);
  assert.equal(entry.level, 'error');
  assert.equal(entry.message, 'explosion');
  assert.ok(typeof entry.ts === 'string' && entry.ts.length > 0);
  assert.ok(typeof entry.stack === 'string' && entry.stack.includes('explosion'));
  assert.deepEqual(entry.context, { foo: 'bar' });
});

test('logError appends additional entries on subsequent calls without overwriting', () => {
  const dataDir = tempDataDir();
  const sessionId = 'session-1';

  logError({ dataDir, sessionId, hook: 'A', error: new Error('first') });
  logError({ dataDir, sessionId, hook: 'B', error: new Error('second') });

  const filePath = getLogPath({ dataDir, sessionId });
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 2);

  const first = JSON.parse(lines[0]);
  const second = JSON.parse(lines[1]);
  assert.equal(first.message, 'first');
  assert.equal(second.message, 'second');
  assert.equal(first.hook, 'A');
  assert.equal(second.hook, 'B');
});

test('logError does not throw on missing dataDir or missing sessionId', () => {
  const dataDir = tempDataDir();

  assert.doesNotThrow(() => logError({ dataDir: null, sessionId: 's', error: new Error('x') }));
  assert.doesNotThrow(() => logError({ dataDir, sessionId: null, error: new Error('x') }));
  assert.doesNotThrow(() => logError({ dataDir, sessionId: '', error: new Error('x') }));
  assert.doesNotThrow(() => logError({}));
  assert.doesNotThrow(() => logError({ dataDir, sessionId: undefined }));
  assert.doesNotThrow(() => logError({ dataDir: undefined, sessionId: 's' }));

  assert.equal(fs.existsSync(path.join(dataDir, 'logs')), false);
});

test('logInfo writes a level=info entry without an error stack', () => {
  const dataDir = tempDataDir();
  logInfo({ dataDir, sessionId: 'session-1', hook: 'reset', message: 'state reset' });

  const filePath = getLogPath({ dataDir, sessionId: 'session-1' });
  const entry = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(entry.level, 'info');
  assert.equal(entry.hook, 'reset');
  assert.equal(entry.message, 'state reset');
  assert.equal(entry.stack, null);
});

test('readLog returns [] for a missing log file', async () => {
  const dataDir = tempDataDir();
  const result = await readLog({ dataDir, sessionId: 'never-seen' });
  assert.deepEqual(result, []);
});

test('readLog returns the last N lines as parsed objects', async () => {
  const dataDir = tempDataDir();
  const sessionId = 'session-1';

  for (let i = 0; i < 5; i += 1) {
    logInfo({ dataDir, sessionId, hook: 'test', message: `entry ${i}` });
  }

  const limited = await readLog({ dataDir, sessionId, limit: 2 });
  assert.equal(limited.length, 2);
  assert.equal(limited[0].message, 'entry 3');
  assert.equal(limited[1].message, 'entry 4');

  const defaultLimit = await readLog({ dataDir, sessionId });
  assert.equal(defaultLimit.length, 5);
});

test('sanitization: sessionId with ../ writes to a sanitized log file (no traversal)', () => {
  const dataDir = tempDataDir();
  const dangerous = '../etc/evil';

  logError({ dataDir, sessionId: dangerous, error: new Error('x') });

  const logsDir = path.join(dataDir, 'logs');
  const entries = fs.readdirSync(logsDir);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].endsWith('.log'));
  assert.ok(!entries[0].includes('/'), `sanitized entry should not contain '/', got: ${entries[0]}`);
  assert.equal(path.dirname(path.join(logsDir, entries[0])), logsDir);

  const filePath = path.join(logsDir, entries[0]);
  const entry = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert.equal(entry.sessionId, sanitizeSessionId(dangerous));
  assert.equal(entry.message, 'x');
});

test('sanitizeSessionId replaces non-allowed characters with underscore', () => {
  assert.equal(sanitizeSessionId('abc-123'), 'abc-123');
  assert.equal(sanitizeSessionId('a b/c'), 'a_b_c');
  assert.equal(sanitizeSessionId(null), null);
  assert.equal(sanitizeSessionId(''), null);
  assert.equal(sanitizeSessionId('safe.id_ok'), 'safe.id_ok');
});

test('getLogPath returns null for missing inputs', () => {
  assert.equal(getLogPath({ dataDir: null, sessionId: 's' }), null);
  assert.equal(getLogPath({ dataDir: '/tmp', sessionId: null }), null);
  assert.equal(getLogPath({ dataDir: '/tmp', sessionId: '' }), null);
});
