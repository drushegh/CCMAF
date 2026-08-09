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
set -u
GUARD="${CLAUDE_PLUGIN_ROOT}/scripts/block-dangerous-commands.py"
if [ ! -f "$GUARD" ]; then
  echo "ccmaf-kernel guard SKIPPED: guard file missing at $GUARD - this Bash command was NOT screened for destructive patterns" >&2
  exit 1
fi
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import sys' >/dev/null 2>&1; then
    exec "$cand" "$GUARD"
  fi
done
echo "ccmaf-kernel guard SKIPPED: no working Python interpreter found on PATH - this Bash command was NOT screened for destructive patterns" >&2
exit 1
