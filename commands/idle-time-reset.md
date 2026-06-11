---
description: Clear the idle-timing state and log for the current session, or all sessions
allowed-tools: [Bash]
---

# Idle-timing reset

Goal: let the user wipe the plugin's per-session state, either for the current session only or for every session stored under `${CLAUDE_PLUGIN_DATA}`.

## Current session (default)

Reads the current `session_id` from stdin and unlinks `${CLAUDE_PLUGIN_DATA}/sessions/${session_id}.json` (and the matching `.lastresponse` file, if present), then appends an info-level "state reset" line to the log:

```bash
echo '{"session_id":"'"$CLAUDE_SESSION_ID"'"}' | node "${CLAUDE_PLUGIN_ROOT}/scripts/reset.js"
```

(The plugin's hook scripts normally supply the JSON; when running outside a hook, pipe a stub payload in as shown.)

## All sessions (destructive — requires confirmation)

Ask the user to confirm before invoking the destructive `--all --yes` form:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/reset.js" --all --yes
```

If the user has not explicitly asked to wipe all sessions, run the per-session form above instead. Never run `--all` without `--yes`.
