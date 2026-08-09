#!/usr/bin/env bash
# console-autostart.sh — SessionStart: auto-start the project Console (TASK-115).
#
# Cold-start step 10.5 (CLAUDE.framework.md) already brings the Console up
# via the driver's `start` verb, but only if the MODEL actually executes
# that step — a session that skips/forgets it (or a harness that never reads
# CLAUDE.framework.md at all) never gets a running Console. This hook is a
# deterministic, model-independent trigger for the same effect: on
# SessionStart it backgrounds this plugin's `scripts/console.mjs start` so
# "open the project" alone brings the Console up, no model action required.
#
# Contract (contract:console-lifecycle — see CLAUDE.framework.md /
# .claude/ECOSYSTEM.md). This hook is intentionally a THIN trigger: all the
# real logic (idempotency, already-running detection, respecting a prior
# manual tray "End" -> autoStart:false, spawning detached, printing the URL)
# lives in the driver's own `start` verb. This hook does not duplicate
# any of that — it only fires the command in the background and returns.
#
# Race note: cold-start step 10.5 ALSO runs `console start` later in the same
# session (for URL surfacing, since this hook's background start has no
# synchronous way to report the port back to the model). Both call sites are
# idempotent — a second `start` while one is already running/starting just
# reprints the URL and respects a prior tray "End" — so the two are safe to
# race benignly. No coordination between them is attempted or needed.
#
# Gated on the project being opted in to the Console (.console-version, the
# skills-style pin from TASK-067, or the legacy .console-enabled) — no opt-in
# => instant no-op (zero coupling for projects without a Console). Fire-and-
# forget: NEVER blocks session start, since the first `npx ccmaf-console` can
# take 10s+ to resolve. Fail-open throughout: any gap => no-op, exit 0.
# Stable hook id: console-autostart (normal tier).

INPUT=$(cat 2>/dev/null || true)

_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"

# Profile gate (auto-off in minimal; explicit disable always wins).
if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled console-autostart normal; then
  echo "{}"; exit 0
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
[ -n "$ROOT" ] || { echo "{}"; exit 0; }

# Opt-in gate: only a project that wants a Console gets auto-started.
{ [ -f "$ROOT/.claude/.console-version" ] || [ -f "$ROOT/.claude/.console-enabled" ]; } \
  || { echo "{}"; exit 0; }

# Only auto-start on a real session boot (startup/resume). On compact/clear
# the console (if opted in) is already up from earlier in the same session —
# re-starting there would be redundant, not wrong, but pointless work on
# every inline compaction. No jq / empty source => treat as startup (fail
# open toward starting, since that's the common/expected case).
SOURCE=""
if command -v jq >/dev/null 2>&1; then
  SOURCE=$(printf '%s' "$INPUT" | jq -r '.source // empty' 2>/dev/null || true)
  SOURCE="${SOURCE%$'\r'}"
fi
case "$SOURCE" in
  ""|startup|resume) : ;;
  *) echo "{}"; exit 0 ;;
esac

# Nothing to start with / nothing to start => no-op, never an error.
command -v node >/dev/null 2>&1 || { echo "{}"; exit 0; }
[ -f "${CLAUDE_PLUGIN_ROOT}/scripts/console.mjs" ] || { echo "{}"; exit 0; }

# Fire-and-forget: background the start and return immediately. This is
# Git Bash on Windows (per console-heartbeat.sh / the repo's existing
# assumption) — nohup ... & is the detach pattern there. The whole
# cd+nohup group is itself backgrounded (trailing & on the subshell) so
# this hook's own process never waits on it even momentarily; disown then
# drops that one job from THIS shell's job table (when the builtin
# exists) so the child is fully detached, not just nohup-immune to SIGHUP.
# --root "$ROOT" is load-bearing: the plugin copy of console.mjs lives in the
# plugin cache, so it cannot derive the project from its own location — it
# resolves the root from the invocation context (--root, else CLAUDE_PROJECT_DIR,
# else git toplevel from cwd). Pass it explicitly so the Console registers THIS
# project regardless of what the fallbacks would see.
( cd "$ROOT" 2>/dev/null || exit 0
  nohup node "${CLAUDE_PLUGIN_ROOT}/scripts/console.mjs" start --root "$ROOT" >/dev/null 2>&1 &
) &
command -v disown >/dev/null 2>&1 && disown -a 2>/dev/null || true

echo "{}"
exit 0
