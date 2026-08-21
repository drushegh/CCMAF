#!/usr/bin/env bash
# update-metrics.sh — append a timestamped snapshot of current telemetry
# to framework-metrics.md, under the "Auto-Generated Snapshots" heading.
#
# Reads:  .claude/telemetry/.hook-metrics (produced by rollup.sh)
# Writes: framework-metrics.md (prepends one new snapshot)
#
# The hand-curated tables at the top of framework-metrics.md stay
# unchanged — they're the framework author's interpretation. This
# script only appends raw snapshots below them so you get history.
#
# Safe to rerun: each run adds a fresh snapshot at the top of the
# auto-generated section. Newest first.
#
# Dependencies: jq, awk.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# v2 adaptation: see rollup.sh — CLAUDE_PROJECT_DIR replaces the old
# SCRIPT_DIR/../../.. climb, which no longer lands on the project under the
# plugin layout.
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
METRICS="$PROJECT_ROOT/.claude/telemetry/.hook-metrics"

# Snapshots append to .claude/framework-metrics.md (root). framework-self
# redirect retired in TASK-054.
TARGET="$PROJECT_ROOT/.claude/framework-metrics.md"

if ! command -v jq >/dev/null 2>&1; then
  echo "update-metrics: jq required." >&2
  exit 1
fi

# Refresh the rollup so we're always snapshotting current data.
bash "$SCRIPT_DIR/rollup.sh" >/dev/null

if [ ! -s "$METRICS" ]; then
  echo "update-metrics: no telemetry yet — nothing to snapshot."
  exit 0
fi

total=$(jq -r '.total_events // 0' "$METRICS")
if [ "$total" = "0" ]; then
  echo "update-metrics: no events yet — nothing to snapshot."
  exit 0
fi

if [ ! -f "$TARGET" ]; then
  echo "update-metrics: $TARGET missing — creating minimal stub." >&2
  cat > "$TARGET" <<'EOF'
# Framework Metrics

## Auto-Generated Snapshots

_(no snapshots yet)_
EOF
fi

# --- Compose the new snapshot block ----------------------------------
now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
first_ts=$(jq -r '.first_ts // "unknown"' "$METRICS")
last_ts=$(jq -r '.last_ts // "unknown"'  "$METRICS")

# Per-hook formatter. Emits one table row per hook that has events.
format_hook_row() {
  local hook="$1"
  local total_outcomes
  total_outcomes=$(jq -r --arg h "$hook" '.by_hook[$h].total // 0' "$METRICS")
  [ "$total_outcomes" = "0" ] && return

  local outcomes
  outcomes=$(jq -r --arg h "$hook" '.by_hook[$h].outcomes | to_entries | map("\(.key)=\(.value)") | join(", ")' "$METRICS")
  printf "| \`%s\` | %s | %s |\n" "$hook" "$total_outcomes" "$outcomes"
}

# Drift trigger breakdown (if any).
drift_breakdown=$(
  jq -r '
    if (.drift_triggers | length) > 0 then
      .drift_triggers
      | to_entries
      | sort_by(.value) | reverse
      | map("\(.key)=\(.value)")
      | join(", ")
    else
      "(no drift-detected events yet)"
    end
  ' "$METRICS"
)

# Rate calculations.
drift_total=$(jq -r '.by_hook["drift-guard"].total // 0' "$METRICS")
drift_fires=$(jq -r '.by_hook["drift-guard"].outcomes["drift-detected"] // 0' "$METRICS")
drift_rate="n/a"
if [ "$drift_total" -gt 0 ]; then
  drift_rate=$(awk -v n="$drift_fires" -v d="$drift_total" 'BEGIN{printf "%.1f%%", (n/d)*100}')
fi

stop_total=$(jq -r '.by_hook["stop"].total // 0' "$METRICS")
stop_blocks=$(jq -r '.by_hook["stop"].outcomes["blocked"] // 0' "$METRICS")
stop_rate="n/a"
if [ "$stop_total" -gt 0 ]; then
  stop_rate=$(awk -v n="$stop_blocks" -v d="$stop_total" 'BEGIN{printf "%.1f%%", (n/d)*100}')
fi

bash_total=$(jq -r '.by_hook["bash-guard"].total // 0' "$METRICS")
bash_blocks=$(jq -r '.by_hook["bash-guard"].outcomes["blocked"] // 0' "$METRICS")
bash_rate="n/a"
if [ "$bash_total" -gt 0 ]; then
  bash_rate=$(awk -v n="$bash_blocks" -v d="$bash_total" 'BEGIN{printf "%.2f%%", (n/d)*100}')
fi

# Build the snapshot Markdown block (newest at top by design).
snapshot_tmp=$(mktemp)
{
  echo ""
  echo "### $now_iso"
  echo
  echo "**Window:** $first_ts → $last_ts | **Total events:** $total"
  echo
  echo "| Hook | Total | Outcomes |"
  echo "| --- | --- | --- |"
  # Stable hook order so diffs stay readable.
  for h in drift-guard stop bash-guard format lint test-filter review-scraper; do
    format_hook_row "$h"
  done
  echo
  echo "**Key rates:**"
  echo
  echo "- Drift guard fire rate: $drift_rate ($drift_fires / $drift_total)"
  echo "- Stop-hook block rate: $stop_rate ($stop_blocks / $stop_total)"
  echo "- Dangerous-command block rate: $bash_rate ($bash_blocks / $bash_total)"
  echo
  echo "**Drift triggers:** $drift_breakdown"
  echo
} > "$snapshot_tmp"

# --- Insert into framework-metrics.md --------------------------------
# Rule: replace the "_(no snapshots yet ...)_" placeholder with the
# snapshot on first run. On subsequent runs, prepend a new snapshot
# immediately after the "## Auto-Generated Snapshots" heading and its
# HTML comments.

target_tmp=$(mktemp "${TARGET}.XXXXXX")
awk -v block_file="$snapshot_tmp" '
  BEGIN { inserted = 0 }

  # Remove the placeholder line entirely (once).
  /^_\(no snapshots yet/ {
    if (!inserted) {
      while ((getline line < block_file) > 0) print line
      close(block_file)
      inserted = 1
    }
    next
  }

  # Detect the first line AFTER the heading+comments block in the
  # Auto-Generated Snapshots section. Anchor: an empty line that
  # follows the last "<!-- ... -->" comment of that section.
  /^### [0-9]{4}-/ {
    if (!inserted) {
      while ((getline line < block_file) > 0) print line
      close(block_file)
      inserted = 1
    }
  }

  { print }

  END {
    # If we never found a previous snapshot or placeholder, append the
    # snapshot at end of file so we never silently drop it.
    if (!inserted) {
      while ((getline line < block_file) > 0) print line
    }
  }
' "$TARGET" > "$target_tmp"

mv "$target_tmp" "$TARGET"
rm -f "$snapshot_tmp"

echo "update-metrics: snapshot appended ($total events, $(date -u +%Y-%m-%dT%H:%M:%SZ))"
