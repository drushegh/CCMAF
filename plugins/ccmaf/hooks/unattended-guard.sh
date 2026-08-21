#!/usr/bin/env bash
# ccmaf core PreToolUse hook — the machine gates behind CLAUDE_UNATTENDED=1
# (CORE-DESIGN §8, contract:core-plugin-v2). Registered with NO matcher (all
# tools) after the review swarm proved a mutating-tool BLOCKLIST fail-open:
# it missed the Windows PowerShell tool and every mcp__* tool. Two rules:
#   1. AskUserQuestion is DENIED — written default policies replace it.
#   2. While doctor reports CRITICAL findings, ONLY known read-only tools
#      are allowed (fail-safe allowlist); everything else — Bash,
#      PowerShell, Write/Edit family, Agent spawns, every MCP tool, and
#      anything not on the list — is denied, and
#      .claude/unattended-halt.md is written for the supervising human.
#      Precedence: this halt beats "never end the run".
# Deny mechanism = exit 2 (S5-probed on a non-Bash tool). Attended sessions
# and non-v2 projects: instant no-op.
set -u

_lib="${CLAUDE_PLUGIN_ROOT:-}/hooks/lib/hook-common.sh"
# shellcheck source=/dev/null
[ -f "$_lib" ] && . "$_lib" 2>/dev/null
if ! command -v core_active >/dev/null 2>&1; then
  core_active() {
    local f="${CLAUDE_PROJECT_DIR:-.}/.claude/.framework-version"
    [ -f "$f" ] && grep -Eq '^[[:space:]]*FRAMEWORK_LINE=v2' "$f" 2>/dev/null
  }
fi
core_active || exit 0
[ "${CLAUDE_UNATTENDED:-}" = "1" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-.}"

# First "tool_name" in the head of the payload (the event's own field comes
# before tool_input in the envelope; grep -o + head -1 takes the FIRST match
# so a tool_input string can't spoof it).
tool=$(head -c 2048 2>/dev/null \
  | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -n 1 \
  | sed 's/.*"\([^"]*\)"$/\1/')

if [ "$tool" = "AskUserQuestion" ]; then
  echo "UNATTENDED RUN: AskUserQuestion is disabled. Apply the written default policy (OPERATIONS.md 'Unattended profile'): a defensible minimum exists -> take it and log the choice to .claude/unattended-log.md; none exists -> mark the current task Blocked with the question written into its board entry and MOVE TO THE NEXT TASK. Never end the run because a question arose." >&2
  exit 2
fi

# CRITICAL-halt state?
flag="$root/.claude/.framework-doctor-findings.md"
if [ -f "$flag" ] && head -n 10 "$flag" | grep -Eq '\*\*Findings:\*\*[[:space:]]+[1-9][0-9]*[[:space:]]+CRITICAL'; then
  case "$tool" in
    Read|Glob|Grep|WebFetch|WebSearch|TodoWrite|TaskOutput|ToolSearch|Skill|Monitor)
      # Read-only / harness-internal tools stay available so the model can
      # triage and report; everything else is fail-safe denied.
      exit 0
      ;;
    *)
      if [ ! -f "$root/.claude/unattended-halt.md" ]; then
        printf 'UNATTENDED HALT %s — doctor reported CRITICAL findings; all non-read-only tools were blocked for the rest of the unattended run. Triage: .claude/.framework-doctor-findings.md. This file clears automatically at the next session start once doctor is clean (or delete it after triage).\n' \
          "$(date -u +%FT%TZ)" > "$root/.claude/unattended-halt.md" 2>/dev/null
      fi
      echo "UNATTENDED HALT: doctor reports CRITICAL findings — tool '${tool:-unknown}' is blocked (fail-safe allowlist; .claude/unattended-halt.md written for the supervisor). Read .claude/.framework-doctor-findings.md, report the halt in your final message, and end the run. This halt takes precedence over 'never end the run'." >&2
      exit 2
      ;;
  esac
fi
exit 0
