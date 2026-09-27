#!/bin/bash
# Run linter on changed files after Write/Edit and hand the findings to the
# MODEL so it can fix them immediately. Stack-agnostic: dispatches by file
# extension + tool availability.
#
# Delivery: plain stdout from an exit-0 PostToolUse hook only reaches the
# transcript / debug view, NOT the model's context. So the linter output is
# captured and emitted as ONE JSON object,
#   {"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":...}}
# (the same channel verify-deps uses). Nothing is printed when the linter is
# clean. Exit 0 always — lint findings are feedback, not a block (PostToolUse
# runs after the write has already landed; exit 2 would only route stderr to
# the model as an error). One-JSON-per-dispatch invariant: auto-lint and
# verify-deps never both print for the same file (auto-lint skips every
# manifest type verify-deps handles: *.json, *.toml, *.txt, and go.mod falls
# to the catch-all), and auto-format keeps its stdout silent.

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
# shellcheck source=/dev/null
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
  local outcome="$1" reason="${2:-}"
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
  # Optional skip-reason token (OPT r2 Phase 1'): passed through telemetry_emit's
  # extra-json param. Lets a later hook-admission-budget check route on WHY a
  # skip happened (tool-ineligible = routing defect; no-tool = coverage-gap or
  # disable; ext = healthy content-based floor) instead of alarming on raw skip%.
  local extra=""
  [ -n "$reason" ] && extra=",\"reason\":\"$reason\""
  telemetry_emit "$root" "lint" "$outcome" "$class" "$extra"
}

# _hoisted_node_bin <pkg-dir> <bin> — for a Node tool NOT installed in the
# nearest package's own node_modules/.bin, walk up from <pkg-dir> to the repo
# root looking for a HOISTED install (npm/yarn/pnpm workspaces put dev tools in
# the workspace root's node_modules). Prints the absolute bin path, or nothing.
# Bounded at CLAUDE_POSTEDIT_ROOT; with no repo root nothing is searched, so an
# unrelated node_modules further up the real filesystem is never used.
# (Identical helper in auto-format.sh — keep the two in step.)
_hoisted_node_bin() {
  local d="$1" name="$2" ceil="${CLAUDE_POSTEDIT_ROOT:-}"
  [ -n "$ceil" ] || return 0
  # Canonicalise both ends the same way before comparing: on Git Bash one side
  # may arrive as /c/Users/.../Temp and the other as its /tmp mount (or C:/...),
  # so compare native forms (`pwd -W`; plain `pwd` elsewhere).
  ceil=$(cd "$ceil" 2>/dev/null && { pwd -W 2>/dev/null || pwd; }) || return 0
  d=$(cd "$d" 2>/dev/null && { pwd -W 2>/dev/null || pwd; }) || return 0
  while [ "$d" != "$ceil" ]; do
    case "$d" in "$ceil"/*) : ;; *) return 0 ;; esac   # never leave the repo
    d=$(dirname "$d")
    [ -f "$d/node_modules/.bin/$name" ] && { printf '%s\n' "$d/node_modules/.bin/$name"; return 0; }
  done
  return 0
}

# Emit captured linter output as PostToolUse additionalContext (see header).
# Empty output → print nothing (a clean lint adds no context noise).
_emit_lint_context() {
  local tool="$1" out="$2" ctx
  out="${out//$'\r'/}"
  [ -n "${out//[[:space:]]/}" ] || return 0
  ctx="Lint findings ($tool) for \`$file\` after your edit — fix before moving on:"$'\n'"$out"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$ctx" \
      | jq -Rs '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:.}}' 2>/dev/null \
      && return 0
  fi
  # No jq (or jq failed): escape by hand. The replacement strings live in a
  # VARIABLE because bash backslash-processes literal replacements in
  # ${var//pat/repl} (same technique as verify-deps.sh). Remaining control
  # characters are stripped — linter output is ordinary text.
  local _bs='\' _esc
  _esc=${ctx//"$_bs"/"$_bs$_bs"}
  _esc=${_esc//'"'/"$_bs"'"'}
  _esc=${_esc//$'\t'/"$_bs"t}
  _esc=${_esc//$'\n'/"$_bs"n}
  _esc=$(printf '%s' "$_esc" | tr -d '\000-\010\013\014\016-\037')
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$_esc"
}

# Skip if no file path or if it's a non-code file
if [ -z "$file" ]; then _log_event "skipped" "tool-ineligible"; exit 0; fi
case "$file" in
  *.md|*.txt|*.json|*.yml|*.yaml|*.toml|*.lock|*.css) _log_event "skipped" "ext"; exit 0 ;;
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
      _out=$( cd "$_pkg_dir" && npx --no eslint "$_file_abs" --no-warn-ignored --format compact 2>/dev/null | head -20 )
      _emit_lint_context eslint "$_out"
      _log_event "ran"; exit 0
    fi
    # Hoisted workspace install (eslint in an ancestor's node_modules, up to the
    # repo root) → run that exact on-disk bin, still from the package dir so the
    # package's own eslint config is the one resolved.
    if [ -n "$_pkg_dir" ]; then
      _ebin=$(_hoisted_node_bin "$_pkg_dir" eslint)
      if [ -n "$_ebin" ]; then
        _out=$( cd "$_pkg_dir" && "$_ebin" "$_file_abs" --no-warn-ignored --format compact 2>/dev/null | head -20 )
        _emit_lint_context eslint "$_out"
        _log_event "ran"; exit 0
      fi
    fi
    ;;
  # Python — Ruff (replaces flake8 + isort + pyflakes)
  *.py)
    if command -v ruff &>/dev/null; then
      _out=$(ruff check "$file" --output-format concise 2>/dev/null | head -20)
      _emit_lint_context ruff "$_out"
      _log_event "ran"; exit 0
    fi
    ;;
  # Go — go vet (stdlib). Runs on the file's package tree.
  *.go)
    if command -v go &>/dev/null; then
      _out=$(go vet ./... 2>&1 | head -20)
      _emit_lint_context "go vet" "$_out"
      _log_event "ran"; exit 0
    fi
    ;;
  # Rust — cargo clippy (walks up to Cargo.toml automatically)
  *.rs)
    if command -v cargo &>/dev/null; then
      _out=$(cargo clippy --quiet --message-format short 2>&1 | head -20)
      _emit_lint_context clippy "$_out"
      _log_event "ran"; exit 0
    fi
    ;;
  # .NET — dotnet format --verify (slow; opt-in via env var)
  *.cs)
    if [ "${CLAUDE_DOTNET_LINT:-0}" = "1" ] && command -v dotnet &>/dev/null; then
      _out=$(dotnet format --verify-no-changes --include "$file" 2>&1 | head -20)
      _emit_lint_context "dotnet format" "$_out"
      _log_event "ran"; exit 0
    fi
    ;;
  # Shell — ShellCheck. This framework (and any shell-heavy consumer) is
  # exactly the stack this hook must cover: shellcheck is load-bearing in CI,
  # yet before this arm every .sh/.bash edit fell through to the catch-all skip
  # (the 100%-skip "coverage gap", not "dead weight" — OPT r2 Phase 1' finding).
  # Informational, like the other arms (findings reach the model as context;
  # they never block an edit).
  *.sh|*.bash)
    if command -v shellcheck &>/dev/null; then
      _out=$(shellcheck -S warning "$file" 2>/dev/null | head -20)
      _emit_lint_context shellcheck "$_out"
      _log_event "ran"; exit 0
    fi
    ;;
esac

# No linter matched the file type / tooling unavailable
_log_event "skipped" "no-tool"
exit 0
