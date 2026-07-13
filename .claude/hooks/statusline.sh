#!/usr/bin/env bash
# statusline.sh — Claude Code status line: context % | model | git branch.
#
# Claude Code pipes session JSON to the statusLine command on STDIN.
# There is no CLAUDE_STATUS_JSON env var — the previous inline command
# read one and rendered permanent "?" placeholders (doctor Check 10
# detects that pattern in consumer settings).
#
# Fields used:
#   .context_window.used_percentage — context usage %
#   .model.display_name             — active model
#   .workspace.current_dir          — where to resolve the git branch
#     (cwd-independent: don't assume the statusline command runs at the
#     project root)
#
# Fail-open: no jq → "?" placeholders; no git repo → "no-git".

input=$(cat)

pct="?"; model="?"; dir="."
if command -v jq >/dev/null 2>&1; then
  pct=$(printf '%s' "$input" | jq -r '.context_window.used_percentage // "?"' 2>/dev/null) || pct="?"
  model=$(printf '%s' "$input" | jq -r '.model.display_name // "?"' 2>/dev/null) || model="?"
  dir=$(printf '%s' "$input" | jq -r '.workspace.current_dir // "."' 2>/dev/null) || dir="."
fi

branch=$(git -C "$dir" branch --show-current 2>/dev/null) || branch=""

# --- persist the real context signal for checkpoint-watermark (TASK-134) ------
# The statusline payload is the ONLY hook surface carrying the true
# .context_window.used_percentage (verified — the UserPromptSubmit/PostToolUse
# payloads that checkpoint-watermark sees do NOT). Cache it (+ a 1M window derived
# from the model display name) so checkpoint-watermark can use the REAL number
# instead of estimating tokens against a guessed window (default 200000, which
# mis-fires on a [1m] session). Best-effort + fail-open: never break the line.
_root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || _root=""
if [ -n "$_root" ]; then
  _win="-"
  case "$model" in *1M*|*1m*|*"1,000,000"*|*"1 million"*) _win=1000000 ;; esac
  _pct="-"; case "$pct" in ''|'?'|*[!0-9.]*) : ;; *) _pct="$pct" ;; esac
  if [ "$_pct" != "-" ] || [ "$_win" != "-" ]; then
    _pf="$_root/.claude/telemetry/.context-pct"
    mkdir -p "$_root/.claude/telemetry" 2>/dev/null
    { printf 'PCT=%s\nWIN=%s\nTS=%s\n' "$_pct" "$_win" "$(date +%s 2>/dev/null || echo 0)"; } \
      > "$_pf.tmp.$$" 2>/dev/null && mv -f "$_pf.tmp.$$" "$_pf" 2>/dev/null \
      || rm -f "$_pf.tmp.$$" 2>/dev/null
  fi
fi

echo "ctx:${pct:-?}% | ${model:-?} | ${branch:-no-git}"
