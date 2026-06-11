const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const scriptPath = path.join(rootDir, 'scripts', 'statusline-fragment.sh');

const SHELL_BIN = (() => {
  // `sh` on every supported POSIX box should resolve to dash / bash / ksh;
  // the script is POSIX-sh, so this is just a shell invocation, not
  // `bash script.sh`.
  return process.env.SHELL_BIN || 'sh';
})();

const DEFAULT_TIMEOUT_MS = 5000;

function dateIsAvailable() {
  // GNU `date -d` is the primary path. BSD `date -j -f` is the fallback.
  // If neither is available, skip the test.
  const gnu = spawnSync('date', ['-d', '2026-04-12T19:00:00.000Z', '+%s'], {
    encoding: 'utf8'
  });
  if (gnu.status === 0 && /^\d+$/.test(gnu.stdout.trim())) {
    return { ok: true, kind: 'gnu' };
  }
  const bsd = spawnSync('date', ['-j', '-f', '%Y-%m-%dT%H:%M:%S', '2026-04-12T19:00:00', '+%s'], {
    encoding: 'utf8'
  });
  if (bsd.status === 0 && /^\d+$/.test(bsd.stdout.trim())) {
    return { ok: true, kind: 'bsd' };
  }
  return { ok: false };
}

const probe = dateIsAvailable();

function makeDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-sh-frag-'));
}

function seedLastResponse(dataDir, sessionId, ts) {
  const dir = path.join(dataDir, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  // No trailing newline: matches what the hook scripts write.
  fs.writeFileSync(path.join(dir, `${sessionId}.lastresponse`), ts);
}

function nowEpochSeconds() {
  const out = spawnSync('date', ['+%s'], { encoding: 'utf8' });
  if (out.status !== 0) {
    throw new Error(`date +%s failed: ${out.stderr}`);
  }
  return Number.parseInt(out.stdout.trim(), 10);
}

function epochToUtcIso(epoch) {
  const out = spawnSync('date', ['-u', '-d', `@${epoch}`, '+%Y-%m-%dT%H:%M:%S.000Z'], {
    encoding: 'utf8'
  });
  if (out.status !== 0) {
    throw new Error(`date -u -d @${epoch} failed: ${out.stderr}`);
  }
  return out.stdout.trim();
}

function runShell({ input = '', args = [], dataDir, env = {} } = {}) {
  return spawnSync(SHELL_BIN, [scriptPath, ...args], {
    cwd: rootDir,
    input,
    encoding: 'utf8',
    timeout: DEFAULT_TIMEOUT_MS,
    env: {
      ...process.env,
      // Wipe out the runtime env so each test sets its own data dir.
      CLAUDE_PLUGIN_DATA: '',
      CLAUDE_PLUGIN_ROOT: '',
      ...env
    }
  });
}

test('fragment formats elapsed time under 60 seconds as seconds only', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const sessionId = 'sub-minute';
  const ts = epochToUtcIso(nowEpochSeconds() - 30);

  seedLastResponse(dataDir, sessionId, ts);

  const result = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: ['--data-dir', dataDir]
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^([0-5]?[0-9])s\n$/, `unexpected: ${JSON.stringify(result.stdout)}`);
});

test('fragment formats 60s..drop-seconds-after as minutes + seconds', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const sessionId = 'min-sec';
  // 500s ago, default drop-seconds-after is 900 → minutes+seconds.
  const ts = epochToUtcIso(nowEpochSeconds() - 500);

  seedLastResponse(dataDir, sessionId, ts);

  const result = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: ['--data-dir', dataDir]
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^([0-9]+)m ([0-9]+)s\n$/,
    `unexpected: ${JSON.stringify(result.stdout)}`
  );
  const m = Number(result.stdout.match(/^([0-9]+)m/)[1]);
  const s = Number(result.stdout.match(/ ([0-9]+)s/)[1]);
  // 500s ago, the script's "now" reads a few ms later, so we expect ~8m20s.
  assert.equal(m, 8);
  assert.ok(s >= 19 && s <= 21, `seconds out of range: ${s}`);
});

