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
  local outcome="$1" reason="${2:-}"
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
  # Optional skip-reason token (OPT r2 Phase 1') — see auto-lint.sh for the vocabulary.
  local extra=""
  [ -n "$reason" ] && extra=",\"reason\":\"$reason\""
  telemetry_emit "$root" "format" "$outcome" "$class" "$extra"
}

# Skip if no file path
if [ -z "$file" ]; then _log_event "skipped" "tool-ineligible"; exit 0; fi

# Deliberately-non-formattable file types → skip as `ext` (healthy content-based
# floor, not a missing-tool signal). Classification only — these already skipped
# by falling through to the catch-all; behaviour is unchanged. This repo edits
# many .md state files, so tagging them keeps the format skip% honest for the
# hook-admission-budget check.
case "$file" in
  *.md|*.txt|*.lock|*.toml) _log_event "skipped" "ext"; exit 0 ;;
esac

case "$file" in
  # TypeScript / JavaScript / web assets — prettier (only if this file sits
  # under a Node project, i.e. has an ancestor package.json). Walking up
  # from the FILE (not checking the hook's own CWD) matters: this
  # framework's own repo has its npm root at console/, not the repo root,
  # so a check anchored at CWD was silently dead for that layout — and for
  # any consumer with a similarly nested npm project (Audtor 2026-07-02
  # minor). Absolute-ize the path first so the tool invocation is correct
  # regardless of which directory we `cd` into below.
  *.ts|*.tsx|*.js|*.jsx|*.css|*.scss|*.html)
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
    if [ -n "$_pkg_dir" ] && command -v npx &>/dev/null; then
      ( cd "$_pkg_dir" && npx prettier --write "$_file_abs" --log-level silent 2>/dev/null )
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
_log_event "skipped" "no-tool"
exit 0
