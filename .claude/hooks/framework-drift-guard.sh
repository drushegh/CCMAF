#!/bin/bash
# Framework Drift Guard — injects reminders when Claude drifts from framework rules.
# Fires on UserPromptSubmit. Only outputs when drift indicators are detected.
#
# Drift indicators:
# 1. State files haven't been touched despite project file changes
# 2. Many prompts since last state file update
# 3. TASKS.md has no "In Progress" item (working without claiming a task)
# 4. Periodic reminder to log framework improvement suggestions and review GOTCHAS.md

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then exit 0; fi

# UserPromptSubmit payload arrives on stdin; its session_id scopes the
# prompt counters to the CURRENT session (see the reset below). Fail-open:
# no jq / no session_id → counters behave as before (lifetime).
HOOK_INPUT=$(cat 2>/dev/null || true)

# --- Profile / opt-out gate (TASK-011) -------------------------------
# Skip → emit the empty object (no additional context injected).
_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"
if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled drift-guard normal; then
  echo "{}"; exit 0
fi

# jq is required for JSON state management
if ! command -v jq &>/dev/null; then
  echo '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"⚠ jq is not installed. Framework hooks (drift guard, metrics) require jq. Install it: https://jqlang.github.io/jq/download/"}}' 2>/dev/null
  exit 0
fi

# State files live at .claude/ (root). framework-self mode was retired in
# TASK-054: the upstream repo now keeps its dirty dev board at root and ships
# the clean canonical from 02_solution/ instead of redirecting to self/.
STATE_ROOT="$REPO_ROOT/.claude"
STATE_PREFIX=".claude/"

STATE_DIR="$REPO_ROOT/.claude"
DRIFT_STATE="$STATE_DIR/.drift-state"
mkdir -p "$STATE_DIR"

# --- Project-source pattern (for Indicator 1) -------------------------
# Default: framework convention `01_Project/`. Consumers with other
# layouts override either via `.claude/healthcheck.conf`
# (`HEALTHCHECK_SOURCE_DIRS="02_src/ app/ src/"` as a space-separated
# list of directories) or directly via the `FRAMEWORK_DRIFT_SOURCE_PATTERN`
# env var (complete regex).
PROJECT_PATTERN="^01_Project/"
if [ -f "$REPO_ROOT/.claude/healthcheck.conf" ]; then
  # Extract ONLY the two variables this hook needs — do NOT source the
  # file (DA-M12: sourcing executes arbitrary shell from a committed
  # config on every prompt, silently making healthcheck.conf a
  # privileged file). Values are taken as simple KEY="value" / KEY=value
  # assignments; anything fancier belongs in the environment.
  _hc_get() {
    sed -n "s/^[[:space:]]*$1=[\"']\\{0,1\\}\\([^\"']*\\)[\"']\\{0,1\\}[[:space:]]*\$/\\1/p" \
      "$REPO_ROOT/.claude/healthcheck.conf" 2>/dev/null | tail -1
  }
  _v=$(_hc_get HEALTHCHECK_SOURCE_DIRS);        [ -n "$_v" ] && HEALTHCHECK_SOURCE_DIRS="$_v"
  _v=$(_hc_get FRAMEWORK_DRIFT_SOURCE_PATTERN); [ -n "$_v" ] && FRAMEWORK_DRIFT_SOURCE_PATTERN="$_v"
fi
if [ -n "${FRAMEWORK_DRIFT_SOURCE_PATTERN:-}" ]; then
  PROJECT_PATTERN="$FRAMEWORK_DRIFT_SOURCE_PATTERN"
elif [ -n "${HEALTHCHECK_SOURCE_DIRS:-}" ]; then
  # Build "^(dir1|dir2|dir3)/" from space-separated HEALTHCHECK_SOURCE_DIRS.
  _sd=$(echo "$HEALTHCHECK_SOURCE_DIRS" | tr -s ' \t' '\n' | sed 's|/$||' | grep -v '^$' | paste -sd '|' -)
  [ -n "$_sd" ] && PROJECT_PATTERN="^($_sd)/"
fi

# Initialise drift state if missing
if [ ! -f "$DRIFT_STATE" ]; then
  echo '{"prompt_count":0,"last_reminder":0}' > "$DRIFT_STATE"
fi

# Read current state
PROMPT_COUNT=$(jq -r '.prompt_count // 0' "$DRIFT_STATE" 2>/dev/null || echo "0")
LAST_REMINDER=$(jq -r '.last_reminder // 0' "$DRIFT_STATE" 2>/dev/null || echo "0")
LAST_SUGGESTIONS_REMINDER=$(jq -r '.last_suggestions_reminder // 0' "$DRIFT_STATE" 2>/dev/null || echo "0")
LAST_COMPACT_REMINDER=$(jq -r '.last_compact_reminder // 0' "$DRIFT_STATE" 2>/dev/null || echo "0")
LAST_SESSION_ID=$(jq -r '.session_id // empty' "$DRIFT_STATE" 2>/dev/null || true)

