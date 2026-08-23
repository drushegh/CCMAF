Rehydrate after a MANUAL `/compact`. A model-generated SUMMARY of the pre-compact context is
now in your window — treat it as POTENTIALLY LOSSY. This is the manual counterpart to the
`session-reanchor` hook (which only fires on AUTO-compaction); you run it yourself after a
deliberate `/compact`.

> **Step 0 — v2 self-route (read this first):** if `.claude/.framework-version` contains a
> `FRAMEWORK_LINE=v2` line, this project runs the CCMAF v2 plugins — invoke the
> `ccmaf:post-compact` skill (Skill tool) and follow IT instead of this file; stop reading
> here. This bare command is the v1-line copy, kept as authored source.

Per the **Re-anchor / Reconcile** rule (CLAUDE.framework.md "Session Lifecycle") — RECONCILE,
don't blindly trust either side:

**If the project uses the orchestrator-state pattern** (`.claude/NOW.md` exists — see
`.claude/framework/agent_docs/orchestrator-state.md`), start with its boot set, in order:
`NOW.md` → `GROUND-TRUTH.md` → the 10 newest `DECISIONS.md` entries → `PLAYBOOK.md` +
`GOTCHAS.md`. This is a small, purpose-built recovery set, not the full stack below — read it
first so you're grounded before anything else. Treat every fact in `GROUND-TRUTH.md` as
**quote, never paraphrase**: cite it verbatim rather than reconstructing it from the
compaction summary. If `.claude/NOW.md` doesn't exist, skip this paragraph — the project isn't
using the pattern, so behaviour is unchanged from the steps below.

1. **Re-read the state files as canonical for COMMITTED facts** (cache-optimised order):
   contracts (`.claude/ECOSYSTEM.md`, or per-file `contracts/`), `.claude/DECISIONS.md`,
   `.claude/TASKS.md`, `.claude/STATUS.md`, `.claude/claude-progress.txt` — **including the
   `## WIP` section** your `/pre-compact` wrote. (If the boot set above already covered
   `NOW.md`/`GROUND-TRUTH.md`/the top `DECISIONS.md` entries, this step fills in the rest of
   the stack rather than re-reading what's already fresh.)
2. **Check actual in-flight work:** run `git status` / `git diff` to see what's modified on disk.
3. **Reconcile:** trust the files + the live repo over the summary where they disagree. The
   summary is the ONLY record of in-flight work since the last checkpoint, so don't discard it —
   but committed facts (decisions, contracts, task lifecycle) come from disk.
4. **Re-orient:** restate the current task + the immediate next step (from `NOW.md`'s in-flight
   section when present, else from STATUS "Active Work" / "Next Up" + the `## WIP`) so you're
   grounded before continuing.

Then output a brief: `✓ Rehydrated from disk — <current task + next step>. Ready for instruction.`
(No copy-paste prompt needed — running this command IS the rehydrate.)
