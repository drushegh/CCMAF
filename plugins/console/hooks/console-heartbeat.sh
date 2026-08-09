#!/usr/bin/env bash
# console-heartbeat.sh — Console liveness heartbeat (TASK-066 AC3).
#
# The machine-global Console tray Hub reaps a project's registry entry when its
# session dies ungracefully (window closed / crash, no /wrapup). This hook is
# the framework's half of that contract: on activity (UserPromptSubmit +
# PostToolUse) it refreshes the mtime of THIS project's live registry entry so a
# still-alive session is never reaped. The Console's reaper stat()s mtimeMs and
# reaps entries stale past its grace — but ONLY when the reaper is enabled
# (cold-start `console start` sets CONSOLE_REAP_GRACE_MIN); this hook just keeps
# the clock fresh.
#
# Contract (contract:console-lifecycle — see CLAUDE.framework.md / .claude/ECOSYSTEM.md):
#   - Resolve the live entry by matching the registry entry whose rootPath ==
#     this project — NOT ports.json (the bound port can differ from the pin;
#     verified live: pin 6120 busy -> bound 6173).
#   - mtime-touch ONLY; never rewrite the Console-owned JSON.
#   - State dir = userStateDir(): Win %LOCALAPPDATA%\ccmaf-console\, mac
#     ~/Library/Application Support/ccmaf-console/, Linux
#     $XDG_STATE_HOME|~/.local/state/ccmaf-console/ ; override CCMAF_CONSOLE_STATE_DIR.
#
# Gated on the project being opted in to the Console (.console-version, the
# skills-style pin from TASK-067, or the legacy .console-enabled) — no opt-in =>
# instant no-op (zero coupling for projects without a Console). Event-cadence,
# throttled to at most once/minute via the .claude/.console-heartbeat marker
# mtime (stateless clock). Fail-open: any gap => emit the event-appropriate
# empty output + exit 0. Stable hook id: console-heartbeat (normal tier).

INPUT=$(cat 2>/dev/null || true)

_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"

# UserPromptSubmit expects a JSON object on stdout; PostToolUse tolerates empty.
EVENT=""
if command -v jq >/dev/null 2>&1; then
  EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)
  EVENT="${EVENT%$'\r'}"
fi
_emit_empty() { case "$EVENT" in UserPromptSubmit) echo "{}" ;; *) : ;; esac; }

# Profile gate (auto-off in minimal; explicit disable always wins).
if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled console-heartbeat normal; then
  _emit_empty; exit 0
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$ROOT" ] || { _emit_empty; exit 0; }

# Opt-in gate: only a project that wants a Console has an entry to heartbeat.
{ [ -f "$ROOT/.claude/.console-version" ] || [ -f "$ROOT/.claude/.console-enabled" ]; } \
  || { _emit_empty; exit 0; }

# Throttle: at most once/minute. The marker's own mtime IS the clock (stateless;
# no counter file to parse). A fresh marker (< 1 min) short-circuits the scan so
# a long autonomous turn's PostToolUse storm costs one stat(), not a scan each.
MARKER="$ROOT/.claude/.console-heartbeat"
if [ -f "$MARKER" ] && [ -n "$(find "$MARKER" -mmin -1 2>/dev/null)" ]; then
  _emit_empty; exit 0
fi

# rootPath parsing needs jq (the value carries escaped backslashes). Without it,
# fail-open — the reaper grace (~60 min) tolerates missed beats.
command -v jq >/dev/null 2>&1 || { _emit_empty; exit 0; }

# Resolve the per-user Console state dir (mirror the Console's userStateDir()).
STATE_DIR="${CCMAF_CONSOLE_STATE_DIR:-}"
if [ -z "$STATE_DIR" ]; then
  if [ -n "$LOCALAPPDATA" ]; then
    STATE_DIR="$LOCALAPPDATA/ccmaf-console"                       # Windows
  elif [ "$(uname 2>/dev/null)" = "Darwin" ]; then
    STATE_DIR="$HOME/Library/Application Support/ccmaf-console"   # macOS
  else
    STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/ccmaf-console"  # Linux
  fi
fi
REG_DIR="$STATE_DIR/registry"
[ -d "$REG_DIR" ] || { _emit_empty; exit 0; }

# Refresh the throttle marker now (before the scan) so concurrent fires in the
# same minute short-circuit regardless of how long the scan takes.
: > "$MARKER" 2>/dev/null || touch "$MARKER" 2>/dev/null

# Canonical form for matching: forward slashes, /drive/ form, fully lowercased
# so path-case never blocks the match. normalize_tool_path (hook-common) does
# the Win->posix drive conversion; tr lowercases the rest.
_canon() {
  local p="$1"
  command -v normalize_tool_path >/dev/null 2>&1 && p="$(normalize_tool_path "$p")"
  printf '%s' "$p" | tr '[:upper:]' '[:lower:]'
}
WANT="$(_canon "$ROOT")"

# Touch every registry entry whose rootPath matches this project (duplicates can
# exist; the Console health-prunes dead pids — we only keep live ones fresh).
for f in "$REG_DIR"/*.json; do
  [ -f "$f" ] || continue
  rp=$(jq -r '.rootPath // empty' "$f" 2>/dev/null); rp="${rp%$'\r'}"
  [ -n "$rp" ] || continue
  [ "$(_canon "$rp")" = "$WANT" ] && touch "$f" 2>/dev/null
done

_emit_empty
exit 0
