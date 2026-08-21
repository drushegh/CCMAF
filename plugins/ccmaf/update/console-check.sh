#!/usr/bin/env bash
# console-check.sh — non-adopter discovery for the Project Console (TASK-116).
#
# A project that has never opted into the Console would otherwise NEVER learn
# it exists. Once per throttle interval, if the project isn't opted in (and
# hasn't permanently declined), raise a suggestion flag the cold start can
# surface via AskUserQuestion. Direct analogue of skills-check.sh's
# suggest_discovery() for the skills tier — mirrors its DA-C4 flag discipline,
# permanent-decline marker, and throttle mechanics.
#
# Runs as part of cold start (alongside update-nudge.sh / skills-check.sh).
# Silent when the project has already opted in, has permanently declined, has
# a pending suggestion flag, is still within the throttle window, or lacks
# Node (the Console needs Node/npx to run — no point suggesting it then).
#
# Exit codes:
#   0  — opted in / declined / pending flag / throttled / suggestion written / no node
#
# Dependencies: git, date. No curl. jq + the `claude` CLI are used, softly
# (silent skip if either is absent), only by the opted-in-but-plugin-absent
# probe below — same S3-verified pattern as update-nudge.sh.

set -uo pipefail

# v2 adaptation: the old fallback (a BASH_SOURCE-relative SCRIPT_DIR/../../..)
# assumed a fixed depth
# under a consumer's .claude/framework/ tree — under the plugin layout that no
# longer lands on the project. CLAUDE_PROJECT_DIR (harness-provided) is now
# the primary source of truth; git/cwd remain fallbacks for a manual,
# non-hook invocation.
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
VERSION_FILE="$PROJECT_ROOT/.claude/.console-version"
ENABLED_MARKER="$PROJECT_ROOT/.claude/.console-enabled"
DECLINED_MARKER="$PROJECT_ROOT/.claude/.console-declined"
SUGGEST_FLAG="$PROJECT_ROOT/.claude/.console-suggestion.md"
SUGGEST_THROTTLE="$PROJECT_ROOT/.claude/telemetry/.last-console-suggest"
CONSOLE_SUGGEST_INTERVAL_DAYS="${CONSOLE_SUGGEST_INTERVAL_DAYS:-14}"
CONSOLE_PLUGIN_NUDGE_INTERVAL_DAYS="${CONSOLE_PLUGIN_NUDGE_INTERVAL_DAYS:-7}"

# --- Opted-in-but-plugin-absent nudge (contract:console-lifecycle) --------
# init writes .console-version (opt-in) even before the console PLUGIN is
# installed, promising "the cold-start chain nudges until it is". Once per
# throttle interval, confirm the plugin is actually installed+enabled; if
# the CLI says otherwise, print one nudge line. CLI missing/timing out ->
# stay silent (advisory only, never blocks cold start).
check_plugin_installed() {
  local throttle="$PROJECT_ROOT/.claude/telemetry/.last-console-plugin-nudge"
  if [ -f "$throttle" ]; then
    local now_e last_e
    now_e=$(date -u +%s)
    last_e=$(date -u -r "$throttle" +%s 2>/dev/null \
      || stat -c '%Y' "$throttle" 2>/dev/null || echo 0)
    [ $((now_e - last_e)) -lt $((CONSOLE_PLUGIN_NUDGE_INTERVAL_DAYS * 86400)) ] && return 0
  fi

  command -v jq >/dev/null 2>&1 || return 0
  command -v claude >/dev/null 2>&1 || return 0

  # Bump the throttle before the CLI call (same rationale as
  # update-nudge.sh:47-51) so a persistently-missing/timing-out `claude`
  # binary doesn't cost a 10s probe every cold start. Only when the dir
  # already exists — .claude/ itself is guaranteed present here (VERSION_FILE
  # lives inside it), never created from scratch.
  mkdir -p "$PROJECT_ROOT/.claude/telemetry" 2>/dev/null
  touch "$throttle" 2>/dev/null || true

  # `claude plugin list --json` is a fast, local, non-network read (S3,
  # CORE-DESIGN §11) — still timeout-bounded per the standing "every
  # external/network-capable call in the cold-start chain is bounded" rule.
  local list_json enabled
  list_json="$(timeout 10 claude plugin list --json 2>/dev/null)" || return 0
  [ -n "$list_json" ] || return 0

  enabled="$(printf '%s' "$list_json" | jq -r '.[]? | select(.id == "console@ccmaf") | .enabled' 2>/dev/null)"
  [ "$enabled" = "true" ] && return 0

  echo "console-check: project opted into the Console but the console plugin is not installed — claude plugin install console@ccmaf --scope user"
  return 0
}

# Already opted in (new .console-version pin, or the legacy boolean marker)
# → nothing to suggest; probe whether the plugin itself ever landed.
if [ -f "$VERSION_FILE" ] || [ -f "$ENABLED_MARKER" ]; then
  check_plugin_installed
  exit 0
fi

[ -f "$DECLINED_MARKER" ] && exit 0   # permanent project-level opt-out
[ -f "$SUGGEST_FLAG" ] && exit 0      # pending notification (DA-C4 discipline)

if [ -f "$SUGGEST_THROTTLE" ]; then
  now_e=$(date -u +%s)
  last_e=$(date -u -r "$SUGGEST_THROTTLE" +%s 2>/dev/null \
    || stat -c '%Y' "$SUGGEST_THROTTLE" 2>/dev/null || echo 0)
  [ $((now_e - last_e)) -lt $((CONSOLE_SUGGEST_INTERVAL_DAYS * 86400)) ] && exit 0
fi

# Soft capability gate: the Console runs via npx/global install — no Node,
# nothing actionable to suggest.
command -v node >/dev/null 2>&1 || exit 0

mkdir -p "$PROJECT_ROOT/.claude/telemetry" 2>/dev/null
touch "$SUGGEST_THROTTLE" 2>/dev/null || true

cat > "$SUGGEST_FLAG" <<EOF
# Console Available for This Project

This project uses CCMAF but hasn't opted into the **Project Console** — a
local dashboard (kanban board, verify queue, decisions, docs, live sessions)
plus a machine-wide tray Hub for all your CCMAF projects. It installs via npx
(no bundling), and is entirely opt-in.

## To set up

    echo latest > .claude/.console-version   # content = an npm version spec; presence = opt-in
    git add .claude/.console-version && git commit -m "chore: opt into Console"

Then install the console plugin if it isn't already, and the console starts
on the next session (its own SessionStart autostart hook):

    claude plugin install console@ccmaf --scope user

Or drive it directly now — the driver ships inside that plugin's own cache
dir (see its README for locating \`scripts/console.mjs\` under
\`~/.claude/plugins/\`).

## Not now

Delete this file: \`rm .claude/.console-suggestion.md\`
(Re-suggested after $CONSOLE_SUGGEST_INTERVAL_DAYS days.)

## Never for this project

\`touch .claude/.console-declined\` and COMMIT it (a project decision every
clone should see), then delete this file.
EOF

echo "console-check: this project hasn't opted into the Console. See $SUGGEST_FLAG."
exit 0
