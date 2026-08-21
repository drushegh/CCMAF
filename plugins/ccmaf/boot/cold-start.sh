#!/usr/bin/env bash
set -uo pipefail
# cold-start.sh — batch the cold-start check chain into ONE invocation (OPT P2;
# v2 PROMOTED to primary per CORE-DESIGN §2 — no longer shadow mode; called by
# core-context.sh, the plugin's SessionStart hook).
#
# Runs the checks the cold start already runs, prints a compact status table +
# which notification FLAG files now exist (the model then handles each flag per
# the plugin digest's cold-start steps), then emits the boot-view. Collapses
# ~10 serial model round-trips into one. Does NOT wrap `git pull --ff-only`
# (step 4.5 — needs conflict handling) or start-project.sh (may start a dev
# server) — those stay visible/interactive, model-executed steps.
#
# v2 adaptations (CORE-DESIGN §2, TASK-171):
#   (a) invokes the PLUGIN copies of each check (${CLAUDE_PLUGIN_ROOT}/...),
#       not a consumer-bundled .claude/framework/ tree (which no longer
#       exists post-migration).
#   (b) check-updates.sh (v1's git-based framework-version poller) is
#       retired; its cold-start slot is now update-nudge.sh (a throttled,
#       cadence-based plugin-update reminder — see that script's header).
#       Unlike the other checks, update-nudge.sh has no flag-file convention
#       — it prints its nudge line(s) directly to stdout — so its output is
#       captured and surfaced below the table instead of discarded.
#   (c) every wrapped check is timeout-bounded (`timeout 10`) — a filtered
#       network, or any other hang, must never hang session start.
#   (d) this hook ALWAYS exits 0. A wrapped check "failing" (a raised flag)
#       was already normal in v1 (exit 0/2/3 by design) and did not
#       propagate; v2 goes further — even a genuinely CRASHED check or
#       boot-view's fail-closed exit-2 becomes a printed table/content line,
#       never a propagated exit code (SessionStart hook contract: no
#       sibling hook exits non-zero, and non-zero-exit context behaviour is
#       unverified, CORE-DESIGN §2).

# v2 adaptation: CLAUDE_PROJECT_DIR (harness-provided) replaces the old
# BASH_SOURCE-relative fallback, which assumed a fixed depth under a
# consumer's .claude/framework/ tree and no longer lands on the project
# under the plugin layout.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
# v2 adaptation: FW pointed at the consumer-bundled .claude/framework/ tree
# (own-machinery siblings); the machinery now ships inside this plugin.
FW="${CLAUDE_PLUGIN_ROOT:-$ROOT/.claude/framework}"
# Hardened (round-4 P1, live-reproduced): uutils date does NOT truncate %3N
# (19-digit ns passed the old all-digit guard and made every ms delta
# nanosecond-scale). Accept exactly 13 digits, else whole-second fallback.
now_ms() { local t; t=$(date +%s%3N 2>/dev/null); case "$t" in [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) printf '%s' "$t" ;; *) printf '%s' "$(( $(date +%s) * 1000 ))" ;; esac; }

echo "cold-start checks — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "-----------------------------------------------"

# Silent checks: the flag file they may write IS the signal; live stdout is
# discarded (matches v1 behaviour). timeout 10 per (c) above.
run_check() { # <label> <timeout-secs> <interpreter> <script> [args...]
  local label="$1" tmo="$2"; shift 2
  if over_deadline; then
    printf '%-16s %8s   SKIPPED (session-start deadline — run it yourself if needed)\n' "$label" "-"
    return 0
  fi
  # After the shifts, $1 is the interpreter (bash) and $2 the script PATH —
  # test the script, not the interpreter (the "(missing)" bug).
  [ -f "${2:-}" ] || { printf '%-16s %8s   (missing)\n' "$label" "-"; return 0; }
  local s e rc; s=$(now_ms)
  timeout "$tmo" "$@" >/dev/null 2>&1; rc=$?; e=$(now_ms)
  # exit=124 means the check was KILLED at its budget — say so explicitly;
  # for doctor that would leave the LAST COMPLETED verdict flag in place
  # (its lifecycle is completion-gated), so a kill is loud-but-safe.
  if [ "$rc" -eq 124 ]; then
    printf '%-16s %6s ms   exit=124 (KILLED at %ss budget — result not refreshed)\n' "$label" "$((e - s))" "$tmo"
  else
    printf '%-16s %6s ms   exit=%s\n' "$label" "$((e - s))" "$rc"
  fi
}

