#!/bin/bash
# Check that state files were updated during this session.
# We check BOTH uncommitted changes AND recent commits (last 5)
# because the agent may have already committed the state files.

# --- Profile / opt-out gate (TASK-011) -------------------------------
# Skip → exit 0 (no state-update enforcement). In minimal profile or if
# explicitly disabled, the session is not blocked at Stop.
_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"

# Capture the Stop hook payload (carries transcript_path) for the
# cost-tracker marker below. Drained even when enforce-state is disabled
# so cost-tracking can still run independently.
STOP_INPUT=$(cat 2>/dev/null || true)

# One jq pass over the Stop payload: session_id (telemetry correlation,
# contract:telemetry-schema), stop_hook_active (re-block yield below),
# transcript_path (cost marker). Fail-open: no jq / non-JSON payload →
# all three stay empty and every consumer degrades exactly as before.
_sid="" STOP_ACTIVE="" _tpath=""
if command -v jq >/dev/null 2>&1; then
  {
    IFS= read -r _sid
    IFS= read -r STOP_ACTIVE
    IFS= read -r _tpath
  } < <(printf '%s' "$STOP_INPUT" | jq -r '(.session_id // ""), (.stop_hook_active // false | tostring), (.transcript_path // "")' 2>/dev/null) || true
  # git-bash jq emits CRLF on -r and `read` keeps the \r — without these
  # strips the "true" comparison and the -f test below silently fail.
  _sid="${_sid%$'\r'}"; STOP_ACTIVE="${STOP_ACTIVE%$'\r'}"; _tpath="${_tpath%$'\r'}"
fi
# Exported so the review-findings scraper subprocess inherits it too.
export CLAUDE_HOOK_SESSION_ID="$_sid"

# cost-tracker sub-feature (TASK-012): emit a per-session-end telemetry
# marker (tool-call count + transcript size) as a cheap cost proxy.
# Gated by the `cost-tracker` hook ID; runs before the state-enforcement
# exit so it fires even on turns the Stop guard would block.
emit_cost_marker() {
  command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled cost-tracker normal && return 0
  command -v telemetry_emit >/dev/null 2>&1 || return 0
  local root; root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
  local tool_uses=0 lines=0
  if [ -n "$_tpath" ] && [ -f "$_tpath" ]; then
    tool_uses=$(grep -c '"type":"tool_use"' "$_tpath" 2>/dev/null) || tool_uses=0
    lines=$(wc -l < "$_tpath" 2>/dev/null | tr -d ' ') || lines=0
  fi
  telemetry_emit "$root" "cost-tracker" "session-end" "ok" \
    ",\"tool_uses\":${tool_uses:-0},\"transcript_lines\":${lines:-0}"
}
emit_cost_marker

command -v hook_enabled >/dev/null 2>&1 && { hook_enabled enforce-state normal || exit 0; }

# Respect stop_hook_active: Claude Code sets it in the payload when the
# Stop hook already fired (and blocked) this stop cycle. Blocking again
# would loop a session that genuinely has nothing to update (e.g. pure
# Q&A far from the last state commit). One block = one nudge — the model
# either fixed the state files or had nothing to fix.
# Fail-open: no jq / field absent → empty → enforcement runs as before.
[ "$STOP_ACTIVE" = "true" ] && exit 0

# Skip on first session — no commits yet means we're scaffolding
COMMIT_COUNT=$(git rev-list --count HEAD 2>/dev/null || echo "0")
if [ "$COMMIT_COUNT" = "0" ]; then
  exit 0
fi

# File paths ONLY (--format= suppresses commit subjects). The old
# --oneline form mixed subject lines into the haystack, so a commit
# MESSAGE mentioning "TASKS.md" counted as an update; and the unanchored
# grep let DEPLOY-STATUS.md satisfy the STATUS.md check (DA-H7).
RECENT_FILES=$(git log --name-only --format= -5 2>/dev/null)
UNCOMMITTED=$(git diff --name-only HEAD 2>/dev/null; git diff --name-only --cached 2>/dev/null)
ALL_CHANGES="$UNCOMMITTED
$RECENT_FILES"

# Anchored: match the exact filename at a path boundary.
_touched() { echo "$ALL_CHANGES" | grep -qE "(^|/)$1\$"; }

MISSING=""
if ! _touched "TASKS\.md"; then MISSING="$MISSING TASKS.md"; fi
if ! _touched "STATUS\.md"; then MISSING="$MISSING STATUS.md"; fi
if ! _touched "claude-progress\.txt"; then MISSING="$MISSING claude-progress.txt"; fi

# --- Telemetry: emit one event per Stop ---
# Schema-v2 via hook-common.sh (contract:telemetry-schema). Lib absent →
# no event; any failure must not break the hook's normal function.
# `missing` is CSV of fixed state-file names — safe to inline.
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$REPO_ROOT" ]; then
  if command -v telemetry_emit >/dev/null 2>&1; then
    if [ -n "$MISSING" ]; then
      # Normalise leading-space trim and CSV the missing files for analysis.
      _missing_csv=$(echo "$MISSING" | awk '{$1=$1}1' | tr ' ' ',')
      telemetry_emit "$REPO_ROOT" "stop" "blocked" "blocked" ",\"missing\":\"$_missing_csv\""
    else
      telemetry_emit "$REPO_ROOT" "stop" "passed" "ok"
    fi
  fi

  # Scrape review-findings.md once per session end. Cheap, non-fatal.
  if [ -x "$REPO_ROOT/.claude/framework/insights/scrape-review-findings.sh" ]; then
    bash "$REPO_ROOT/.claude/framework/insights/scrape-review-findings.sh" 2>/dev/null || true
  fi
fi

if [ -n "$MISSING" ]; then
  echo "STATE FILES NOT UPDATED:$MISSING" >&2
  echo "You must update these files before finishing. Update task statuses, current status, and session progress." >&2
  exit 2
fi
