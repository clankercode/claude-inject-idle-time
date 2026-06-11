const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SANITIZE_RE = /[^A-Za-z0-9._-]/g;

function sanitizeSessionId(sessionId) {
  if (sessionId == null) return null;
  const stringId = String(sessionId);
  if (stringId.length === 0) return null;
  return stringId.replace(SANITIZE_RE, '_');
}

function getLogPath({ dataDir, sessionId }) {
  if (!dataDir || !sessionId) return null;
  const safe = sanitizeSessionId(sessionId);
  if (!safe) return null;
  return path.join(dataDir, 'logs', `${safe}.log`);
}

function ensureLogDirSync(logDir) {
  try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
}

function appendEntry({ dataDir, sessionId, hook, level, message, stack, context }) {
  if (!dataDir || !sessionId) return;
  const safeId = sanitizeSessionId(sessionId);
  if (!safeId) return;
  const logDir = path.join(dataDir, 'logs');
  ensureLogDirSync(logDir);
  const filePath = path.join(logDir, `${safeId}.log`);
  const entry = {
    ts: new Date().toISOString(),
    hook: hook || null,
    sessionId: safeId,
    level,
    message,
    stack: stack || null,
    context: context || null
  };
  let line;
  try { line = JSON.stringify(entry) + '\n'; } catch { return; }
  let existing = '';
  try { existing = fs.readFileSync(filePath, 'utf8'); } catch {}
  const next = existing + line;
  const tempPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempPath, next);
    fs.renameSync(tempPath, filePath);
  } catch {}
}

function logError({ dataDir, sessionId, hook, error, context }) {
  appendEntry({
    dataDir, sessionId, hook, level: 'error',
    message: (error && (error.message || String(error))) || 'unknown error',
    stack: (error && error.stack) || null,
    context
  });
}

function logInfo({ dataDir, sessionId, hook, message, context }) {
  appendEntry({ dataDir, sessionId, hook, level: 'info', message: message || 'info', context });
}

async function readLog({ dataDir, sessionId, limit = 50 }) {
  const filePath = getLogPath({ dataDir, sessionId });
  if (!filePath) return [];
  let raw;
  try { raw = await fsp.readFile(filePath, 'utf8'); }
  catch (error) { if (error && error.code === 'ENOENT') return []; return []; }
  const out = [];
  for (const line of raw.split('\n').filter((l) => l.length > 0).slice(-limit)) {
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}
module.exports = { logError, logInfo, getLogPath, readLog, sanitizeSessionId };
