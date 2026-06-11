#!/usr/bin/env node

const { mutateSessionState } = require('../src/state');
const { getNowIso, diffMs } = require('../src/time');

async function readStdin() {
  let input = '';

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return input;
}

async function main() {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;

  if (!dataDir) {
    throw new Error('CLAUDE_PLUGIN_DATA is required');
  }

  const rawInput = await readStdin();
  const hookInput = JSON.parse(rawInput || '{}');
  const sessionId = hookInput.session_id;

  if (!sessionId) {
    throw new Error('session_id is required');
  }

  const lastStopAt = getNowIso();

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
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error.message}\n`);
  process.exit(1);
});
