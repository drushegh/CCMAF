---
description: Gracefully stop this project's CCMAF Console (the /ccmaf:wrapup teardown seam)
---
# /console:stop

Stops the running Console for THIS project (the `ccmaf-console` npm server
the autostart hook brought up). This is the session-end teardown seam
`/ccmaf:wrapup` invokes by name (`contract:console-lifecycle`); it is also
safe to run manually.

1. **Resolve the project root the same way autostart does** — the git
   toplevel: `ROOT=$(git rev-parse --show-toplevel)`. (Autostart registers
   the Console under the git toplevel; `CLAUDE_PROJECT_DIR` can be a
   subdirectory of it, so do NOT let the driver fall back to that.) If this
   is not a git repo, autostart never ran here — report `— not opted in`
   and finish.
2. **Gate:** if neither `$ROOT/.claude/.console-version` nor the legacy
   `$ROOT/.claude/.console-enabled` exists, say "not opted in —
   nothing to stop" and finish. (Being invoked in a non-opted-in project is
   normal, never an error.)
3. Run:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/console.mjs" stop --root "$ROOT"`
   The driver resolves the running server for THAT project root and shuts
   it down gracefully (the tray Hub drops the entry; the Hub itself exits
   when its last console closes). Stopping when nothing is running is a
   clean no-op — report it as such.
4. Report one line: `✓ Console stopped` / `— none running` /
   `— not opted in`.
