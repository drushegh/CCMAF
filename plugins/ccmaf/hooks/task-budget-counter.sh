#!/usr/bin/env bash
# ccmaf core PostToolUse hook — per-TASK tool-call budgets (CORE-DESIGN §6,
# the Tier 2 half of TASK-152).
#
# /ccmaf:build writes .claude/telemetry/.task-dispatch.<TASK-ID> (content:
# `class=S|M|L`) before each Agent() dispatch and removes it on return.
# This hook increments a per-task counter while the marker exists and nags
# via exit 2 + stderr (PostToolUse feeds stderr to the model, non-blocking)
# at budget/2, budget, then every budget/2 past it. Per-task marker files —
# never one shared marker — because parallel waves dispatch several tasks at
# once (last-writer-wins + first-return-clears would corrupt tracking).
# SUBAGENT VISIBILITY IS HARNESS-DEPENDENT. The S2 probe (2026-08-10,
# headless CLI 2.1.191) saw subagent tool calls in PostToolUse; the live
# acceptance walk (same day, interactive desktop) FALSIFIED that for its
# path — a 15-call worker dispatch left the counter at the orchestrator's
# handful, and the worker's transcript carried no hook feedback at all.
# So this counter is a best-effort meter of whatever calls the harness
# shows it (at minimum the orchestrator's own); the AUTHORITATIVE budget
# check is /ccmaf:build step 4's return-time audit of the worker's
# reported tool-use count. Never present a nag as proof a worker was
# metered.
# Atomic tmp+mv per the kernel budget-counter pattern. Must stay FAST.
set -u

_lib="${CLAUDE_PLUGIN_ROOT:-}/hooks/lib/hook-common.sh"
# shellcheck source=/dev/null
[ -f "$_lib" ] && . "$_lib" 2>/dev/null
if ! command -v core_active >/dev/null 2>&1; then
  core_active() {
    local f="${CLAUDE_PROJECT_DIR:-.}/.claude/.framework-version"
    [ -f "$f" ] && grep -Eq '^[[:space:]]*FRAMEWORK_LINE=v2' "$f" 2>/dev/null
  }
fi
core_active || exit 0

root="${CLAUDE_PROJECT_DIR:-.}"
tdir="$root/.claude/telemetry"
[ -d "$tdir" ] || exit 0

# Session scoping: a marker left behind by a session that died mid-dispatch
# used to be counted — and nagged about — by EVERY later session until the
# 2-day sweep below. Each marker is now claimed by the first session whose
# tool call sees it (in practice the session that wrote it: writing the
# marker is itself a tool call, so its own PostToolUse fires first) via
# .task-owner.<ID>; other sessions skip it. A re-armed marker (newer than
# its owner stamp — build re-dispatched that ID) is re-claimed. No
# session_id in the payload → no scoping (previous behaviour). When a
# marker exists the payload is drained fully; only the head is parsed (the
# envelope's session_id precedes tool_input/tool_response).

# Opportunistic housekeeping: markers/counters from dead runs (build clears
# its markers on return; anything older than 2 days is an orphan). Owner
# stamps whose marker is gone are dropped at once.
find "$tdir" -maxdepth 1 \( -name '.task-dispatch.*' -o -name '.task-count.*' -o -name '.task-owner.*' -o -name '.task-wave*' \) -mtime +2 -delete 2>/dev/null || true
for o in "$tdir"/.task-owner.*; do
  [ -e "$o" ] || continue
  [ -e "$tdir/.task-dispatch.${o##*/.task-owner.}" ] || rm -f "$o" 2>/dev/null
done

# Fast path (hook must stay FAST; PostToolUse payloads can be multi-MB): no
# live dispatch marker -> nothing to count, so exit WITHOUT reading the
# payload (the harness tolerates an unread stdin). Runs after housekeeping
# so orphaned owner stamps/counters are still swept.
ls "$tdir"/.task-dispatch.* >/dev/null 2>&1 || { rm -f "$tdir"/.task-wave* 2>/dev/null; exit 0; }
payload=$(cat 2>/dev/null || true)
sid=$(printf '%s' "${payload:0:4096}" \
  | grep -o '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -n 1 \
  | sed 's/.*"\([^"]*\)"$/\1/' | tr -cd 'A-Za-z0-9._-')

