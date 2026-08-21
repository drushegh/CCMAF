#!/usr/bin/env bash
# update-nudge.sh — NEW (v2, TASK-171 §7). Throttled reminder to check for
# newer versions of the installed ccmaf-marketplace plugins.
#
# v2 replaces v1's check-updates.sh (a git-based updater that compared this
# project's manifest-mirrored clone against a tracked upstream SHA and could
# pull automatically). Code updates are now PLUGIN updates (CORE-DESIGN §7):
# `claude plugin update <name>` per plugin, driven by the Claude Code CLI's
# own marketplace machinery — there is no project-local git state to diff
# anymore. Critically, there is also no known LOCAL way to read the
# marketplace's latest-available version (only what's installed) — so unlike
# check-updates.sh's real version-diff ("you are 3 commits behind"), this
# nudge is CADENCE-BASED ONLY ("you haven't checked in N days"). Running
# `claude plugin update <name>` is itself the only way to learn whether
# anything new shipped.
#
# Throttle: .claude/telemetry/.last-plugin-update-nudge, default 7 days
# (UPDATE_NUDGE_INTERVAL_DAYS to override) — same mtime-diff pattern as
# skills-check.sh / console-check.sh's suggestion throttles.
#
# NEVER creates .claude/ or .claude/telemetry/ itself (unlike skills-check.sh
# / console-check.sh, which mkdir -p their own suggestion throttle dir) — the
# throttle file is written only when .claude/telemetry/ already exists. A
# project with no telemetry dir simply gets re-nudged every cold start; that
# is an acceptable, explicit trade-off, not a bug.
#
# Exit codes: always 0 (advisory — never blocks cold start).
# Dependencies: jq, the `claude` CLI — both soft (silent skip if either is
# absent or the CLI call times out).

set -uo pipefail

# v2 (new script, no legacy root-resolution to fix): CLAUDE_PROJECT_DIR is
# the harness-provided project root; git/cwd are fallbacks for a manual,
# non-hook invocation.
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
TELEMETRY_DIR="$PROJECT_ROOT/.claude/telemetry"
THROTTLE="$TELEMETRY_DIR/.last-plugin-update-nudge"
UPDATE_NUDGE_INTERVAL_DAYS="${UPDATE_NUDGE_INTERVAL_DAYS:-7}"

if [ -f "$THROTTLE" ]; then
  now_e=$(date -u +%s)
  last_e=$(date -u -r "$THROTTLE" +%s 2>/dev/null || stat -c '%Y' "$THROTTLE" 2>/dev/null || echo 0)
  [ $((now_e - last_e)) -lt $((UPDATE_NUDGE_INTERVAL_DAYS * 86400)) ] && exit 0
fi

# Due for a check this interval — bump the throttle now (before the CLI call)
# so a persistently-missing/timing-out `claude` binary doesn't cost a 10s
# `timeout` probe every single cold start. Only when the dir already exists —
# never create .claude/ ourselves.
[ -d "$TELEMETRY_DIR" ] && touch "$THROTTLE" 2>/dev/null

command -v jq >/dev/null 2>&1 || exit 0
command -v claude >/dev/null 2>&1 || exit 0

# `claude plugin list --json` is a fast, local, non-network read (verified
# S3, CORE-DESIGN §11: ~1.8s, no network) — still timeout-bounded per the
# standing "every external/network-capable call in the cold-start chain is
# bounded" rule, so a hung or misbehaving CLI can never hang session start.
list_json="$(timeout 10 claude plugin list --json 2>/dev/null)" || exit 0
[ -n "$list_json" ] || exit 0

# `id` is "<name>@<marketplace>" (verified against a live `claude plugin
# list --json` run, matching the `claude plugin install <name>@ccmaf` form
# used throughout this project's own docs) — filter to this marketplace's
# plugins only, one TSV row per plugin.
lines="$(printf '%s' "$list_json" | jq -r '
  .[]? | select(.id | endswith("@ccmaf")) | "\(.id)\t\(.version // "unknown")"
' 2>/dev/null)"
[ -n "$lines" ] || exit 0

while IFS=$'\t' read -r id version; do
  [ -z "$id" ] && continue
  # [ASSUMED, unverified]: `claude plugin update <name>` accepts the same
  # "<name>@<marketplace>" identifier `list --json` returns as `id` and
  # `plugin install` documents elsewhere — not empirically confirmed here
  # (that would require actually running an update).
  # Wording matters: this is a CADENCE reminder, not a version diff — the
  # acceptance walk (2026-08-10) showed "update available check" being read
  # as "an update IS available". Say only what is known.
  echo "plugin update check due (cadence, not a version diff): $id v$version installed — find out with: claude plugin update $id"
done <<<"$lines"

exit 0
