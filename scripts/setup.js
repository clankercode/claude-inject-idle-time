#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..');
const fragmentScriptAbsolutePath = path.join(
  pluginRoot,
  'scripts',
  'statusline-fragment.sh'
);

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

function buildSnippet({ partsArray = true } = {}) {
  const append = partsArray
    ? '[ -n "$idle" ] && parts+=("$idle")'
    : '[ -n "$idle" ] && result="$result | $idle"';

  return [
    '# --- idle-timing fragment ---',
    `idle=$(echo "$input" | sh "${fragmentScriptAbsolutePath}" 2>/dev/null || true)`,
    append,
    '# --- /idle-timing fragment ---'
  ].join('\n');
}

function printSnippet() {
  const lines = [
    '',
    'Paste this into your statusline script, just before the final output assembly:',
    '',
    buildSnippet({ partsArray: true }),
    '',
    'If your script does not use a `parts` bash array, use this variant instead:',
    '',
    buildSnippet({ partsArray: false }),
    ''
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function readSettingsFile() {
  let raw;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  if (raw.trim() === '') {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError('settings root must be a JSON object');
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `failed to parse ${settingsPath}: ${error && error.message ? error.message : error}`
    );
  }
}

function applyRefreshInterval(settings) {
  let mutated = false;
  let next = settings;

  if (!next.statusLine || typeof next.statusLine !== 'object' || Array.isArray(next.statusLine)) {
    next = { ...next, statusLine: {} };
    mutated = true;
  }

  if (typeof next.statusLine.refreshInterval !== 'number') {
    next = { ...next, statusLine: { ...next.statusLine, refreshInterval: 1 } };
    mutated = true;
  }

  return { settings: next, mutated };
}

function writeSettingsFile(settings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function main() {
  printSnippet();

  let settings;
  try {
    settings = readSettingsFile();
  } catch (error) {
    process.stderr.write(`[idle-timing] setup: ${error.message}\n`);
    process.exit(1);
  }

  if (settings == null) {
    settings = {};
  }

  const { settings: updated, mutated } = applyRefreshInterval(settings);

  if (!mutated) {
    process.stdout.write(
      `No changes needed: ${settingsPath} already has statusLine.refreshInterval.\n`
    );
    return;
  }

  try {
    writeSettingsFile(updated);
  } catch (error) {
    process.stderr.write(
      `[idle-timing] setup: failed to write ${settingsPath}: ${
        error && error.message ? error.message : error
      }\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `Added statusLine.refreshInterval: 1 to ${settingsPath}\n`
  );
}

main();