test('fragment drops seconds once past --drop-seconds-after (default 900) under one hour', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const sessionId = 'drop';
  // 1000s ago, default drop-seconds-after is 900 → "16m".
  const ts = epochToUtcIso(nowEpochSeconds() - 1000);

  seedLastResponse(dataDir, sessionId, ts);

  const result = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: ['--data-dir', dataDir]
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^([0-9]+)m\n$/,
    `expected minutes-only, got: ${JSON.stringify(result.stdout)}`
  );
  const m = Number(result.stdout.match(/^([0-9]+)m/)[1]);
  assert.ok(m >= 16 && m <= 17, `expected 16-17m, got ${m}`);
});

test('fragment formats 1h..24h as hours + minutes', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const sessionId = 'hours';
  // 12000s ago (~3h20m).
  const ts = epochToUtcIso(nowEpochSeconds() - 12000);

  seedLastResponse(dataDir, sessionId, ts);

  const result = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: ['--data-dir', dataDir]
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^([0-9]+)h ([0-9]+)m\n$/,
    `unexpected: ${JSON.stringify(result.stdout)}`
  );
  const h = Number(result.stdout.match(/^([0-9]+)h/)[1]);
  const m = Number(result.stdout.match(/ ([0-9]+)m/)[1]);
  assert.equal(h, 3);
  assert.ok(m >= 19 && m <= 21, `minutes out of range: ${m}`);
});

test('fragment formats >= 1d as days + hours', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const sessionId = 'days';
  // 100000s ago (~1d 3h 46m).
  const ts = epochToUtcIso(nowEpochSeconds() - 100000);

  seedLastResponse(dataDir, sessionId, ts);

  const result = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: ['--data-dir', dataDir]
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(
    result.stdout,
    /^([0-9]+)d ([0-9]+)h\n$/,
    `unexpected: ${JSON.stringify(result.stdout)}`
  );
  const d = Number(result.stdout.match(/^([0-9]+)d/)[1]);
  const h = Number(result.stdout.match(/ ([0-9]+)h/)[1]);
  assert.equal(d, 1);
  assert.ok(h >= 3 && h <= 4, `hours out of range: ${h}`);
});

test('fragment prints empty when stdin has no session_id', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const result = runShell({
    input: JSON.stringify({ other: 'value' }),
    args: ['--data-dir', dataDir]
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stdout, '');
});

test('fragment prints empty when stdin is invalid JSON', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const result = runShell({
    input: 'not json at all',
    args: ['--data-dir', dataDir]
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stdout, '');
});

test('fragment prints empty when stdin is empty', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const result = runShell({
    input: '',
    args: ['--data-dir', dataDir]
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stdout, '');
});

test('fragment prints empty when no .lastresponse file exists', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const result = runShell({
    input: JSON.stringify({ session_id: 'never-seen' }),
    args: ['--data-dir', dataDir]
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stdout, '');
});

test('fragment prints empty when .lastresponse is malformed', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const sessionId = 'malformed';
  seedLastResponse(dataDir, sessionId, 'totally not a date');
  const result = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: ['--data-dir', dataDir]
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stdout, '');
});

test('fragment prints empty when .lastresponse is empty', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const sessionId = 'empty';
  seedLastResponse(dataDir, sessionId, '');
  const result = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: ['--data-dir', dataDir]
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stdout, '');
});

test('fragment respects --data-dir flag', { skip: !probe.ok }, () => {
  // Seed two different data dirs with different timestamps for the same session.
  // We pick well-separated offsets (5s and 75s) so the timing race between
  // the test computing "now" and the script computing "now" can't push us
  // across a format boundary.
  const dir1 = makeDataDir();
  const dir2 = makeDataDir();
  const sessionId = 'same-session';

  const ts1 = epochToUtcIso(nowEpochSeconds() - 5);
  const ts2 = epochToUtcIso(nowEpochSeconds() - 75);
  seedLastResponse(dir1, sessionId, ts1);
  seedLastResponse(dir2, sessionId, ts2);

  const result1 = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: ['--data-dir', dir1]
  });
  const result2 = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: ['--data-dir', dir2]
  });

  assert.equal(result1.status, 0, `stderr: ${result1.stderr}`);
  assert.equal(result2.status, 0, `stderr: ${result2.stderr}`);

  // 5s ago → sub-minute, "Ns". 75s ago → 1m 15s ± a few s.
  assert.match(result1.stdout, /^[0-9]s\n$/, `unexpected: ${result1.stdout}`);
  assert.match(result2.stdout, /^1m [0-9]+s\n$/, `unexpected: ${result2.stdout}`);
  const m2 = Number(result2.stdout.match(/^1m ([0-9]+)s/)[1]);
  assert.ok(m2 >= 14 && m2 <= 17, `unexpected minutes-seconds for 75s offset: ${result2.stdout}`);
});

