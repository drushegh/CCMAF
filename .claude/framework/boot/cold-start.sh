#!/usr/bin/env bash
set -uo pipefail
# cold-start.sh — batch the cold-start check chain into ONE invocation (OPT P2).
#
# Runs the checks the cold start already runs, prints a compact status table +
# which notification FLAG files now exist (the model then handles each flag per
# CLAUDE.framework.md cold-start steps 1-3), then emits the boot-view. Collapses
# ~10 serial model round-trips into one. Does NOT wrap `git pull --ff-only`
# (step 4.5 — needs conflict handling) or init.sh (may start a dev server) — those
# stay visible/interactive.
#
# SHADOW MODE: the cold start (CLAUDE.framework.md) is NOT switched to this yet —
# the boot-view read-strategy migration needs a multi-session shadow soak.
#
# Non-zero exit from a wrapped check that CRASHED (vs merely raising a flag) makes
# this exit non-zero → the caller falls back to running the checks individually.

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
FW="$ROOT/.claude/framework"
now_ms() { date +%s%3N 2>/dev/null | grep -qE '^[0-9]+$' && date +%s%3N || echo 0; }

rc_all=0
echo "cold-start checks — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "-----------------------------------------------"
run_check() { # <label> <script...>
  local label="$1"; shift
  [ -f "${1:-}" ] || { printf '%-16s %8s   (missing)\n' "$label" "-"; return 0; }
  local s e rc; s=$(now_ms); "$@" >/dev/null 2>&1; rc=$?; e=$(now_ms)
  printf '%-16s %6s ms   exit=%s\n' "$label" "$((e - s))" "$rc"
  # A check "failing" usually means it wrote a flag (normal) — those exit 0/2/3
  # by design. Only a truly unexpected code (>=10) is treated as a crash here.
  [ "$rc" -ge 10 ] && rc_all=1
}
run_check "check-updates"  bash "$FW/update/check-updates.sh"
run_check "skills-check"   bash "$FW/update/skills-check.sh"
run_check "console-check"  bash "$FW/update/console-check.sh"
run_check "insights"       bash "$FW/insights/analyse.sh"
run_check "doctor"         bash "$FW/doctor/doctor.sh"
echo "-----------------------------------------------"

echo "FLAGS (handle each per CLAUDE.framework.md cold-start steps 1-3):"
_flag() { [ -f "$ROOT/.claude/$1" ] && echo "  - .claude/$1"; }
_flag ".framework-update-available.md"
_flag ".skills-update-available.md"
_flag ".skills-suggestion.md"
_flag ".console-suggestion.md"
_flag ".framework-insight-alert.md"
_flag ".framework-doctor-findings.md"
echo "(none listed above = all clear)"
echo

# Emit the boot-view (its own exit 2 = fall back to full-file reads).
bash "$FW/boot/boot-view.sh"
bv=$?
[ "$rc_all" -eq 0 ] || { echo "cold-start: a check crashed — run the checks individually per the legacy steps." >&2; exit 1; }
exit "$bv"
