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
# Runs as part of cold start (alongside check-updates.sh / skills-check.sh).
# Silent when the project has already opted in, has permanently declined, has
# a pending suggestion flag, is still within the throttle window, or lacks
# Node (the Console needs Node/npx to run — no point suggesting it then).
#
# Exit codes:
#   0  — opted in / declined / pending flag / throttled / suggestion written / no node
#
# Dependencies: git, date. No jq, no curl.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VERSION_FILE="$PROJECT_ROOT/.claude/.console-version"
ENABLED_MARKER="$PROJECT_ROOT/.claude/.console-enabled"
DECLINED_MARKER="$PROJECT_ROOT/.claude/.console-declined"
SUGGEST_FLAG="$PROJECT_ROOT/.claude/.console-suggestion.md"
SUGGEST_THROTTLE="$PROJECT_ROOT/.claude/telemetry/.last-console-suggest"
CONSOLE_SUGGEST_INTERVAL_DAYS="${CONSOLE_SUGGEST_INTERVAL_DAYS:-14}"

# Already opted in (new .console-version pin, or the legacy boolean marker)
# → nothing to suggest.
if [ -f "$VERSION_FILE" ] || [ -f "$ENABLED_MARKER" ]; then
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

Then the console starts on the next session (cold-start step 10.5), or run now:
\`node tools/console.mjs start\`.

## Not now

Delete this file: \`rm .claude/.console-suggestion.md\`
(Re-suggested after $CONSOLE_SUGGEST_INTERVAL_DAYS days.)

## Never for this project

\`touch .claude/.console-declined\` and COMMIT it (a project decision every
clone should see), then delete this file.
EOF

echo "console-check: this project hasn't opted into the Console. See $SUGGEST_FLAG."
exit 0
