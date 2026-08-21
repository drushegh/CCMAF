# ccmaf — the CCMAF core plugin (v2 line)

The full CCMAF framework — board/lanes, role agents, lifecycle hooks, doctor,
insights, housekeeping — served as a Claude Code plugin. This is the v2 shape:
**code and prose are machine-wide (this plugin); state is per-project (the
scaffold `/ccmaf:init` writes); nothing is both.**

> **Status: IN DEVELOPMENT — not yet listed in the marketplace.** It ships
> with the v2.0 release together with the migration bridge (TASK-166/167).
> Design record: `docs/tiering/CORE-DESIGN.md` in the dev repo.

## Install (once per machine, when released)

    claude plugin marketplace add drushegh/CCMAF
    claude plugin install ccmaf-kernel@ccmaf --scope user   # REQUIRED first — the safety floor
    claude plugin install ccmaf@ccmaf --scope user

The kernel is a hard prerequisite (owner ruling D1-a): it solely owns the
dangerous-command guard. `/ccmaf:init` refuses to scaffold without it and
the doctor treats a missing kernel as CRITICAL.

## Activation — inert unless a project opts in

Everything in this plugin gates on the project's
`.claude/.framework-version` containing `FRAMEWORK_LINE=v2` — CONTENT, not
file presence. Installed machine-wide it is therefore a no-op in:

- non-CCMAF repos (no `.claude/.framework-version` at all), and
- **v1-line CCMAF projects** (file present, no v2 line) — their bundled
  framework keeps running untouched until they migrate.

`/ccmaf:init` (fresh project) or `migrate-v2.sh` (existing v1 project)
writes the v2 line — that write is the activation switch.

## What the project keeps locally

State only: the board/state files, `.claude/settings.json` (permissions +
statusLine — no hook registrations; hooks come from plugins),
`.claude/.framework-version`, opt-in pins (console/skills/watcher), bare
command aliases (`/build` → the `ccmaf:build` plugin command via the Skill
tool), and `.claude/statusline.sh`.

## Hooks (all v2-gated, cd-anchored to the project)

SessionStart: `core-context` (≤8KB digest + check chain + boot view; the
10KB inline ceiling is probe-verified) · `session-reanchor` ·
`session-start-marker` · `guard-interpreter-check` (monitors the kernel's
guard) — plus `.core-present` liveness for the kernel's blackout warning.
Stop: `enforce-state-update`. PreCompact/PostCompact: snapshot/archive.
UserPromptSubmit + PostToolUse: `framework-drift-guard`,
`checkpoint-watermark`. PostToolUse: `task-budget-counter` (per-task
S≈30/M≈60/L≈120 nags). PreToolUse: `unattended-guard`
(`CLAUDE_UNATTENDED=1`: denies AskUserQuestion; halts mutating tools on
doctor-CRITICAL, writing `.claude/unattended-halt.md`).

## Commands

`/ccmaf:init` · `/ccmaf:plan` · `/ccmaf:build` · `/ccmaf:test` ·
`/ccmaf:review` · `/ccmaf:analyse` · `/ccmaf:security` · `/ccmaf:wrapup` ·
`/ccmaf:pre-compact` · `/ccmaf:post-compact` · `/ccmaf:reconcile` ·
`/ccmaf:healthcheck` · `/ccmaf:board-heal` · `/ccmaf:bug` ·
`/ccmaf:housekeeping` · `/ccmaf:update` — scaffolded projects also get bare
aliases so `/build` etc. keep working.

Sibling plugins (advisors · council · media · devhooks · console) install
independently; core degrades gracefully without them and `/ccmaf:init`
prints the install command for any feature you enable that needs one.
