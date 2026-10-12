#!/usr/bin/env bash
# ccmaf-kernel PreToolUse(Bash) hook — run the bundled dangerous-command
# guard. The .py is a byte-identical copy of the framework's canonical
# .claude/hooks/block-dangerous-commands.py (enforced by kernel_plugin.bats);
# edit the canonical, then re-sync — never edit the copy.
#
# Same fail-loud semantics as the framework's settings.json wrapper: no
# working Python (or a missing guard file) -> report the screening gap
# (non-blocking exit 1), never silently skip. Candidates must pass a
# `-c 'import sys'` probe before being accepted — mirroring the framework's
# resolve_python — because `command -v` alone accepts the Windows Store
# python.exe app-execution alias, which resolves on PATH but exits non-zero
# without ever running the guard. The guard's own opt-out
# (CLAUDE_DISABLED_HOOKS=block-dangerous) lives inside the .py and applies
# here identically.
#
# Opt-in wave mode (CCMAF_WAVE_GUARD=1) chains scripts/wave-guard.sh AFTER
# the guard, from this one hook entry, so the default path costs no second
# bash process per call. Unset: the guard is exec'd exactly as before.
set -u
GUARD="${CLAUDE_PLUGIN_ROOT}/scripts/block-dangerous-commands.py"
WAVE="${CLAUDE_PLUGIN_ROOT}/scripts/wave-guard.sh"

payload=""
[ "${CCMAF_WAVE_GUARD:-}" = "1" ] && payload=$(cat)

# skipped <reason>: the guard could not run. Wave mode still screens (its
# block wins); otherwise report the gap, non-blocking.
skipped() {
  if [ "${CCMAF_WAVE_GUARD:-}" = "1" ]; then
    printf '%s' "$payload" | bash "$WAVE"
    [ $? -eq 2 ] && exit 2
  fi
  echo "ccmaf-kernel guard SKIPPED: $1 - this command was NOT screened for destructive patterns" >&2
  exit 1
}

[ -f "$GUARD" ] || skipped "guard file missing at $GUARD"
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import sys' >/dev/null 2>&1; then
    [ "${CCMAF_WAVE_GUARD:-}" = "1" ] || exec "$cand" "$GUARD"
    printf '%s' "$payload" | "$cand" "$GUARD"
    rc=$?
    [ "$rc" -eq 2 ] && exit 2
    printf '%s' "$payload" | bash "$WAVE"
    [ $? -eq 2 ] && exit 2
    exit "$rc"
  fi
done
skipped "no working Python interpreter found on PATH"
