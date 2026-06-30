#!/bin/bash
# Auto-format the changed file after Write/Edit. Targets only the
# specific file, not the entire project. Stack-agnostic: dispatches by
# file extension + tool availability. Each branch is opt-in — if the
# relevant tool is absent, the hook no-ops.

# Dispatcher fast path (TASK-035): post-edit-dispatch.sh reads stdin and
# resolves the normalized path + repo root once for all three post-edit
# hooks. Presence of CLAUDE_POSTEDIT_FILE (even empty) means "trust it" —
# skip the per-hook stdin read, jq spawn, and normalization below.
if [ -n "${CLAUDE_POSTEDIT_FILE+x}" ]; then
  file="$CLAUDE_POSTEDIT_FILE"
else
  input=$(cat)
  # One jq spawn: file path + telemetry correlation ids (contract:telemetry-schema).
  _sid="" _tuid="" file=""
  {
    IFS= read -r _sid
    IFS= read -r _tuid
    IFS= read -r file
  } < <(echo "$input" | jq -r '(.session_id // ""), (.tool_use_id // ""), (.tool_input.file_path // .tool_input.path // "")' 2>/dev/null) || true
  # git-bash jq emits CRLF on -r; `read` keeps the \r — strip it.
  export CLAUDE_HOOK_SESSION_ID="${_sid%$'\r'}"
  export CLAUDE_HOOK_TOOL_USE_ID="${_tuid%$'\r'}"
fi

# --- Profile / opt-out gate (TASK-011) -------------------------------
_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"
command -v hook_enabled >/dev/null 2>&1 && { hook_enabled format normal || exit 0; }
# Windows-native paths (F:\x) → POSIX (/f/x) so formatter invocations work (DA-H1).
# Dispatcher path arrives pre-normalized.
if [ -z "${CLAUDE_POSTEDIT_FILE+x}" ]; then
  command -v normalize_tool_path >/dev/null 2>&1 && file=$(normalize_tool_path "$file")
fi

_log_event() {
  local outcome="$1"
  local root
  if [ -n "${CLAUDE_POSTEDIT_ROOT:-}" ]; then
    root="$CLAUDE_POSTEDIT_ROOT"
  else
    root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
  fi
  # Schema-v2 emit via hook-common.sh (contract:telemetry-schema). Lib
  # absent → no event; telemetry is best-effort, formatting never is.
  command -v telemetry_emit >/dev/null 2>&1 || return 0
  local class="ok"; [ "$outcome" = "skipped" ] && class="skipped"
  telemetry_emit "$root" "format" "$outcome" "$class"
}

# Skip if no file path
if [ -z "$file" ]; then _log_event "skipped"; exit 0; fi

case "$file" in
  # TypeScript / JavaScript / web assets — prettier (only if this is a Node project)
  *.ts|*.tsx|*.js|*.jsx|*.css|*.scss|*.html)
    if [ -f "package.json" ] && command -v npx &>/dev/null; then
      npx prettier --write "$file" --log-level silent 2>/dev/null
      _log_event "formatted"; exit 0
    fi
    ;;
  # Python — ruff format (preferred) or black
  *.py)
    if command -v ruff &>/dev/null; then
      ruff format "$file" 2>/dev/null
      _log_event "formatted"; exit 0
    elif command -v black &>/dev/null; then
      black --quiet "$file" 2>/dev/null
      _log_event "formatted"; exit 0
    fi
    ;;
  # Go — gofmt (ships with Go toolchain)
  *.go)
    if command -v gofmt &>/dev/null; then
      gofmt -w "$file" 2>/dev/null
      _log_event "formatted"; exit 0
    fi
    ;;
  # Rust — rustfmt
  *.rs)
    if command -v rustfmt &>/dev/null; then
      rustfmt --edition 2021 "$file" 2>/dev/null
      _log_event "formatted"; exit 0
    fi
    ;;
  # .NET — dotnet format is slow (needs full solution parse); opt-in via
  # env var so default behaviour doesn't stall every edit.
  *.cs)
    if [ "${CLAUDE_DOTNET_FORMAT:-0}" = "1" ] && command -v dotnet &>/dev/null; then
      dotnet format --include "$file" >/dev/null 2>&1
      _log_event "formatted"; exit 0
    fi
    ;;
esac

# No formatter matched the file type / tooling unavailable
_log_event "skipped"
exit 0
