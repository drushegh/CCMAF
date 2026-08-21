#!/usr/bin/env bash
# guard-interpreter-check.sh — SessionStart: verify the destructive-command
# guard actually has a working Python interpreter to run on. Audtor
# 2026-07-02, M1 residual (a).
#
# v2 adaptation: under the adopted D1-a ruling, the ccmaf-kernel plugin
# SOLELY owns the dangerous-command guard (its own bundled copy of
# block-dangerous-commands.py, run via guard-wrapper.sh) — core no longer
# ships the guard itself. This hook is core's MONITOR of the kernel's
# guard: same interpreter-availability check, ported unchanged, but its
# warning text now names "the ccmaf-kernel plugin's dangerous-command
# guard" instead of the old in-repo file path.
#
# Why this exists: the guard's own PreToolUse wrapper picks python3/python by
# `command -v` alone, which only proves a name resolves on PATH — not that
# running it actually works (a Windows Store python3.exe app-execution
# alias is the concrete real-world case: it resolves via `command -v` and
# then either opens the Store or exits non-zero instead of executing).
# When neither candidate can really run, the guard never executes and
# EVERY Bash command sails through completely unscreened — and unless
# someone is reading each PreToolUse hook-error line in the transcript,
# that outage is effectively silent. That is exactly the failure this
# audit flagged.
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
# Tier: safety (mirrors the guard's own tier) — this is a health report ON
# that guard, so lowering CLAUDE_HOOK_PROFILE must not silence it. Only an
# explicit CLAUDE_DISABLED_HOOKS=guard-interpreter-check opts out. Fail-open
# on anything unexpected: never crashes the tool loop, and SessionStart
# cannot block regardless of exit code.

# Drain stdin (the SessionStart payload) even though nothing here reads a
# field from it — matches every other hook's habit of not leaving a
# harness write blocked on an unread pipe.
cat >/dev/null 2>&1 || true

# v2 adaptation: source the core plugin's OWN copy of the shared lib via
# CLAUDE_PLUGIN_ROOT (devhooks/console precedent). Inline fallback
# definition of core_active covers the lib failing to load — same shape as
# the sibling core-plugin hooks (core-context.sh / task-budget-counter.sh /
# unattended-guard.sh).
_lib="${CLAUDE_PLUGIN_ROOT:-}/hooks/lib/hook-common.sh"
# shellcheck source=/dev/null
[ -f "$_lib" ] && . "$_lib" 2>/dev/null
if ! command -v core_active >/dev/null 2>&1; then
  core_active() {
    local f="${CLAUDE_PROJECT_DIR:-.}/.claude/.framework-version"
    [ -f "$f" ] && grep -q '^FRAMEWORK_LINE=v2' "$f" 2>/dev/null
  }
fi
# v2 adaptation: core activates on the v2 line in .framework-version
# (CORE-DESIGN §0), never bare presence — this must be the FIRST effective
# act after sourcing the lib so core stays a true no-op in v1 projects and
# non-CCMAF repos (the kernel's own guard-wrapper.sh keeps monitoring
# itself independently of core either way).
core_active || exit 0

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

SYS_MSG="WARNING: the ccmaf-kernel plugin's dangerous-command guard has NO working Python interpreter on this host, so it is NOT running - Bash commands are not being screened for destructive patterns. Install Python (python3 or python must resolve on PATH and actually execute) to restore it."
CTX_MSG="SessionStart check: the ccmaf-kernel plugin's dangerous-command guard could not find a working Python interpreter, so the PreToolUse safety guard is not screening Bash commands for destructive patterns (e.g. a filesystem-root wipe or a whole-device write). This hook is defense-in-depth, not a security boundary, so nothing is blocked while it is inert - but you should know it is currently not running and mention this to the user if relevant. Installing Python 3 (python3 or python resolving on PATH and able to execute) restores the check; no other action needed."

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
