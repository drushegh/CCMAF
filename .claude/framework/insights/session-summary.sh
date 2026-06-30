#!/usr/bin/env bash
# session-summary.sh — read-only telemetry read-back for the current
# session window (TASK-034). Prints ONE "Session efficacy" line for the
# /wrapup final verdict: did the framework's enforcement actually fire
# this session, or just cost cycles?
#
# Session window (TASK-021 schema v2): when the stream's last event
# carries a session_id, the window is ALL events with that session_id —
# exact boundaries, immune to the mid-session-Stop split that broke the
# old heuristic. Streams with no v2 events fall back to the original
# approximation: everything after the last cost-tracker marker (one
# marker per Stop fire; fresh installs with no marker = whole file).
#
# Tool-call figure: cost-tracker counts tool_uses at session END, so the
# in-flight session has no marker yet. The figure shown is the PREVIOUS
# session's (most recent cost-tracker from a DIFFERENT session_id on the
# v2 path; the bounding marker on the fallback path) — labelled as such.
#
# Fail-soft (AC2): every missing dependency or absent/unparseable file
# prints "Session efficacy: telemetry unavailable (<why>)" and exits 0.
# This line must never block a wrapup.
#
# Composition note (AC4): ALL jq lives in mine_window_counts(). When
# TASK-021 lands the span schema, migrating this script = rewriting that
# one function; the formatting below consumes a flat TSV contract.
#
# Usage: bash .claude/framework/insights/session-summary.sh
# Exit code: always 0.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
EVENTS="$REPO_ROOT/.claude/telemetry/events.jsonl"

unavailable() { echo "Session efficacy: telemetry unavailable ($1)"; exit 0; }

command -v jq >/dev/null 2>&1 || unavailable "jq missing"
[ -f "$EVENTS" ] || unavailable "no events.jsonl"
[ -s "$EVENTS" ] || unavailable "events.jsonl empty"

# --- The one jq function (TASK-021 migration point) -------------------
# Reads the whole event stream, line-tolerant (malformed lines dropped via
# fromjson?), finds the last cost-tracker marker, and reduces the window
# after it to one TSV row:
#   total  guard_allowed  guard_blocked  drift_fires  drift_triggers
#   stop_blocked  format_ran  format_skipped  lint_ran  lint_skipped
#   deps_events  prev_tool_uses
mine_window_counts() {
  jq -R -s -r '
    [ split("\n")[] | fromjson? // empty ] as $all
    | ($all | map(.hook == "cost-tracker") | rindex(true)) as $mi
    | (if ($all | length) > 0 then ($all[-1].session_id // "") else "" end) as $cur
    | (if $cur != ""
       then [ $all[] | select((.session_id // "") == $cur) ]
       else (if $mi == null then $all else $all[($mi + 1):] end)
       end) as $w
    | (if $cur != ""
       then ([ $all[] | select(.hook == "cost-tracker" and (.session_id // "") != $cur) ]
             | if length == 0 then "-" else (.[-1].tool_uses // "-" | tostring) end)
       else (if $mi == null then "-" else ($all[$mi].tool_uses // "-" | tostring) end)
       end) as $prev
    | [ $w[] | select(.hook == "drift-guard" and .outcome == "drift-detected") ] as $drift
    | def cnt($h): [ $w[] | select(.hook == $h) ] | length;
      def cnt2($h; $o): [ $w[] | select(.hook == $h and .outcome == $o) ] | length;
      [
        ($w | length),
        cnt2("bash-guard"; "allowed"),
        cnt2("bash-guard"; "blocked"),
        ($drift | length),
        (if ($drift | length) == 0 then "-"
         else ([ $drift[] | .trigger // "unknown" ] | group_by(.)
               | map("\(.[0]) x\(length)") | join(", "))
         end),
        cnt2("stop"; "blocked"),
        (cnt("format") - cnt2("format"; "skipped")),
        cnt2("format"; "skipped"),
        (cnt("lint") - cnt2("lint"; "skipped")),
        cnt2("lint"; "skipped"),
        cnt("verify-deps"),
        $prev
      ] | @tsv
  ' "$EVENTS" 2>/dev/null
}

row="$(mine_window_counts || true)"
[ -n "$row" ] || unavailable "events.jsonl unparseable"

IFS=$'\t' read -r total g_allow g_block d_fires d_trig s_block \
  f_ran f_skip l_ran l_skip deps prev_tools <<<"$row"

drift_part="drift-guard ${d_fires} fire(s)"
[ "$d_trig" != "-" ] && drift_part="drift-guard ${d_fires} fire(s) (${d_trig})"

prev_part="prev session ${prev_tools} tool calls"
[ "$prev_tools" = "-" ] && prev_part="prev session cost n/a (no marker)"

echo "Session efficacy: ${total} hook events this window | bash-guard ${g_allow} allowed / ${g_block} blocked | ${drift_part} | stop-hook ${s_block} block(s) | format ${f_ran} ran / ${f_skip} skipped | lint ${l_ran} ran / ${l_skip} skipped | verify-deps ${deps} check(s) | ${prev_part}"
exit 0
