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
# Per-project overrides: .claude/insights-thresholds.conf (same KEY=VALUE
# format, any subset of keys) is read FIRST, key by key; the shipped
# thresholds.conf next to this script supplies everything it omits.
#
# Exit codes:
#   0 — up to date (no findings, OR skipped due to throttle, OR insufficient data)
#   0 — findings written to flag file (cold start continues)
#   1 — fatal (missing jq, malformed metrics)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# v2 adaptation: the old fallback (SCRIPT_DIR/../../..) assumed a fixed depth
# under a consumer's .claude/framework/ tree — under the plugin layout that no
# longer lands on the project. CLAUDE_PROJECT_DIR (harness-provided) is now
# the primary source of truth; git/cwd remain fallbacks for a manual,
# non-hook invocation.
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
TELEMETRY_DIR="$PROJECT_ROOT/.claude/telemetry"
METRICS="$TELEMETRY_DIR/.hook-metrics"
LAST_CHECK="$TELEMETRY_DIR/.last-analysed"
FLAG="$PROJECT_ROOT/.claude/.framework-insight-alert.md"
THRESHOLDS="$SCRIPT_DIR/thresholds.conf"
# Project-owned override file: never overwritten by a framework update
# (the shipped thresholds.conf is framework-owned and gets replaced).
THRESHOLDS_LOCAL="$PROJECT_ROOT/.claude/insights-thresholds.conf"

# NB: the stale flag is removed only once the throttle has passed (below).
# Removing it up here erased alerts no cold start had surfaced yet.

if ! command -v jq >/dev/null 2>&1; then
  echo "analyse: jq required." >&2
  exit 1
fi

if [ ! -f "$THRESHOLDS" ]; then
  echo "analyse: thresholds.conf missing — expected at $THRESHOLDS" >&2
  exit 1
fi

# Parsed without sourcing (DA-M12: never execute a config file as shell).
# thresholds.conf is a tracked, adopter-editable file (its own header
# invites per-project overrides) — sourcing it turns an innocuous-looking
# numeric tuning file into a code-execution sink on every analyse.sh run
# (healthcheck weekly / --force). Pull only the known KEY=VALUE keys this
# script uses, and fall back to the documented default when a key is
# missing or its value doesn't parse as a non-negative int/float.
# Keys used in bash integer arithmetic ($((...)), -lt/-ge) are read with
# _thr_int, which also rejects fractions (a "7.5" there crashed the run).
# Each file is tried in turn (override first); an invalid value in one
# falls through to the next, then to the documented default.
_thr_get() {  # $1 = key, $2 = file
  sed -n "s/^[[:space:]]*$1=\\([^#[:space:]]*\\).*/\\1/p" "$2" 2>/dev/null | tail -1
}
_thr_read() {  # $1 = key, $2 = default, $3 = int|num
  local f v
  for f in "$THRESHOLDS_LOCAL" "$THRESHOLDS"; do
    [ -f "$f" ] || continue
    v="$(_thr_get "$1" "$f")"; v="${v%$'\r'}"
    case "$v" in
      ''|.|*[!0-9.]*) continue ;;   # empty/missing or non-numeric char
      *.*.*)          continue ;;   # more than one '.' - not a number
    esac
    if [ "$3" = int ]; then
      case "$v" in *.*) continue ;; esac
      printf '%s' "$((10#$v))"      # 10#: "08" is decimal, not bad octal
    else
      printf '%s' "$v"
    fi
    return 0
  done
  printf '%s' "$2"
}
_thr_num() { _thr_read "$1" "$2" num; }
_thr_int() { _thr_read "$1" "$2" int; }
INSIGHTS_CHECK_INTERVAL_DAYS=$(_thr_int INSIGHTS_CHECK_INTERVAL_DAYS 7)
INSIGHTS_MIN_EVENTS=$(_thr_int INSIGHTS_MIN_EVENTS 50)
DRIFT_GUARD_FIRE_RATE_HIGH=$(_thr_num DRIFT_GUARD_FIRE_RATE_HIGH 0.30)
DRIFT_GUARD_FIRE_RATE_LOW=$(_thr_num DRIFT_GUARD_FIRE_RATE_LOW 0.02)
STOP_HOOK_BLOCK_RATE_HIGH=$(_thr_num STOP_HOOK_BLOCK_RATE_HIGH 0.20)
DANGEROUS_CMD_BLOCK_RATE_HIGH=$(_thr_num DANGEROUS_CMD_BLOCK_RATE_HIGH 0.05)
FORMAT_LINT_FIRE_RATE_LOW=$(_thr_num FORMAT_LINT_FIRE_RATE_LOW 0.01)
INSIGHTS_MIN_SESSIONS=$(_thr_int INSIGHTS_MIN_SESSIONS 5)
STOP_BLOCK_SESSION_RATE_HIGH=$(_thr_num STOP_BLOCK_SESSION_RATE_HIGH 0.50)

