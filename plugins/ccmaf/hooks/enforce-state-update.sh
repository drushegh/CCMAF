#!/bin/bash
# Check that state files were updated during this session.
# We check BOTH uncommitted changes AND commits made since this session
# started (see session-start-marker.sh; falls back to the last 5 commits
# repo-wide if that marker is unavailable) because the agent may have
# already committed the state files.

# Capture the Stop hook payload (carries transcript_path) for the
# cost-tracker marker below. Drained FIRST, before lib-sourcing/gating,
# regardless of what follows — matches every other hook's habit of never
# leaving a harness write blocked on an unread pipe (see
# guard-interpreter-check.sh) — and so cost-tracking can still run
# independently even when enforce-state itself is disabled.
STOP_INPUT=$(cat 2>/dev/null || true)

# --- Profile / opt-out gate (TASK-011) -------------------------------
# Skip → exit 0 (no state-update enforcement). In minimal profile or if
# explicitly disabled, the session is not blocked at Stop.
#
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
# (CORE-DESIGN §0), never bare presence — this is the FIRST effective act
# after sourcing the lib, ahead of the cost-tracker sub-feature AND the
# main state-enforcement logic below, so core's copy is a true zero-cost
# no-op in every v1 project (which already runs the bundled v1 hook
# unchanged) and in any non-CCMAF repo.
core_active || exit 0

# v2 adaptation (CORE-DESIGN §8): during an UNATTENDED HALT the
# unattended-guard denies every mutating tool, so demanding state-file
# updates here would deadlock the run (can't edit, can't stop). The
# exemption is LIVE, not latched (review swarm P1): it applies only while
# the doctor findings flag STILL reports CRITICAL — a stale halt file
# left after the human fixed the findings must not silently disable
# Stop-hook enforcement forever (core-context clears stale halts at the
# next session start).
_uh_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
if [ "${CLAUDE_UNATTENDED:-}" = "1" ] && [ -f "$_uh_root/.claude/unattended-halt.md" ] \
   && [ -f "$_uh_root/.claude/.framework-doctor-findings.md" ] \
   && head -n 10 "$_uh_root/.claude/.framework-doctor-findings.md" | grep -Eq '\*\*Findings:\*\*[[:space:]]+[1-9][0-9]*[[:space:]]+CRITICAL'; then
  exit 0
fi

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

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

# File paths ONLY (--format= suppresses commit subjects). The old
# --oneline form mixed subject lines into the haystack, so a commit
# MESSAGE mentioning "TASKS.md" counted as an update; and the unanchored
# grep let DEPLOY-STATUS.md satisfy the STATUS.md check (DA-H7).
#
# Session-scope the window (Audtor 2026-07-02 minor): a fixed "last 5
# commits" is repo-wide, not session-wide — a PRIOR session's state commit
# could silently satisfy the CURRENT session's gate if it landed within
# the last 5. session-start-marker.sh (SessionStart) stamps HEAD at the
# start of THIS session into .claude/.session-start-commit.<session_id>;
# count only commits strictly after OUR OWN session's mark instead of a
# blind fixed count. The marker is keyed by the payload's session_id
# (sanitised with the IDENTICAL filter the writer uses) because a fixed,
# repo-global name would let two CONCURRENT sessions on the same working
# directory clobber each other's mark — the very cross-session
# interference class this scoping exists to close. No session_id in the
# payload → the legacy unsuffixed name (matches the writer's own no-jq
# fallback, so the degraded path stays coherent end-to-end); another
# session's suffixed marker is NEVER read.
# Fail-open on ANY gap (no marker for THIS session, unreadable, garbage
# content, or a sha that isn't a real commit in this repo's history —
# e.g. a rewritten/rebased history) by falling back to the old repo-wide
# -5 window, so a missing marker degrades scoping precision, never
# protection.
#
# SESSION_SCOPED is a deliberate separate flag, not "RECENT_FILES is
# empty": a session that legitimately made ZERO commits yet (all work
# still uncommitted, or no work at all) produces an EMPTY, but perfectly
# VALID, session-scoped result — that must still count as scoped (so a
# prior session's state commit stays out of MISSING's calculation), not
# be mistaken for "the marker didn't resolve" and fall back to the
# repo-wide window, which would re-admit exactly the prior-session commit
# this fix exists to exclude.
RECENT_FILES=""
SESSION_SCOPED=0
if [ -n "$REPO_ROOT" ]; then
  # Same filesystem-safe sanitisation as session-start-marker.sh — both
  # sides must derive the same filename from the same session_id.
  _marker_sid=$(printf '%s' "$_sid" | tr -cd 'A-Za-z0-9._-')
  SESSION_MARKER="$REPO_ROOT/.claude/.session-start-commit${_marker_sid:+.$_marker_sid}"
  SESSION_START_SHA=""
  if [ -f "$SESSION_MARKER" ]; then
    SESSION_START_SHA=$(head -c 200 "$SESSION_MARKER" 2>/dev/null | tr -d '\r\n ')
  fi
  if [ -n "$SESSION_START_SHA" ] && git cat-file -e "${SESSION_START_SHA}^{commit}" 2>/dev/null; then
    RECENT_FILES=$(git log --name-only --format= "${SESSION_START_SHA}..HEAD" 2>/dev/null)
    SESSION_SCOPED=1
  fi
fi
if [ "$SESSION_SCOPED" -eq 0 ]; then
  RECENT_FILES=$(git log --name-only --format= -5 2>/dev/null)
fi
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
# (REPO_ROOT already resolved above for the session-scoping marker.)
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

  # v2 adaptation: insights machinery is PLUGIN-owned (CLAUDE_PLUGIN_ROOT),
  # not project-owned — the v1 `.claude/framework/...` path would silently
  # no-op at v2.1 (CORE-DESIGN §1: "the §3 path-swap rule applies to HOOKS
  # as well as commands"). Scrape review-findings.md once per session end.
  # Cheap, non-fatal.
  if [ -x "${CLAUDE_PLUGIN_ROOT}/insights/scrape-review-findings.sh" ]; then
    bash "${CLAUDE_PLUGIN_ROOT}/insights/scrape-review-findings.sh" 2>/dev/null || true
  fi
fi

if [ -n "$MISSING" ]; then
  echo "STATE FILES NOT UPDATED:$MISSING" >&2
  echo "You must update these files before finishing. Update task statuses, current status, and session progress." >&2
  exit 2
fi