# _mine <marker> <id> — true if this session owns (or just claimed) it.
_mine() {
  [ -n "$sid" ] || return 0
  local of="$tdir/.task-owner.$2" owner=""
  [ -f "$of" ] && owner=$(head -n 1 "$of" 2>/dev/null | tr -d '\r')
  if [ -z "$owner" ] || [ "$1" -nt "$of" ]; then
    printf '%s\n' "$sid" > "$of" 2>/dev/null || true
    return 0
  fi
  [ "$owner" = "$sid" ]
}

# Honest multi-marker semantics (review swarm P1): PostToolUse events carry
# no per-task attribution, so with N tasks armed EVERY event increments ALL
# N counters — parallel-wave counts are session-shared and therefore
# CONSERVATIVE (they overcount each task, never undercount). So with N>1 the
# per-call nags are SUPPRESSED (fleet audit C3: "570/60" wallpaper got the
# hook disarmed) and ONE wave-level nag fires instead, at 2x and 4x the
# largest armed budget, measured on the highest counter (the oldest
# dispatch, i.e. the wave's span). .task-wave.<sid> records the highest
# level already nagged so each fires once per wave; it is cleared when the
# wave ends. The authoritative per-task check stays /ccmaf:build step 4's
# return-time tool_uses audit.
mine=()
for m in "$tdir"/.task-dispatch.*; do
  [ -e "$m" ] || continue
  id="${m##*/.task-dispatch.}"
  case "$id" in ''|*[!A-Za-z0-9._-]*) continue;; esac
  _mine "$m" "$id" && mine+=("$m")
done
armed=${#mine[@]}

# Telemetry on nags only (never per call — PostToolUse is the hottest hook).
export CLAUDE_HOOK_SESSION_ID="$sid"
_emit() { command -v telemetry_emit >/dev/null 2>&1 && telemetry_emit "$root" "task-budget" "nagged" "flagged" "$1"; }

rc=0
wave_n=0 wave_b=0
for m in ${mine[@]+"${mine[@]}"}; do
  id="${m##*/.task-dispatch.}"

  cf="$tdir/.task-count.$id"
  n=0
  [ -f "$cf" ] && n=$(cat "$cf" 2>/dev/null || echo 0)
  case "$n" in *[!0-9]*|"") n=0;; esac
  n=$((n + 1))
  tmp="$cf.tmp.$$"
  printf '%s' "$n" > "$tmp" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; continue; }
  mv -f "$tmp" "$cf" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; continue; }

  cls=$(sed -n 's/^class=\([SML]\)$/\1/p' "$m" 2>/dev/null | head -n 1)
  case "$cls" in S) b=30 ;; L) b=120 ;; *) cls="M"; b=60 ;; esac
  half=$((b / 2))
  [ "$n" -gt "$wave_n" ] && wave_n=$n
  [ "$b" -gt "$wave_b" ] && wave_b=$b
  [ "$armed" -gt 1 ] && continue

  if [ "$n" -eq "$half" ] || [ "$n" -eq "$b" ] || { [ "$n" -gt "$b" ] && [ $(((n - b) % half)) -eq 0 ]; }; then
    echo "[$id] $n tool calls against budget $cls=$b without green acceptance. At/over budget: apply the blocked-return protocol (stop, findings to disk, return 'blocked: <one-line question>') or justify continuing in one line." >&2
    rc=2
    _emit ",\"detail\":{\"task\":\"$id\",\"count\":$n,\"budget\":$b}"
  fi
done

wf="$tdir/.task-wave${sid:+.$sid}"
if [ "$armed" -gt 1 ]; then
  lvl=0
  [ -f "$wf" ] && lvl=$(cat "$wf" 2>/dev/null || echo 0)
  case "$lvl" in *[!0-9]*|"") lvl=0;; esac
  new=0
  if [ "$wave_n" -ge $((wave_b * 4)) ]; then new=4
  elif [ "$wave_n" -ge $((wave_b * 2)) ]; then new=2; fi
  if [ "$new" -gt "$lvl" ]; then
    printf '%s' "$new" > "$wf" 2>/dev/null || true
    echo "[wave] ${armed} tasks in flight; ${wave_n} tool calls this wave = ${new}x the largest per-task budget (${wave_b}). Counts are session-shared while parallel, so per-task nags are off: judge each task at return time (build step 4 tool_uses audit) and stop any worker that is clearly thrashing." >&2
    rc=2
    _emit ",\"detail\":{\"wave\":true,\"armed\":$armed,\"count\":$wave_n,\"budget\":$wave_b,\"level\":$new}"
  fi
else
  rm -f "$wf" 2>/dev/null
fi
exit "$rc"
