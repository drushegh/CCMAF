#!/usr/bin/env bash
# ccmaf-kernel PostToolUse hook (all tools) — the machine-checked side of the
# kernel's tool-call budget. Counts tool calls per session (cumulative across
# tasks — KERNEL.md rule 2 says so); at the kernel's thresholds (30, 60, then
# every 60) it nags via exit 2 + stderr, which PostToolUse feeds back to the
# model without blocking anything.
#
# Self-deference: silent no-op in a full-CCMAF project (its own lifecycle
# hooks own pacing there), anchored on CLAUDE_PROJECT_DIR because hook cwd
# is not guaranteed to be the project root. Must stay FAST — it runs after
# every tool call.
set -u

[ -f "${CLAUDE_PROJECT_DIR:-.}/.claude/.framework-version" ] && exit 0

# The payload's own session_id is the FIRST key of the one-line JSON on
# stdin: anchor the match there and read only the head, so a session_id
# buried in tool_input/tool_response can never win and a multi-MB payload
# is never scanned in full. The value feeds a filename — whitelist it, and
# fall back per-invocation (not to one shared counter) so a failed
# extraction degrades to bounded noise instead of cross-session bleed.
sid=$(head -c 2048 2>/dev/null | sed -n 's/^{[[:space:]]*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
case "$sid" in ''|*[!A-Za-z0-9._-]*) sid="unknown-$$";; esac

dir="${HOME}/.ccmaf-kernel"
mkdir -p "$dir" 2>/dev/null || exit 0
f="$dir/budget-${sid}.count"

n=0
[ -f "$f" ] && n=$(cat "$f" 2>/dev/null || echo 0)
case "$n" in *[!0-9]*|"") n=0;; esac
n=$((n + 1))
# Per-invocation temp + atomic rename: parallel tool calls fire concurrent
# PostToolUse hooks, and a plain `>` truncate lets a concurrent reader see
# an empty file and silently reset the count to zero.
tmp="${f}.tmp.$$"
printf '%s' "$n" > "$tmp" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; exit 0; }
mv -f "$tmp" "$f" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; exit 0; }

if [ "$n" -eq 30 ] || [ "$n" -eq 60 ] || { [ "$n" -ge 120 ] && [ $((n % 60)) -eq 0 ]; }; then
  echo "ccmaf-kernel budget: ${n} tool calls this session. If this meets or exceeds the budget you stated for the current task (kernel rule 2), stop and write the receipt (what you'd try next included); otherwise continue and mind the bound - session counts are cumulative across tasks." >&2
  exit 2
fi
exit 0
