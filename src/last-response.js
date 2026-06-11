const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function sanitizeSessionId(sessionId) {
  return String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_');
}

function getLastResponseFilePath(dataDir, sessionId) {
  return path.join(
    dataDir,
    'sessions',
    `${sanitizeSessionId(sessionId)}.lastresponse`
  );
}

async function writeLastResponse({ dataDir, sessionId, timestamp }) {
  const filePath = getLastResponseFilePath(dataDir, sessionId);
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
