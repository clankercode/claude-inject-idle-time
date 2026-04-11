# Claude Code Idle Timing Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin that injects per-message timing context on every user prompt and persists the previous turn's timing state across `UserPromptSubmit` and `Stop` hooks.

**Architecture:** Use two official Claude Code command hooks backed by a tiny Node.js codebase. `UserPromptSubmit` reads persisted session state and emits hidden `additionalContext`, while `Stop` records end-of-turn timing data under `${CLAUDE_PLUGIN_DATA}` for the next prompt.

**Tech Stack:** Node.js CommonJS, built-in `node:test`, Claude Code plugin hooks, JSON files under `${CLAUDE_PLUGIN_DATA}`

---

## Planned File Structure

- `.claude-plugin/plugin.json`: plugin manifest
- `hooks/hooks.json`: Claude Code hook registration
- `package.json`: test and validation scripts
- `src/time.js`: timestamp helpers and duration math
- `src/format.js`: timing block formatter
- `src/state.js`: per-session JSON persistence helpers
- `scripts/user-prompt-submit.js`: `UserPromptSubmit` hook entrypoint
- `scripts/stop.js`: `Stop` hook entrypoint
- `tests/installability.test.js`: plugin shape and hook registration checks
- `tests/core.test.js`: unit coverage for time, formatting, and state helpers
- `tests/user-prompt-submit.test.js`: contract tests for hidden context injection
- `tests/stop.test.js`: contract tests for state updates on `Stop`
- `tests/integration.test.js`: full prompt-stop-prompt timing flow

### Task 1: Scaffold The Plugin And Installability Test

**Files:**
- Create: `tests/installability.test.js`
- Create: `.claude-plugin/plugin.json`
- Create: `hooks/hooks.json`
- Create: `package.json`

- [ ] **Step 1: Write the failing installability test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

