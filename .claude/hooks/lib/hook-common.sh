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
#   safety  — runs in ALL profiles (only block-dangerous today)
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