# Per-session counter reset. Without this, .drift-state accumulated for the
# project's LIFETIME: "every 8 prompts" nudges measured across sessions and
# the compaction nudge claimed "N prompts this session" with a lifetime
# count. The payload's session_id changes per session — reset on change.
SESSION_ID=$(printf '%s' "$HOOK_INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
if [ -n "$SESSION_ID" ] && [ "$SESSION_ID" != "$LAST_SESSION_ID" ]; then
  PROMPT_COUNT=0
  LAST_REMINDER=0
  LAST_SUGGESTIONS_REMINDER=0
  LAST_COMPACT_REMINDER=0
fi
PROMPT_COUNT=$((PROMPT_COUNT + 1))

# Check for drift indicators
REMINDERS=""
DRIFT_DETECTED=false

# Track the PRIMARY trigger (first one fired) for telemetry.
PRIMARY_TRIGGER=""
_set_primary() { [ -z "$PRIMARY_TRIGGER" ] && PRIMARY_TRIGGER="$1"; }

# Indicator 1: Project files changed but state files haven't
# grep -c prints "0" on no match — no `|| echo "0"` fallback needed. With
# `set -e` active (or in arithmetic context), the || branch was producing
# "0\n0" for the variable, which broke the integer comparison below.
PROJECT_CHANGES=$(git diff --name-only HEAD 2>/dev/null | grep -cE "$PROJECT_PATTERN")
# State-file regex (STATE_PREFIX is always .claude/; framework-self redirect retired)
# AND per-file layouts (decisions/*.md, contracts/*.md). Either a
# monolithic file or any file in the per-file dirs counts as state.
STATE_REGEX="^${STATE_PREFIX}(TASKS|STATUS|DECISIONS|ECOSYSTEM)\.md|^${STATE_PREFIX}claude-progress\.txt|^${STATE_PREFIX}(decisions|contracts)/.*\.md"
STATE_CHANGES=$(git diff --name-only HEAD 2>/dev/null | grep -cE "$STATE_REGEX")
if [ "$PROJECT_CHANGES" -gt 3 ] && [ "$STATE_CHANGES" -eq 0 ]; then
  REMINDERS="${REMINDERS}⚠ You have ${PROJECT_CHANGES} uncommitted project file changes but NO state file updates. Update TASKS.md with current task status.\n"
  DRIFT_DETECTED=true
  _set_primary "stale-state"
fi

# Indicator 2: Many prompts since last reminder (every 8 prompts)
SINCE_REMINDER=$((PROMPT_COUNT - LAST_REMINDER))
if [ "$SINCE_REMINDER" -ge 8 ]; then
  REMINDERS="${REMINDERS}📋 Framework check-in: Are you following the framework? Update TASKS.md when task status changes. Review contracts before changing interfaces. Record significant decisions per your project's decision-logging convention.\n"
  DRIFT_DETECTED=true
  _set_primary "periodic-checkin"
fi

# Indicator 3: No "In Progress" task in TASKS.md (working without claiming)
if [ -f "$STATE_ROOT/TASKS.md" ]; then
  # Count actual entries UNDER the "### In Progress" heading (#### task
  # headings or list items). Grepping the whole file for "in.progress"
  # matched the section heading and lifecycle comments themselves, so the
  # count was >0 even on an empty board and this indicator never fired.
  IN_PROGRESS=$(awk '/^### In Progress/{f=1; next} /^### /{f=0} f && (/^#### / || /^[-*] /){c++} END{print c+0}' "$STATE_ROOT/TASKS.md" 2>/dev/null)
  IN_PROGRESS="${IN_PROGRESS:-0}"
  # An entirely EMPTY board = a fresh project / pre-task setup (before /plan has
  # created anything) — there's nothing to claim yet, so stay quiet. Only nag when
  # tasks EXIST but none is In Progress.
  TOTAL_TASKS=$(grep -cE '^#### \[(TASK|BUG)-' "$STATE_ROOT/TASKS.md" 2>/dev/null || true)
  TOTAL_TASKS="${TOTAL_TASKS:-0}"
  if [ "$IN_PROGRESS" -eq 0 ] && [ "$TOTAL_TASKS" -gt 0 ] && [ "$PROMPT_COUNT" -gt 3 ]; then
    REMINDERS="${REMINDERS}⚠ No task is marked 'In Progress' in TASKS.md. Claim a task before working on it.\n"
    DRIFT_DETECTED=true
    _set_primary "no-task-claimed"
  fi
fi

# Indicator 4: Periodic reminder about framework suggestions and GOTCHAS review
# Fires every 15 prompts (less frequent than the general check-in).
SINCE_SUGGESTIONS=$((PROMPT_COUNT - LAST_SUGGESTIONS_REMINDER))
if [ "$SINCE_SUGGESTIONS" -ge 15 ]; then
  REMINDERS="${REMINDERS}💡 Framework improvement check: If you encountered and fixed an issue this session that the framework itself could have prevented (missing guardrails, unclear instructions, structural gaps), log it in FRAMEWORK-SUGGESTIONS.md. Also review GOTCHAS.md — if any entry describes a broadly useful pattern (not project-specific) that would help future projects, promote it to a framework suggestion.\n"
  DRIFT_DETECTED=true
  SUGGESTIONS_REMINDED=true
  _set_primary "framework-suggestions"
fi

# Indicator 5: Strategic compaction nudge (suggest-compact sub-feature, TASK-012).
# Fires every CLAUDE_SUGGEST_COMPACT_TURNS prompts (default 25). Gated by the
# `suggest-compact` hook ID so it honours profile/disable settings
# independently of the rest of drift-guard (CLAUDE_DISABLED_HOOKS=suggest-compact
# silences just this nudge; minimal profile silences all of drift-guard anyway).
# This is the technically-correct channel for the nudge: UserPromptSubmit can
# inject context the model reads BEFORE responding, so it can act on the
# suggestion this turn — a Stop hook fires after the turn is already over.
COMPACT_TURNS="${CLAUDE_SUGGEST_COMPACT_TURNS:-25}"
COMPACT_TURNS="${COMPACT_TURNS%$'\r'}"
case "$COMPACT_TURNS" in ''|*[!0-9]*) COMPACT_TURNS=25 ;; esac
COMPACT_ENABLED=true
if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled suggest-compact normal; then
  COMPACT_ENABLED=false
