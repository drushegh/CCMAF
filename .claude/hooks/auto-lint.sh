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

# Resolve the repo root ONCE and export it under the SAME var the
# dispatcher uses, so a standalone (non-dispatched) invocation doesn't pay
# for a second `git rev-parse --show-toplevel` spawn later (in
# node_project_dir_for, below) for a value _log_event already needed.
# Presence check (not emptiness) so a dispatcher-supplied "" (not a git
# repo) is trusted rather than re-resolved.
if [ -z "${CLAUDE_POSTEDIT_ROOT+x}" ]; then
  # Assign then export separately (SC2155): `export VAR=$(cmd)` masks the
  # command's exit status behind export's own.
  CLAUDE_POSTEDIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
  export CLAUDE_POSTEDIT_ROOT
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
  # TypeScript / JavaScript — ESLint (project-local). Walk up from the FILE
  # to the nearest ancestor package.json rather than checking the hook's
  # own CWD — this framework's own npm root is console/, not the repo
  # root, so a CWD-anchored check was silently dead for that layout, and
  # for any consumer with a similarly nested npm project (Audtor
  # 2026-07-02 minor). Absolute-ize the path first so the eslint
  # invocation is correct regardless of which directory we `cd` into.
  *.ts|*.tsx|*.js|*.jsx)
    case "$file" in
      /*) _file_abs="$file" ;;
      *)  _file_abs="${PWD%/}/$file" ;;
    esac
    _pkg_dir=""
    if command -v node_project_dir_for >/dev/null 2>&1; then
      _pkg_dir=$(node_project_dir_for "$file")
    elif [ -f "package.json" ]; then
      _pkg_dir="."
    fi
    if [ -n "$_pkg_dir" ] && [ -f "$_pkg_dir/node_modules/.bin/eslint" ]; then
      ( cd "$_pkg_dir" && npx eslint "$_file_abs" --no-warn-ignored --format compact 2>/dev/null | head -20 )
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