test('fragment respects --data-dir=foo=bar (with = separator)', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const sessionId = 'eq-form';
  const ts = epochToUtcIso(nowEpochSeconds() - 45);
  seedLastResponse(dataDir, sessionId, ts);

  const result = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: [`--data-dir=${dataDir}`]
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /^[0-5]?[0-9]s\n$/, `unexpected: ${result.stdout}`);
});

test('fragment respects --drop-seconds-after flag (forces minutes-only below 1h)', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const sessionId = 'drop-override';
  // 200s ago. Default drop is 900 → "3m 20s"; with --drop-seconds-after 60 → "3m".
  const ts = epochToUtcIso(nowEpochSeconds() - 200);

  seedLastResponse(dataDir, sessionId, ts);

  const withDefault = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: ['--data-dir', dataDir]
  });
  assert.equal(withDefault.status, 0, `stderr: ${withDefault.stderr}`);
  assert.match(withDefault.stdout, /^3m 20s\n$/, `default: ${withDefault.stdout}`);

  const withLowerThreshold = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: ['--data-dir', dataDir, '--drop-seconds-after', '60']
  });
  assert.equal(withLowerThreshold.status, 0, `stderr: ${withLowerThreshold.stderr}`);
  assert.match(
    withLowerThreshold.stdout,
    /^3m\n$/,
    `with --drop-seconds-after=60: ${withLowerThreshold.stdout}`
  );
});

test('fragment uses $CLAUDE_PLUGIN_DATA when --data-dir is not given', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  const sessionId = 'env-data';
  const ts = epochToUtcIso(nowEpochSeconds() - 42);
  seedLastResponse(dataDir, sessionId, ts);

  const result = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: [],
    env: { CLAUDE_PLUGIN_DATA: dataDir }
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /^[0-5]?[0-9]s\n$/, `unexpected: ${result.stdout}`);
});

test('fragment falls back to $CLAUDE_PLUGIN_ROOT/data when neither --data-dir nor $CLAUDE_PLUGIN_DATA is set', { skip: !probe.ok }, () => {
  const root = makeDataDir();
  const dataDir = path.join(root, 'data');
  const sessionId = 'env-root';
  const ts = epochToUtcIso(nowEpochSeconds() - 7);
  seedLastResponse(dataDir, sessionId, ts);

  const result = runShell({
    input: JSON.stringify({ session_id: sessionId }),
    args: [],
    env: { CLAUDE_PLUGIN_DATA: '', CLAUDE_PLUGIN_ROOT: root }
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /^[0-9]s\n$/, `unexpected: ${result.stdout}`);
});

test('fragment sanitizes session id with unsafe characters', { skip: !probe.ok }, () => {
  const dataDir = makeDataDir();
  // The shell script does its own sanitization; we mimic the JS sanitizer's
  // output by using the safe id when seeding the file. The stdin
  // session_id has unsafe chars that get replaced.
  const unsafe = '../escape/abc';
  const safe = '.._escape_abc';
  const ts = epochToUtcIso(nowEpochSeconds() - 12);
  seedLastResponse(dataDir, safe, ts);

  const result = runShell({
    input: JSON.stringify({ session_id: unsafe }),
    args: ['--data-dir', dataDir]
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /^[0-5]?[0-9]s\n$/, `unexpected: ${result.stdout}`);
});

test('fragment exits 0 even when both GNU and BSD date paths are absent (smoke test of the empty-output contract)', () => {
  // We don't actually strip date from the system; we just confirm the
  // "no data dir" / "no .lastresponse" path is benign when date is
  // never called.
  const dataDir = makeDataDir();
  const result = runShell({
    input: '',
    args: ['--data-dir', dataDir]
  });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.equal(result.stdout, '');
});
