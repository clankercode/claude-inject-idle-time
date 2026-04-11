# Claude Code Idle Timing Plugin Design

**Date:** 2026-04-12

**Goal:** Build a Claude Code plugin that injects timing context alongside each user message so the model can see when the message was sent, how long the session was idle before it arrived, and how long the previous turn took to execute.

## Scope

This design covers a v1 local-development Claude Code plugin that:

- uses the official Claude Code plugin and hook system
- injects hidden context on every `UserPromptSubmit`
- persists per-session timing state between turns
- reports timing fields in a stable machine-readable block
- is fully tested programmatically without manual validation

This design does not require a CLI wrapper. It also does not depend on transcript parsing for the primary implementation path.

## Constraints And Decisions

- Use an official Claude Code plugin, not a wrapper around the `claude` binary.
- Use hook-provided hidden context rather than rewriting the visible user prompt text.
- Always inject the timing block in v1.
- Always include a UTC ISO 8601 timestamp for the user message in v1.
- Preserve separate fields for `idle_since_last_assistant_ms` and `idle_since_last_stop_ms`, even if they are equal in v1.
- Prefer a small persisted state file over transcript-derived timing for the core implementation.
- Keep formatting configurable in one place so later filtering or wording changes do not require hook-flow changes.

## Why This Approach

Three implementation paths were considered:

1. Official plugin hooks with persisted state
2. Transcript parsing only
3. CLI wrapper around Claude Code

The chosen approach is official plugin hooks with persisted state because it is the most robust way to ship a real Claude Code plugin without taking over the CLI entrypoint. Claude Code's `UserPromptSubmit` hook can append additional hidden context to the model input, which matches the goal better than mutating prompt text. `Stop` provides a reliable lifecycle boundary for recording end-of-turn timing. Transcript parsing remains available as a future enhancement or debugging aid, but not the primary source of truth.

## Architecture

The plugin has two hook handlers and a small shared library:

- `UserPromptSubmit` hook
  - runs before Claude processes each user message
  - reads persisted timing state for the current `session_id`
  - records the current user-message timestamp
  - computes idle durations relative to prior state
  - appends a hidden timing block through hook output
- `Stop` hook
  - runs when Claude finishes a turn
  - records the stop timestamp
  - derives the previous turn execution duration
  - updates persisted state for the next user message
- shared library
  - handles state access, time math, and formatting

The plugin should rely on Claude Code's official hook mechanism:

- `UserPromptSubmit` uses `hookSpecificOutput.additionalContext`
- `Stop` updates persistent state only

The visible prompt text remains unchanged.

## Timing Model

The plugin stores state per Claude Code `session_id`.

Each session record contains:

```json
{
  "sessionId": "abc123",
  "lastAssistantMessageAt": "2026-04-12T18:30:00.000Z",
  "lastStopAt": "2026-04-12T18:30:01.200Z",
  "lastUserPromptAt": "2026-04-12T18:29:56.500Z",
  "lastTurnExecMs": 4700
}
```

Field semantics:

- `lastUserPromptAt`
  - timestamp recorded by `UserPromptSubmit` when a user message is submitted
  - start anchor for the turn whose completion will later be recorded by `Stop`
- `lastStopAt`
  - timestamp recorded by `Stop` when Claude finishes responding
- `lastTurnExecMs`
  - computed by `Stop` as `lastStopAt - lastUserPromptAt`
  - represents the previous turn's end-to-end execution time from prompt submit to stop
- `lastAssistantMessageAt`
  - in v1, set equal to `lastStopAt`
  - keeps a stable field name for future refinement if transcript parsing later yields a more exact assistant-message timestamp

At each new `UserPromptSubmit`, the plugin injects these fields:

- `user_message_utc`
- `idle_since_last_assistant_ms`
- `idle_since_last_stop_ms`
- `last_turn_exec_ms`

In v1, `idle_since_last_assistant_ms` and `idle_since_last_stop_ms` may be equal. They remain separate so later versions can distinguish them without changing the external format.

## Hook Flow

### UserPromptSubmit

Inputs used from Claude Code hook payload:

- `session_id`
- `hook_event_name`
- `cwd`
- `transcript_path`
- `prompt`

Flow:

1. Read the current timestamp as `user_message_utc`.
2. Load the session state from persistent storage.
3. Compute:
   - `idle_since_last_assistant_ms` from `user_message_utc - lastAssistantMessageAt`
   - `idle_since_last_stop_ms` from `user_message_utc - lastStopAt`
   - `last_turn_exec_ms` from persisted state
4. Update `lastUserPromptAt` in persisted state.
5. Return JSON using `hookSpecificOutput.additionalContext` containing the formatted timing block.

If there is no existing session state, the plugin should still inject a block with a consistent first-turn representation. The preferred v1 behavior is to omit unavailable duration fields rather than inventing values.

### Stop

Inputs used from Claude Code hook payload:

- `session_id`
- `hook_event_name`

Flow:

