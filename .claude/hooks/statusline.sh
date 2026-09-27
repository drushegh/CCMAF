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
  sid=$(printf '%s' "$input" | jq -r '.session_id // ""' 2>/dev/null) || sid=""
fi
sid="${sid:-}"; sid="${sid%$'\r'}"
case "$sid" in *[!A-Za-z0-9_-]*) sid="" ;; esac   # path-safe ids only

branch=$(git -C "$dir" branch --show-current 2>/dev/null) || branch=""

# --- persist the real context signal for checkpoint-watermark (TASK-134) ------
# The statusline payload is the ONLY hook surface carrying the true
# .context_window.used_percentage (verified — the UserPromptSubmit/PostToolUse
# payloads that checkpoint-watermark sees do NOT). Cache it (+ a 1M window derived
# from the model display name) so checkpoint-watermark can use the REAL number
# instead of estimating tokens against a guessed window (default 200000, which
# mis-fires on a [1m] session). Best-effort + fail-open: never break the line.
# Keyed by session_id (.context-pct.<sid>): a single per-repo file let two
# concurrent sessions overwrite each other's %, so one session's nudge fired
# (or stayed silent) on the OTHER session's context. The v1 hook
# (.claude/hooks/checkpoint-watermark.sh) prefers the keyed file.
# LEGACY: the unkeyed .context-pct is ALSO still written, because the shipped
# v2 twin (plugins/ccmaf/hooks/checkpoint-watermark.sh) and any consumer still
# on a pre-keying hook read ONLY that file — dropping it would silently send
# them back to the 200k-window token estimate (the [1m] footgun TASK-134
# fixed). Retire the unkeyed write once every reader does the keyed lookup.
_root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || _root=""
_write_pct() {  # $1 = target file
  { printf 'PCT=%s\nWIN=%s\nTS=%s\n' "$_pct" "$_win" "$_ts"; } \
    > "$1.tmp.$$" 2>/dev/null && mv -f "$1.tmp.$$" "$1" 2>/dev/null \
    || rm -f "$1.tmp.$$" 2>/dev/null
}
if [ -n "$_root" ]; then
  _win="-"
  case "$model" in *1M*|*1m*|*"1,000,000"*|*"1 million"*) _win=1000000 ;; esac
  _pct="-"; case "$pct" in ''|'?'|*[!0-9.]*) : ;; *) _pct="$pct" ;; esac
  if [ "$_pct" != "-" ] || [ "$_win" != "-" ]; then
    _ts=$(date +%s 2>/dev/null || echo 0)
    _pf="$_root/.claude/telemetry/.context-pct"
    mkdir -p "$_root/.claude/telemetry" 2>/dev/null
    if [ -n "$sid" ]; then
      # First write for this session → prune other sessions' caches older than
      # a day (once per session, not per render).
      [ -f "$_pf.$sid" ] || find "$_root/.claude/telemetry" -maxdepth 1 -name '.context-pct.*' \
        -mmin +1440 -exec rm -f {} + 2>/dev/null
      _write_pct "$_pf.$sid"
    fi
    _write_pct "$_pf"   # legacy unkeyed copy (see above)
  fi
fi

echo "ctx:${pct:-?}% | ${model:-?} | ${branch:-no-git}"
