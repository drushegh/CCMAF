Rehydrate after a MANUAL `/compact`. A model-generated SUMMARY of the pre-compact context is
now in your window — treat it as POTENTIALLY LOSSY. This is the manual counterpart to the
`session-reanchor` hook (which only fires on AUTO-compaction); you run it yourself after a
deliberate `/compact`.

Per the **Re-anchor / Reconcile** rule (CLAUDE.framework.md "Session Lifecycle") — RECONCILE,
don't blindly trust either side:

1. **Re-read the state files as canonical for COMMITTED facts** (cache-optimised order):
   contracts (`.claude/ECOSYSTEM.md`, or per-file `contracts/`), `.claude/DECISIONS.md`,
   `.claude/TASKS.md`, `.claude/STATUS.md`, `.claude/claude-progress.txt` — **including the
   `## WIP` section** your `/pre-compact` wrote.
2. **Check actual in-flight work:** run `git status` / `git diff` to see what's modified on disk.
3. **Reconcile:** trust the files + the live repo over the summary where they disagree. The
   summary is the ONLY record of in-flight work since the last checkpoint, so don't discard it —
   but committed facts (decisions, contracts, task lifecycle) come from disk.
4. **Re-orient:** restate the current task + the immediate next step (from STATUS "Active Work" /
   "Next Up" + the `## WIP`) so you're grounded before continuing.

Then output a brief: `✓ Rehydrated from disk — <current task + next step>. Ready for instruction.`
(No copy-paste prompt needed — running this command IS the rehydrate.)
