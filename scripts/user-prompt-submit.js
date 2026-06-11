#!/usr/bin/env node

const { formatIdleSystemMessage, formatTimingBlock } = require('../src/format');
const { loadSessionState, updateSessionState } = require('../src/state');
const { getNowIso, diffMs } = require('../src/time');
const { loadConfig } = require('../src/config');
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

  const userMessageTime = getNowIso(env);
  const previous = await loadSessionState({ dataDir, sessionId });
  const isFirstPrompt = !previous.lastUserPromptAt;
  const idleSinceLastStopMs = diffMs(userMessageTime, previous.lastStopAt);
  const lastResponseAt = previous.lastAssistantMessageAt || previous.lastStopAt;
  const nextSession = await updateSessionState({
    dataDir,
    sessionId,
    patch: {
      lastUserPromptAt: userMessageTime,
      lastStopAt: null
    }
  });

  if (lastResponseAt) {
    await writeLastResponse({ dataDir, sessionId, timestamp: lastResponseAt });
  }

  const config = loadConfig({ dataDir });
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
  const systemMessage = formatIdleSystemMessage(idleSinceLastStopMs, config);

  if (systemMessage) {
    hookOutput.systemMessage = systemMessage;
  }

  return {
    stdout: JSON.stringify(hookOutput),
    stderr: ''
  };
}

if (require.main === module) {
  main()
    .then(({ stdout, stderr }) => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    })
    .catch((error) => {
      try {
        logError({ dataDir, sessionId, hook: 'UserPromptSubmit', error });
      } catch {}
      process.stderr.write(`${error && error.stack ? error.stack : error.message}\n`);
      process.exit(1);
    });
}

module.exports = { main };
