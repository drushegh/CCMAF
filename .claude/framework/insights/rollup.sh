#!/usr/bin/env bash
# rollup.sh — aggregate events.jsonl into summary counters.
#
# Reads:  .claude/telemetry/events.jsonl (append-only event log)
# Writes: .claude/telemetry/.hook-metrics (JSON counters)
#
# Designed to be cheap and idempotent. Running repeatedly is safe — the
# counters file is rewritten each time from the full event log.
#
# Event record shape: contract:telemetry-schema (ECOSYSTEM). Schema v2
# adds session_id / event_id / outcome_class / optional tool_use_id;
# v1 lines (no schema field) remain valid forever — outcome_class is
# derived for them via the legacy mapping in classof below (the ONE
# place that mapping lives).
#
# Supported hooks / outcomes (vocabularies unchanged from v1):
#   drift-guard:   drift-detected | clean        (per UserPromptSubmit)
#   stop:          passed | blocked               (per session end)
#   bash-guard:    allowed | blocked              (per bash invocation)
#   format:        formatted | skipped            (per Write/Edit)
#   lint:          ran | skipped                  (per Write/Edit)
#   test-filter:   filtered | passthrough         (per test-command match)
#   verify-deps:   clean | findings               (per manifest edit)
#   review-scraper: scraped                       (per session end with new findings)
#   cost-tracker:  session-end                    (per session end)
#
# Dependency: jq.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TELEMETRY_DIR="$PROJECT_ROOT/.claude/telemetry"
EVENTS="$TELEMETRY_DIR/events.jsonl"
METRICS="$TELEMETRY_DIR/.hook-metrics"

if ! command -v jq >/dev/null 2>&1; then
  echo "rollup: jq required but not found. Install: https://jqlang.github.io/jq/download/" >&2
  exit 1
fi

mkdir -p "$TELEMETRY_DIR"

if [ ! -s "$EVENTS" ]; then
  # No events yet — write an empty metrics file so downstream reads
  # don't error.
  echo '{"total_events":0,"by_hook":{},"drift_triggers":{},"sessions":0,"by_session":{},"schema_mix":{"v1":0,"v2":0}}' > "$METRICS"
  exit 0
fi

# Single jq pass that produces the rollup. Line-tolerant input (-R slurp
# + fromjson?): a malformed line — partial write, control character —
# is DROPPED, not fatal. The old `jq -s` aborted the whole rollup on one
# bad line (its select(type=="object") only defended against valid-JSON
# non-objects); same lesson session-summary.sh learned in TASK-034.
#
# classof: canonical outcome_class (contract:telemetry-schema). v2 events
# carry it; v1 events get it derived from the legacy per-hook outcome
# vocabularies. This def is the single home of that legacy mapping.
jq -Rsr '
  def classof:
    .outcome_class // (
      if .outcome == "blocked" then "blocked"
      elif (.outcome == "drift-detected" or .outcome == "findings"
            or .outcome == "scraped") then "flagged"
      elif (.outcome == "skipped" or .outcome == "passthrough") then "skipped"
      else "ok" end
    );
  [ split("\n")[] | fromjson? // empty | select(type == "object") ] as $events
  | {
      generated_at: now | strftime("%Y-%m-%dT%H:%M:%SZ"),
      total_events: ($events | length),
      first_ts: ($events | map(.ts // empty) | min),
      last_ts:  ($events | map(.ts // empty) | max),
      schema_mix: {
        v1: ($events | map(select(.schema == null)) | length),
        v2: ($events | map(select(.schema == 2)) | length)
      },
      by_hook: (
        $events
        | group_by(.hook)
        | map({
            key: (.[0].hook // "unknown"),
            value: {
              total: length,
              outcomes: (
                group_by(.outcome)
                | map({key: (.[0].outcome // "unknown"), value: length})
                | from_entries
              )
            }
          })
        | from_entries
      ),
      drift_triggers: (
        $events
        | map(select(.hook == "drift-guard" and .outcome == "drift-detected"))
        | group_by(.trigger)
        | map({key: (.[0].trigger // "unknown"), value: length})
        | from_entries
      ),
      # --- Session structure (schema v2, TASK-021) ---------------------
      # Only v2 events carry session_id; v1 history simply does not
      # contribute here (no migration — append-only log).
      sessions: (
        $events | map(.session_id // "" | select(. != "")) | unique | length
      ),
      by_session: (
        $events
        | map(select((.session_id // "") != ""))
        | group_by(.session_id)
        | map({
            key: .[0].session_id,
            value: {
              total: length,
              first_ts: (map(.ts // empty) | min),
              last_ts:  (map(.ts // empty) | max),
              blocked: (map(select(classof == "blocked")) | length),
              flagged: (map(select(classof == "flagged")) | length),
              stop_blocked: (map(select(.hook == "stop" and .outcome == "blocked")) | length),
              drift_fires: (map(select(.hook == "drift-guard" and .outcome == "drift-detected")) | length)
            }
          })
        | from_entries
      )
    }
' "$EVENTS" > "$METRICS"

# Compact summary to stdout when run manually.
echo "rollup: $(jq -r '.total_events' "$METRICS") events aggregated → $METRICS"
