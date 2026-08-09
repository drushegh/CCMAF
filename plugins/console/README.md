# console — CCMAF Console bridge

Claude-side bridge to the **ccmaf-console** web dashboard (published to npm
as `ccmaf-console` — a separate package this plugin drives but does not
bundle). Install once per machine; any repo **opted in** via a
`.claude/.console-version` file (content = an npm version spec, e.g.
`latest`) gets:

- **Session autostart** — a SessionStart hook backgrounds the Console for
  the project, so opening the project brings the board up with no model
  action required.
- **Liveness heartbeat** — UserPromptSubmit/PostToolUse hooks refresh the
  project's Console registry entry mtime so the tray Hub never reaps a live
  session's console.

Projects without the opt-in file are untouched (every hook is an instant
no-op there).

## Install (once per machine)

```bash
claude plugin marketplace add drushegh/CCMAF
claude plugin install console@ccmaf --scope user
```

Then opt a project in: `echo latest > .claude/.console-version` (and commit it).

## Driving the Console manually

The driver lives inside the plugin at `scripts/console.mjs` (in hook
commands `${CLAUDE_PLUGIN_ROOT}` expands to the plugin's cache directory;
interactively, find it under your Claude Code plugin cache, e.g.
`~/.claude/plugins/`). Verbs:

```bash
node "<plugin-dir>/scripts/console.mjs" start   --root <project>  # ensure up, print URL (idempotent)
node "<plugin-dir>/scripts/console.mjs" stop    --root <project>  # graceful teardown (session wrap-up)
node "<plugin-dir>/scripts/console.mjs" open    --root <project>  # open in the browser
node "<plugin-dir>/scripts/console.mjs" restart --root <project>  # after a Console version bump
```

`--root` names the project the Console serves. It is optional but
recommended: without it the driver falls back to `CLAUDE_PROJECT_DIR`, then
the enclosing git toplevel of the current directory. (This plugin copy
cannot infer the project from its own location — it lives in the plugin
cache, not in your repo.)

## Behaviour in full-CCMAF projects

In a project scaffolded with the full framework (marked by
`.claude/.framework-version`), this plugin **self-defers**: the framework's
own bundled console-autostart/console-heartbeat registrations handle the
lifecycle, and running both would double every heartbeat's process cost and
race two autostarts. The deference gate lives in `hooks/hooks.json`.

## Maintenance invariants

- `hooks/lib/hook-common.sh` must stay **byte-identical** to
  `plugins/devhooks/hooks/lib/hook-common.sh` (enforced by
  `plugins_structure.bats`).
- `hooks/console-heartbeat.sh` is a byte-identical copy of the framework's
  `.claude/hooks/console-heartbeat.sh`; `hooks/console-autostart.sh` and
  `scripts/console.mjs` are the framework copies plus documented
  plugin-cache adaptations (`${CLAUDE_PLUGIN_ROOT}` resolution and
  invocation-context project-root resolution).
