# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-06-11

### Fixed
- Concurrent hook runs (e.g. `UserPromptSubmit` racing a `Stop` or `PreCompact` on the same session) no longer fail with `ENOENT` on the state-file rename. The temp filename in `src/state.js` is now unique per call (random hex suffix) so parallel `writeFile`/`rename` pairs don't clobber each other's temp file.
- Concurrent hooks can no longer clobber each other's state via the read-modify-write pattern. `src/state.js` now exposes `updateSessionState` and `mutateSessionState` that do the load-merge-save atomically under a per-session in-process mutex and a cross-process file lock (`<session>.json.lock`, atomic `O_EXCL` create, steal-after-5s on stale). The three hook scripts (`UserPromptSubmit`, `Stop`, `PreCompact`) now use these primitives.
- A truncated or invalid `sessions/<id>.json` no longer breaks every future prompt for that session. `loadSessionState` now quarantines the bad file as `<id>.json.corrupt-<ts>` and returns a default state, with a stderr notice pointing at the quarantine path.
- `Stop` no longer re-stamps `lastStopAt` / `lastAssistantMessageAt` on a repeat `Stop` of the same turn (it preserves the existing `lastTurnExecMs` instead of recomputing it from a later timestamp).
- A malicious or accidentally-large `session_id` (e.g. an unbounded string, empty string, or `null`) can no longer write to a weirdly-named file under the data dir. `sanitizeSessionId` now throws on empty/`null` input and caps length at 256 chars.

### Added
- `src/state.js` now whitelists the fields it persists (`lastUserPromptAt`, `lastStopAt`, `lastAssistantMessageAt`, `lastTurnExecMs`, `modelAtLastStop`, `modelAtLastStopAt`). Other fields passed to `saveSessionState` / `updateSessionState` are dropped before they hit disk — eliminates the `sessionId` / `session_id` duplication and protects against any future caller accidentally persisting hook-input fields.
- `src/state.js` now sweeps `sessions/*.tmp` files older than one hour on each save, so a process killed mid-`writeFile` doesn't leave permanent litter in the data dir.
- The statusline fragment now ships in two flavors: `scripts/statusline-fragment.sh` (POSIX-sh, no node cold-start, <10ms/tick) and `scripts/statusline-fragment.js` (reference / fallback with model-change `---` tracking).
- `/idle-time-status` slash command runs a one-shot self-test (verifies all three hooks, prints the version, the data dir, and the log dir).
- `/idle-time-reset` slash command clears the current session's state (or all sessions with `--all --yes`).
- Hook errors are appended to `${CLAUDE_PLUGIN_DATA}/logs/<sessionId>.log` (NDJSON, one line per error) so the user can see them via `tail` or `/idle-time-status`.
- Configurable thresholds via `${CLAUDE_PLUGIN_DATA}/config.json`: `idleMessageThresholdSeconds` (default 10), `dropSecondsAfterSeconds` (default 900), `idleMessageDropSecondsAfterSeconds` (default 3600), `formatHoursAsDays` (default true).
- Format polish: the visible `[after X]` system message uses a `d` unit once idle exceeds 24h, and drops the trailing seconds at >= 1h. The hidden `[timing]` block uses clearer field names: `local_time=`, `idle_for=`, `last_turn_dur=`. The redundant `local_time=` line is omitted on turn 2+.
- `npm run setup` script (`scripts/setup.js`) prints a paste-ready snippet with the actual installed path and patches `~/.claude/settings.json` to add `statusLine.refreshInterval: 1`.
- `src/log.js` exports `logError` / `logInfo` / `readLog` / `getLogPath` — per-session NDJSON error logger, used by the hook scripts and the reset command.

### Changed
- The hidden `[timing]` block's field names are renamed: `time=` → `local_time=`, `last_turn=` → `last_turn_dur=`. (`idle_for=` is unchanged.)
- Statusline source of truth is now a per-session `.lastresponse` file (one line, the ISO timestamp of the last model response) maintained by the hooks. The `.sh` fragment reads this file; the `.js` fragment reads the same file (with a JSON fallback for backward compatibility).
- State files are written as compact JSON (no indent) to halve the bytes per write.

## [0.3.1] - 2026-06-11

### Fixed
- Statusline fragment now counts from the model's last response
  (`lastAssistantMessageAt`) rather than `lastStopAt`. `lastStopAt` is cleared by
  the `UserPromptSubmit` hook at the start of each turn (so `stop.js` can measure
  the turn), which made the fragment go **blank** for the whole next turn and
  until that turn's `Stop` fired. It now keeps ticking as "time since the model
  last responded," restoring the documented semantic. The idle display after a
  `Stop` is unchanged (the two timestamps are equal there); model-change `---`
  tracking is preserved. Falls back to `lastStopAt` for pre-existing state files.

## [0.3.0] - 2026-04-17

### Changed
- Timing block is now a multiline `[timing]` tag with `key=value` fields on their own lines, cutting token usage by ~25% (40t vs 53t on a typical block, via `gpt-tokenizer`).
- Timestamp renders in local time with an explicit UTC offset (e.g. `2026-04-17T16:04:19+10:00`) instead of UTC `Z`, and milliseconds are dropped from the displayed value (state still keeps ms precision).
- Field renames: `user_message_utc` → `time`, `idle_since_last_stop_seconds` → `idle_for` (with `s` suffix on the value), `last_turn_exec_seconds` → `last_turn`.
- Idle system message now appears after 10 seconds of idle time (was 60 seconds), providing faster visibility into resumed conversations.

### Added
- `bun run tokens` / `npm run tokens` script (`scripts/token-benchmark.js`) that prints token counts for representative timing payloads using `gpt-tokenizer`.

## [0.2.0] - 2026-04-17

### Added
- `scripts/statusline-fragment.js` — composable statusline fragment printing elapsed time since the model's last reply (`45s`, `3m 21s`, `17m`, `1h 23m`).
- `/idle-time-setup` slash command prints a paste-ready snippet and settings change to wire the fragment into an existing statusline.
- `PreCompact` hook resets the idle timer on context compaction, so the fragment counts from the compaction event rather than the pre-compact final reply.
- Fragment tracks the active model and prints `---` when the current model differs from the one that produced the last reply (e.g. after `/model`), resuming the elapsed count if the user switches back.
- Fragment accepts `--model-id <id>` flag and reads `model.id` from stdin statusline JSON.

## [0.1.3] - 2026-04-17

### Added
- Dual Unlicense/CC0 license
- Full plugin.json metadata (author, homepage, repository, license, keywords)
- Marketplace packaging as `idle-info` (was `idle-timing-local`)
- Marketplace install instructions in README
- RELEASING.md with release checklist and version-match pre-release check

## [0.1.2] - 2026-04-16

### Added
- Visible `[after Xm Ys]` system message when idle exceeds 60 seconds

## [0.1.1] - 2026-04-15

### Added
- `Stop` hook persists per-session timing state (last stop timestamp, exec duration)
- `UserPromptSubmit` hook injects hidden `[message_timing]` block with structured fields:
  - `user_message_utc` — ISO 8601 UTC timestamp
  - `idle_since_last_stop_seconds` — seconds since last `Stop` hook fired
  - `last_turn_exec_seconds` — duration of the previous turn
- Atomic state writes via temp-file rename (safe on Linux/macOS)
- Session ID sanitization to prevent path traversal
- Test-injectable clock via `CLAUDE_TIMING_NOW_ISO` env var
- 28 automated tests covering unit, integration, and installability checks
