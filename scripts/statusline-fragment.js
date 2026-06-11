#!/usr/bin/env node
//
// REFERENCE IMPLEMENTATION — use scripts/statusline-fragment.sh for the hot
// path (no node cold-start per tick). This file is kept for users who want
// the model-change tracking (`---`) and for tests.
//
// Why this is still slow (~100 ms/tick):
//   - The node runtime starts cold every tick (~80–100 ms of overhead just
//     to get to the first line of JS).
//   - Model-change tracking requires reading `modelAtLastStop` /
//     `modelAtLastStopAt` from the session JSON, which means a full
//     load + (sometimes) write of the state. The flat `.lastresponse`
//     file used by the .sh script intentionally omits the model field
//     so the hot path can stay read-only — the .sh fragment is
//     strictly faster, at the cost of losing the `---` behavior.
//   - The hook scripts also keep the flat `.lastresponse` file in sync,
//     so switching to scripts/statusline-fragment.sh in your
//     statusline is a drop-in performance win. Use this file only if
//     you want the `---` placeholder or if your shell can't run
//     scripts/statusline-fragment.sh.
//

const { loadSessionState, saveSessionState } = require('../src/state');
const { getNowIso, diffMs } = require('../src/time');
const { formatElapsed } = require('../src/duration');
const { readLastResponse } = require('../src/last-response');

const DEFAULT_DROP_SECONDS_AFTER = 900;
const MODEL_CHANGED_PLACEHOLDER = '---';

function parseArgs(argv) {
  const args = {
    sessionId: null,
    modelId: null,
    dropSecondsAfterSeconds: DEFAULT_DROP_SECONDS_AFTER
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--session-id') {
      args.sessionId = argv[i + 1] || null;
      i += 1;
    } else if (arg.startsWith('--session-id=')) {
      args.sessionId = arg.slice('--session-id='.length) || null;
    } else if (arg === '--model-id') {
      args.modelId = argv[i + 1] || null;
      i += 1;
    } else if (arg.startsWith('--model-id=')) {
      args.modelId = arg.slice('--model-id='.length) || null;
    } else if (arg === '--drop-seconds-after') {
      args.dropSecondsAfterSeconds = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--drop-seconds-after=')) {
      args.dropSecondsAfterSeconds = Number(arg.slice('--drop-seconds-after='.length));
    }
  }

  if (!Number.isFinite(args.dropSecondsAfterSeconds) || args.dropSecondsAfterSeconds < 0) {
    args.dropSecondsAfterSeconds = DEFAULT_DROP_SECONDS_AFTER;
  }

  return args;
}

function parseStdinJson(stdinRaw) {
  if (!stdinRaw) return null;
  try {
    return JSON.parse(stdinRaw);
  } catch {
    return null;
  }
}

function resolveSessionId(stdinJson, argSessionId) {
  if (argSessionId) return argSessionId;
  if (stdinJson && typeof stdinJson.session_id === 'string' && stdinJson.session_id) {
    return stdinJson.session_id;
  }
  return null;
}

function resolveModelId(stdinJson, argModelId) {
  if (argModelId) return argModelId;
  if (stdinJson && stdinJson.model && typeof stdinJson.model.id === 'string' && stdinJson.model.id) {
    return stdinJson.model.id;
  }
  return null;
}

async function main({ env, stdin, argv } = {}) {
  const runtimeEnv = env || process.env;
  const runtimeStdin = stdin == null ? '' : stdin;
  const runtimeArgv = argv || process.argv.slice(2);

  let stdout = '';
  let stderr = '';
  const writeOut = (chunk) => {
    stdout += String(chunk);
  };
  const writeErr = (chunk) => {
    stderr += String(chunk);
  };

  const args = parseArgs(runtimeArgv);
  const dataDir = runtimeEnv.CLAUDE_PLUGIN_DATA;

  if (dataDir) {
    const stdinJson = parseStdinJson(runtimeStdin);
    const sessionId = resolveSessionId(stdinJson, args.sessionId);

    if (sessionId) {
      const flatTimestamp = await readLastResponse({ dataDir, sessionId });
      const session = await loadSessionState({ dataDir, sessionId });

      // Count from the model's last response. `lastAssistantMessageAt` survives
      // the UserPromptSubmit boundary (which clears `lastStopAt` so stop.js can
      // measure the next turn), so the fragment keeps ticking during the
      // following turn instead of going blank. Fall back to `lastStopAt` for
      // state files written before `lastAssistantMessageAt` existed. The flat
      // `.lastresponse` file (preferred) carries the same timestamp written
      // by the hook scripts, so the read is usually satisfied there and the
      // JSON load is mostly for the model-change bookkeeping below.
      const lastResponseAt =
        flatTimestamp ||
        (session && (session.lastAssistantMessageAt || session.lastStopAt)) ||
        null;

      if (lastResponseAt) {
        const currentModelId = resolveModelId(stdinJson, args.modelId);
        const stopAt = lastResponseAt;

        if (currentModelId) {
          if (session.modelAtLastStopAt !== stopAt) {
            await saveSessionState({
              dataDir,
              sessionId,
              state: {
                ...session,
                modelAtLastStop: currentModelId,
                modelAtLastStopAt: stopAt
              }
            });
          } else if (session.modelAtLastStop && session.modelAtLastStop !== currentModelId) {
            writeOut(MODEL_CHANGED_PLACEHOLDER);
            return { stdout, stderr, code: 0 };
          }
        }

        const elapsedMs = diffMs(getNowIso(runtimeEnv), stopAt);
        const formatted = formatElapsed(elapsedMs, {
          dropSecondsAfterSeconds: args.dropSecondsAfterSeconds
        });

        if (formatted) {
          writeOut(formatted);
        }
      }
    }
  }

  // Mark unused so lint doesn't complain about the helper being defined.
  void writeErr;
  return { stdout, stderr, code: 0 };
}

async function readStdin() {
  if (process.stdin.isTTY) {
    return '';
  }

  let input = '';

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  return input;
}

if (require.main === module) {
  readStdin()
    .then((stdin) => main({ env: process.env, stdin, argv: process.argv.slice(2) }))
    .then((result) => {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exit(result.code || 0);
    })
    .catch(() => {
      process.exit(0);
    });
}

module.exports = { main };