fi
SINCE_COMPACT=$((PROMPT_COUNT - LAST_COMPACT_REMINDER))
if [ "$COMPACT_ENABLED" = true ] && [ "$SINCE_COMPACT" -ge "$COMPACT_TURNS" ]; then
  REMINDERS="${REMINDERS}🧭 Context check: ${PROMPT_COUNT} prompts this session. At a logical breakpoint (a task just finished, about to start something new), consider \`/compact\` or a fresh session to keep context lean — see CLAUDE.framework.md 'Context Awareness'. When compacting, preserve modified files, task status, and current decisions.\n"
  DRIFT_DETECTED=true
  COMPACT_REMINDED=true
  _set_primary "compaction-nudge"
fi

# Update drift state
NEW_LAST_REMINDER=$LAST_REMINDER
NEW_LAST_SUGGESTIONS=$LAST_SUGGESTIONS_REMINDER
NEW_LAST_COMPACT=$LAST_COMPACT_REMINDER
if [ "$DRIFT_DETECTED" = true ]; then
  NEW_LAST_REMINDER=$PROMPT_COUNT
fi
if [ "${SUGGESTIONS_REMINDED:-false}" = true ]; then
  NEW_LAST_SUGGESTIONS=$PROMPT_COUNT
fi
if [ "${COMPACT_REMINDED:-false}" = true ]; then
  NEW_LAST_COMPACT=$PROMPT_COUNT
fi
_dtmp="${DRIFT_STATE}.tmp"
command -v unique_tmp >/dev/null 2>&1 && _dtmp=$(unique_tmp "$DRIFT_STATE")
jq -n --argjson count "$PROMPT_COUNT" \
      --argjson reminder "$NEW_LAST_REMINDER" \
      --argjson suggestions "$NEW_LAST_SUGGESTIONS" \
      --argjson compact "$NEW_LAST_COMPACT" \
      --arg session "${SESSION_ID:-$LAST_SESSION_ID}" \
  '{prompt_count: $count, last_reminder: $reminder, last_suggestions_reminder: $suggestions, last_compact_reminder: $compact, session_id: $session}' > "$_dtmp" \
  && mv -f "$_dtmp" "$DRIFT_STATE" 2>/dev/null || rm -f "$_dtmp" 2>/dev/null
# tmp+mv (DA-H6): a direct truncate-write left partial JSON behind on an
# interrupted write or concurrent UserPromptSubmit fire — the next read
# then failed and silently reset every counter. A UNIQUE tmp path per
# write (Audtor 2026-07-02 minor), not a fixed "${DRIFT_STATE}.tmp" name:
# two concurrent UserPromptSubmit fires used to race on the SAME temp
# file and could clobber each other's write (lost update).

# --- Telemetry: emit one event per UserPromptSubmit ---
# Schema-v2 via hook-common.sh (contract:telemetry-schema). Lib absent →
# no event; telemetry must not break the hook's normal function. SESSION_ID
# was already extracted above for the per-session counter reset; trigger
# values are fixed enums from _set_primary call sites.
if command -v telemetry_emit >/dev/null 2>&1; then
  export CLAUDE_HOOK_SESSION_ID="${SESSION_ID:-}"
  if [ "$DRIFT_DETECTED" = true ]; then
    telemetry_emit "$REPO_ROOT" "drift-guard" "drift-detected" "flagged" \
      ",\"trigger\":\"${PRIMARY_TRIGGER:-unknown}\""
  else
    telemetry_emit "$REPO_ROOT" "drift-guard" "clean" "ok"
  fi
fi

# Output reminder if drift detected
if [ "$DRIFT_DETECTED" = true ]; then
  # Escape for JSON
  ESCAPED=$(echo -e "$REMINDERS" | jq -Rs .)
  cat <<ENDJSON
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": ${ESCAPED}
  }
}
ENDJSON
else
  echo "{}"
fi

exit 0
