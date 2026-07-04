Follow the Cold Start sequence (steps 0-9 from CLAUDE.framework.md — the canonical list lives there; CLAUDE.md merely @imports it).

Then:

1. Pick the highest-priority unblocked task from TASKS.md.
   If TASKS.md has no tasks, tell the user: "No tasks found. Run /analyse
   and /plan first to create the spec, contracts, and task breakdown."
   **Granularity guard:** if the picked task actually bundles several
   independently-verifiable features, STOP and decompose it first — one board task
   per feature (see `.claude/framework/agent_docs/verify-handback.md`). Do NOT build
   one umbrella task covering many features; that destroys the per-feature review surface.
   **Move it to In Progress now, before any code changes** — Todo → In Progress
   in TASKS.md (Blocked instead if you discover a blocker before you can start).
   Subagents don't make this move themselves (RED-LINES, behavioral-principles.md
   §7); the main session does it here, symmetric with the Ready-for-Review check
   in step 5a below.
2. Estimate the task's token cost against the current context window
3. If current usage + estimated cost >= 90%, ask the user:
   "Context is at X%. This task will need ~YK tokens (Z% projected).
   Would you like to: 1) Proceed anyway 2) Prepare for compaction 3) Start a fresh session"
   If "prepare": save all state files, commit, tell user to /compact and wait.
   If "fresh session": save all state files, commit, tell user to start a new session.
   If user says "proceed" after compacting: re-read state files first.

4. Route, then delegate using the Task tool. Route to the **ui-designer**
   subagent when the task creates or meaningfully changes user-facing UI
   (screens, components, styling passes, interaction flows); the
   **developer** subagent otherwise. Brief (fill every bracket; drop none):
   "Implement [TASK-XXX]: [description].
   Contract: [read and include the relevant contract from ECOSYSTEM.md, or the matching file in `contracts/` if the project uses per-file contracts — see CLAUDE.md]
   Check GOTCHAS.md for: [relevant area]
   Acceptance: [name the artefact's REAL consumer and the check that
   proves it works for them — e.g. 'endpoint returns the contract shape
   the console renders', never a proxy like 'the build passes']. Do not
   declare success on lenient checks alone.
   Treat any anomaly (counts that don't reconcile, warnings you want to
   call pre-existing, identical outputs across different cases) as a
   defect hypothesis to investigate before declaring success.
   Mark anything you couldn't verify inline: [GAP] / [ASSUMED] /
   [INFERRED] (behavioral-principles.md §4) — a named gap beats a
   fabricated fact.
   Commit after each milestone. When done, update TASKS.md (move to
   Ready for Review), STATUS.md, and claude-progress.txt.
   RETURN: ~200 words — what shipped, how the acceptance check was
   exercised (numbers, not adjectives), assumptions and gaps. Your
   return is data for this session, not a user-facing message."

   **Parallel dispatch (two+ implementation subagents in one wave):**
   every brief additionally gets an explicit ownership manifest — "You
   OWN [paths] (may write); you CONSUME [paths] (read, never modify)" —
   with disjoint OWN sets across the wave (state-file rules per
   behavioral-principles.md §8). When the wave completes and BEFORE
   review, run the **reconciler** subagent in `scoped` mode across the
   wave's boundaries (give it each builder's OWN manifest and the
   contracts between them — the same input seam-checker used); route
   each violation back to its owning builder for a targeted fix, bounded
   to 2 rounds, then fall through to review regardless. This is the
   wave-merge instance of reconciler `scoped` mode — the same mode a
   human or the orchestrator can invoke directly via `/reconcile` between
   waves (nudged by doctor Check 14's reconcile-due nag); the wave case
   just supplies the delta as an explicit manifest instead of a
   watermark diff. `/review` and `/test` do not fire `/reconcile`
   automatically.

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
