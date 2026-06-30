#!/bin/bash
input=$(cat)
# One jq spawn: command + telemetry correlation ids (contract:telemetry-schema).
# The ids are single-line tokens read first; the command may be MULTILINE,
# so it goes last and `cat` consumes the remainder.
_sid="" _tuid="" cmd=""
{
  IFS= read -r _sid
  IFS= read -r _tuid
  cmd=$(cat)
} < <(echo "$input" | jq -r '(.session_id // ""), (.tool_use_id // ""), (.tool_input.command // "")' 2>/dev/null) || true
# git-bash jq emits CRLF on -r; `read`/`cat` keep the \r — strip it.
export CLAUDE_HOOK_SESSION_ID="${_sid%$'\r'}"
export CLAUDE_HOOK_TOOL_USE_ID="${_tuid%$'\r'}"
cmd="${cmd%$'\r'}"

# --- Profile / opt-out gate (TASK-011) -------------------------------
# Skip → emit the no-op passthrough so the original command runs unchanged.
_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"
if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled filter-test-output normal; then
  echo "{}"; exit 0
fi

# Schema-v2 emit via hook-common.sh (contract:telemetry-schema). Lib
# absent → no event; telemetry is best-effort, the filter never is.
_log_event() {
  local outcome="$1"
  local root; root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
  command -v telemetry_emit >/dev/null 2>&1 || return 0
  local class="ok"; [ "$outcome" = "passthrough" ] && class="skipped"
  telemetry_emit "$root" "test-filter" "$outcome" "$class"
}

# Match the test runner wherever a new command starts (string start, after
# `&&` or `;`) — NOT only at position 0. The framework's own documented
# invocation is `cd 01_Project && npm test`, which the old `^(npm test|…)`
# anchor silently never matched (the filter was dead code in the standard
# flow). Runner set covers the stack-agnostic dispatch targets; the
# trailing class stops prefix false-positives (`npm testify`).
TEST_CMD_RE='(^|&&|;)[[:space:]]*(npm test|pytest|go test|dotnet test|cargo test)([^[:alnum:]_-]|$)'
if [[ "$cmd" =~ $TEST_CMD_RE ]]; then
  # Write full test output to a tempfile (preserves $cmd's exit code in $?),
  # then filter the tempfile for display. No pipeline between $cmd and the
  # filter — so we sidestep PIPESTATUS / pipefail subtleties entirely.
  # Fresh tempfile per invocation via mktemp — portable across Windows
  # Git Bash (where /tmp is emulated with variable reliability) and POSIX
  # systems, and collision-safe if Claude Code ever runs test commands
  # in parallel. The \$(mktemp) / \$TMPF / \$? / \$TEST_EXIT are escaped
  # so they're evaluated by the OUTER shell when the rewritten command
  # actually runs, not here.
  filtered_cmd="TMPF=\$(mktemp); $cmd > \"\$TMPF\" 2>&1; TEST_EXIT=\$?; grep -A 5 -E '(FAIL|ERROR|PASS|error:|✓|✗)' \"\$TMPF\" | head -100; rm -f \"\$TMPF\"; exit \$TEST_EXIT"
  # Use jq --arg to safely embed the rewritten command — $cmd may contain
  # double-quotes or backslashes (e.g. --testNamePattern="foo"), which
  # would corrupt manually-built JSON.
  jq -cn --arg cmd "$filtered_cmd" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:{command:$cmd}}}'
  _log_event "filtered"
else
  echo "{}"
  _log_event "passthrough"
fi
