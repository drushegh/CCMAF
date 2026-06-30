Follow the Cold Start sequence (steps 0-9 from CLAUDE.framework.md — the canonical list lives there; CLAUDE.md merely @imports it).

Then:

1. Pick the highest-priority unblocked task from TASKS.md.
   If TASKS.md has no tasks, tell the user: "No tasks found. Run /analyse
   and /plan first to create the spec, contracts, and task breakdown."
   **Granularity guard:** if the picked task actually bundles several
   independently-verifiable features, STOP and decompose it first — one board task
   per feature (see `.claude/framework/agent_docs/verify-handback.md`). Do NOT build
   one umbrella task covering many features; that destroys the per-feature review surface.
2. Estimate the task's token cost against the current context window
3. If current usage + estimated cost >= 90%, ask the user:
   "Context is at X%. This task will need ~YK tokens (Z% projected).
   Would you like to: 1) Proceed anyway 2) Prepare for compaction 3) Start a fresh session"
   If "prepare": save all state files, commit, tell user to /compact and wait.
   If "fresh session": save all state files, commit, tell user to start a new session.
   If user says "proceed" after compacting: re-read state files first.

4. Delegate the implementation to the developer subagent using the Task tool:
   "Implement [TASK-XXX]: [description].
   Contract: [read and include the relevant contract from ECOSYSTEM.md, or the matching file in `contracts/` if the project uses per-file contracts — see CLAUDE.md]
   Check GOTCHAS.md for: [relevant area]
   Commit after each milestone. When done, update TASKS.md (move to
   Ready for Review), STATUS.md, and claude-progress.txt."

5. POST-DELEGATION VERIFICATION (mandatory — subagents cannot be trusted
   to update state files reliably, since hooks may not fire in subagent
   context):
   a. Read TASKS.md — did the task move to "Ready for Review"?
   b. Read STATUS.md — does it reflect the completed work?
   c. Read claude-progress.txt — is there a session entry?
   d. **Commit linkage check:** Run `git log --oneline --grep="TASK-XXX"`
   to verify at least one commit references the task ID. If the subagent
   didn't include the task ID in commit messages, amend or create a
   fixup commit now.
   e. If ANY state files are missing or stale, update them yourself using
   the subagent's summary output. This is expected, not an error.
6. Commit all state file updates (include task ID in the commit message).
7. If context allows, repeat from step 1 for the next task.
8. **Hand the work back for verification (NON-NEGOTIABLE — this is what makes a
   delivered build reviewable).** Built features are not "done" until the human can
   verify them, one per feature:
   - Each delivered feature must be its own board task (granularity guard, step 1). If
     an autonomous / batch build delivered many features under one umbrella task,
     **decompose it now** — the retroactive procedure in
     `.claude/framework/agent_docs/verify-handback.md` (create one task per feature in
     the **Verify** section, carrying its use-cases).
   - Run `/test` so the Tester emits the verify-handback seed per task
     (`.claude/console/verify/<TASK-ID>.json`, `items[]` = use-cases, gated on
     `.claude/console/` existing). A consumer's verify UI then renders one Verify story
     per feature for the human to accept or flag-as-bug.
   Skipping this leaves the human a pile of code with no per-feature acceptance surface
   — the exact failure this step prevents.
