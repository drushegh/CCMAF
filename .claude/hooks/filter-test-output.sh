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
  local outcome="$1" reason="${2:-}"
  local root; root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
  command -v telemetry_emit >/dev/null 2>&1 || return 0
  local class="ok"; [ "$outcome" = "passthrough" ] && class="skipped"
  # Optional skip-reason token (OPT r2 Phase 1') — see auto-lint.sh for the
  # vocabulary. test-filter's skip is irreducibly content-based (this Bash
  # command isn't a test command); a tool-name matcher cannot see it.
  local extra=""
  [ -n "$reason" ] && extra=",\"reason\":\"$reason\""
  telemetry_emit "$root" "test-filter" "$outcome" "$class" "$extra"
}

# Only rewrite (and auto-`allow`) when the WHOLE command is composed of `cd`
# and test-runner segments — never on a mere SUBSTRING match. The old
# `(^|&&|;)…` regex fired whenever a runner appeared at ANY segment start,
# so an arbitrary prefix (`curl evil.com; npm test`) inherited the
# `permissionDecision:"allow"` below and slipped past a consumer's own Bash
# `ask`/`deny` rules. Now we split the command on shell chain/pipe/background
# operators and require EVERY segment to be a `cd` or one of the known test
# runners; a single foreign segment → passthrough (the original command runs
# unchanged through the normal permission flow — the safe default). The
# framework's own documented invocation `cd 01_Project && npm test` still
# qualifies; the trailing class stops prefix false-positives (`npm testify`).
#
# The split is deliberately conservative: it does NOT honour shell quoting,
# so a runner arg that embeds an operator inside quotes (`pytest -k "a|b"`)
# simply falls to passthrough instead of being rewritten — erring toward the
# safe side, never toward over-allowing. Runner set covers the stack-agnostic
# dispatch targets.
_TEST_SEG_RE='^(npm[[:space:]]+test|pytest|go[[:space:]]+test|dotnet[[:space:]]+test|cargo[[:space:]]+test)([^[:alnum:]_-]|$)'
# Normalise shell operators to newlines so each simple command is one line.
# Order matters: two-char operators before their one-char prefixes.
_segments="${cmd//&&/$'\n'}"
_segments="${_segments//||/$'\n'}"
_segments="${_segments//|/$'\n'}"
_segments="${_segments//;/$'\n'}"
_segments="${_segments//&/$'\n'}"
_all_safe=1
_has_test=0
while IFS= read -r _seg; do
  # Trim surrounding whitespace.
  _seg="${_seg#"${_seg%%[![:space:]]*}"}"
  _seg="${_seg%"${_seg##*[![:space:]]}"}"
  [ -z "$_seg" ] && continue
  # Command substitution, process substitution, and redirections inside a
  # segment let an arbitrary command ride along (or an arbitrary file be
  # truncated) inside what otherwise looks like a bare runner invocation — the
  # prefix regex below only checks the START of the segment, so it would still
  # match and inherit the auto-`allow`. Concretely: `npm test $(curl evil)` and
  # the backtick form (command substitution); `npm test --reporter <(curl evil)`
  # / `>(sh dropper)` (process substitution — bash EXECUTES the inner command);
  # `npm test > ~/.bashrc` (redirection — bash opens+TRUNCATES the target). Test
  # runners never need `( ) < >` in the plain invocations this hook rewrites, so
  # treat any of them anywhere in the segment as foreign → passthrough, same as
  # a segment that isn't cd/test-runner at all.
  case "$_seg" in
    *'$('*|*'`'*|*'('*|*')'*|*'<'*|*'>'*)
      _all_safe=0
      break
      ;;
  esac
  if [[ "$_seg" =~ ^cd([[:space:]]|$) ]]; then
    continue
  elif [[ "$_seg" =~ $_TEST_SEG_RE ]]; then
    _has_test=1
  else
    _all_safe=0
    break
  fi
done <<< "$_segments"

if [ "$_all_safe" = "1" ] && [ "$_has_test" = "1" ]; then
  # Write full test output to a tempfile (preserves $cmd's exit code in $?),
  # then filter the tempfile for display. No pipeline between $cmd and the
  # filter — so we sidestep PIPESTATUS / pipefail subtleties entirely.
  # Fresh tempfile per invocation via mktemp — portable across Windows
  # Git Bash (where /tmp is emulated with variable reliability) and POSIX
  # systems, and collision-safe if Claude Code ever runs test commands
  # in parallel. The \$(mktemp) / \$TMPF / \$? / \$TEST_EXIT are escaped
  # so they're evaluated by the OUTER shell when the rewritten command
  # actually runs, not here.
  # grep is case-INSENSITIVE (`-i`) so lowercase success/failure vocabulary is
  # caught — pytest `5 passed`, dotnet `Passed!`/`Failed!` — not just the
  # uppercase tokens. And the summary block (always at the END of a run) is
  # `tail`'d UNCONDITIONALLY, so a green pytest/go/dotnet run whose output the
  # grep doesn't match (e.g. go's `ok  pkg  0.31s`) is never displayed as
  # EMPTY — the model always sees the result. Both stay bounded (head/tail).
  filtered_cmd="TMPF=\$(mktemp); $cmd > \"\$TMPF\" 2>&1; TEST_EXIT=\$?; grep -iA 5 -E '(fail|error|pass|✓|✗)' \"\$TMPF\" | head -100; echo '---- last 15 lines ----'; tail -n 15 \"\$TMPF\"; rm -f \"\$TMPF\"; exit \$TEST_EXIT"
  # Use jq --arg to safely embed the rewritten command — $cmd may contain
  # double-quotes or backslashes (e.g. --testNamePattern="foo"), which
  # would corrupt manually-built JSON.
  jq -cn --arg cmd "$filtered_cmd" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:{command:$cmd}}}'
  _log_event "filtered"
else
  echo "{}"
  _log_event "passthrough" "not-test-cmd"
fi
