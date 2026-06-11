const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const scriptPath = path.join(rootDir, 'scripts', 'reset.js');
const DEFAULT_TIMEOUT_MS = 5000;

function runReset({ args = [], input, dataDir, extraEnv = {} } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      ...extraEnv
    };
    if (dataDir !== undefined) {
      env.CLAUDE_PLUGIN_DATA = dataDir;
    } else {
      delete env.CLAUDE_PLUGIN_DATA;
    }

    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: rootDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`reset timed out after ${DEFAULT_TIMEOUT_MS}ms`));
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });

    child.stdin.end(input == null ? '' : (typeof input === 'string' ? input : JSON.stringify(input)));
  });
}

function seedSessionFile(dataDir, name) {
  const sessionsDir = path.join(dataDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const filePath = path.join(sessionsDir, name);
  fs.writeFileSync(filePath, '{"placeholder":true}');
  return filePath;
}

test('reset.js removes the session JSON and .lastresponse file and appends a state-reset log entry', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-reset-'));
  const sessionId = 'session-1';
  const jsonPath = seedSessionFile(dataDir, `${sessionId}.json`);
  const lastResponsePath = seedSessionFile(dataDir, `${sessionId}.lastresponse`);

  const result = await runReset({
    input: { session_id: sessionId },
    dataDir
  });

  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, new RegExp(`OK: reset session ${sessionId}`));

  assert.equal(fs.existsSync(jsonPath), false, 'expected session JSON to be removed');
  assert.equal(fs.existsSync(lastResponsePath), false, 'expected .lastresponse to be removed');

  const logPath = path.join(dataDir, 'logs', `${sessionId}.log`);
  assert.equal(fs.existsSync(logPath), true, 'expected a log file to be created');
  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.hook, 'reset');
  assert.equal(entry.sessionId, sessionId);
  assert.equal(entry.level, 'info');
  assert.equal(entry.message, 'state reset');
  assert.ok(typeof entry.ts === 'string' && entry.ts.length > 0);
});

test('reset.js is a no-op for sessions with no prior state and still appends a log line', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-reset-'));
  const sessionId = 'never-seen';

  const result = await runReset({
    input: { session_id: sessionId },
    dataDir
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, new RegExp(`OK: reset session ${sessionId}`));

  const logPath = path.join(dataDir, 'logs', `${sessionId}.log`);
  assert.equal(fs.existsSync(logPath), true);
  const entry = JSON.parse(fs.readFileSync(logPath, 'utf8').split('\n')[0]);
  assert.equal(entry.hook, 'reset');
  assert.equal(entry.message, 'state reset');
});

test('reset.js --all --yes removes every file in sessions/ and logs/ and reports the count', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-reset-'));
  fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'sessions', 'a.json'), '{}');
  fs.writeFileSync(path.join(dataDir, 'sessions', 'a.lastresponse'), 'x');
  fs.writeFileSync(path.join(dataDir, 'sessions', 'b.json'), '{}');
  fs.writeFileSync(path.join(dataDir, 'logs', 'a.log'), '{}');
  fs.writeFileSync(path.join(dataDir, 'logs', 'b.log'), '{}');

  const result = await runReset({
    args: ['--all', '--yes'],
    dataDir
  });

  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /OK: reset all sessions \(\d+ files\)/);
  const m = result.stdout.match(/\((\d+) files\)/);
  assert.ok(m, `expected "(N files)" in stdout, got: ${result.stdout}`);
  assert.equal(Number(m[1]), 5, 'expected 5 files to be removed');

  const remainingSessions = fs.readdirSync(path.join(dataDir, 'sessions'));
  const remainingLogs = fs.readdirSync(path.join(dataDir, 'logs'));
  assert.deepEqual(remainingSessions, []);
  assert.deepEqual(remainingLogs, []);
});

test('reset.js --all without --yes prints a confirmation prompt and removes nothing', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-reset-'));
  fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
  const protectedJson = path.join(dataDir, 'sessions', 'keep.json');
  const protectedLog = path.join(dataDir, 'logs', 'keep.log');
  fs.writeFileSync(protectedJson, '{}');
  fs.writeFileSync(protectedLog, '{}');

  const result = await runReset({
    args: ['--all'],
    dataDir
  });

  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Refusing to wipe all sessions without --yes/);
  assert.equal(fs.existsSync(protectedJson), true, 'expected session JSON to remain untouched');
  assert.equal(fs.existsSync(protectedLog), true, 'expected log file to remain untouched');
});

test('reset.js fails with exit 1 when CLAUDE_PLUGIN_DATA is unset (per-session form)', async () => {
  const result = await runReset({
    input: { session_id: 'session-1' },
    extraEnv: { CLAUDE_PLUGIN_DATA: '' }
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /CLAUDE_PLUGIN_DATA is required/);
});

test('reset.js fails with exit 1 when stdin has no session_id', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-reset-'));
  const result = await runReset({ input: {}, dataDir });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /session_id is required/);
});
