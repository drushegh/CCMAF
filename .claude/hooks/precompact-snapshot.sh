#!/usr/bin/env bash
# precompact-snapshot.sh — PreCompact hook (TASK-052).
#
# MECHANICAL ONLY (shell, no model turn): record that a compaction is about to
# happen and which files are dirty, so the post-compaction reconcile has a
# breadcrumb. It records FILENAMES ONLY (git status --short) — never file
# CONTENT: a content patch (git diff) could copy a secret out of a tracked
# file's uncommitted diff into a model-readable path, defeating the shipped
# Read-deny controls. The working tree itself survives compaction, so the live
# `git diff` is the content record (session-reanchor tells the model to use it).
#
# It deliberately does NOT externalise a handoff — that needs a model turn,
# impossible from a shell hook (the model-driven externalise is the
# watermark-nudged CHECKPOINT during the run, see checkpoint-watermark.sh).
# It deliberately does NOT mutate git (no add / commit / stash) — locked
# decision, design doc §4: nothing surprising happens to the branch.
#
# Fail-open: never blocks compaction; always exit 0.

INPUT=$(cat 2>/dev/null || true)

_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"
if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled precompact-snapshot normal; then
  exit 0
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
SNAP="$ROOT/.claude/.precompact-snapshot"
mkdir -p "$SNAP" 2>/dev/null || exit 0

# Prune stale per-compaction status snapshots (>14 days). These accumulate one
# file per compaction and are gitignored + Read-denied, so nothing else ever
# trims them; only the most recent matters to a post-compaction reconcile.
# Same cheap, best-effort idiom as session-start-marker.sh.
find "$SNAP" -maxdepth 1 -name 'status-*.txt' -type f -mtime +14 -delete 2>/dev/null || true

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)       # ISO, for file contents
TSF=$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null)          # colon-free, for FILENAMES
                                                    # (NTFS forbids ':' in names)

TRIGGER="" SID=""
if command -v jq >/dev/null 2>&1; then
  TRIGGER=$(printf '%s' "$INPUT" | jq -r '.trigger // empty' 2>/dev/null || true); TRIGGER="${TRIGGER%$'\r'}"
  SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true); SID="${SID%$'\r'}"
fi

BRANCH=$(git -C "$ROOT" branch --show-current 2>/dev/null || echo "")

# Marker: a small breadcrumb the post-compaction reconcile can diff against.
{
  echo "compaction_at=$TS"
  echo "trigger=${TRIGGER:-unknown}"
  echo "session_id=${SID:-}"
  echo "branch=${BRANCH:-}"
  echo "--- git status --short ---"
  git -C "$ROOT" status --short 2>/dev/null
} > "$ROOT/.claude/.last-compaction" 2>/dev/null || true

# Snapshot WHICH files are dirty (porcelain = filenames + status codes only,
# never file CONTENT — see header). READ-ONLY git: no add/commit/stash — the
# index and HEAD are untouched.
git -C "$ROOT" status --short > "$SNAP/status-$TSF.txt" 2>/dev/null || true

if command -v telemetry_emit >/dev/null 2>&1; then
  export CLAUDE_HOOK_SESSION_ID="$SID"
  telemetry_emit "$ROOT" "precompact-snapshot" "snapshot" "ok" ",\"trigger\":\"${TRIGGER:-unknown}\""
fi
exit 0