test('plugin manifest describes the idle timing plugin', () => {
  const manifestPath = path.join(rootDir, '.claude-plugin', 'plugin.json');

  assert.ok(fs.existsSync(manifestPath), 'expected plugin manifest to exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.name, 'idle-timing');
  assert.match(manifest.description, /timing context/i);
  assert.equal(manifest.version, '0.1.0');
});

test('hook config registers UserPromptSubmit and Stop handlers', () => {
  const hooksPath = path.join(rootDir, 'hooks', 'hooks.json');

  assert.ok(fs.existsSync(hooksPath), 'expected hook config to exist');

  const config = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  const userPromptCommand = config.hooks.UserPromptSubmit[0].hooks[0].command;
  const stopCommand = config.hooks.Stop[0].hooks[0].command;

  assert.equal(
    userPromptCommand,
    'node ${CLAUDE_PLUGIN_ROOT}/scripts/user-prompt-submit.js'
  );
  assert.equal(stopCommand, 'node ${CLAUDE_PLUGIN_ROOT}/scripts/stop.js');
});
```

- [ ] **Step 2: Run the installability test to verify it fails**

Run: `node --test tests/installability.test.js`

Expected: FAIL with missing `.claude-plugin/plugin.json` and `hooks/hooks.json` assertions.

- [ ] **Step 3: Write the minimal plugin scaffold**

`.claude-plugin/plugin.json`

```json
{
  "name": "idle-timing",
  "description": "Inject hidden timing context into Claude Code prompts.",
  "version": "0.1.0"
}
```

`hooks/hooks.json`

```json
{
  "description": "Inject per-message timing context for Claude Code sessions.",
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/user-prompt-submit.js",
            "timeout": 30
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/stop.js",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

`package.json`

```json
{
  "name": "claude-code-idle-timing-plugin",
  "private": true,
  "version": "0.1.0",
  "description": "Claude Code plugin that injects per-message timing context.",
  "scripts": {
    "test": "node --test tests/*.test.js",
    "validate:plugin": "sh -c 'if command -v claude >/dev/null 2>&1; then claude plugin validate .; else printf \"skip: claude CLI not installed\\n\"; fi'"
  }
}
```

- [ ] **Step 4: Run the installability test to verify it passes**

Run: `node --test tests/installability.test.js`

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit the scaffold**

```bash
git add tests/installability.test.js .claude-plugin/plugin.json hooks/hooks.json package.json
git commit -m "feat: scaffold idle timing plugin"
```

### Task 2: Add Shared Time, Formatting, And State Helpers

**Files:**
- Create: `tests/core.test.js`
- Create: `src/time.js`
- Create: `src/format.js`
- Create: `src/state.js`

- [ ] **Step 1: Write the failing shared-helper tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { toIsoUtc, getNowIso, diffMs } = require('../src/time');
const { formatTimingBlock } = require('../src/format');
const { getSessionFilePath, loadSessionState, saveSessionState } = require('../src/state');

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

test('formatTimingBlock includes only available numeric fields', () => {
  const block = formatTimingBlock({
    userMessageUtc: '2026-04-12T18:34:56.789Z',
    idleSinceLastAssistantMs: null,
    idleSinceLastStopMs: 14890,
    lastTurnExecMs: 4321
  });

  assert.equal(
    block,
    [
      '[message_timing]',
      'user_message_utc: 2026-04-12T18:34:56.789Z',
      'idle_since_last_stop_ms: 14890',
      'last_turn_exec_ms: 4321',
      '[/message_timing]'
    ].join('\n')
  );
});

test('loadSessionState returns a default object when the session is new', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-core-'));

  const state = await loadSessionState({ dataDir, sessionId: 'session-1' });

  assert.deepEqual(state, { sessionId: 'session-1' });
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
});
```

- [ ] **Step 2: Run the shared-helper tests to verify they fail**

Run: `node --test tests/core.test.js`

Expected: FAIL with `Cannot find module '../src/time'` or equivalent missing-module errors.

- [ ] **Step 3: Write the minimal shared-helper implementation**

`src/time.js`

```js
function toIsoUtc(value) {
  return new Date(value).toISOString();
}

function getNowIso(env = process.env, nowFactory = () => new Date()) {
  return env.CLAUDE_TIMING_NOW_ISO || nowFactory().toISOString();
}

function diffMs(laterIso, earlierIso) {
  if (!laterIso || !earlierIso) {
    return null;
  }

  return Date.parse(laterIso) - Date.parse(earlierIso);
}

module.exports = {
  toIsoUtc,
  getNowIso,
  diffMs
};
```

`src/format.js`

```js
function appendNumberLine(lines, name, value) {
  if (typeof value === 'number') {
    lines.push(`${name}: ${value}`);
  }
}

function formatTimingBlock({
  userMessageUtc,
  idleSinceLastAssistantMs,
  idleSinceLastStopMs,
  lastTurnExecMs
}) {
  const lines = ['[message_timing]', `user_message_utc: ${userMessageUtc}`];

  appendNumberLine(lines, 'idle_since_last_assistant_ms', idleSinceLastAssistantMs);
  appendNumberLine(lines, 'idle_since_last_stop_ms', idleSinceLastStopMs);
  appendNumberLine(lines, 'last_turn_exec_ms', lastTurnExecMs);

  lines.push('[/message_timing]');
  return lines.join('\n');
}

module.exports = {
  formatTimingBlock
};
```

`src/state.js`

```js
const fs = require('node:fs/promises');
const path = require('node:path');

function getSessionFilePath(dataDir, sessionId) {
  return path.join(dataDir, 'sessions', `${sessionId}.json`);
}

async function loadSessionState({ dataDir, sessionId }) {
  try {
    const raw = await fs.readFile(getSessionFilePath(dataDir, sessionId), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { sessionId };
    }

    throw error;
  }
}

async function saveSessionState({ dataDir, sessionId, state }) {
  const filePath = getSessionFilePath(dataDir, sessionId);
  const nextState = { sessionId, ...state };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(nextState, null, 2));

  return nextState;
}

