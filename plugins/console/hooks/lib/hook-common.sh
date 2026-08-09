#!/usr/bin/env bash
# hook-common.sh — shared helpers sourced by framework hooks.
#
# Single place to resolve hook enablement so consumers can tune hook
# behaviour without editing settings.json. Two knobs:
#
#   CLAUDE_HOOK_PROFILE = minimal | standard | strict   (default: standard)
#   CLAUDE_DISABLED_HOOKS = "id1,id2 id3"   (comma/space-separated stable IDs)
#
# Profile semantics — each hook declares a TIER when it calls hook_enabled:
#   safety  — runs in ALL profiles (block-dangerous + guard-interpreter-check)
#   normal  — runs in standard + strict; skipped in minimal
#   strict  — runs only in strict (reserved for opt-in extra-strict hooks)
#
# A hook ID present in CLAUDE_DISABLED_HOOKS is skipped regardless of
# profile or tier — the user's explicit override always wins.
#
# Stable hook IDs (keep in sync with settings.json registrations):
#   block-dangerous, enforce-state, filter-test-output, drift-guard,
#   format, lint, verify-deps, suggest-compact, cost-tracker,
#   reanchor, precompact-snapshot, postcompact-archive, checkpoint-watermark
#     (these four = TASK-052 session-lifecycle hooks)
#   console-heartbeat   (TASK-066 Console-integration hook)
#   console-autostart   (TASK-115 — SessionStart auto-start of an opted-in Console)
#   guard-interpreter-check (safety tier — reports on block-dangerous's own
#     health; Audtor 2026-07-02 M1-residual fix)
#   session-start-marker   (records the session-scoping watermark that
#     enforce-state-update.sh reads; Audtor 2026-07-02 minor fix)
#
# Usage in a bash hook (FAIL-OPEN: if this helper is absent, the hook
# runs exactly as before — default behaviour is never changed by adding
# the gate):
#
#   _lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
#   [ -f "$_lib" ] && . "$_lib"
#   command -v hook_enabled >/dev/null 2>&1 && { hook_enabled format normal || exit 0; }
#
# Legacy per-hook opt-outs (CLAUDE_DEP_VERIFY=0, CLAUDE_DOTNET_FORMAT=1,
# etc.) still work and are checked inside the individual hooks — this
# helper is additive, not a replacement.

