# Claude Code Idle Timing Plugin

Claude Code plugin that injects hidden timing context alongside each user message.

![Idle note on re-entry plus a live statusline timer tracking elapsed time since Claude's last reply](docs/screenshots/hero.png)

The plugin adds up to three fields inside a compact `[timing]` block:

- `local_time` — local time with explicit UTC offset (only on the first prompt of a session)
- `idle_for` — seconds idle since the assistant's last stop
- `last_turn_dur` — seconds the previous assistant turn took to run

Each prompt gets a hidden block Claude reads but you never see in your transcript:

```
[timing]
local_time=2026-04-17T16:04:19+10:00
idle_for=57.0s
last_turn_dur=88.2s
[/timing]
```

## What It Does

The plugin uses official Claude Code hooks:

- `UserPromptSubmit` injects hidden timing context on every prompt
- `UserPromptSubmit` also shows a compact TUI note like `[after 5m 2s]` when the user replies after more than 10 seconds of idle time
- `Stop` persists per-session timing state for the next turn
- `PreCompact` resets the idle timer when context compaction runs, so the statusline counts from the compaction event rather than the last pre-compact reply

On a fresh session, unavailable prior-turn fields are omitted.

## Install via Marketplace

```text
/plugin marketplace add clankercode/claude-inject-idle-time
/plugin install idle-timing@idle-info
```

## Statusline integration (optional)

This plugin ships a composable fragment that prints the elapsed time since
the model's last reply. Two implementations are provided:

- `scripts/statusline-fragment.sh` — POSIX-sh, no node cold-start. Recommended.
  Reads a small per-session file (`.lastresponse`) that the hooks keep
  updated, so it costs <10 ms per tick.
- `scripts/statusline-fragment.js` — Node, with model-change tracking
  (`---` when the current model differs from the one that produced the
  last reply). Slower (~100 ms/tick) because of the node cold start and
  because it still does read-modify-write on the session JSON. Kept for
  reference and for users who want the `---` behavior.

Run the slash command for a guided paste-ready snippet tailored to your current statusline:

```text
/idle-time-setup
```

At a minimum you will need to:

1. Enable periodic refresh in `~/.claude/settings.json`:

    ```json
    { "statusLine": { "refreshInterval": 1 } }
    ```

2. In your statusline script, after you read stdin into a variable (e.g. `input=$(cat)`), pipe the full stdin JSON to the fragment so it can see the current `session_id`:

    ```bash
    idle=$(echo "$input" | sh "/path/to/idle-timing/scripts/statusline-fragment.sh" 2>/dev/null || true)
    [ -n "$idle" ] && parts+=("$idle")
    ```

The fragment prints just the elapsed time (e.g. `45s`, `3m 21s`, `17m`, `1h 23m`). Add any prefix or emoji in your own script.

If you want the model-change `---` behavior (and don't mind the per-tick node cold-start), swap the script path in the snippet above to `scripts/statusline-fragment.js` and run it via `node`.

Flags (both fragments):

- `.sh`: `--data-dir <path>`, `--drop-seconds-after <seconds>` (default 900, i.e. 15 minutes).
- `.js`: `--session-id <id>`, `--model-id <id>`, `--drop-seconds-after <seconds>` (default 900).

### Statusline state table

The fragment produces the following outputs:

| State | Output | When |
| --- | --- | --- |
| No data dir / no session_id | (empty) | `CLAUDE_PLUGIN_DATA` unset or stdin has no `session_id` |
| Fresh session, no prior turn | (empty) | `.lastresponse` file does not exist (first turn) |
| Mid-turn, model unchanged | `<elapsed>` | Normal: counting up since the model's last reply |
| Mid-turn, model changed | `---` | Current model differs from the one captured at the last stop (only with the `.js` fragment) |
| After `/compact` | `<elapsed>` counting from compaction | `PreCompact` hook rewrites `.lastresponse` to the compaction timestamp |
| Corrupt `.lastresponse` | (empty) | File exists but timestamp is unparseable; hook will rewrite it on next turn |

## Observability

The plugin keeps all of its runtime state under the directory pointed to by the `CLAUDE_PLUGIN_DATA` environment variable (Claude Code sets this per session). Two subdirectories are created there:

- `sessions/` — one `<sessionId>.json` file per session, holding the persisted timing state. The file format is a single-line JSON object with fields like `lastUserPromptAt`, `lastStopAt`, `lastAssistantMessageAt`, `lastTurnExecMs`, and `modelAtLastStop` / `modelAtLastStopAt`.
- `logs/` — one `<sessionId>.log` file per session, holding NDJSON entries written by the plugin's error logger.

### Error logging

When a hook (UserPromptSubmit, Stop, or PreCompact) catches an unexpected error, the error is appended to `${CLAUDE_PLUGIN_DATA}/logs/<sessionId>.log` as a single NDJSON line. Each line has the shape:

```json
{"ts":"2026-04-19T03:14:15.000Z","hook":"UserPromptSubmit","sessionId":"abc","level":"error","message":"...","stack":"...","context":null}
```

The original error stack is still written to stderr; Claude Code swallows that stream, so the log file is the user-visible diagnostic. The logger is best-effort and will not throw if the data dir or session id is missing.

### Slash commands

- `/idle-time-status` — runs a one-shot self-test. Reports the plugin version, the resolved data dir, the result of running each hook script, and the path to the per-session log file.
- `/idle-time-reset` — clears the state and log files for the current session. With `--all --yes`, wipes every file in `${CLAUDE_PLUGIN_DATA}/sessions/` and `.../logs/`.

### Inspecting state

```bash
# View the per-session state file
cat "${CLAUDE_PLUGIN_DATA}/sessions/${CLAUDE_SESSION_ID}.json" | jq

# Tail the most recent error log entries
tail -n 20 "${CLAUDE_PLUGIN_DATA}/logs/${CLAUDE_SESSION_ID}.log"
```

## Local Usage

Run Claude Code with the plugin from this repo root:

```bash
claude --plugin-dir .
```

If Claude Code is already running, reload plugins after changes:

```text
/reload-plugins
```

## Validation

Run the automated test suite:

```bash
npm test
```

Validate the plugin structure:

```bash
claude plugin validate .
```

Count the tokens used by the timing block across representative payloads (uses `gpt-tokenizer` as a BPE proxy):

```bash
bun run tokens
```

## Configuration

Optional settings live in `${CLAUDE_PLUGIN_DATA}/config.json` (the same directory the plugin already uses for per-session state). The file is read once per process; unknown keys are ignored with a warning, malformed JSON is treated as no overrides.

Keys (with defaults):

| Key | Default | Meaning |
| --- | --- | --- |
| `idleMessageThresholdSeconds` | `10` | Minimum idle gap (in seconds) before the visible `[after Xm Ys]` system message is shown. |
| `idleMessageDropSecondsAfterSeconds` | `3600` | Once total idle seconds reaches this, the system message drops the trailing seconds — e.g. `[after 1h]` instead of `[after 1h 0m 0s]`. |
| `dropSecondsAfterSeconds` | `900` | Default for the `statusline-fragment.js --drop-seconds-after` CLI flag (15 minutes). Another subagent wires this into the statusline fragment; for now the config key is exposed and read. |
| `formatHoursAsDays` | `true` | When total idle seconds reaches a day, format the system message as `1d 4h` instead of `28h 0m`. |

Example `config.json`:

```json
{
  "idleMessageThresholdSeconds": 15,
  "idleMessageDropSecondsAfterSeconds": 1800,
  "dropSecondsAfterSeconds": 600,
  "formatHoursAsDays": true
}
```

Note: the statusline fragment's `drop-seconds-after` flag is a CLI override; the matching `dropSecondsAfterSeconds` config key here serves as its default once the statusline side starts reading `config.json`.

## Notes

- The timing block is added as hidden hook context, not visible prompt text.
- The over-one-minute idle note is emitted as a hook `systemMessage` so it is visible to the user without being added to the plugin's `additionalContext`.
- In v1, idle time is measured from the previous `Stop` hook timestamp.
