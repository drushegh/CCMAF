#!/usr/bin/env bash
# analyse.sh — evaluate rollup counters against thresholds; raise alerts.
#
# Pipeline:
#   events.jsonl → rollup.sh → .hook-metrics → analyse.sh → alert flag
#
# Exits silently (code 0) when no findings exceed thresholds. When
# findings exist, writes .claude/.framework-insight-alert.md
# and prints a one-line summary. Cold start reads the flag file and
# surfaces findings to the user via AskUserQuestion.
#
# Throttled by INSIGHTS_CHECK_INTERVAL_DAYS in thresholds.conf.
#
# Exit codes:
#   0 — up to date (no findings, OR skipped due to throttle, OR insufficient data)
#   0 — findings written to flag file (cold start continues)
#   1 — fatal (missing jq, malformed metrics)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TELEMETRY_DIR="$PROJECT_ROOT/.claude/telemetry"
METRICS="$TELEMETRY_DIR/.hook-metrics"
LAST_CHECK="$TELEMETRY_DIR/.last-analysed"
FLAG="$PROJECT_ROOT/.claude/.framework-insight-alert.md"
THRESHOLDS="$SCRIPT_DIR/thresholds.conf"

# Always remove stale flag — we recompute from scratch each run.
rm -f "$FLAG"

if ! command -v jq >/dev/null 2>&1; then
  echo "analyse: jq required." >&2
  exit 1
fi

if [ ! -f "$THRESHOLDS" ]; then
  echo "analyse: thresholds.conf missing — expected at $THRESHOLDS" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$THRESHOLDS"

# Freshen the rollup so we're always analysing current data.
bash "$SCRIPT_DIR/rollup.sh" >/dev/null

# Throttle: skip if last analysed within interval. Bypass with --force.
force=0
[ "${1:-}" = "--force" ] && force=1

if [ $force -eq 0 ] && [ -f "$LAST_CHECK" ]; then
  last_epoch=$(date -u -d "$(cat "$LAST_CHECK")" +%s 2>/dev/null || echo 0)
  now_epoch=$(date -u +%s)
  interval_seconds=$((INSIGHTS_CHECK_INTERVAL_DAYS * 86400))
  if [ $((now_epoch - last_epoch)) -lt "$interval_seconds" ]; then
    exit 0
  fi
fi

# Record this run's timestamp regardless of outcome below.
date -u +%Y-%m-%dT%H:%M:%SZ > "$LAST_CHECK"

if [ ! -f "$METRICS" ]; then
  exit 0
fi

total_events=$(jq -r '.total_events // 0' "$METRICS")
if [ "$total_events" -lt "$INSIGHTS_MIN_EVENTS" ]; then
  # Not enough data yet to draw conclusions.
  exit 0
fi

# --- Finding collection ----------------------------------------------
# Each finding is one line of markdown inserted into the flag file.
findings=()

# Helper: float comparison via awk (bash can't compare floats).
gte() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a >= b)}'; }
lte() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a <= b)}'; }

# Helper: read hook total and specific outcome count from metrics.
hook_total() {
  jq -r --arg h "$1" '.by_hook[$h].total // 0' "$METRICS"
}
hook_outcome() {
  jq -r --arg h "$1" --arg o "$2" '.by_hook[$h].outcomes[$o] // 0' "$METRICS"
}
rate() {
  # $1 = numerator, $2 = denominator. Prints "0" if denom is 0.
  awk -v n="$1" -v d="$2" 'BEGIN{if (d == 0) print "0"; else printf "%.4f", n/d}'
}

# --- Drift Guard analysis ---
drift_total=$(hook_total "drift-guard")
drift_fires=$(hook_outcome "drift-guard" "drift-detected")
if [ "$drift_total" -gt 0 ]; then
  drift_rate=$(rate "$drift_fires" "$drift_total")
  if gte "$drift_rate" "$DRIFT_GUARD_FIRE_RATE_HIGH"; then
    top_trigger=$(jq -r '.drift_triggers | to_entries | max_by(.value) | .key // "unknown"' "$METRICS")
    findings+=("**Drift guard fire rate is high** ($(awk -v r="$drift_rate" 'BEGIN{printf "%.0f%%", r*100}') of prompts trigger a drift reminder; threshold is $(awk -v t="$DRIFT_GUARD_FIRE_RATE_HIGH" 'BEGIN{printf "%.0f%%", t*100}')). Top trigger: \`$top_trigger\`. **Consider:** promote this rule to a dedicated hook, a skill, or tighter CLAUDE.md wording so the guard has less to nag about.")
  fi
  if lte "$drift_rate" "$DRIFT_GUARD_FIRE_RATE_LOW"; then
    findings+=("**Drift guard has gone quiet** ($(awk -v r="$drift_rate" 'BEGIN{printf "%.1f%%", r*100}') fire rate over $drift_total prompts). Either the agents are perfectly trained or the guard is misconfigured. **Consider:** smoke-test the guard with a deliberate drift scenario, and retire it if it genuinely isn't pulling its weight.")
  fi
