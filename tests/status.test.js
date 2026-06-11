const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const scriptPath = path.join(rootDir, 'scripts', 'status.js');
const DEFAULT_TIMEOUT_MS = 15000;

function runStatus({ dataDir, extraEnv = {} } = {}) {
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

    const child = spawn(process.execPath, [scriptPath], {
      cwd: rootDir,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`status timed out after ${DEFAULT_TIMEOUT_MS}ms`));
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });

    child.stdin.end('');
  });
}

test('status.js exits 0 and reports PASS for all three hooks against a writable data dir', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-status-'));
  const result = await runStatus({ dataDir });

  assert.equal(result.code, 0, `expected exit 0, stderr was: ${result.stderr}`);
  assert.match(result.stdout, /idle-timing status/);
  assert.match(result.stdout, new RegExp(`data dir:\\s+${dataDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*writable`));
  assert.match(result.stdout, /UserPromptSubmit:\s+PASS/);
  assert.match(result.stdout, /Stop:\s+PASS/);
  assert.match(result.stdout, /PreCompact:\s+PASS/);
  assert.match(result.stdout, /3\/3 hooks OK/);
});

test('status.js reports the version from the package.json', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-status-'));
  const result = await runStatus({ dataDir });

  const manifest = JSON.parse(
    fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')
  );
  assert.match(result.stdout, new RegExp(`version:\\s+${manifest.version}`));
});

test('status.js exits non-zero and prints FAIL when CLAUDE_PLUGIN_DATA is unset', async () => {
  const result = await runStatus({ extraEnv: { CLAUDE_PLUGIN_DATA: '' } });

  assert.notEqual(result.code, 0, `expected non-zero exit, got ${result.code}`);
  assert.match(result.stdout, /CLAUDE_PLUGIN_DATA/);
  assert.match(result.stdout, /FAIL/);
});

test('status.js includes a PASS/FAIL line per hook', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-status-'));
  const result = await runStatus({ dataDir });

  for (const hook of ['UserPromptSubmit', 'Stop', 'PreCompact']) {
    assert.match(
      result.stdout,
      new RegExp(`${hook}:\\s+(PASS|FAIL)`),
      `expected a PASS/FAIL line for ${hook}, got:\n${result.stdout}`
    );
  }
});