module.exports = {
  getSessionFilePath,
  loadSessionState,
  saveSessionState
};
```

- [ ] **Step 4: Run the shared-helper tests to verify they pass**

Run: `node --test tests/core.test.js`

Expected: PASS with 7 passing tests.

- [ ] **Step 5: Commit the shared helpers**

```bash
git add tests/core.test.js src/time.js src/format.js src/state.js
git commit -m "feat: add timing state helpers"
```

### Task 3: Implement The UserPromptSubmit Hook

**Files:**
- Create: `tests/user-prompt-submit.test.js`
- Create: `scripts/user-prompt-submit.js`

- [ ] **Step 1: Write the failing UserPromptSubmit hook tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { loadSessionState, saveSessionState } = require('../src/state');

function runUserPromptHook({ pluginDataDir, nowIso, input }) {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'user-prompt-submit.js')], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: pluginDataDir,
      CLAUDE_TIMING_NOW_ISO: nowIso
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');

  return JSON.parse(result.stdout);
}

test('first prompt injects only the UTC timestamp block', async () => {
  const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-user-'));
  const output = runUserPromptHook({
    pluginDataDir,
    nowIso: '2026-04-12T18:34:56.789Z',
    input: {
      session_id: 'session-1',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/tmp/project',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hello'
    }
  });

  assert.deepEqual(output, {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: [
        '[message_timing]',
        'user_message_utc: 2026-04-12T18:34:56.789Z',
        '[/message_timing]'
      ].join('\n')
    }
  });

  const persisted = await loadSessionState({ dataDir: pluginDataDir, sessionId: 'session-1' });
  assert.equal(persisted.lastUserPromptAt, '2026-04-12T18:34:56.789Z');
});

test('later prompts include idle and previous execution timings from state', async () => {
  const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-user-'));

  await saveSessionState({
    dataDir: pluginDataDir,
    sessionId: 'session-2',
    state: {
      lastAssistantMessageAt: '2026-04-12T18:34:40.000Z',
      lastStopAt: '2026-04-12T18:34:41.899Z',
      lastTurnExecMs: 4321
    }
  });

  const output = runUserPromptHook({
    pluginDataDir,
    nowIso: '2026-04-12T18:34:56.789Z',
    input: {
      session_id: 'session-2',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/tmp/project',
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hello again'
    }
  });

  assert.equal(
    output.hookSpecificOutput.additionalContext,
    [
      '[message_timing]',
      'user_message_utc: 2026-04-12T18:34:56.789Z',
      'idle_since_last_assistant_ms: 16789',
      'idle_since_last_stop_ms: 14890',
      'last_turn_exec_ms: 4321',
      '[/message_timing]'
    ].join('\n')
  );
});
```

- [ ] **Step 2: Run the UserPromptSubmit tests to verify they fail**

Run: `node --test tests/user-prompt-submit.test.js`

Expected: FAIL because `scripts/user-prompt-submit.js` does not exist yet.

- [ ] **Step 3: Write the minimal UserPromptSubmit hook**

`scripts/user-prompt-submit.js`

