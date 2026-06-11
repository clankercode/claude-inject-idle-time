#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { logInfo } = require('../src/log');

function readStdinSync() {
  if (process.stdin.isTTY) return '';
  return fs.readFileSync(0, 'utf8');
}

function unlinkIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    return false;
  }
}

function removeAllIn(dir) {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (entry.endsWith('.tmp')) continue;
      if (unlinkIfExists(path.join(dir, entry))) count += 1;
    }
  } catch {}
  return count;
}

function resetSession({ dataDir, sessionId }) {
  const sessionsDir = path.join(dataDir, 'sessions');
  unlinkIfExists(path.join(sessionsDir, `${sessionId}.json`));
  unlinkIfExists(path.join(sessionsDir, `${sessionId}.lastresponse`));
  logInfo({ dataDir, sessionId, hook: 'reset', message: 'state reset' });
  process.stdout.write(`OK: reset session ${sessionId}\n`);
}

function resetAll({ dataDir }) {
  const sessionsDir = path.join(dataDir, 'sessions');
  const logsDir = path.join(dataDir, 'logs');
  const removed = removeAllIn(sessionsDir) + removeAllIn(logsDir);
  process.stdout.write(`OK: reset all sessions (${removed} files)\n`);
}

function main() {
  const args = process.argv.slice(2);
  const allFlag = args.includes('--all');
  const yesFlag = args.includes('--yes');

  if (allFlag) {
    if (!yesFlag) {
      process.stdout.write(
        'Refusing to wipe all sessions without --yes. Re-run with --all --yes to confirm.\n'
      );
      return;
    }
    const dataDir = process.env.CLAUDE_PLUGIN_DATA;
    if (!dataDir) {
      process.stderr.write('CLAUDE_PLUGIN_DATA is required\n');
      process.exit(1);
    }
    resetAll({ dataDir });
    return;
  }

  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) {
    process.stderr.write('CLAUDE_PLUGIN_DATA is required\n');
    process.exit(1);
  }

  const raw = readStdinSync();
  let hookInput = {};
  try {
    hookInput = JSON.parse(raw || '{}');
  } catch {
    process.stderr.write('stdin was not valid JSON\n');
    process.exit(1);
  }
  const sessionId = hookInput.session_id;
  if (!sessionId) {
    process.stderr.write('session_id is required (read from stdin)\n');
    process.exit(1);
  }

  resetSession({ dataDir, sessionId });
}

main();