1. Read the current timestamp as `lastStopAt`.
2. Load the session state.
3. If `lastUserPromptAt` exists, compute `lastTurnExecMs = lastStopAt - lastUserPromptAt`.
4. Set `lastAssistantMessageAt = lastStopAt` for v1.
5. Persist the updated session record.
6. Return success without additional context.

## Hidden Context Format

The timing block should be short, stable, and LLM-friendly.

Proposed v1 format:

```text
[message_timing]
user_message_utc: 2026-04-12T18:34:56.789Z
idle_since_last_assistant_ms: 15234
idle_since_last_stop_ms: 14890
last_turn_exec_ms: 4321
[/message_timing]
```

Formatting rules:

- always include `user_message_utc`
- include the block on every user prompt in v1
- omit unavailable values on first turn rather than emitting guessed durations
- keep exact formatting centralized in one formatter module so later thresholds or friendlier renderings can be introduced cleanly

## Plugin Layout

```text
.claude-plugin/plugin.json
hooks/hooks.json
scripts/user-prompt-submit.js
scripts/stop.js
src/state.js
src/time.js
src/format.js
tests/user-prompt-submit.test.js
tests/stop.test.js
tests/integration.test.js
package.json
```

Responsibilities:

- `.claude-plugin/plugin.json`
  - plugin metadata
- `hooks/hooks.json`
  - declares the `UserPromptSubmit` and `Stop` hook handlers
- `scripts/user-prompt-submit.js`
  - executable hook entrypoint that reads stdin JSON and prints hook JSON only
- `scripts/stop.js`
  - executable hook entrypoint for stop events
- `src/state.js`
  - per-session persistent storage under `${CLAUDE_PLUGIN_DATA}`
- `src/time.js`
  - timestamp acquisition, parsing, and duration math
- `src/format.js`
  - generation of the hidden timing block
- `tests/*.test.js`
  - unit, hook-contract, and integration coverage

## Persistence

Persistent state should live under `${CLAUDE_PLUGIN_DATA}` so it survives plugin reloads and matches Claude Code plugin conventions.

Suggested shape:

- one state directory per plugin under `${CLAUDE_PLUGIN_DATA}`
- one JSON file per session, keyed by `session_id`

This keeps concurrency simple and avoids unnecessary global state.

## Installation And Development Flow

V1 installation target is local development.

Supported flow:

- load locally with `claude --plugin-dir .`
- reload during development with Claude Code's plugin reload support
- validate plugin structure with `claude plugin validate` when available

The same plugin structure should remain compatible with later marketplace or normal installation work. No redesign should be required to move from local development to distributable installation.

## Testing Strategy

All tests must be programmatic and runnable from the CLI.

### Unit Tests

Cover:

- ISO 8601 UTC timestamp formatting
- duration calculations
- missing-state handling
- hidden block formatting
- state read/write behavior

### Hook Contract Tests

Cover:

- `UserPromptSubmit` stdin payload in, valid hook JSON out
- `hookSpecificOutput.additionalContext` presence and content
- `Stop` stdin payload in, updated session state persisted
- hook scripts emitting only valid JSON on stdout

### Integration Tests

Simulate a full turn sequence with deterministic timestamps:

1. user prompt submit at `t1`
2. stop at `t2`
3. next user prompt submit at `t3`

Assert:

- `last_turn_exec_ms = t2 - t1`
- `idle_since_last_stop_ms = t3 - t2`
- `idle_since_last_assistant_ms` matches the current v1 semantics
- injected block contains the expected fields and values

### Installability Tests

Cover:

- required plugin files exist
- `hooks/hooks.json` references valid script paths
- scripts are executable where required
- plugin validation command passes when available in the environment

### Determinism

The implementation should not depend directly on wall-clock time inside core logic. Time acquisition should be injectable or overrideable in tests so all timing assertions are deterministic.

## Acceptance Criteria

The v1 implementation is complete when all of the following are true:

- the plugin loads with `claude --plugin-dir .`
- `UserPromptSubmit` appends hidden context without changing visible prompt text
- `Stop` persists timing state for the active session
- each injected timing block contains `user_message_utc`
- each injected timing block includes any available prior-turn timing values from persisted state
- first-turn behavior is consistent and documented
- tests run headlessly from the CLI and pass
- no manual or GUI validation is required to trust correctness

## Known Limitations

- In v1, `lastAssistantMessageAt` is approximated by `Stop` time.
- This means `idle_since_last_assistant_ms` and `idle_since_last_stop_ms` are not meaningfully different yet.
- The design keeps both fields so transcript-derived refinement can be added later without changing consumers.
- V1 targets local development install flow first. Marketplace-style installation can be added after the plugin is working and verified.

## Future Extensions

- add transcript parsing to distinguish actual final assistant message time from stop time
- add configurable thresholds for whether to emit some timing fields
- add alternative formatting styles for the injected block
- add broader install packaging for non-development plugin installation

## Non-Goals

- changing or rewriting the visible user prompt text
- building a Claude CLI wrapper
- depending on manual testing as the primary verification method
- solving marketplace distribution in the first implementation slice
