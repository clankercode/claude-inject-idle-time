#!/usr/bin/env node

const { mutateSessionState } = require('../src/state');
const { getNowIso, diffMs } = require('../src/time');
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

  const lastStopAt = getNowIso(env);

  await mutateSessionState({
    dataDir,
    sessionId,
    mutator: (existing) => {
      const isFirstStopInTurn = !existing.lastStopAt;
      const candidate =
        isFirstStopInTurn && existing.lastUserPromptAt
          ? diffMs(lastStopAt, existing.lastUserPromptAt)
          : null;
      const lastTurnExecMs =
        typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
          ? candidate
          : existing.lastTurnExecMs;

      return {
        lastStopAt,
        lastAssistantMessageAt: lastStopAt,
        lastTurnExecMs
      };
    }
  });

  await writeLastResponse({ dataDir, sessionId, timestamp: lastStopAt });

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
        logError({ dataDir, sessionId, hook: 'Stop', error });
      } catch {}
      process.stderr.write(`${error && error.stack ? error.stack : error.message}\n`);
      process.exit(1);
    });
}

module.exports = { main };
