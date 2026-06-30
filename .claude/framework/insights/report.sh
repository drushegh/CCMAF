#!/usr/bin/env bash
# report.sh — print a human-readable summary of current framework telemetry.
#
# On-demand equivalent of "what is the framework telling us about
# itself right now?" Safe to run any time — does not modify state.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
METRICS="$PROJECT_ROOT/.claude/telemetry/.hook-metrics"

if ! command -v jq >/dev/null 2>&1; then
  echo "report: jq required." >&2
  exit 1
fi

# Refresh the rollup before reporting.
bash "$SCRIPT_DIR/rollup.sh" >/dev/null

if [ ! -s "$METRICS" ]; then
  echo "No telemetry yet — run a few sessions to accumulate events."
  exit 0
fi

total=$(jq -r '.total_events' "$METRICS")
if [ "$total" = "0" ]; then
  echo "No telemetry yet — run a few sessions to accumulate events."
  exit 0
fi

echo "# Framework Telemetry Report"
echo
echo "**Events collected:** $total"
echo "**Window:** $(jq -r '.first_ts' "$METRICS") → $(jq -r '.last_ts' "$METRICS")"
echo

echo "## Hook activity"
echo
printf "| %-16s | %-7s | %s\n" "Hook" "Total" "Outcomes"
printf "| %-16s | %-7s | %s\n" "----" "-----" "--------"
jq -r '
  .by_hook
  | to_entries
  | sort_by(.value.total) | reverse
  | .[]
  | [
      .key,
      (.value.total | tostring),
      (.value.outcomes | to_entries | map("\(.key)=\(.value)") | join(", "))
    ]
  | @tsv
' "$METRICS" | while IFS=$'\t' read -r hook t outcomes; do
  printf "| %-16s | %-7s | %s\n" "$hook" "$t" "$outcomes"
done
echo

echo "## Drift triggers (top causes)"
echo
drift_count=$(jq -r '.drift_triggers | length' "$METRICS")
if [ "$drift_count" = "0" ]; then
  echo "_(none)_"
else
  jq -r '
    .drift_triggers
    | to_entries
    | sort_by(.value) | reverse
    | .[]
    | "- \(.key): \(.value)"
  ' "$METRICS"
fi
echo

flag="$PROJECT_ROOT/.claude/.framework-insight-alert.md"
if [ -f "$flag" ]; then
  echo "## ⚠ Active findings"
  echo
  echo "There is an active alert at \`$flag\`. Run it:"
  echo
  echo '```'
  echo "cat $flag"
  echo '```'
fi
