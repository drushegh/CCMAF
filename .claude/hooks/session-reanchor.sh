#!/usr/bin/env bash
# session-reanchor.sh — SessionStart hook (TASK-052).
#
# After a COMPACTION only, inject a benign, framework-attributed RE-ANCHOR
# directive so the session RECONCILES against disk instead of trusting the
# (possibly lossy) compaction summary.
#
# Verified (Claude Code v2.1.183, design doc framework/docs/plans/
# session-lifecycle-design.md): SessionStart fires with source=="compact"
# after an inline compaction, and its additionalContext IS consumed by the
# model. (A PostCompact hook's additionalContext is NOT — there is no handler
# — so the re-anchor lives here, on SessionStart, not on PostCompact.)
# The directive is deliberately benign + framework-attributed: an empirically
# verified finding is that a coercive / token-echo injection is REFUSED by the
# model as prompt-injection (and can even corrupt the summary), whereas a
# benign "per project protocol, re-read X and reconcile" instruction is honored.
#
# Acts ONLY when source==compact. On startup/resume/clear (or any unknown or
# missing source) it stays silent — it never injects on a normal session start.
# Fail-open: no jq / non-JSON payload → emit {} (no injection), exit 0.

INPUT=$(cat 2>/dev/null || true)

# Profile / opt-out gate. Skip → emit empty object (no injection).
_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"
if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled reanchor normal; then
  echo "{}"; exit 0
fi

# jq required to read .source; without it, do nothing (fail-open).
command -v jq >/dev/null 2>&1 || { echo "{}"; exit 0; }

SOURCE=$(printf '%s' "$INPUT" | jq -r '.source // empty' 2>/dev/null || true)
SOURCE="${SOURCE%$'\r'}"
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
SID="${SID%$'\r'}"

# Only act after a real compaction. Everything else stays silent.
[ "$SOURCE" = "compact" ] || { echo "{}"; exit 0; }

# Telemetry (best-effort; never required).
if command -v telemetry_emit >/dev/null 2>&1; then
  _root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$_root" ]; then
    export CLAUDE_HOOK_SESSION_ID="$SID"
    telemetry_emit "$_root" "reanchor" "injected" "flagged" ",\"source\":\"compact\""
  fi
fi

# Benign, framework-attributed RECONCILE directive (single-quoted: backticks
# and parentheses are literal, no shell expansion).
DIRECTIVE='⚓ Context was just COMPACTED — the summary above may be lossy or wrong. Before continuing, RE-ANCHOR per CLAUDE.framework.md "Session Lifecycle": (1) re-read your state files (TASKS, STATUS, claude-progress — including any `## WIP` section) as canonical for COMMITTED facts; (2) run `git status` / `git diff` to see actual in-flight work; (3) RECONCILE the summary against disk + the live repo — trust the files and the working tree over the summary where they disagree; (4) do not treat the summary'"'"'s task statuses or decisions as authoritative until checked.'

# jq builds the output object → bulletproof JSON escaping of the directive.
printf '%s' "$DIRECTIVE" | jq -Rs '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:.}}' 2>/dev/null || echo "{}"
exit 0
