#!/usr/bin/env bash
# postcompact-archive.sh — PostCompact hook (TASK-052).
#
# MECHANICAL ONLY: the PostCompact payload carries the full compact_summary
# (verified, v2.1.183). Archive it to disk so the pre-compaction context has a
# durable, auditable record after history is replaced by the lossy summary.
#
# PostCompact CANNOT inject context back (verified — there is no additionalContext
# handler for PostCompact in the CLI; the re-anchor injection lives on
# SessionStart, see session-reanchor.sh). So this hook is archive-only.
#
# Fail-open: always exit 0.

INPUT=$(cat 2>/dev/null || true)

_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"
if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled postcompact-archive normal; then
  exit 0
fi
command -v jq >/dev/null 2>&1 || exit 0

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
ARCH="$ROOT/.claude/.compaction-archive"
mkdir -p "$ARCH" 2>/dev/null || exit 0

# Prune stale summary archives (>14 days). One file lands per compaction and
# the dir is gitignored + Read-denied, so nothing else trims it; the recent
# ones are the only auditable record worth keeping online. Same cheap,
# best-effort idiom as session-start-marker.sh.
find "$ARCH" -maxdepth 1 -name '*.md' -type f -mtime +14 -delete 2>/dev/null || true

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
TSF=$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null)          # colon-free filename (NTFS)
TRIGGER=$(printf '%s' "$INPUT" | jq -r '.trigger // empty' 2>/dev/null || true); TRIGGER="${TRIGGER%$'\r'}"
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true); SID="${SID%$'\r'}"
SUMMARY=$(printf '%s' "$INPUT" | jq -r '.compact_summary // empty' 2>/dev/null || true)
[ -n "$SUMMARY" ] || SUMMARY="(no compact_summary field in payload)"

{
  echo "# Compaction summary archive"
  echo ""
  echo "- at: $TS"
  echo "- trigger: ${TRIGGER:-unknown}"
  echo "- session_id: ${SID:-}"
  echo ""
  echo "---"
  echo ""
  printf '%s\n' "$SUMMARY"
} > "$ARCH/$TSF.md" 2>/dev/null || true

if command -v telemetry_emit >/dev/null 2>&1; then
  export CLAUDE_HOOK_SESSION_ID="$SID"
  telemetry_emit "$ROOT" "postcompact-archive" "archived" "ok" ",\"trigger\":\"${TRIGGER:-unknown}\""
fi
exit 0