```js
#!/usr/bin/env node

const { formatTimingBlock } = require('../src/format');
const { loadSessionState, saveSessionState } = require('../src/state');
const { diffMs, getNowIso } = require('../src/time');

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => resolve(buffer));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const rawInput = await readStdin();
  const input = JSON.parse(rawInput);
  const sessionId = input.session_id;
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;

  if (!dataDir) {
    throw new Error('CLAUDE_PLUGIN_DATA is required');
  }

  const userMessageUtc = getNowIso();
  const session = await loadSessionState({ dataDir, sessionId });

  await saveSessionState({
    dataDir,
    sessionId,
    state: {
      ...session,
      lastUserPromptAt: userMessageUtc
    }
  });

  const additionalContext = formatTimingBlock({
    userMessageUtc,
    idleSinceLastAssistantMs: diffMs(userMessageUtc, session.lastAssistantMessageAt),
    idleSinceLastStopMs: diffMs(userMessageUtc, session.lastStopAt),
    lastTurnExecMs: session.lastTurnExecMs
  });

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext
      }
    })
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the UserPromptSubmit tests to verify they pass**

Run: `node --test tests/user-prompt-submit.test.js`

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit the UserPromptSubmit hook**

```bash
git add tests/user-prompt-submit.test.js scripts/user-prompt-submit.js
git commit -m "feat: inject timing context on prompt submit"
```

### Task 4: Implement The Stop Hook

**Files:**
- Create: `tests/stop.test.js`
- Create: `scripts/stop.js`

- [ ] **Step 1: Write the failing Stop hook tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { loadSessionState, saveSessionState } = require('../src/state');

function runStopHook({ pluginDataDir, nowIso, input }) {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'stop.js')], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: pluginDataDir,
      CLAUDE_TIMING_NOW_ISO: nowIso
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

test('stop records stop time, assistant time, and previous execution duration', async () => {
  const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-stop-'));

  await saveSessionState({
    dataDir: pluginDataDir,
    sessionId: 'session-1',
    state: {
      lastUserPromptAt: '2026-04-12T18:34:56.789Z'
    }
  });

  runStopHook({
    pluginDataDir,
    nowIso: '2026-04-12T18:35:01.110Z',
    input: {
      session_id: 'session-1',
      hook_event_name: 'Stop'
    }
  });

  const persisted = await loadSessionState({ dataDir: pluginDataDir, sessionId: 'session-1' });

  assert.deepEqual(persisted, {
    sessionId: 'session-1',
    lastUserPromptAt: '2026-04-12T18:34:56.789Z',
    lastStopAt: '2026-04-12T18:35:01.110Z',
    lastAssistantMessageAt: '2026-04-12T18:35:01.110Z',
    lastTurnExecMs: 4321
  });
});

test('stop still records the stop time when there is no last prompt timestamp', async () => {
  const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-stop-'));

  runStopHook({
    pluginDataDir,
    nowIso: '2026-04-12T18:35:01.110Z',
    input: {
      session_id: 'session-2',
      hook_event_name: 'Stop'
    }
  });

  const persisted = await loadSessionState({ dataDir: pluginDataDir, sessionId: 'session-2' });

  assert.deepEqual(persisted, {
    sessionId: 'session-2',
    lastStopAt: '2026-04-12T18:35:01.110Z',
    lastAssistantMessageAt: '2026-04-12T18:35:01.110Z'
  });
});
```

- [ ] **Step 2: Run the Stop hook tests to verify they fail**

Run: `node --test tests/stop.test.js`

Expected: FAIL because `scripts/stop.js` does not exist yet.

- [ ] **Step 3: Write the minimal Stop hook**

`scripts/stop.js`

```js
#!/usr/bin/env node

const { loadSessionState, saveSessionState } = require('../src/state');
const { diffMs, getNowIso } = require('../src/time');

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => resolve(buffer));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const rawInput = await readStdin();
  const input = JSON.parse(rawInput);
  const sessionId = input.session_id;
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;

  if (!dataDir) {
    throw new Error('CLAUDE_PLUGIN_DATA is required');
  }

  const lastStopAt = getNowIso();
  const session = await loadSessionState({ dataDir, sessionId });
  const lastTurnExecMs = diffMs(lastStopAt, session.lastUserPromptAt);

  const nextState = {
    ...session,
    lastStopAt,
    lastAssistantMessageAt: lastStopAt
  };

  if (typeof lastTurnExecMs === 'number') {
    nextState.lastTurnExecMs = lastTurnExecMs;
  }

  await saveSessionState({
    dataDir,
    sessionId,
    state: nextState
  });
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the Stop hook tests to verify they pass**

Run: `node --test tests/stop.test.js`

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit the Stop hook**

```bash
git add tests/stop.test.js scripts/stop.js
git commit -m "feat: persist stop timing state"
```

### Task 5: Add End-To-End Flow Coverage And Final Verification

**Files:**
- Create: `tests/integration.test.js`
- Modify: `tests/installability.test.js`

- [ ] **Step 1: Write the failing integration and final installability tests**

`tests/integration.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runHook(scriptName, pluginDataDir, nowIso, input) {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', scriptName)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: pluginDataDir,
      CLAUDE_TIMING_NOW_ISO: nowIso
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');

  return result.stdout;
}

