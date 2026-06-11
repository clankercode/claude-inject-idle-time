#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const pluginRoot = path.resolve(__dirname, '..');
const HOOKS = [
  { name: 'UserPromptSubmit', script: 'user-prompt-submit.js' },
  { name: 'Stop', script: 'stop.js' },
  { name: 'PreCompact', script: 'pre-compact.js' }
];

function readVersion() {
  try {
    const raw = fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8');
    return JSON.parse(raw).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function checkDataDir() {
  const dataDir = process.env.CLAUDE_PLUGIN_DATA;
  if (!dataDir) {
    return { dataDir: null, writable: false, reason: 'CLAUDE_PLUGIN_DATA is not set' };
  }
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const probe = path.join(dataDir, `.idle-timing-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return { dataDir, writable: true, reason: null };
  } catch (error) {
    return { dataDir, writable: false, reason: (error && error.message) || String(error) };
  }
}

function runHook(scriptName) {
  return new Promise((resolve) => {
    const scriptPath = path.join(pluginRoot, 'scripts', scriptName);
    const started = Date.now();
    const child = spawn(process.execPath, [scriptPath], {
      cwd: pluginRoot,
      env: {
        ...process.env,
        CLAUDE_TIMING_NOW_ISO: new Date().toISOString()
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stdout.on('data', () => {});
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (error) => {
      resolve({ ok: false, ms: Date.now() - started, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({
        ok: code === 0 && stderr === '',
        ms: Date.now() - started,
        stderr: stderr.trim(),
        code
      });
    });
    child.stdin.end(JSON.stringify({ session_id: '__idle_timing_status__' }));
  });
}

async function main() {
  const lines = [];
  let failCount = 0;

  const version = readVersion();
  const { dataDir, writable, reason } = checkDataDir();

  lines.push('idle-timing status');
  lines.push(`  version:        ${version}`);

  if (!dataDir) {
    lines.push(`  data dir:       (not set — CLAUDE_PLUGIN_DATA is required)`);
    lines.push(`  log dir:        (n/a)`);
    lines.push('');
    lines.push('FAIL: CLAUDE_PLUGIN_DATA is not set. The plugin cannot run without it.');
    process.stdout.write(`${lines.join('\n')}\n`);
    process.exit(1);
  }

  lines.push(`  data dir:       ${dataDir}${writable ? ' (writable)' : ` (NOT WRITABLE: ${reason})`}`);
  lines.push(`  log dir:        ${path.join(dataDir, 'logs')}`);
  lines.push('');

  const hookResults = [];
  for (const hook of HOOKS) {
    const result = await runHook(hook.script);
    hookResults.push({ name: hook.name, ...result });
    if (!result.ok) failCount += 1;
  }

  for (const r of hookResults) {
    const status = r.ok ? 'PASS' : 'FAIL';
    const detail = r.ok ? ` (${r.ms}ms)` : r.stderr ? ` — ${r.stderr.split('\n')[0]}` : ` (exit ${r.code})`;
    const label = `${r.name}:`.padEnd(16, ' ');
    lines.push(`  ${label} ${status}${detail}`);
  }

  lines.push('  model capture:   enabled');

  const logDir = path.join(dataDir, 'logs');
  let logDirStatus = '';
  try {
    const stat = await fsp.stat(logDir);
    if (stat.isDirectory()) {
      const entries = await fsp.readdir(logDir).catch(() => []);
      logDirStatus = entries.length === 0
        ? `(empty, will be created on first error)`
        : `(${entries.length} session log${entries.length === 1 ? '' : 's'})`;
    }
  } catch {
    logDirStatus = '(not yet created)';
  }
  lines.push(`  log dir:        ${logDir} ${logDirStatus}`);

  lines.push('');
  if (failCount === 0 && writable) {
    lines.push(`${HOOKS.length}/${HOOKS.length} hooks OK. data dir is healthy.`);
    process.stdout.write(`${lines.join('\n')}\n`);
    process.exit(0);
  } else {
    if (!writable) failCount += 1;
    lines.push(`FAIL: ${failCount} check${failCount === 1 ? '' : 's'} failed.`);
    process.stdout.write(`${lines.join('\n')}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`[idle-timing] status: ${error && error.stack ? error.stack : error.message}\n`);
  process.exit(2);
});
