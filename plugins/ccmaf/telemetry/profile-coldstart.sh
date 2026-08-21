#!/usr/bin/env bash
set -uo pipefail
# profile-coldstart.sh — time the heavy cold-start scripts individually (OPT P0, M2).
#
# Purpose (TASK-136 / the framework-optimization plan): give real numbers for the
# cold-start chain so the P7 "split doctor into fast/deep" decision is made on
# measured runtime, NOT on source-file size (both advisors' explicit correction:
# doctor.sh being 51KB is not evidence it is slow — profile it).
#
# Default run times only the SAFE, side-effect-free-ish heavy hitters (doctor +
# insights). `--full` additionally times the update/skills/console checks, which
# do NETWORK I/O (git ls-remote) and may write notification flag files — run that
# form deliberately, not casually. start-project.sh and `git pull` are never timed
# here (they start servers / need conflict handling).
#
# Output: a table (script | elapsed ms | exit). Read-only aside from the throttle
# timestamps the checks already write on any run.

# v2 adaptation: v1 computed a project ROOT here (git rev-parse, else a
# BASH_SOURCE-relative SCRIPT_DIR/../../.. climb that assumed a fixed depth
# under a consumer's .claude/framework/ tree — broken under the plugin
# layout) solely to build FW="$ROOT/.claude/framework". This script has no
# other project-relative reference, so ROOT is dropped entirely; FW now
# resolves straight from CLAUDE_PLUGIN_ROOT (harness-provided), with
# SCRIPT_DIR (dirname-based, always correct regardless of install location)
# kept as the fallback for a manual, non-hook invocation.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FW="${CLAUDE_PLUGIN_ROOT:-$SCRIPT_DIR/..}"
FULL=0; [ "${1:-}" = "--full" ] && FULL=1

# Hardened: 13-digit epoch-millis only (uutils %3N emits ns — see cold-start.sh).
now_ms() { local t; t=$(date +%s%3N 2>/dev/null); case "$t" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) printf '%s\n' "$t" ;;
  *) { command -v python3 >/dev/null 2>&1 && python3 -c 'import time;print(int(time.time()*1000))' \
       || python -c 'import time;print(int(time.time()*1000))'; } ;; esac; }

time_one() { # <label> <cmd...>
  local label="$1"; shift
  [ -f "${2:-}" ] || { printf '%-26s %8s   %s\n' "$label" "-" "(missing: ${2:-?})"; return 0; }
  local s e rc
  s=$(now_ms); "$@" >/dev/null 2>&1; rc=$?; e=$(now_ms)
  printf '%-26s %6s ms   exit=%s\n' "$label" "$((e - s))" "$rc"
}

_lbl=""; [ "$FULL" -eq 1 ] && _lbl=" (--full)"
echo "cold-start chain timing — $(date -u +%Y-%m-%dT%H:%M:%SZ)$_lbl"
echo "------------------------------------------------------"
time_one "doctor"            bash "$FW/doctor/doctor.sh"
time_one "insights/analyse"  bash "$FW/insights/analyse.sh"
if [ "$FULL" -eq 1 ]; then
  echo "-- --full: network + flag-writing checks --"
  # v2 adaptation: check-updates.sh (v1 framework-version poller) is retired;
  # the v2 cold-start chain's equivalent throttled nudge is update-nudge.sh.
  time_one "update-nudge"    bash "$FW/update/update-nudge.sh"
  time_one "skills-check"    bash "$FW/update/skills-check.sh"
  time_one "console-check"   bash "$FW/update/console-check.sh"
fi
echo "------------------------------------------------------"
echo "P7 gate: split doctor fast/deep only if 'doctor' is meaningfully > ~1-2s here."
echo "(start-project.sh + git pull excluded — side-effecting/interactive.)"