test('prompt, stop, prompt produces the expected timing block on the second prompt', () => {
  const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-integration-'));

  const firstPrompt = runHook('user-prompt-submit.js', pluginDataDir, '2026-04-12T18:34:56.789Z', {
    session_id: 'session-1',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp/project',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'first'
  });

  assert.equal(
    JSON.parse(firstPrompt).hookSpecificOutput.additionalContext,
    [
      '[message_timing]',
      'user_message_utc: 2026-04-12T18:34:56.789Z',
      '[/message_timing]'
    ].join('\n')
  );

  runHook('stop.js', pluginDataDir, '2026-04-12T18:35:01.110Z', {
    session_id: 'session-1',
    hook_event_name: 'Stop'
  });

  const secondPrompt = runHook('user-prompt-submit.js', pluginDataDir, '2026-04-12T18:35:16.000Z', {
    session_id: 'session-1',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp/project',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'second'
  });

  assert.equal(
    JSON.parse(secondPrompt).hookSpecificOutput.additionalContext,
    [
      '[message_timing]',
      'user_message_utc: 2026-04-12T18:35:16.000Z',
      'idle_since_last_assistant_ms: 14890',
      'idle_since_last_stop_ms: 14890',
      'last_turn_exec_ms: 4321',
      '[/message_timing]'
    ].join('\n')
  );
});
```

Update `tests/installability.test.js` to this final version so it also checks that both hook scripts now exist:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

test('plugin manifest describes the idle timing plugin', () => {
  const manifestPath = path.join(rootDir, '.claude-plugin', 'plugin.json');

  assert.ok(fs.existsSync(manifestPath), 'expected plugin manifest to exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.name, 'idle-timing');
  assert.match(manifest.description, /timing context/i);
  assert.equal(manifest.version, '0.1.0');
});

test('hook config registers UserPromptSubmit and Stop handlers', () => {
  const hooksPath = path.join(rootDir, 'hooks', 'hooks.json');

  assert.ok(fs.existsSync(hooksPath), 'expected hook config to exist');

  const config = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  const userPromptCommand = config.hooks.UserPromptSubmit[0].hooks[0].command;
  const stopCommand = config.hooks.Stop[0].hooks[0].command;

  assert.equal(
    userPromptCommand,
    'node ${CLAUDE_PLUGIN_ROOT}/scripts/user-prompt-submit.js'
  );
  assert.equal(stopCommand, 'node ${CLAUDE_PLUGIN_ROOT}/scripts/stop.js');
});

test('hook scripts exist at the configured paths', () => {
  assert.ok(
    fs.existsSync(path.join(rootDir, 'scripts', 'user-prompt-submit.js')),
    'expected UserPromptSubmit script to exist'
  );
  assert.ok(
    fs.existsSync(path.join(rootDir, 'scripts', 'stop.js')),
    'expected Stop script to exist'
  );
});
```

- [ ] **Step 2: Run the integration suite to verify it fails**

Run: `node --test tests/integration.test.js tests/installability.test.js`

Expected: FAIL because the integration test does not exist yet and the installability test does not yet assert script existence.

- [ ] **Step 3: Add the final tests exactly as written above**

