---
description: Gracefully stop this project's CCMAF Console (the /ccmaf:wrapup teardown seam)
---
# /console:stop

Stops the running Console for THIS project (the `ccmaf-console` npm server
the autostart hook brought up). This is the session-end teardown seam
`/ccmaf:wrapup` invokes by name (`contract:console-lifecycle`); it is also
safe to run manually.

1. **Gate:** if neither `.claude/.console-version` nor the legacy
   `.claude/.console-enabled` exists in this project, say "not opted in —
   nothing to stop" and finish. (Being invoked in a non-opted-in project is
   normal, never an error.)
2. Run, from the project root:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/console.mjs" stop`
   The driver resolves the running server for THIS project root and shuts
   it down gracefully (the tray Hub drops the entry; the Hub itself exits
   when its last console closes). Stopping when nothing is running is a
   clean no-op — report it as such.
3. Report one line: `✓ Console stopped` / `— none running` /
   `— not opted in`.
