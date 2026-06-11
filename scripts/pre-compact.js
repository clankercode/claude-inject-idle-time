#!/usr/bin/env node

const { updateSessionState } = require('../src/state');
const { getNowIso } = require('../src/time');
const { logError } = require('../src/log');
const { writeLastResponse } = require('../src/last-response');

async function readStdin(stdin) {
  if (stdin !== null && stdin !== undefined) {
    return stdin;
  }

  let input = '';

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return input;
}

async function main({ env = process.env, stdin = null } = {}) {
  const dataDir = env.CLAUDE_PLUGIN_DATA;

  if (!dataDir) {
    throw new Error('CLAUDE_PLUGIN_DATA is required');
  }

  const rawInput = await readStdin(stdin);
  const hookInput = JSON.parse(rawInput || '{}');
  const sessionId = hookInput.session_id;

  if (!sessionId) {
    throw new Error('session_id is required');
  }

  const now = getNowIso(env);

  await updateSessionState({
    dataDir,
    sessionId,
    patch: {
      lastStopAt: now,
      lastAssistantMessageAt: now,
      modelAtLastStop: null,
      modelAtLastStopAt: null
    }
  });

  await writeLastResponse({ dataDir, sessionId, timestamp: now });

  return { stdout: '', stderr: '' };
}

if (require.main === module) {
  main()
    .then(({ stdout, stderr }) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    })
    .catch((error) => {
      try {
        logError({ dataDir, sessionId, hook: 'PreCompact', error });
      } catch {}
      process.stderr.write(`${error && error.stack ? error.stack : error.message}\n`);
      process.exit(1);
    });
}

module.exports = { main };
