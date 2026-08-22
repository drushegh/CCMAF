# Migrating a v1 project to CCMAF v2

CCMAF v2 moves the framework out of your repo and into Claude Code plugins.
After migrating, your project keeps only its own state (board, decisions,
contracts, settings, skills); the machinery — hooks, commands, doctor, the
update system — lives in the `ccmaf` plugins and updates via
`claude plugin update`. Your board history, decisions, and project files are
not touched by the migration; it is delivered as **one revertible git commit**.

Staying on v1 is fine. Nothing forces the move; the offer simply repeats at
each session start until you accept or the framework line is retired.

## The short version

> Update the framework as usual, then accept the migration offer at your next
> session start and follow the prompts.

Everything below is what the prompts do, for the record.

## Step by step

1. **Take the v2.0 framework update** (the normal cold-start update check, or
   by hand: `bash .claude/framework/update/apply-update.sh`). v2.0 is the
   *bridge* release: it adds the migration tooling and deletes nothing.
2. **Install the plugin floor — once per machine, not per project:**

   ```bash
   claude plugin marketplace add drushegh/CCMAF
   claude plugin install ccmaf-kernel@ccmaf --scope user   # the safety floor — required
   claude plugin install ccmaf@ccmaf --scope user          # the core — required
   # optional siblings — user-scope, inert until used; take the lot or delete any line
   claude plugin install devhooks@ccmaf --scope user       # format/lint/test-QoL hooks v1 always ran (recommended)
   claude plugin install advisors@ccmaf --scope user       # cross-model advisor workbench (needs the codex CLI)
   claude plugin install council@ccmaf --scope user        # /council five-advisor deliberations
   claude plugin install media@ccmaf --scope user          # /image generation (needs the codex CLI)
   claude plugin install console@ccmaf --scope user        # bridge to the ccmaf-console dashboard (if Console-opted-in)
   ```

   Restart the session after installing — close and reopen your IDE or
   terminal (plugins only load at session start). The migration script
   refuses to run until both are verified — the bundled dangerous-command
   guard is never deleted before its plugin replacement is active.
3. **Run the migration** (the session does this when you accept the offer):

   ```bash
   bash .claude/framework/update/migrate-v2.sh --yes    # --dry-run to preview
   ```

   What it does, in order: rewrites `.claude/settings.json` (removes the
   retired hook registrations, keeps everything of yours, retargets the
   status line) → moves `statusline.sh` to `.claude/statusline.sh` → deletes
   the bundled framework copies, recording each in
   `.claude/.migrate-v2-tombstone` → writes `FRAMEWORK_LINE=v2` → commits.
4. **Close and reopen your IDE or terminal, then tell Claude you're back.**
   That close-and-reopen *is* the "restart" — nothing else is. In the fresh
   session Claude runs `/ccmaf:init` itself (it's a plugin command Claude can
   invoke); its missing-piece flow scaffolds the bare command aliases
   (`/build`, `/plan`, …) and anything else absent. You never run it by hand.
5. **Skipped the optional lines in step 2?** The migration output re-prints
   the same sibling block, flagging the ones this project was detected using
   (e.g. `console` if you were Console-opted-in). Paste it in any terminal,
   any time; restart once afterwards to load them.

## Good to know

- **Revert:** the whole migration is one commit — `git revert <sha>` returns
  the project to v1 (the DONE banner prints the sha).
- **Customised framework files** (an edited hook, a tweaked command) are
  deleted with the rest but remain in git history:
  `git show '<migration-sha>^:<path>'` recovers any of them. Re-home custom
  work under your own filenames afterwards.
- **During the migration session** Bash calls may be denied after the old
  guard file is deleted — the stale hook registration fails closed. That is
  expected; restart rather than "fixing" it.
- **Interrupted?** Re-run the script — it resumes safely (the tombstone
  makes every crash window recoverable, and the doctor flags a half-migrated
  state loudly).
- **Skipping releases:** if you never took v2.0 and update straight into a
  later release, the updater refuses to apply anything destructive until the
  migration has run. Un-migrated projects can stay put indefinitely.
