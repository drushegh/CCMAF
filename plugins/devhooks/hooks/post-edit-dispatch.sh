#!/usr/bin/env bash
# post-edit-dispatch.sh — single PostToolUse entry point for the three
# post-edit hooks (auto-format, auto-lint, verify-deps). TASK-035.
#
# Why: registered separately, every Write/Edit spawns three hook chains,
# each re-reading stdin, re-running jq, and re-resolving the repo root
# with its own `git rev-parse` — 5-7 process spawns per edit, 250-750ms
# on Windows git-bash (deep-analysis S4). This dispatcher reads stdin
# ONCE, extracts + normalizes the file path ONCE, resolves the root
# ONCE, and hands the results to the three hooks via precomputed env:
#
#   CLAUDE_POSTEDIT_FILE — extracted + normalize_tool_path'd file path
#                          (presence of the var means "trust it, skip
#                          stdin/jq"; empty value = no file in event)
#   CLAUDE_POSTEDIT_ROOT — `git rev-parse --show-toplevel` result
#                          (empty = not in a git repo)
#
# Each hook keeps its standalone stdin path unchanged — consumers with
# the legacy three-entry settings.json registration keep working, and
# the hooks stay independently testable. Chosen over the alternative
# (refactor the three into sourceable function files) for exactly that
# reason: zero behaviour change on the direct path.
#
# Per-hook gates are NOT applied here: each hook still runs its own
# hook_enabled check, so the stable IDs format / lint / verify-deps
# remain individually controllable via CLAUDE_HOOK_PROFILE and
# CLAUDE_DISABLED_HOOKS exactly as before.
#
# Fail-open: any failure (no jq, garbage stdin, missing hook file)
# degrades to running the hooks with whatever was resolved; always
# exits 0. PostToolUse output is informational — never block an edit.
#
# settings.json registration (replaces the three separate entries):
#   bash -c 'cd "$CLAUDE_PROJECT_DIR" && bash .claude/hooks/post-edit-dispatch.sh'

input=$(cat)

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Resolve once -----------------------------------------------------
_lib="$HOOK_DIR/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"

file="" _sid="" _tuid=""
if command -v jq >/dev/null 2>&1; then
  # One jq spawn extracts the file path AND the telemetry correlation ids
  # (contract:telemetry-schema). Three values, one per line — the ids are
  # single-line tokens, the path is read last.
  {
    IFS= read -r _sid
    IFS= read -r _tuid
    IFS= read -r file
  } < <(echo "$input" | jq -r '(.session_id // ""), (.tool_use_id // ""), (.tool_input.file_path // .tool_input.path // "")' 2>/dev/null) || true
  # git-bash jq emits CRLF on -r; `read` keeps the \r — strip it.
  _sid="${_sid%$'\r'}"; _tuid="${_tuid%$'\r'}"
fi
command -v normalize_tool_path >/dev/null 2>&1 && file=$(normalize_tool_path "$file")

root=$(git rev-parse --show-toplevel 2>/dev/null || true)

export CLAUDE_POSTEDIT_FILE="$file"
export CLAUDE_POSTEDIT_ROOT="$root"
# Telemetry correlation ids for telemetry_emit (hook-common.sh) — exported
# under the generic names so the three hooks' emits pick them up directly.
export CLAUDE_HOOK_SESSION_ID="$_sid"
export CLAUDE_HOOK_TOOL_USE_ID="$_tuid"

# --- Run the three hooks ----------------------------------------------
# Sequential, same order as the legacy settings.json entries. </dev/null
# because the hooks skip their stdin read when CLAUDE_POSTEDIT_FILE is
# set — but if one is ever run without that support, an empty stdin is
# the safe fallback (every hook fail-opens on an unparseable event).
for h in auto-format.sh auto-lint.sh verify-deps.sh; do
  [ -f "$HOOK_DIR/$h" ] && bash "$HOOK_DIR/$h" </dev/null || true
done

exit 0
