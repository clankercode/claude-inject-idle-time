const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getLastResponseFilePath,
  writeLastResponse,
  readLastResponse
} = require('../src/last-response');

function makeDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-last-response-'));
}

test('getLastResponseFilePath places the file under sessions/ with sanitized name', () => {
  const dataDir = '/tmp/example';
  const filePath = getLastResponseFilePath(dataDir, 'abc/123');
  assert.equal(filePath, path.join(dataDir, 'sessions', 'abc_123.lastresponse'));
});

test('getLastResponseFilePath preserves the safe character class', () => {
  const dataDir = '/tmp/example';
  assert.equal(
    getLastResponseFilePath(dataDir, 'safe-id_1.2'),
    path.join(dataDir, 'sessions', 'safe-id_1.2.lastresponse')
  );
});

test('writeLastResponse + readLastResponse round-trips the timestamp without a trailing newline', async () => {
  const dataDir = makeDataDir();
  const sessionId = 'session-1';
  const ts = '2026-04-12T19:00:00.000Z';

  await writeLastResponse({ dataDir, sessionId, timestamp: ts });

  const filePath = getLastResponseFilePath(dataDir, sessionId);
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.equal(raw, ts, 'expected exact timestamp, no trailing newline');

  assert.equal(await readLastResponse({ dataDir, sessionId }), ts);
});

test('writeLastResponse sanitizes the session id and never creates a tmp file under a different name', async () => {
  const dataDir = makeDataDir();
  const sessionId = '../escape';
  const ts = '2026-04-12T19:00:00.000Z';

  await writeLastResponse({ dataDir, sessionId, timestamp: ts });

  const filePath = getLastResponseFilePath(dataDir, sessionId);
  assert.ok(filePath.startsWith(path.join(dataDir, 'sessions', '.._escape.lastresponse')));
  assert.equal(fs.readFileSync(filePath, 'utf8'), ts);

  // No leftover .tmp files in sessions/
  const entries = fs.readdirSync(path.join(dataDir, 'sessions'));
  assert.ok(!entries.some((entry) => entry.endsWith('.tmp')), `unexpected tmp: ${entries.join(', ')}`);
});

test('readLastResponse returns null when the file does not exist', async () => {
  const dataDir = makeDataDir();
  assert.equal(await readLastResponse({ dataDir, sessionId: 'never-seen' }), null);
});

test('readLastResponse returns null for an empty file', async () => {
  const dataDir = makeDataDir();
  const filePath = getLastResponseFilePath(dataDir, 'empty');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');

  assert.equal(await readLastResponse({ dataDir, sessionId: 'empty' }), null);
});

test('readLastResponse returns null for a malformed file (treated as best-effort cache)', async () => {
  const dataDir = makeDataDir();
  const filePath = getLastResponseFilePath(dataDir, 'garbage');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'definitely not a timestamp');

  assert.equal(await readLastResponse({ dataDir, sessionId: 'garbage' }), null);
});

test('writeLastResponse does not throw when the data dir cannot be created and logs a notice', async () => {
  const dataDir = makeDataDir();
  // Make dataDir a regular file so mkdir(dataDir, recursive) fails.
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.writeFileSync(dataDir, 'blocking file');

  const captured = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };

  try {
    await writeLastResponse({
      dataDir,
      sessionId: 'session-x',
      timestamp: '2026-04-12T19:00:00.000Z'
    });
  } finally {
    process.stderr.write = originalWrite;
  }

  assert.ok(
    captured.some((line) => /failed to write \.lastresponse/.test(line)),
    `expected a stderr notice, got: ${captured.join('')}`
  );
});
