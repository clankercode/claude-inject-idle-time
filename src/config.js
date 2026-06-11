const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG = Object.freeze({
  idleMessageThresholdSeconds: 10,
  idleMessageDropSecondsAfterSeconds: 3600,
  dropSecondsAfterSeconds: 900,
  formatHoursAsDays: true
});

const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULT_CONFIG));

const cache = new Map();

function emitWarning(message) {
  try {
    process.stderr.write(`[idle-timing] config: ${message}\n`);
  } catch {}
}

function freezeConfig(config) {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.includes(key)) {
      emitWarning(`unknown key "${key}" ignored`);
      delete config[key];
    }
  }

  for (const key of CONFIG_KEYS) {
    if (typeof DEFAULT_CONFIG[key] === 'number') {
      const value = config[key];
      if (value == null) {
        config[key] = DEFAULT_CONFIG[key];
      } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        emitWarning(`key "${key}" must be a non-negative finite number, using default`);
        config[key] = DEFAULT_CONFIG[key];
      }
    } else if (typeof DEFAULT_CONFIG[key] === 'boolean') {
      if (typeof config[key] !== 'boolean') {
        if (config[key] == null) {
          config[key] = DEFAULT_CONFIG[key];
        } else {
          emitWarning(`key "${key}" must be a boolean, using default`);
          config[key] = DEFAULT_CONFIG[key];
        }
      }
    } else {
      if (config[key] === undefined) {
        config[key] = DEFAULT_CONFIG[key];
      }
    }
  }

  return Object.freeze(config);
}

function readConfigFile(dataDir) {
  if (!dataDir || typeof dataDir !== 'string') {
    return null;
  }

  const filePath = path.join(dataDir, 'config.json');

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    emitWarning(`failed to read ${filePath}: ${error.message}`);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    emitWarning(`malformed JSON in ${filePath}: ${error.message}`);
    return null;
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    emitWarning(`${filePath} must contain a JSON object, using defaults`);
    return null;
  }

  return parsed;
}

function loadConfig({ dataDir } = {}) {
  if (cache.has(dataDir)) {
    return cache.get(dataDir);
  }

  const overrides = readConfigFile(dataDir) || {};
  const merged = freezeConfig({ ...DEFAULT_CONFIG, ...overrides });
  cache.set(dataDir, merged);
  return merged;
}

function _resetConfigCacheForTesting() {
  cache.clear();
}

module.exports = {
  loadConfig,
  DEFAULT_CONFIG,
  _resetConfigCacheForTesting
};