# Freshen the rollup so we're always analysing current data.
bash "$SCRIPT_DIR/rollup.sh" >/dev/null

# Throttle: skip if last analysed within interval. Bypass with --force.
force=0
[ "${1:-}" = "--force" ] && force=1

if [ $force -eq 0 ] && [ -f "$LAST_CHECK" ]; then
  last_ts_raw="$(tr -d '\r\n' < "$LAST_CHECK")"
  # GNU date -d first; BSD/macOS date -j -f fallback (no -d there).
  last_epoch=$(date -u -d "$last_ts_raw" +%s 2>/dev/null \
    || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$last_ts_raw" +%s 2>/dev/null \
    || echo 0)
  now_epoch=$(date -u +%s)
  interval_seconds=$((INSIGHTS_CHECK_INTERVAL_DAYS * 86400))
  if [ $((now_epoch - last_epoch)) -lt "$interval_seconds" ]; then
    exit 0
  fi
fi

# Throttle passed: this run recomputes from scratch, so drop the stale flag.
rm -f "$FLAG"

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
# v2: format/lint hooks ship only in the OPTIONAL devhooks plugin, so a zero
# count is expected wherever devhooks isn't enabled. Only check wiring when
# devhooks is enabled in a settings file, or when either hook has fired at
# least once (proof it is installed).
devhooks_enabled() {
  local f
  for f in "$PROJECT_ROOT/.claude/settings.local.json" \
           "$PROJECT_ROOT/.claude/settings.json" \
           "${HOME:-/nonexistent}/.claude/settings.json"; do
    [ -f "$f" ] || continue
    jq -e '[(.enabledPlugins // {}) | to_entries[]
            | select((.key | startswith("devhooks@")) and .value == true)]
           | length > 0' "$f" >/dev/null 2>&1 && return 0
  done
  return 1
}
fmt_lint_seen=$(( $(hook_total format) + $(hook_total lint) ))
if [ "$total_events" -ge "$INSIGHTS_MIN_EVENTS" ] \
   && { [ "$fmt_lint_seen" -gt 0 ] || devhooks_enabled; }; then
  for h in format lint; do
    h_total=$(hook_total "$h")
    h_rate=$(rate "$h_total" "$total_events")
    if lte "$h_rate" "$FORMAT_LINT_FIRE_RATE_LOW"; then
      findings+=("**Hook \`$h\` almost never fires** ($h_total events out of $total_events total). **Consider:** verify the devhooks plugin is enabled and loading, its matcher covers your edits, and the target toolchain is installed.")
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
  # v2 adaptation: ${CLAUDE_PLUGIN_ROOT} is literal text to anything reading
  # this flag file later — the var exists only inside a hook/command
  # invocation, not in the model's Bash tool or a human's terminal. Bake in
  # the real resolved path at write time instead (mirrors core-context.sh's
  # digest substitution): prefer the env var's value, fall back to the
  # sibling paths we already know (SCRIPT_DIR/THRESHOLDS, guaranteed
  # resolvable — this very script used them to find its own thresholds.conf
  # above), and only fall back to a resolve-it-yourself hint if somehow
  # neither is available.
  # Threshold tuning is per-project: the shipped thresholds.conf lives in the
  # plugin cache (replaced on every plugin update), so the hint names the
  # project-owned override file, with the shipped one as the key/default
  # reference.
  report_hint="bash \"$SCRIPT_DIR/report.sh\""
  thresholds_ref="$THRESHOLDS"
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    report_hint="bash \"$CLAUDE_PLUGIN_ROOT/insights/report.sh\""
    thresholds_ref="$CLAUDE_PLUGIN_ROOT/insights/thresholds.conf"
  elif [ ! -f "$SCRIPT_DIR/report.sh" ]; then
    report_hint="the ccmaf plugin's insights/report.sh (resolve via claude plugin list --json installPath)"
    thresholds_ref="the ccmaf plugin's insights/thresholds.conf (resolve via claude plugin list --json installPath)"
  fi
  echo "1. Read the full rollup: \`$report_hint\`"
  echo "2. If a finding deserves follow-up, append it to FRAMEWORK-SUGGESTIONS.md."
  echo "3. To dismiss for now: \`rm .claude/.framework-insight-alert.md\`. Analysis"
  echo "   reruns after $INSIGHTS_CHECK_INTERVAL_DAYS days (or on \`analyse.sh --force\`)."
  echo
  echo "Tune thresholds in \`.claude/insights-thresholds.conf\` (KEY=VALUE, any"
  echo "subset of keys; defaults and key list: \`$thresholds_ref\`) if any of"
  echo "these are false positives for your workflow."
} > "$FLAG"

echo "analyse: ${#findings[@]} finding(s) — see $FLAG"