`tests/integration.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runHook(scriptName, pluginDataDir, nowIso, input) {
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', scriptName)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: pluginDataDir,
      CLAUDE_TIMING_NOW_ISO: nowIso
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');

  return result.stdout;
}

test('prompt, stop, prompt produces the expected timing block on the second prompt', () => {
  const pluginDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-integration-'));

  const firstPrompt = runHook('user-prompt-submit.js', pluginDataDir, '2026-04-12T18:34:56.789Z', {
    session_id: 'session-1',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp/project',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'first'
  });

  assert.equal(
    JSON.parse(firstPrompt).hookSpecificOutput.additionalContext,
    [
      '[message_timing]',
      'user_message_utc: 2026-04-12T18:34:56.789Z',
      '[/message_timing]'
    ].join('\n')
  );

  runHook('stop.js', pluginDataDir, '2026-04-12T18:35:01.110Z', {
    session_id: 'session-1',
    hook_event_name: 'Stop'
  });

  const secondPrompt = runHook('user-prompt-submit.js', pluginDataDir, '2026-04-12T18:35:16.000Z', {
    session_id: 'session-1',
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/tmp/project',
    hook_event_name: 'UserPromptSubmit',
    prompt: 'second'
  });

  assert.equal(
    JSON.parse(secondPrompt).hookSpecificOutput.additionalContext,
    [
      '[message_timing]',
      'user_message_utc: 2026-04-12T18:35:16.000Z',
      'idle_since_last_assistant_ms: 14890',
      'idle_since_last_stop_ms: 14890',
      'last_turn_exec_ms: 4321',
      '[/message_timing]'
    ].join('\n')
  );
});
```

`tests/installability.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

test('plugin manifest describes the idle timing plugin', () => {
  const manifestPath = path.join(rootDir, '.claude-plugin', 'plugin.json');

  assert.ok(fs.existsSync(manifestPath), 'expected plugin manifest to exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.name, 'idle-timing');
  assert.match(manifest.description, /timing context/i);
  assert.equal(manifest.version, '0.1.0');
});

test('hook config registers UserPromptSubmit and Stop handlers', () => {
  const hooksPath = path.join(rootDir, 'hooks', 'hooks.json');

  assert.ok(fs.existsSync(hooksPath), 'expected hook config to exist');

  const config = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  const userPromptCommand = config.hooks.UserPromptSubmit[0].hooks[0].command;
  const stopCommand = config.hooks.Stop[0].hooks[0].command;

  assert.equal(
    userPromptCommand,
    'node ${CLAUDE_PLUGIN_ROOT}/scripts/user-prompt-submit.js'
  );
  assert.equal(stopCommand, 'node ${CLAUDE_PLUGIN_ROOT}/scripts/stop.js');
});

test('hook scripts exist at the configured paths', () => {
  assert.ok(
    fs.existsSync(path.join(rootDir, 'scripts', 'user-prompt-submit.js')),
    'expected UserPromptSubmit script to exist'
  );
  assert.ok(
    fs.existsSync(path.join(rootDir, 'scripts', 'stop.js')),
    'expected Stop script to exist'
  );
});
```

- [ ] **Step 4: Run the full automated verification**

Run: `npm test && npm run validate:plugin`

Expected:
- `npm test` PASS with installability, core, hook-contract, and integration suites green
- `npm run validate:plugin` prints either Claude Code validator success or `skip: claude CLI not installed`

- [ ] **Step 5: Commit the final verification coverage**

```bash
git add tests/integration.test.js tests/installability.test.js
git commit -m "test: cover idle timing plugin flow"
```

## Plan Self-Review

- Spec coverage: plugin packaging, hidden context injection, persisted per-session state, UTC timestamps, all requested timing fields, local-dev install flow, and programmatic tests are all covered by Tasks 1 through 5.
- Placeholder scan: no `TBD`, `TODO`, or implicit “write tests later” language remains.
- Type consistency: the same state keys and output keys are used across helper, hook, and integration tasks.
