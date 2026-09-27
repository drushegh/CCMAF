#!/usr/bin/env bash
# session-start-marker.sh — SessionStart: record HEAD at the start of THIS
# session so enforce-state-update.sh (Stop) can session-scope its "were the
# state files touched" gate. Audtor 2026-07-02 minor fix.
#
# The problem this closes: enforce-state-update.sh used to check a
# repo-wide `git log -5` window with no session boundary — a PRIOR
# session's state-file commit could silently satisfy the CURRENT session's
# gate if it happened to land within the last 5 commits. This hook writes
# the current HEAD sha to .claude/.session-start-commit.<session_id>;
# enforce-state-update.sh then only counts commits strictly after ITS OWN
# session's mark as "this session's" work.
#
# The marker is keyed PER SESSION (the payload's .session_id — same field
# every sibling hook parses; see session-reanchor.sh) because a fixed,
# repo-global filename would let two CONCURRENT Claude Code sessions on
# the same working directory overwrite each other's marker — re-creating
# exactly the cross-session interference this fix exists to close. When
# the payload carries no session_id (no jq / degraded harness), both this
# hook and enforce-state-update.sh fall back to the same UNSUFFIXED legacy
# name, so the no-jq path stays coherent end-to-end.
#
# Every SessionStart fire (startup/resume/clear/compact) re-stamps the
# marker to the CURRENT HEAD — deliberately, including after an inline
# compaction, so the enforced window is always "commits since the most
# recent SessionStart", consistent with treating a post-compaction
# re-anchor (session-reanchor.sh) as a fresh checkpoint. Suffixed markers
# from long-dead sessions are pruned here so they never accumulate.
#
# Marker format: line 1 = the HEAD sha (the only line older readers use —
# /ccmaf:build reads `head -1`), line 2 = `started=<epoch>`, the session's
# start time. The start time lives in the CONTENT, not the file mtime,
# because enforce-state-update.sh re-touches this session's marker on every
# Stop as a LIVENESS signal — so the prune below keys on "no Stop for 7
# days" (a genuinely dead session), never on "started 3+ days ago", which
# used to delete a live long-running session's marker out from under it.
# enforce-state-update.sh uses `started=` to tell state files dirtied THIS
# session from ones left dirty by an earlier one.
#
# Root: "${CLAUDE_PROJECT_DIR:-$PWD}" — the same .claude/ core_active
# gated on (a nested project in a monorepo must not scatter its marker into
# the git toplevel's .claude/). git is still required for the HEAD sha.
#
# Tier: normal (matches enforce-state's own tier — in `minimal` profile
# enforce-state-update.sh no-ops entirely, so this marker not being written
# there changes nothing). Fail-open throughout: no git repo / no commits
# yet / any read-write hiccup → write nothing and exit 0.
# enforce-state-update.sh already falls back to its old repo-wide window
# when the marker is absent or doesn't resolve to a real commit, so any
# failure here degrades scoping precision, never protection.

INPUT=$(cat 2>/dev/null || true)

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
    [ -f "$f" ] && grep -Eq '^[[:space:]]*FRAMEWORK_LINE=v2' "$f" 2>/dev/null
  }
fi
# v2 adaptation: core activates on the v2 line in .framework-version
# (CORE-DESIGN §0), never bare presence — this must be the FIRST effective
# act after sourcing the lib so core stays a true no-op in v1 projects and
# non-CCMAF repos.
core_active || exit 0

if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled session-start-marker normal; then
  echo "{}"; exit 0
fi

# Session identity from the payload (fail-open: no jq / absent field →
# empty → legacy unsuffixed marker name). Sanitised to a filesystem-safe
# character class — the id becomes part of a filename, so anything outside
# [A-Za-z0-9._-] is dropped. enforce-state-update.sh applies the IDENTICAL
# sanitisation so both sides always derive the same name.
SID=""
if command -v jq >/dev/null 2>&1; then
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
  SID="${SID%$'\r'}"
fi
SID=$(printf '%s' "$SID" | tr -cd 'A-Za-z0-9._-')

ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1 || { echo "{}"; exit 0; }

# Prune suffixed markers left by long-dead sessions (cheap, best-effort).
# mtime = that session's last Stop (enforce-state-update.sh touches its own
# marker every Stop), so +7 means a week with no turn at all. The current
# session's marker is immune: it is (re)written just below.
find "$ROOT/.claude" -maxdepth 1 -name '.session-start-commit.*' -type f \
  -mtime +7 -delete 2>/dev/null || true

# `git rev-parse HEAD` on an UNBORN HEAD (no commits yet) is a genuine git
# gotcha, not a hypothetical: it exits 128 but still prints the literal
# string "HEAD" to STDOUT before failing (the ref-name echo happens before
# resolution). A bare non-empty-string check on the captured output would
# therefore treat that as a valid sha and write "HEAD" as the marker — the
# exit status must be checked too, not just non-emptiness.
if HEAD_SHA=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null) && [ -n "$HEAD_SHA" ]; then
  MARKER="$ROOT/.claude/.session-start-commit${SID:+.$SID}"
  mkdir -p "$ROOT/.claude" 2>/dev/null
  _tmp="$MARKER.tmp"
  command -v unique_tmp >/dev/null 2>&1 && _tmp=$(unique_tmp "$MARKER")
  printf '%s\nstarted=%s\n' "$HEAD_SHA" "$(date +%s 2>/dev/null)" > "$_tmp" 2>/dev/null \
    && mv -f "$_tmp" "$MARKER" 2>/dev/null || rm -f "$_tmp" 2>/dev/null
fi

echo "{}"
exit 0
