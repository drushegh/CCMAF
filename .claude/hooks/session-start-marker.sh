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
# from long-dead sessions are pruned here (>3 days old) so they never
# accumulate.
#
# Tier: normal (matches enforce-state's own tier — in `minimal` profile
# enforce-state-update.sh no-ops entirely, so this marker not being written
# there changes nothing). Fail-open throughout: no git repo / no commits
# yet / any read-write hiccup → write nothing and exit 0.
# enforce-state-update.sh already falls back to its old repo-wide window
# when the marker is absent or doesn't resolve to a real commit, so any
# failure here degrades scoping precision, never protection.

INPUT=$(cat 2>/dev/null || true)

_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"
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

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$ROOT" ] || { echo "{}"; exit 0; }

# Prune suffixed markers left by long-dead sessions (cheap, best-effort).
# The current session's marker is immune in practice: it is (re)written
# with a fresh mtime immediately below.
find "$ROOT/.claude" -maxdepth 1 -name '.session-start-commit.*' -type f \
  -mtime +3 -delete 2>/dev/null || true

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
  printf '%s\n' "$HEAD_SHA" > "$_tmp" 2>/dev/null \
    && mv -f "$_tmp" "$MARKER" 2>/dev/null || rm -f "$_tmp" 2>/dev/null
fi

echo "{}"
exit 0
