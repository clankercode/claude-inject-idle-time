const { stripMs } = require('./time');

const IDLE_MESSAGE_DEFAULT_THRESHOLD_SECONDS = 10;
const IDLE_MESSAGE_DEFAULT_DROP_SECONDS_AFTER_SECONDS = 3600;
const FORMAT_HOURS_AS_DAYS_DEFAULT = true;

function resolveIdleConfig(config) {
  if (!config) {
    return {
      thresholdMs: IDLE_MESSAGE_DEFAULT_THRESHOLD_SECONDS * 1000,
      dropSecondsAfterSeconds: IDLE_MESSAGE_DEFAULT_DROP_SECONDS_AFTER_SECONDS,
      formatHoursAsDays: FORMAT_HOURS_AS_DAYS_DEFAULT
    };
  }

  const thresholdSeconds =
    typeof config.idleMessageThresholdSeconds === 'number' &&
    Number.isFinite(config.idleMessageThresholdSeconds) &&
    config.idleMessageThresholdSeconds >= 0
      ? config.idleMessageThresholdSeconds
      : IDLE_MESSAGE_DEFAULT_THRESHOLD_SECONDS;

  const dropSecondsAfterSeconds =
    typeof config.idleMessageDropSecondsAfterSeconds === 'number' &&
    Number.isFinite(config.idleMessageDropSecondsAfterSeconds) &&
    config.idleMessageDropSecondsAfterSeconds >= 0
      ? config.idleMessageDropSecondsAfterSeconds
      : IDLE_MESSAGE_DEFAULT_DROP_SECONDS_AFTER_SECONDS;

  const formatHoursAsDays =
    typeof config.formatHoursAsDays === 'boolean'
      ? config.formatHoursAsDays
      : FORMAT_HOURS_AS_DAYS_DEFAULT;

  return {
    thresholdMs: thresholdSeconds * 1000,
    dropSecondsAfterSeconds,
    formatHoursAsDays
  };
}

function appendDuration(parts, name, valueMs) {
  if (typeof valueMs === 'number' && Number.isFinite(valueMs)) {
    parts.push(`${name}=${(valueMs / 1000).toFixed(1)}s`);
  }
}

function formatTimingBlock({
  userMessageTime,
  idleSinceLastStopMs,
  lastTurnExecMs,
  isFirstPrompt = false
}) {
  const lines = ['[timing]'];

  if (isFirstPrompt && userMessageTime) {
    lines.push(`local_time=${stripMs(userMessageTime)}`);
  }

  appendDuration(lines, 'idle_for', idleSinceLastStopMs);
  appendDuration(lines, 'last_turn_dur', lastTurnExecMs);
  lines.push('[/timing]');
  return lines.join('\n');
}

function formatIdleSystemMessage(valueMs, config) {
  if (typeof valueMs !== 'number' || !Number.isFinite(valueMs)) {
    return null;
  }

  const { thresholdMs, dropSecondsAfterSeconds, formatHoursAsDays } =
    resolveIdleConfig(config);

  if (valueMs <= thresholdMs) {
    return null;
  }

  const totalSeconds = Math.floor(valueMs / 1000);

  if (formatHoursAsDays && totalSeconds >= 86400) {
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    return `[after ${days}d ${hours}h]`;
  }

  if (formatHoursAsDays && totalSeconds >= dropSecondsAfterSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `[after ${hours}h ${minutes}m]`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${seconds}s`);

  return `[after ${parts.join(' ')}]`;
}

module.exports = {
  formatIdleSystemMessage,
  formatTimingBlock,
  resolveIdleConfig
};