# update-nudge.sh: no flag-file convention (b) — capture its stdout so the
# nudge line(s) actually reach the model instead of being thrown away.
un_output=""
run_check_capture() { # <label> <timeout-secs> <interpreter> <script> [args...]
  local label="$1" tmo="$2"; shift 2
  if over_deadline; then
    printf '%-16s %8s   SKIPPED (session-start deadline — run it yourself if needed)\n' "$label" "-"
    return 0
  fi
  [ -f "${2:-}" ] || { printf '%-16s %8s   (missing)\n' "$label" "-"; return 0; }
  local s e rc out; s=$(now_ms)
  out="$(timeout "$tmo" "$@" 2>&1)"; rc=$?; e=$(now_ms)
  printf '%-16s %6s ms   exit=%s\n' "$label" "$((e - s))" "$rc"
  un_output="$out"
}

# Aggregate deadline (round-3 review P1): the per-check budgets sum past the
# harness's default 60s per-hook timeout (a killed hook discards ALL stdout —
# digest included). hooks.json sets timeout:120 on core-context as the outer
# fix; this deadline is the belt-and-braces inner one: once ~40s have gone,
# remaining checks are SKIPPED with an explicit line so the digest + boot
# view always land. Doctor runs FIRST — it is the safety authority (its flag
# feeds the unattended halt) and must never be the check the deadline drops.
# Deadline clock: bash's builtin SECONDS (integer seconds since script
# start) — immune to date-implementation quirks by construction (the round-4
# P1: uutils %3N nanoseconds made an ms-based deadline fire at t=0). now_ms
# stays for the cosmetic per-check ms column only; NO control flow may ever
# depend on it.
CHAIN_DEADLINE_S=40
over_deadline() { [ "$SECONDS" -ge "$CHAIN_DEADLINE_S" ]; }

run_check "doctor"         30 bash "$FW/doctor/doctor.sh"
run_check_capture "update-nudge" 10 bash "$FW/update/update-nudge.sh"
run_check "skills-check"   10 bash "$FW/update/skills-check.sh"
run_check "console-check"  10 bash "$FW/update/console-check.sh"
run_check "insights"       10 bash "$FW/insights/analyse.sh"
echo "-----------------------------------------------"

if [ -n "$un_output" ]; then
  printf '%s\n' "$un_output"
  echo
fi

# Doctor-CRITICAL elevation (acceptance-walk finding 2026-08-10): doctor
# always exits 0 so the check table cannot distinguish CRITICAL from clean,
# and listing the findings file as one more generic flag buried the lede —
# a live halt drill showed the CRITICAL was not legible from SessionStart
# context alone. Make it a HEADLINE, using the unattended-guard's EXACT
# predicate (same file, same head -n 10, same regex) so this advisory line
# and the enforcing guard can never disagree. Advisory only — enforcement
# stays in the guard.
_findings="$ROOT/.claude/.framework-doctor-findings.md"
if [ -f "$_findings" ] && head -n 10 "$_findings" | grep -Eq '\*\*Findings:\*\*[[:space:]]+[1-9][0-9]*[[:space:]]+CRITICAL'; then
  echo "*** DOCTOR CRITICAL — read .claude/.framework-doctor-findings.md FIRST and resolve before any other work. ***"
  echo "*** (Unattended runs: the PreToolUse guard is already blocking non-read-only tools on this state.) ***"
  echo
fi

echo "FLAGS (handle each per the plugin digest's cold-start steps):"
_flag() { [ -f "$ROOT/.claude/$1" ] && echo "  - .claude/$1"; }
_flag ".skills-update-available.md"
_flag ".skills-suggestion.md"
_flag ".console-suggestion.md"
_flag ".framework-insight-alert.md"
_flag ".framework-doctor-findings.md"
echo "(none listed above = all clear)"
echo

# Emit the boot-view. Its own fail-closed exit-2 contract is UNCHANGED (see
# boot-view.sh) — but per (d) above, that exit code must not propagate out of
# THIS hook. A non-zero exit becomes a printed content line instead of an
# exit-code handoff.
bv_out="$(timeout 10 bash "$FW/boot/boot-view.sh" 2>&1)"
bv=$?
if [ "$bv" -eq 0 ]; then
  printf '%s\n' "$bv_out"
else
  echo "boot-view: INCOMPLETE (exit $bv) — read .claude/TASKS.md, STATUS.md, DECISIONS.md, claude-progress.txt directly."
  printf '%s\n' "$bv_out" >&2
fi

exit 0
