#!/usr/bin/env bash
# guard-interpreter-check.sh — SessionStart: verify the destructive-command
# guard (block-dangerous-commands.py, PreToolUse) actually has a working
# Python interpreter to run on. Audtor 2026-07-02, M1 residual (a).
#
# Why this exists: settings.json's PreToolUse entry picks python3/python by
# `command -v` alone, which only proves a name resolves on PATH — not that
# running it actually works (a Windows Store python3.exe app-execution
# alias is the concrete real-world case: it resolves via `command -v` and
# then either opens the Store or exits non-zero instead of executing).
# When neither candidate can really run, block-dangerous-commands.py never
# executes and EVERY Bash command sails through completely unscreened —
# and unless someone is reading each PreToolUse hook-error line in the
# transcript, that outage is effectively silent. That is exactly the
# failure this audit flagged.
#
# The guard is documented defense-in-depth, not a security boundary (see
# its own module docstring and README.md's "Hooks" section) — so this does
# NOT fail closed; blocking every Bash call because Python is missing would
# be strictly worse than the risk it mitigates. Instead it makes the outage
# LOUD, once, at session start: `systemMessage` (shown directly to the
# user — SessionStart cannot block, but stderr/systemMessage still reach
# the terminal) plus `additionalContext` (so Claude itself also knows the
# guard is currently inert and can mention it).
#
# Tier: safety (mirrors block-dangerous-commands.py's own tier) — this is a
# health report ON that guard, so lowering CLAUDE_HOOK_PROFILE must not
# silence it. Only an explicit CLAUDE_DISABLED_HOOKS=guard-interpreter-check
# opts out. Fail-open on anything unexpected: never crashes the tool loop,
# and SessionStart cannot block regardless of exit code.

# Drain stdin (the SessionStart payload) even though nothing here reads a
# field from it — matches every other hook's habit of not leaving a
# harness write blocked on an unread pipe.
cat >/dev/null 2>&1 || true

_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"
if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled guard-interpreter-check safety; then
  echo "{}"; exit 0
fi

_found=""
if command -v resolve_python >/dev/null 2>&1; then
  _found=$(resolve_python python3 python) || _found=""
else
  # Lib unavailable — fall back to the same plain PATH check the
  # PreToolUse wrapper used before this fix (still better than nothing).
  command -v python3 >/dev/null 2>&1 && _found=python3
  [ -z "$_found" ] && command -v python >/dev/null 2>&1 && _found=python
fi

if [ -n "$_found" ]; then
  echo "{}"
  exit 0
fi

# --- No working interpreter found: the guard is inert. Warn loudly. -------
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$ROOT" ] && command -v telemetry_emit >/dev/null 2>&1; then
  telemetry_emit "$ROOT" "guard-interpreter-check" "no-interpreter" "flagged"
fi

SYS_MSG="WARNING: the destructive-command safety guard (block-dangerous-commands.py) has NO working Python interpreter on this host, so it is NOT running - Bash commands are not being screened for destructive patterns. Install Python (python3 or python must resolve on PATH and actually execute) to restore it."
CTX_MSG="SessionStart check: block-dangerous-commands.py could not find a working Python interpreter, so the PreToolUse safety guard is not screening Bash commands for destructive patterns (e.g. a filesystem-root wipe or a whole-device write). This hook is defense-in-depth, not a security boundary, so nothing is blocked while it is inert - but you should know it is currently not running and mention this to the user if relevant. Installing Python 3 (python3 or python resolving on PATH and able to execute) restores the check; no other action needed."

if command -v jq >/dev/null 2>&1; then
  jq -n --arg sys "$SYS_MSG" --arg ctx "$CTX_MSG" \
    '{systemMessage:$sys, hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}' \
    2>/dev/null && exit 0
fi
# jq unavailable: degrade to a fixed JSON literal (both message strings
# above are plain ASCII with no embedded quotes, so this is safe, but the
# jq path is preferred whenever it's available).
printf '{"systemMessage":"%s","hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' \
  "$SYS_MSG" "$CTX_MSG"
exit 0