fi

# --- Stop hook (enforce-state-update) analysis ---
stop_total=$(hook_total "stop")
stop_blocks=$(hook_outcome "stop" "blocked")
if [ "$stop_total" -gt 0 ]; then
  stop_rate=$(rate "$stop_blocks" "$stop_total")
  if gte "$stop_rate" "$STOP_HOOK_BLOCK_RATE_HIGH"; then
    findings+=("**Stop hook block rate is high** ($(awk -v r="$stop_rate" 'BEGIN{printf "%.0f%%", r*100}') of session ends blocked for missing state-file updates). **Consider:** agents are not internalising the state-file rules. Either the rule needs to move earlier in the cold-start sequence, or a mid-session reminder hook should fire.")
  fi
fi

# --- Bash-guard analysis ---
bash_total=$(hook_total "bash-guard")
bash_blocks=$(hook_outcome "bash-guard" "blocked")
if [ "$bash_total" -gt 0 ]; then
  bash_rate=$(rate "$bash_blocks" "$bash_total")
  if gte "$bash_rate" "$DANGEROUS_CMD_BLOCK_RATE_HIGH"; then
    findings+=("**Dangerous-command block rate is elevated** ($(awk -v r="$bash_rate" 'BEGIN{printf "%.1f%%", r*100}') of bash invocations blocked). **Consider:** repeated attempts suggest agents are reaching for destructive patterns — add safer alternatives to CLAUDE.md or bake a safer helper into the framework.")
  fi
fi

# --- Format / Lint wiring check ---
if [ "$total_events" -ge "$INSIGHTS_MIN_EVENTS" ]; then
  for h in format lint; do
    h_total=$(hook_total "$h")
    h_rate=$(rate "$h_total" "$total_events")
    if lte "$h_rate" "$FORMAT_LINT_FIRE_RATE_LOW"; then
      findings+=("**Hook \`$h\` almost never fires** ($h_total events out of $total_events total). **Consider:** verify the hook is wired in .claude/settings.json, its matcher is correct, and the target toolchain is installed.")
    fi
  done
fi

# --- Session structure (schema v2, TASK-021) ---
# Concentration, not volume: the event-level stop rate above is diluted
# by long sessions; this asks "what fraction of SESSIONS hit the
# state-file wall at all". Only v2 events carry session_id, so this
# stays silent until enough v2 sessions accumulate.
sessions_total=$(jq -r '.sessions // 0' "$METRICS")
if [ "$sessions_total" -ge "${INSIGHTS_MIN_SESSIONS:-5}" ]; then
  sessions_stop_blocked=$(jq -r '[.by_session[]? | select(.stop_blocked > 0)] | length' "$METRICS")
  sb_session_rate=$(rate "$sessions_stop_blocked" "$sessions_total")
  if gte "$sb_session_rate" "${STOP_BLOCK_SESSION_RATE_HIGH:-0.50}"; then
    findings+=("**Stop-hook blocks concentrate across sessions** ($sessions_stop_blocked of $sessions_total sessions ended blocked at least once; threshold is $(awk -v t="${STOP_BLOCK_SESSION_RATE_HIGH:-0.50}" 'BEGIN{printf "%.0f%%", t*100}')). The state-file rules are not being internalised session-over-session — this is a habit gap, not a one-off. **Consider:** move the state-file reminder earlier in the cold-start sequence or add a mid-session nudge.")
  fi
fi

# --- Write flag file if any findings ---
if [ ${#findings[@]} -eq 0 ]; then
  exit 0
fi

generated=$(jq -r '.generated_at // "unknown"' "$METRICS")
first_ts=$(jq -r '.first_ts // "unknown"' "$METRICS")
last_ts=$(jq -r '.last_ts // "unknown"' "$METRICS")

{
  echo "# Framework Insights — Concerns Raised"
  echo
  echo "**Analysis generated:** $generated"
  if [ "${sessions_total:-0}" -gt 0 ]; then
    echo "**Events analysed:** $total_events across $sessions_total session(s) (from $first_ts to $last_ts)"
  else
    echo "**Events analysed:** $total_events (from $first_ts to $last_ts)"
  fi
  echo
  echo "## Findings"
  echo
  for f in "${findings[@]}"; do
    echo "- $f"
    echo
  done
  echo "## What to do"
  echo
  echo "1. Read the full rollup: \`bash .claude/framework/insights/report.sh\`"
  echo "2. If a finding deserves follow-up, append it to FRAMEWORK-SUGGESTIONS.md."
  echo "3. To dismiss for now: \`rm .claude/.framework-insight-alert.md\`. Analysis"
  echo "   reruns after $INSIGHTS_CHECK_INTERVAL_DAYS days (or on \`analyse.sh --force\`)."
  echo
  echo "Tune thresholds in \`.claude/framework/insights/thresholds.conf\` if any of"
  echo "these are false positives for your workflow."
} > "$FLAG"

echo "analyse: ${#findings[@]} finding(s) — see $FLAG"
