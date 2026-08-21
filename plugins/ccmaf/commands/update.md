---
description: Check plugin updates + apply CCMAF v2 scaffold deltas to this project
---
# /ccmaf:update — plugin nudge + scaffold sync

**Context check:** `.claude/.framework-version` must contain
`FRAMEWORK_LINE=v2`; otherwise say so in one line and stop (v1 projects use
the bundled update system until they migrate).

Code updates ride the marketplace, never this command: this command only
(a) surfaces available plugin refreshes and (b) applies SCAFFOLD deltas —
the per-project files init wrote — when the plugin ships a newer scaffold
revision.

## Step 1 — plugin refresh nudge

`timeout 10 claude plugin list --json`. Print one line per installed
`*@ccmaf` plugin with its version, and the refresh command:
`claude plugin update <name>`. (Marketplace-latest is not readable locally —
this is a cadence nudge, not a version diff. If the CLI call fails or times
out, say so and continue; never block on it.)

## Step 2 — scaffold revision check

- Project rev: `grep '^SCAFFOLD_REV=' .claude/.framework-version`.
- Shipped rev: `cat ${CLAUDE_PLUGIN_ROOT}/templates/.scaffold-rev`.
- Equal → "scaffold up to date", done.
- Project BEHIND → apply the delta: re-execute `/ccmaf:init` **Steps 1 and 4
  only** (the scaffold-write and alias steps, by reference — read
  `${CLAUDE_PLUGIN_ROOT}/commands/init.md`), which are idempotent: existing
  files SKIP. Two behaviours differ from a fresh `/ccmaf:init` run:
  - **Settings never auto-merge here.** Skip Step 1.3's write entirely.
    Instead diff the template's `deny`/`ask`/`statusLine` entries against
    the consumer's `.claude/settings.json` and PRINT the missing entries as
    a suggested JSON snippet — never write `settings.json` from
    `/ccmaf:update` (CORE-DESIGN §7: settings changes are suggestions,
    never auto-merged, at update time; first-time `/ccmaf:init` still
    merges as normal).
  - **Missing-piece flow (tombstone write side).** Steps 1/4 already
    respect `.claude/.scaffold-removed` tombstones (read side: a listed
    path is reported TOMBSTONED and never recreated). For a Step 1/4 path
    that is ABSENT and NOT already tombstoned, do not silently recreate
    it — attended: ask "`<path>` is missing — restore it, or was it
    deliberately removed?" (restore → create it normally and report
    CREATED; keep removed → append `<path>` to `.claude/.scaffold-removed`,
    creating the file if it doesn't exist, and report TOMBSTONED);
    unattended: restore nothing, log the question to
    `.claude/unattended-log.md`, and report PENDING (no silent recreation,
    no silent tombstoning — this ambiguity needs a human).
  Then update the `SCAFFOLD_REV=` line to the shipped rev and print the
  CREATED/SKIPPED/TOMBSTONED/PENDING report plus any settings suggestion.
- Project AHEAD of shipped (plugin downgraded): report loudly, change
  nothing.

## Step 3 — commit

If anything changed: `chore: CCMAF scaffold sync to rev <n> (ccmaf:update)`.
