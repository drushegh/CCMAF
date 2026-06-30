#!/bin/bash
# Run linter on changed files after Write/Edit. Claude sees the output
# and can fix issues immediately. Exit 0 always — lint errors are
# feedback, not blockers (exit 2 would prevent the edit from saving).
# Stack-agnostic: dispatches by file extension + tool availability.

# Dispatcher fast path (TASK-035): see post-edit-dispatch.sh. Presence of
# CLAUDE_POSTEDIT_FILE (even empty) = trust it, skip stdin/jq/normalize.
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
command -v hook_enabled >/dev/null 2>&1 && { hook_enabled lint normal || exit 0; }
# Windows-native paths (F:\x) → POSIX (/f/x) so linter invocations work (DA-H1).
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
  # absent → no event; telemetry is best-effort, linting never is.
  command -v telemetry_emit >/dev/null 2>&1 || return 0
  local class="ok"; [ "$outcome" = "skipped" ] && class="skipped"
  telemetry_emit "$root" "lint" "$outcome" "$class"
}

# Skip if no file path or if it's a non-code file
if [ -z "$file" ]; then _log_event "skipped"; exit 0; fi
case "$file" in
  *.md|*.txt|*.json|*.yml|*.yaml|*.toml|*.lock|*.css) _log_event "skipped"; exit 0 ;;
esac

case "$file" in
  # TypeScript / JavaScript — ESLint (project-local)
  *.ts|*.tsx|*.js|*.jsx)
    if [ -f "node_modules/.bin/eslint" ]; then
      npx eslint "$file" --no-warn-ignored --format compact 2>/dev/null | head -20
      _log_event "ran"; exit 0
    fi
    ;;
  # Python — Ruff (replaces flake8 + isort + pyflakes)
  *.py)
    if command -v ruff &>/dev/null; then
      ruff check "$file" --output-format concise 2>/dev/null | head -20
      _log_event "ran"; exit 0
    fi
    ;;
  # Go — go vet (stdlib). Runs on the file's package tree.
  *.go)
    if command -v go &>/dev/null; then
      go vet ./... 2>&1 | head -20
      _log_event "ran"; exit 0
    fi
    ;;
  # Rust — cargo clippy (walks up to Cargo.toml automatically)
  *.rs)
    if command -v cargo &>/dev/null; then
      cargo clippy --quiet --message-format short 2>&1 | head -20
      _log_event "ran"; exit 0
    fi
    ;;
  # .NET — dotnet format --verify (slow; opt-in via env var)
  *.cs)
    if [ "${CLAUDE_DOTNET_LINT:-0}" = "1" ] && command -v dotnet &>/dev/null; then
      dotnet format --verify-no-changes --include "$file" 2>&1 | head -20
      _log_event "ran"; exit 0
    fi
    ;;
esac

# No linter matched the file type / tooling unavailable
_log_event "skipped"
exit 0
