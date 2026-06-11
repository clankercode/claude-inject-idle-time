const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadConfig,
  DEFAULT_CONFIG,
  _resetConfigCacheForTesting
} = require('../src/config');

function withTempDataDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-timing-config-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function captureStderr(fn) {
  const chunks = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join('');
}

test('loadConfig returns defaults when no dataDir is provided', () => {
  _resetConfigCacheForTesting();
  const config = loadConfig();
  assert.deepEqual(config, DEFAULT_CONFIG);
});

test('loadConfig returns defaults when the config.json file does not exist', () => {
  _resetConfigCacheForTesting();
  withTempDataDir((dataDir) => {
    const config = loadConfig({ dataDir });
    assert.deepEqual(config, DEFAULT_CONFIG);
  });
});

test('loadConfig returns frozen objects that cannot be mutated', () => {
  _resetConfigCacheForTesting();
  withTempDataDir((dataDir) => {
    const config = loadConfig({ dataDir });
    assert.equal(Object.isFrozen(config), true);
    assert.throws(() => {
      'use strict';
      Object.defineProperty(config, 'idleMessageThresholdSeconds', { value: 99 });
    }, TypeError);
  });
});

test('loadConfig merges overrides from disk on top of defaults', () => {
  _resetConfigCacheForTesting();
  withTempDataDir((dataDir) => {
    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify({
        idleMessageThresholdSeconds: 42,
        formatHoursAsDays: false
      })
    );
    const config = loadConfig({ dataDir });
    assert.equal(config.idleMessageThresholdSeconds, 42);
    assert.equal(config.formatHoursAsDays, false);
    assert.equal(config.dropSecondsAfterSeconds, DEFAULT_CONFIG.dropSecondsAfterSeconds);
    assert.equal(
      config.idleMessageDropSecondsAfterSeconds,
      DEFAULT_CONFIG.idleMessageDropSecondsAfterSeconds
    );
  });
});

test('loadConfig warns and ignores unknown keys', () => {
  _resetConfigCacheForTesting();
  withTempDataDir((dataDir) => {
    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify({
        idleMessageThresholdSeconds: 15,
        somethingMadeUp: 'oops',
        anotherUnknown: 99
      })
    );
    const warnings = captureStderr(() => {
      const config = loadConfig({ dataDir });
      assert.equal(config.idleMessageThresholdSeconds, 15);
      assert.equal(config.somethingMadeUp, undefined);
      assert.equal(config.anotherUnknown, undefined);
    });
    assert.match(warnings, /unknown key "somethingMadeUp"/);
    assert.match(warnings, /unknown key "anotherUnknown"/);
  });
});

test('loadConfig falls back to defaults and warns on malformed JSON', () => {
  _resetConfigCacheForTesting();
  withTempDataDir((dataDir) => {
    fs.writeFileSync(path.join(dataDir, 'config.json'), '{ not valid json');
    const warnings = captureStderr(() => {
      const config = loadConfig({ dataDir });
      assert.deepEqual(config, DEFAULT_CONFIG);
    });
    assert.match(warnings, /malformed JSON/);
  });
});

test('loadConfig falls back to defaults when config.json is not an object', () => {
  _resetConfigCacheForTesting();
  withTempDataDir((dataDir) => {
    fs.writeFileSync(path.join(dataDir, 'config.json'), '"a string, not an object"');
    const warnings = captureStderr(() => {
      const config = loadConfig({ dataDir });
      assert.deepEqual(config, DEFAULT_CONFIG);
    });
    assert.match(warnings, /must contain a JSON object/);
  });
});

test('loadConfig coerces invalid numeric values to the default and warns', () => {
  _resetConfigCacheForTesting();
  withTempDataDir((dataDir) => {
    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify({
        idleMessageThresholdSeconds: -5,
        idleMessageDropSecondsAfterSeconds: 'nope',
        dropSecondsAfterSeconds: { not: 'a number' }
      })
    );
    const warnings = captureStderr(() => {
      const config = loadConfig({ dataDir });
      assert.equal(config.idleMessageThresholdSeconds, DEFAULT_CONFIG.idleMessageThresholdSeconds);
      assert.equal(
        config.idleMessageDropSecondsAfterSeconds,
        DEFAULT_CONFIG.idleMessageDropSecondsAfterSeconds
      );
      assert.equal(config.dropSecondsAfterSeconds, DEFAULT_CONFIG.dropSecondsAfterSeconds);
    });
    assert.match(warnings, /"idleMessageThresholdSeconds" must be a non-negative finite number/);
    assert.match(warnings, /"idleMessageDropSecondsAfterSeconds" must be a non-negative finite number/);
    assert.match(warnings, /"dropSecondsAfterSeconds" must be a non-negative finite number/);
  });
});

test('loadConfig coerces invalid boolean values to the default and warns', () => {
  _resetConfigCacheForTesting();
  withTempDataDir((dataDir) => {
    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify({ formatHoursAsDays: 'yes please' })
    );
    const warnings = captureStderr(() => {
      const config = loadConfig({ dataDir });
      assert.equal(config.formatHoursAsDays, DEFAULT_CONFIG.formatHoursAsDays);
    });
    assert.match(warnings, /"formatHoursAsDays" must be a boolean/);
  });
});

test('loadConfig caches the merged config per dataDir for the process lifetime', () => {
  _resetConfigCacheForTesting();
  withTempDataDir((dataDir) => {
    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify({ idleMessageThresholdSeconds: 25 })
    );
    const first = loadConfig({ dataDir });
    assert.equal(first.idleMessageThresholdSeconds, 25);

    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify({ idleMessageThresholdSeconds: 99 })
    );

    const second = loadConfig({ dataDir });
    assert.equal(second, first, 'expected cached object identity');
    assert.equal(second.idleMessageThresholdSeconds, 25);
  });
});

test('loadConfig does not throw when dataDir is undefined or null', () => {
  _resetConfigCacheForTesting();
  assert.doesNotThrow(() => loadConfig({ dataDir: undefined }));
  assert.doesNotThrow(() => loadConfig({ dataDir: null }));
  assert.doesNotThrow(() => loadConfig({ dataDir: '' }));
});
