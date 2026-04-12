# Claude Code Idle Timing Plugin

Claude Code plugin that injects hidden timing context alongside each user message.

The plugin adds:

- `user_message_utc`
- `idle_since_last_assistant_ms`
- `idle_since_last_stop_ms`
- `last_turn_exec_ms`

## What It Does

The plugin uses official Claude Code hooks:

- `UserPromptSubmit` injects hidden timing context on every prompt
- `Stop` persists per-session timing state for the next turn

On a fresh session, unavailable prior-turn fields are omitted.

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

## Notes

- The timing block is added as hidden hook context, not visible prompt text.
- In v1, `lastAssistantMessageAt` is approximated using the `Stop` hook timestamp.
- That means `idle_since_last_assistant_ms` is effectively very close to `idle_since_last_stop_ms` in the current implementation.
