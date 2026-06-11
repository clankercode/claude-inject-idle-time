const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { trySanitizeSessionId } = require('./sanitize');

function getLastResponseFilePath(dataDir, sessionId) {
  const safeId = trySanitizeSessionId(sessionId);
  if (!safeId) return null;
  return path.join(
    dataDir,
    'sessions',
    `${safeId}.lastresponse`
  );
}

async function writeLastResponse({ dataDir, sessionId, timestamp }) {
  const filePath = getLastResponseFilePath(dataDir, sessionId);
  if (!filePath) return;
  const sessionDir = path.dirname(filePath);
  const tempFilePath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(tempFilePath, timestamp);
    await fs.rename(tempFilePath, filePath);
  } catch (error) {
    process.stderr.write(
      `[idle-timing] failed to write .lastresponse for ${sessionId}: ${
        error && error.message ? error.message : error
      }\n`
    );
  }
}

async function readLastResponse({ dataDir, sessionId }) {
  const filePath = getLastResponseFilePath(dataDir, sessionId);
  if (!filePath) return null;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (!Number.isFinite(Date.parse(trimmed))) return null;
    return trimmed;
  } catch {
    return null;
  }
}

module.exports = {
  getLastResponseFilePath,
  writeLastResponse,
  readLastResponse
};
