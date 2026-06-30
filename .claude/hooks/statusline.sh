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

echo "ctx:${pct:-?}% | ${model:-?} | ${branch:-no-git}"
