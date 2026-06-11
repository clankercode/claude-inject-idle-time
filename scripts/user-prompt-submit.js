#!/usr/bin/env node

const { formatIdleSystemMessage, formatTimingBlock } = require('../src/format');
const { loadSessionState, updateSessionState } = require('../src/state');
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

  const userMessageTime = getNowIso();
  const previous = await loadSessionState({ dataDir, sessionId });
  const isFirstPrompt = !previous.lastUserPromptAt;
  const idleSinceLastStopMs = diffMs(userMessageTime, previous.lastStopAt);
  const nextSession = await updateSessionState({
    dataDir,
    sessionId,
    patch: {
      lastUserPromptAt: userMessageTime,
      lastStopAt: null
    }
  });

  const additionalContext = formatTimingBlock({
    userMessageTime,
    isFirstPrompt,
    idleSinceLastAssistantMs: diffMs(userMessageTime, previous.lastAssistantMessageAt),
    idleSinceLastStopMs,
    lastTurnExecMs: nextSession.lastTurnExecMs
  });
  const hookOutput = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext
    }
  };
  const systemMessage = formatIdleSystemMessage(idleSinceLastStopMs);

  if (systemMessage) {
    hookOutput.systemMessage = systemMessage;
  }

  process.stdout.write(JSON.stringify(hookOutput));
}

main().catch((error) => {
  process.stderr.write(`${error && error.stack ? error.stack : error.message}\n`);
  process.exit(1);
});
