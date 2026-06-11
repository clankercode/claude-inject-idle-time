---
description: Run a one-shot self-test of the idle-timing plugin (data dir, hook scripts, logs)
allowed-tools: [Bash]
---

# Idle-timing status

Goal: confirm the plugin is installed correctly and the data dir is healthy.

Run the status script and show its output verbatim:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/status.js"
```

Report the result to the user. If the script exits non-zero, surface the FAIL summary and any per-hook error lines.
