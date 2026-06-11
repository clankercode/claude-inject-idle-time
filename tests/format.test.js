const test = require('node:test');
const assert = require('node:assert/strict');

const { formatIdleSystemMessage, formatTimingBlock } = require('../src/format');

const DEFAULT_IDLE_CONFIG = Object.freeze({
  idleMessageThresholdSeconds: 10,
  idleMessageDropSecondsAfterSeconds: 3600,
  formatHoursAsDays: true
});

const HOURS_AS_DAYS_OFF = Object.freeze({
  ...DEFAULT_IDLE_CONFIG,
  formatHoursAsDays: false
});

test('formatIdleSystemMessage short gaps are unaffected by config', () => {
  assert.equal(formatIdleSystemMessage(11000), '[after 11s]');
  assert.equal(formatIdleSystemMessage(63000), '[after 1m 3s]');
  assert.equal(formatIdleSystemMessage(302000), '[after 5m 2s]');
});

test('formatIdleSystemMessage drops seconds at hour+ with default config', () => {
  assert.equal(formatIdleSystemMessage(3_600_000), '[after 1h 0m]');
  assert.equal(formatIdleSystemMessage(3_661_000), '[after 1h 1m]');
  assert.equal(formatIdleSystemMessage(7_200_000), '[after 2h 0m]');
});

test('formatIdleSystemMessage shows days+hours at day+ with default config', () => {
  assert.equal(formatIdleSystemMessage(86_400_000), '[after 1d 0h]');
  assert.equal(formatIdleSystemMessage(90_000_000), '[after 1d 1h]');
  assert.equal(formatIdleSystemMessage(172_800_000), '[after 2d 0h]');
});

test('formatIdleSystemMessage falls back to plain hours+minutes+seconds when formatHoursAsDays is false', () => {
  assert.equal(formatIdleSystemMessage(3_600_000, HOURS_AS_DAYS_OFF), '[after 1h 0m 0s]');
  assert.equal(formatIdleSystemMessage(3_661_000, HOURS_AS_DAYS_OFF), '[after 1h 1m 1s]');
  assert.equal(formatIdleSystemMessage(86_400_000, HOURS_AS_DAYS_OFF), '[after 24h 0m 0s]');
});

test('formatIdleSystemMessage respects a custom threshold', () => {
  assert.equal(formatIdleSystemMessage(5000, { ...DEFAULT_IDLE_CONFIG, idleMessageThresholdSeconds: 10 }), null);
  assert.equal(formatIdleSystemMessage(10_500, { ...DEFAULT_IDLE_CONFIG, idleMessageThresholdSeconds: 10 }), '[after 10s]');
});

test('formatIdleSystemMessage returns null for null/NaN/Infinity', () => {
  assert.equal(formatIdleSystemMessage(null), null);
  assert.equal(formatIdleSystemMessage(Number.NaN), null);
  assert.equal(formatIdleSystemMessage(Number.POSITIVE_INFINITY), null);
  assert.equal(formatIdleSystemMessage(5000), null);
});

test('formatTimingBlock first prompt includes the local_time line', () => {
  const block = formatTimingBlock({
    userMessageTime: '2026-04-13T04:34:56.789+10:00',
    isFirstPrompt: true,
    idleSinceLastStopMs: null,
    lastTurnExecMs: null
  });
  assert.equal(
    block,
    [
      '[timing]',
      'local_time=2026-04-13T04:34:56+10:00',
      '[/timing]'
    ].join('\n')
  );
});

test('formatTimingBlock turn 2+ omits the local_time line', () => {
  const block = formatTimingBlock({
    userMessageTime: '2026-04-13T04:34:56.789+10:00',
    isFirstPrompt: false,
    idleSinceLastStopMs: 14890,
    lastTurnExecMs: 4321
  });
  assert.equal(
    block,
    [
      '[timing]',
      'idle_for=14.9s',
      'last_turn_dur=4.3s',
      '[/timing]'
    ].join('\n')
  );
  assert.equal(block.includes('local_time='), false);
  assert.equal(block.includes('time='), false);
  assert.equal(block.includes('last_turn='), false);
});

test('formatTimingBlock default isFirstPrompt=false so local_time is omitted', () => {
  const block = formatTimingBlock({
    userMessageTime: '2026-04-13T04:34:56.789+10:00',
    idleSinceLastStopMs: 1000,
    lastTurnExecMs: 1000
  });
  assert.equal(block.includes('local_time='), false);
});

test('formatTimingBlock uses last_turn_dur and idle_for names', () => {
  const block = formatTimingBlock({
    userMessageTime: '2026-04-13T04:34:56.789+10:00',
    isFirstPrompt: true,
    idleSinceLastStopMs: 14890,
    lastTurnExecMs: 4321
  });
  assert.match(block, /last_turn_dur=4\.3s/);
  assert.match(block, /idle_for=14\.9s/);
  assert.equal(block.includes('last_turn=4.3s'), false);
});

test('formatTimingBlock omits non-finite numeric fields but keeps the block shape', () => {
  const block = formatTimingBlock({
    userMessageTime: '2026-04-13T04:34:56.789+10:00',
    isFirstPrompt: true,
    idleSinceLastStopMs: Number.POSITIVE_INFINITY,
    lastTurnExecMs: 4321
  });
  assert.equal(
    block,
    [
      '[timing]',
      'local_time=2026-04-13T04:34:56+10:00',
      'last_turn_dur=4.3s',
      '[/timing]'
    ].join('\n')
  );
});

test('formatTimingBlock first prompt with no extra fields renders just the open/close tags', () => {
  const block = formatTimingBlock({
    userMessageTime: '2026-04-13T04:34:56.789+10:00',
    isFirstPrompt: true,
    idleSinceLastStopMs: null,
    lastTurnExecMs: null
  });
  assert.equal(
    block,
    [
      '[timing]',
      'local_time=2026-04-13T04:34:56+10:00',
      '[/timing]'
    ].join('\n')
  );
});