# normalize_tool_path <path> — print the path in POSIX form (DA-H1).
#
# Claude Code on Windows can deliver tool_input.file_path as a native
# Windows path (F:\x\y.ts or F:/x/y.ts). Bash prefix-stripping against
# `git rev-parse --show-toplevel` output (/f/x) and git pathspecs both
# need the git-bash form — without this conversion, hooks that compare
# or cat the path become silent no-ops on Windows. POSIX paths pass
# through unchanged, so non-Windows platforms are unaffected.
normalize_tool_path() {
  local p="$1"
  p="${p%$'\r'}"
  p="${p//\\//}"                       # backslashes → forward slashes
  case "$p" in
    [A-Za-z]:/*)                       # drive letter → /<lowercase-drive>/
      local drive="${p%%:*}"
      drive=$(printf '%s' "$drive" | tr '[:upper:]' '[:lower:]')
      p="/$drive/${p#*:/}"
      ;;
  esac
  printf '%s' "$p"
}

# telemetry_emit <root> <hook_id> <outcome> <outcome_class> [extra_json_pairs]
#
# Append one schema-v2 event line to <root>/.claude/telemetry/events.jsonl
# (contract:telemetry-schema). Correlation ids are read from the
# environment — each hook exports them after parsing its payload (or
# post-edit-dispatch.sh exports them for the dispatched trio):
#
#   CLAUDE_HOOK_SESSION_ID   — payload .session_id (trace root; "" when absent)
#   CLAUDE_HOOK_TOOL_USE_ID  — payload .tool_use_id (tool-call span; key
#                              omitted entirely when empty)
#
# extra_json_pairs, when given, must be a pre-rendered fragment starting
# with a comma, e.g. ',"trigger":"stale-state"' — values the CALLER must
# have escaped/controlled (all current callers pass fixed enums or
# jq-sanitised strings; never interpolate raw user/tool input here).
#
# Best-effort by design: every failure path returns 0 and writes nothing.
# A hook's core function must never depend on telemetry landing.
telemetry_emit() {
  local root="$1" hook="$2" outcome="$3" class="$4" extra="${5:-}"
  [ -n "$root" ] || return 0
  local tdir="$root/.claude/telemetry"
  # Plugin copy: only record telemetry in a CCMAF-scaffolded project —
  # keyed on .claude/.framework-version (the update-system pin every CCMAF
  # project carries), the same marker the plugins' hooks.json deference
  # gates use. A bare .claude/ dir is near-universal among plain Claude
  # Code repos, and nothing outside CCMAF ever reads events.jsonl — plugin
  # copies must never scaffold telemetry into such a repo (nor CREATE
  # .claude anywhere).
  [ -f "$root/.claude/.framework-version" ] || return 0
  mkdir -p "$tdir" 2>/dev/null || return 0
  local ts; ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  # Unique per line, cheap (no extra process): timestamp + pid + two
  # RANDOM draws. Dedup/replay anchor, not a cryptographic id.
  local eid="${ts//[-:]/}-$$-${RANDOM}${RANDOM}"
  # CR-strip the env-supplied ids: git-bash jq emits CRLF on -r, and
  # `read` keeps the \r — a raw control char inside a JSON string makes
  # the whole line unparseable (caught live the first time this ran).
  local sid="${CLAUDE_HOOK_SESSION_ID:-}"; sid="${sid//$'\r'/}"
  local tuid="${CLAUDE_HOOK_TOOL_USE_ID:-}"; tuid="${tuid//$'\r'/}"
  local tuid_frag=""
  [ -n "$tuid" ] && tuid_frag=",\"tool_use_id\":\"${tuid}\""
  printf '{"ts":"%s","schema":2,"event_id":"%s","session_id":"%s"%s,"hook":"%s","outcome":"%s","outcome_class":"%s"%s}\n' \
    "$ts" "$eid" "$sid" "$tuid_frag" "$hook" "$outcome" "$class" "$extra" \
    >> "$tdir/events.jsonl" 2>/dev/null || true
  return 0
}

# Resolve the active profile, defaulting to standard for any unknown value.
_hook_profile() {
  local p="${CLAUDE_HOOK_PROFILE:-standard}"
  p="${p%$'\r'}"   # defend against CRLF if exported from a Windows file
  case "$p" in
    minimal|standard|strict) printf '%s' "$p" ;;
    *) printf 'standard' ;;
  esac
}

# Is <id> present in the CLAUDE_DISABLED_HOOKS list? (comma/space separated)
_hook_is_disabled() {
  local id="$1"
  local list="${CLAUDE_DISABLED_HOOKS:-}"
  [ -z "$list" ] && return 1
  local tok
  for tok in ${list//,/ }; do
    tok="${tok%$'\r'}"
    [ "$tok" = "$id" ] && return 0
  done
  return 1
}

# hook_enabled <id> <tier>
#   exit 0 → the hook should run
#   exit 1 → the hook should skip
hook_enabled() {
  local id="$1" tier="${2:-normal}"
  _hook_is_disabled "$id" && return 1
  local profile; profile="$(_hook_profile)"
  case "$tier" in
    safety) return 0 ;;
    strict) [ "$profile" = "strict" ] && return 0 || return 1 ;;
    normal|*)
      case "$profile" in
        minimal) return 1 ;;
        *) return 0 ;;
      esac
      ;;
  esac
}

# resolve_python <candidate...> — print the first candidate that is BOTH on
# PATH and can actually execute a trivial script; return 1 with no output
# if none can (Audtor 2026-07-02, M1 residual (a)).
#
# `command -v python3` alone is not enough: a name can resolve on PATH and
# still not run. The concrete, observed case is the Windows Store's
# python3.exe app-execution alias — on a host with no real Python installed
# it resolves via PATH resolution and then either opens the Store or exits
# non-zero instead of executing, so a guard that only checked `command -v`
# would think it found a working interpreter and silently never run.
# Actually invoking `-c 'import sys'` catches that class of stub, plus any
# other broken/aliased/shadowed "python" on a consumer's PATH.
resolve_python() {
  local cand
  for cand in "$@"; do
    if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import sys' >/dev/null 2>&1; then
      printf '%s' "$cand"
      return 0
    fi
  done
  return 1
}

# unique_tmp <dest> — print a same-directory temp path for the tmp-write +
# rename pattern used across the hooks (write to a temp file, then
# atomically `mv` it over <dest> on the same filesystem). A FIXED name like
# "<dest>.tmp" lets two concurrent hook fires (e.g. two PostToolUse
# invocations racing on the same state file) write the SAME temp file and
# clobber each other — the loser's content silently wins or the winner's
# write is torn (Audtor 2026-07-02 minor). Each caller gets its own path
# instead, so two racing writers each finish their own tmp file cleanly and
# the later `mv` simply decides which write's result survives — no
# interleaved/truncated content either way.
#
# mktemp keeps the tmp file in <dest>'s directory (same filesystem — the
# `mv` that follows stays an atomic rename, never a cross-fs copy+unlink).
# Falls back to a PID+RANDOM suffix if mktemp is unavailable/fails; never
# fails outright, since every caller's own write+rename already tolerates
# a bad tmp path via its existing `|| rm -f` cleanup.
unique_tmp() {
  local dest="$1" t
  t=$(mktemp "${dest}.XXXXXX" 2>/dev/null) && { printf '%s' "$t"; return 0; }
  printf '%s' "${dest}.tmp.$$.${RANDOM}"
}

# nearest_package_json_dir <start-dir> [<ceiling-dir>] — print the closest
# ancestor of <start-dir> (inclusive) that contains a package.json, walking
# upward and stopping at <ceiling-dir> (inclusive) if given, or at the
# filesystem root otherwise. Prints nothing and returns 1 if none is found
# in range.
#
# Why walk at all: a consumer's npm root is not always the repo root (this
# framework's OWN repo is the example — its npm root is console/, not the
# repo root auto-format.sh/auto-lint.sh used to check). A check anchored
# only at the current directory is silently dead for any such layout
# (Audtor 2026-07-02 minor).
#
# Termination is deliberately explicit, not inferred from string shape:
# an earlier version detected "reached the top" by comparing `${dir%/*}`
# to `dir`, which is wrong at "/" itself — `${dir%/*}` on "/" yields "",
# which then got defaulted back to "/", so `dir` never changed and the
# old-vs-new comparison (taken BEFORE that default) never matched. That
# hung in an infinite loop the first time a real caller's ceiling didn't
# string-match the walk (below — git-for-windows returning a Windows-
# style toplevel while $PWD is POSIX-style is a real, observed case on
# this platform, not a hypothetical). Checking `[ "$dir" = "/" ]` BEFORE
# computing the next parent makes the walk provably finite regardless of
# whether the ceiling ever matches.
nearest_package_json_dir() {
  local dir="${1%/}" ceiling="${2:-}"
  ceiling="${ceiling%/}"
  [ -z "$dir" ] && dir="/"
  while :; do
    if [ -f "$dir/package.json" ]; then
      printf '%s' "$dir"
      return 0
    fi
    [ -n "$ceiling" ] && [ "$dir" = "$ceiling" ] && break
    case "$dir" in
      /|[A-Za-z]:) break ;;   # filesystem root or a bare drive root — stop
    esac
    local parent="${dir%/*}"
    [ -z "$parent" ] && parent="/"
    [ "$parent" = "$dir" ] && break   # safety net; should be unreachable
    dir="$parent"
  done
  return 1
}

# node_project_dir_for <file-path> — resolve <file-path> to an absolute
# path (relative to $PWD if it isn't already one), then find the nearest
# ancestor package.json, bounded at CLAUDE_POSTEDIT_ROOT (set by
# post-edit-dispatch.sh) or the current git repo root — so an unrelated
# package.json further up the real filesystem is never picked up. Prints
# the directory a Node tool (npx/eslint/prettier) should be run FROM, or
# nothing if none exists in range.
node_project_dir_for() {
  local f="$1"
  case "$f" in
    /*) : ;;
    *)  f="${PWD%/}/$f" ;;
  esac
  local ceiling="${CLAUDE_POSTEDIT_ROOT:-}"
  [ -z "$ceiling" ] && ceiling=$(git rev-parse --show-toplevel 2>/dev/null)
  # git-for-windows' `git rev-parse --show-toplevel` has been observed to
  # print a native Windows-style path (C:/Users/...) even from inside
  # git-bash, while $PWD-derived paths here are always POSIX-style
  # (/c/Users/...) — the SAME DA-H1 class of mismatch normalize_tool_path
  # already exists to fix. Without normalizing both sides, the ceiling
  # never string-matches the walk: nearest_package_json_dir still
  # terminates (it no longer hangs), but it would walk past the intended
  # boundary and could pick up an unrelated package.json further up the
  # real filesystem.
  if command -v normalize_tool_path >/dev/null 2>&1; then
    f=$(normalize_tool_path "$f")
    ceiling=$(normalize_tool_path "$ceiling")
  fi
  nearest_package_json_dir "$(dirname "$f")" "$ceiling"
}
