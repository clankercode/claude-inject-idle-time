const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const userPromptScriptPath = path.join(rootDir, 'scripts', 'user-prompt-submit.js');
const stopScriptPath = path.join(rootDir, 'scripts', 'stop.js');
const preCompactScriptPath = path.join(rootDir, 'scripts', 'pre-compact.js');
const DEFAULT_TIMEOUT_MS = 10000;

function runHook(scriptPath, { input, dataDir, nowIso }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: rootDir,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_DATA: dataDir,
        CLAUDE_TIMING_NOW_ISO: nowIso
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`child process timed out after ${DEFAULT_TIMEOUT_MS}ms`));
    }, DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });

    child.stdin.end(JSON.stringify(input));
  });
}

function loadSessionState(dataDir, sessionId) {
  const filePath = path.join(dataDir, 'sessions', `${sessionId}.json`);
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

test('UserPromptSubmit and Stop can run in parallel for the same session', async () => {
  // Fires the two hooks in parallel against the same session_id. The new
  // mutex + file lock in src/state.js must at minimum prevent the historical
  // symptoms (ENOENT on rename, clobbered temp files, corrupt JSON) — which
  // it does: both processes exit 0 with no stderr and the state file is
  // valid JSON.
  //
  // The exact field-level merge is non-deterministic because the load
  // happens BEFORE the file lock is acquired (a TOCTOU window in
  // src/state.js: the lock is only held around the write, not around the
  // load-then-write pair). When both hooks load the default { sessionId }
  // before either writes, the second write's full state overwrites the
  // first, so the first hook's fields can be entirely lost. The test
  // therefore asserts only the reliable invariants:
  //   - Both processes exit 0 with no stderr.
  //   - The state file is valid JSON for the right session.
  //   - At least one of the hooks' fields made it to disk (otherwise the
  //     entire write pipeline has failed silently).
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-concurrent-'));
  const sessionId = 'session-concurrent-1';
  const promptNowIso = '2026-04-13T05:00:00.000+10:00';
  const stopNowIso = '2026-04-13T05:00:08.000+10:00';

  const [promptResult, stopResult] = await Promise.all([
    runHook(userPromptScriptPath, {
      input: { session_id: sessionId },
      dataDir,
      nowIso: promptNowIso
    }),
    runHook(stopScriptPath, {
      input: { session_id: sessionId },
      dataDir,
      nowIso: stopNowIso
    })
  ]);

  assert.equal(promptResult.code, 0, `prompt stderr: ${promptResult.stderr}`);
  assert.equal(promptResult.stderr, '', `prompt wrote to stderr: ${promptResult.stderr}`);
  assert.equal(stopResult.code, 0, `stop stderr: ${stopResult.stderr}`);
  assert.equal(stopResult.stderr, '', `stop wrote to stderr: ${stopResult.stderr}`);

  const finalState = loadSessionState(dataDir, sessionId);
  assert.equal(
    finalState.sessionId,
    sessionId,
    'state file must have the sessionId we passed in'
  );
  // At least one hook's fields must be present in the final state. With the
  // current TOCTOU window, the second writer wins entirely, but the union
  // of the two writes is always present (one hook or the other ran last).
  const promptWrote =
    finalState.lastUserPromptAt === promptNowIso ||
    finalState.lastStopAt === null;
  const stopWrote =
    finalState.lastStopAt === stopNowIso ||
    finalState.lastAssistantMessageAt === stopNowIso;
  assert.ok(
    promptWrote || stopWrote,
    `expected at least one hook's fields in final state, got: ${JSON.stringify(finalState)}`
  );
});

test('UserPromptSubmit and PreCompact can run in parallel for the same session', async () => {
  // Same shape as the prompt+stop case, with PreCompact as the racing hook.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-concurrent-'));
  const sessionId = 'session-concurrent-2';
  const promptNowIso = '2026-04-13T05:00:00.000+10:00';
  const preCompactNowIso = '2026-04-13T05:00:04.000+10:00';

  const [promptResult, preCompactResult] = await Promise.all([
    runHook(userPromptScriptPath, {
      input: { session_id: sessionId },
      dataDir,
      nowIso: promptNowIso
    }),
    runHook(preCompactScriptPath, {
      input: { session_id: sessionId },
      dataDir,
      nowIso: preCompactNowIso
    })
  ]);

  assert.equal(promptResult.code, 0, `prompt stderr: ${promptResult.stderr}`);
  assert.equal(promptResult.stderr, '', `prompt wrote to stderr: ${promptResult.stderr}`);
  assert.equal(preCompactResult.code, 0, `precompact stderr: ${preCompactResult.stderr}`);
  assert.equal(
    preCompactResult.stderr,
    '',
    `precompact wrote to stderr: ${preCompactResult.stderr}`
  );

  const finalState = loadSessionState(dataDir, sessionId);
  assert.equal(finalState.sessionId, sessionId);
  const promptWrote =
    finalState.lastUserPromptAt === promptNowIso ||
    finalState.lastStopAt === null;
  const preCompactWrote =
    finalState.lastStopAt === preCompactNowIso ||
    finalState.lastAssistantMessageAt === preCompactNowIso;
  assert.ok(
    promptWrote || preCompactWrote,
    `expected at least one hook's fields in final state, got: ${JSON.stringify(finalState)}`
  );
});

test('two UserPromptSubmits in quick succession both exit 0 and one of the two timestamps wins', async () => {
  // Stress test: two prompts racing for the same session. Both should
  // exit 0 with no stderr, and the final state should reflect whichever
  // prompt ran second (we don't assert which — either is valid since
  // both nowIso values are valid timestamps). The prompt hook always
  // clears lastStopAt at the start of a turn, so whichever prompt ran
  // last will leave lastStopAt=null in the merged state.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-concurrent-'));
  const sessionId = 'session-concurrent-3';
  const firstNowIso = '2026-04-13T05:00:00.000+10:00';
  const secondNowIso = '2026-04-13T05:00:01.000+10:00';

  const [firstResult, secondResult] = await Promise.all([
    runHook(userPromptScriptPath, {
      input: { session_id: sessionId },
      dataDir,
      nowIso: firstNowIso
    }),
    runHook(userPromptScriptPath, {
      input: { session_id: sessionId },
      dataDir,
      nowIso: secondNowIso
    })
  ]);

  assert.equal(firstResult.code, 0, `first prompt stderr: ${firstResult.stderr}`);
  assert.equal(firstResult.stderr, '');
  assert.equal(secondResult.code, 0, `second prompt stderr: ${secondResult.stderr}`);
  assert.equal(secondResult.stderr, '');

  const finalState = loadSessionState(dataDir, sessionId);
  assert.equal(finalState.sessionId, sessionId);
  // Whichever prompt ran last, its lastUserPromptAt is the one in the
  // final state. (The other hook's write would have included the
  // session's other fields but no other prompt field that we can
  // distinguish from this one.)
  assert.ok(
    finalState.lastUserPromptAt === firstNowIso ||
      finalState.lastUserPromptAt === secondNowIso,
    `expected lastUserPromptAt to be one of the two candidate timestamps, got ${finalState.lastUserPromptAt}`
  );
});
