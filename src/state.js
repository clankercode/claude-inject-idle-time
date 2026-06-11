const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { sanitizeSessionId } = require('./sanitize');

const LOCK_TIMEOUT_MS = 200;
const STALE_LOCK_MS = 5000;
const TMP_SWEEP_MAX_AGE_MS = 60 * 60 * 1000;

const PERSISTED_FIELDS = new Set([
  'lastUserPromptAt',
  'lastStopAt',
  'lastAssistantMessageAt',
  'lastTurnExecMs',
  'modelAtLastStop',
  'modelAtLastStopAt'
]);

const sessionLocks = new Map();

function getSessionFilePath(dataDir, sessionId) {
  return path.join(dataDir, 'sessions', `${sanitizeSessionId(sessionId)}.json`);
}

function getLockFilePath(filePath) {
  return `${filePath}.lock`;
}

function pickPersisted(state) {
  if (!state || typeof state !== 'object') return {};
  const out = {};
  for (const key of PERSISTED_FIELDS) {
    if (key in state) out[key] = state[key];
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(lockPath) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      return await fs.open(lockPath, 'wx');
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }
      if (Date.now() >= deadline) {
        try {
          const stat = await fs.stat(lockPath);
          if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
            await fs.unlink(lockPath);
            continue;
          }
        } catch {
          continue;
        }
        return null;
      }
      await sleep(5 + Math.random() * 10);
    }
  }
}

async function releaseLock(fileHandle, lockPath) {
  if (!fileHandle) return;
  try {
    await fileHandle.close();
  } catch {}
  try {
    await fs.unlink(lockPath);
  } catch {}
}

async function sweepStaleTmpFiles(sessionDir) {
  let entries;
  try {
    entries = await fs.readdir(sessionDir);
  } catch {
    return;
  }

  const now = Date.now();
  await Promise.all(
    entries
      .filter((name) => name.endsWith('.tmp'))
      .map(async (name) => {
        try {
          const stat = await fs.stat(path.join(sessionDir, name));
          if (now - stat.mtimeMs > TMP_SWEEP_MAX_AGE_MS) {
            await fs.unlink(path.join(sessionDir, name));
          }
        } catch {}
      })
  );
}

async function loadSessionState({ dataDir, sessionId }) {
  const filePath = getSessionFilePath(dataDir, sessionId);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { sessionId };
    }

    if (error instanceof SyntaxError) {
      const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
      try {
        await fs.rename(filePath, quarantinePath);
        process.stderr.write(
          `[idle-timing] quarantined corrupt state file: ${quarantinePath}\n`
        );
      } catch {}
      return { sessionId };
    }

    throw error;
  }
}

async function writeSessionStateAtomically({ filePath, state }) {
  const lockPath = getLockFilePath(filePath);
  const sessionDir = path.dirname(filePath);
  const tempFilePath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;

  await fs.mkdir(sessionDir, { recursive: true });
  await sweepStaleTmpFiles(sessionDir);

  const fileHandle = await acquireLock(lockPath);
  try {
    await fs.writeFile(tempFilePath, JSON.stringify(state));
    await fs.rename(tempFilePath, filePath);
  } finally {
    await releaseLock(fileHandle, lockPath);
  }
}

async function saveSessionState({ dataDir, sessionId, state }) {
  const filePath = getSessionFilePath(dataDir, sessionId);
  const nextState = { sessionId, ...pickPersisted(state) };

  await writeSessionStateAtomically({ filePath, state: nextState });
  return nextState;
}

async function withSessionLock(sessionId, fn) {
  const previous = sessionLocks.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => fn());
  sessionLocks.set(sessionId, next);
  try {
    return await next;
  } finally {
    if (sessionLocks.get(sessionId) === next) {
      sessionLocks.delete(sessionId);
    }
  }
}

async function updateSessionState({ dataDir, sessionId, patch }) {
  return mutateSessionState({
    dataDir,
    sessionId,
    mutator: () => pickPersisted(patch)
  });
}

async function mutateSessionState({ dataDir, sessionId, mutator }) {
  const filePath = getSessionFilePath(dataDir, sessionId);

  return withSessionLock(sessionId, async () => {
    const current = await loadSessionState({ dataDir, sessionId });
    const partial = mutator(current);
    const next = { ...current, ...pickPersisted(partial) };
    await writeSessionStateAtomically({ filePath, state: next });
    return next;
  });
}

module.exports = {
  getSessionFilePath,
  loadSessionState,
  saveSessionState,
  updateSessionState,
  mutateSessionState,
  withSessionLock,
  PERSISTED_FIELDS
};
