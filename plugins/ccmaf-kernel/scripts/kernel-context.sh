#!/usr/bin/env bash
# ccmaf-kernel SessionStart hook — serve the Tier 0 kernel as session context.
#
# Self-deference: in a full-CCMAF (Tier 2) project the framework's own
# CLAUDE.framework.md carries the discipline; injecting the kernel there
# would double-instruct. Presence of .claude/.framework-version in the
# project dir (CLAUDE_PROJECT_DIR, falling back to cwd — hook cwd is not
# guaranteed to be the project root) marks such a project -> emit nothing.
#
# Source filter: on `resume` the prior context persists and already contains
# the kernel, so re-emitting would duplicate it -> skip. startup/clear/compact
# (window new, wiped, or lossy) all inject; an empty/unknown source injects.
#
# Plain stdout from a SessionStart hook is added to the model's context
# (documented behaviour), so no JSON wrapping is needed.
set -u

# Opportunistic housekeeping: prune budget counters from long-dead sessions.
# Best-effort; never let it affect the hook outcome.
find "${HOME}/.ccmaf-kernel" -name 'budget-*.count' -mtime +2 -delete 2>/dev/null || true

src=""
if [ ! -t 0 ]; then
  src=$(head -c 4096 2>/dev/null | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi
if [ "$src" = "resume" ]; then
  exit 0
fi

if [ -f "${CLAUDE_PROJECT_DIR:-.}/.claude/.framework-version" ]; then
  root="${CLAUDE_PROJECT_DIR:-.}"
  # v2 adaptation (CORE-DESIGN §0/§5, D1-a): post-scaffold liveness marker —
  # the core plugin's doctor keys its kernel-absent CRITICAL check on this.
  # Touch only where the scaffold already exists; never create .claude/.
  [ -d "$root/.claude/telemetry" ] && touch "$root/.claude/telemetry/.kernel-present" 2>/dev/null
  # v2 adaptation (CORE-DESIGN §0): coverage-blackout warning. A v2-line
  # project whose ccmaf core plugin isn't emitting its liveness marker has
  # silently lost budgets, the session digest, and Stop enforcement — and
  # this deference branch would otherwise stay mute about it. Grace: skip
  # while .framework-version itself is <1 day old (a fresh migration's first
  # session may run before core's marker lands).
  if grep -Eq '^[[:space:]]*FRAMEWORK_LINE=v2' "$root/.claude/.framework-version" 2>/dev/null; then
    m="$root/.claude/telemetry/.core-present"
    fresh_version=$(find "$root/.claude/.framework-version" -mtime -1 2>/dev/null)
    if [ -z "$fresh_version" ] && { [ ! -f "$m" ] || [ -n "$(find "$m" -mtime +7 2>/dev/null)" ]; }; then
      printf 'WARNING (ccmaf-kernel): this is a CCMAF v2 project but the ccmaf core plugin shows no recent activity — per-task budgets, the session digest, and Stop-hook state enforcement may be OFF. Check `claude plugin list` and install/enable the ccmaf plugin.\n'
    fi
  fi
  exit 0
fi

cat "${CLAUDE_PLUGIN_ROOT}/KERNEL.md"

# Guard-interpreter parity (kernel rule 5): the PreToolUse guard needs a
# Python that actually runs — `command -v` hits like the Windows Store
# app-execution alias don't count (see guard-wrapper.sh). If none exists,
# say so loudly once per session start instead of letting the safety floor
# vanish silently.
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import sys' >/dev/null 2>&1; then
    exit 0
  fi
done
printf '\nWARNING: no working Python interpreter on PATH - the kernel dangerous-command guard (rule 5) cannot run this session. Treat every Bash command as UNSCREENED: apply the same bans yourself and record the gap in the receipt.\n'
