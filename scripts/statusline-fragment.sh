#!/bin/sh
#
# scripts/statusline-fragment.sh
#
# Statusline fragment — POSIX-sh, no node cold-start. Reads a per-session
# .lastresponse file that the hook scripts (user-prompt-submit.js, stop.js,
# pre-compact.js) keep updated, and prints the elapsed time since the
# model's last reply. Designed to run once per statusline refresh
# (default 1s) at <10 ms / tick.
#
# Usage (in your statusline script):
#
#     idle=$(echo "$input" | sh "/path/to/idle-timing/scripts/statusline-fragment.sh" 2>/dev/null || true)
#     [ -n "$idle" ] && parts+=("$idle")
#
# Flags:
#   --data-dir <path>           Override the data dir (default: $CLAUDE_PLUGIN_DATA,
#                               then $CLAUDE_PLUGIN_ROOT/data).
#   --drop-seconds-after <s>    Switch to minute-only formatting once the elapsed
#                               time reaches this many seconds AND the display is
#                               below one hour. Default 900 (15 min).
#
# Exit codes: 0 always. Emits the formatted string to stdout, or nothing if
# the data dir / session id / .lastresponse file is missing or the
# timestamp cannot be parsed.

set -eu

# Defaults
data_dir="${CLAUDE_PLUGIN_DATA:-${CLAUDE_PLUGIN_ROOT:-}/data}"
drop_seconds_after=900
input=""

# Parse flags. We support `--flag value` and `--flag=value` to play nicely
# with future hand-written statusline scripts.
while [ $# -gt 0 ]; do
  case "$1" in
    --data-dir)
      data_dir="$2"
      shift 2
      ;;
    --data-dir=*)
      data_dir="${1#--data-dir=}"
      shift
      ;;
    --drop-seconds-after)
      drop_seconds_after=$2
      shift 2
      ;;
    --drop-seconds-after=*)
      drop_seconds_after="${1#--drop-seconds-after=}"
      shift
      ;;
    *)
      # Ignore unknown flags (forward-compat) but still consume the arg.
      shift
      ;;
  esac
done

# Read stdin.
input=$(cat)

# Pull session_id from the statusline JSON. Tolerate absent / malformed JSON.
session_id=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)

if [ -z "$session_id" ] || [ -z "$data_dir" ] || [ "$data_dir" = "/" ]; then
  exit 0
fi

# Sanitize: same character class as src/state.js:sanitizeSessionId.
safe_id=$(printf '%s' "$session_id" | tr -c 'A-Za-z0-9._-' '_')
last_response_file="$data_dir/sessions/$safe_id.lastresponse"

# Read the timestamp (single line, no trailing newline). Missing or empty
# file → silent exit (fresh session, no prior turn). Use a shell-read
# instead of `cat` to skip a process startup. The `|| true` neutralizes
# `read`'s non-zero exit on a non-newline-terminated file (bash and some
# other shells return 1 even when the variable is set correctly).
if [ ! -r "$last_response_file" ]; then
  exit 0
fi
IFS= read -r ts < "$last_response_file" 2>/dev/null || true
if [ -z "$ts" ]; then
  exit 0
fi

# Parse to epoch seconds. GNU `date -d` first, then BSD `date -j -f`.
ts_epoch=$(date -d "$ts" +%s 2>/dev/null) || ts_epoch=""
if [ -z "$ts_epoch" ]; then
  normalized=$(printf '%s' "$ts" | sed 's/\.[0-9][0-9][0-9]//; s/^\(.*[+-][0-9][0-9]\):\([0-9][0-9]\)$/\1\2/; s/Z$/+0000/')
  ts_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S%z" "$normalized" +%s 2>/dev/null) || ts_epoch=""
fi
if [ -z "$ts_epoch" ]; then
  exit 0
fi

# Compute elapsed seconds (floor). Negative or non-finite → silent exit.
now_epoch=$(date +%s)
elapsed=$((now_epoch - ts_epoch))
if [ "$elapsed" -lt 0 ] 2>/dev/null; then
  exit 0
fi

# Format. Branches are ordered cheapest-first: most ticks land in the
# < 60s / < 3600s ranges, so we test those first.
if [ "$elapsed" -lt 60 ]; then
  printf '%ss\n' "$elapsed"
elif [ "$elapsed" -lt 3600 ]; then
  m=$((elapsed / 60))
  s=$((elapsed % 60))
  if [ "$elapsed" -lt "$drop_seconds_after" ]; then
    printf '%sm %ss\n' "$m" "$s"
  else
    printf '%sm\n' "$m"
  fi
elif [ "$elapsed" -lt 86400 ]; then
  h=$((elapsed / 3600))
  m=$(((elapsed % 3600) / 60))
  printf '%sh %sm\n' "$h" "$m"
else
  d=$((elapsed / 86400))
  h=$(((elapsed % 86400) / 3600))
  printf '%sd %sh\n' "$d" "$h"
fi
