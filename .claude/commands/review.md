Follow the Cold Start sequence (steps 0-9 from CLAUDE.framework.md — the canonical list lives there; CLAUDE.md merely @imports it).

Then:

1. Find tasks marked "Ready for Review" in TASKS.md
2. Do the pre-task context check. If projected >= 90%, ask user.
3. Before delegating, gather the file list for the task:
   Run `git log --oneline --name-only --grep="TASK-XXX"` to get all files
   touched by commits for this task.

4. Delegate review to the reviewer subagent using the Task tool:
   "Review [TASK-XXX]: [description].
   Files changed: [list the specific files from the git log above]
   Contract: [read and include the relevant contract from ECOSYSTEM.md, or the matching file in `contracts/` if the project uses per-file contracts — see CLAUDE.md]
   Conventions: read .claude/framework/agent_docs/code-conventions.md
   Check GOTCHAS.md for known issues in this area.
   Return your findings in the output format specified in your instructions."

   The reviewer runs in a clean context window with no memory of the
   developer's session. Passing the file list ensures it reviews the
   right code without needing to search for it.

5. When the subagent returns its findings (the Reviewer is read-only —
   ALL file writes happen here in main context, not in the subagent):
   - **FIRST, before acting on anything:** persist the findings block
     verbatim to .claude/review-findings.md as a date-stamped section
     (`## YYYY-MM-DD — TASK-XXX`) prepended at the top. This step is
     mandatory, not best-effort — returned text that isn't persisted is
     lost at session end (2026-06-12 cross-project review finding). Prepend
     WITHOUT reading or deduping against existing sections (anchoring,
     BUG-001); /healthcheck rotation and /housekeeping handle growth.
   - **SECOND, verify before acting (P0/P1 findings):** delegate the
     P0/P1 findings as claims to the **verifier** subagent (fresh
     context — never the reviewer that produced them; the agent that
     produced a claim does not verify it). Append its
     CONFIRMED/REFUTED/DOWNGRADED verdicts to the persisted findings
     section. Then: act on CONFIRMED as reported; act on DOWNGRADED at
     the downgraded severity; REFUTED findings move no tasks and file
     no bugs (keep them in the findings file with the refutation —
     they calibrate the Reviewer). P2/P3 findings may be acted on
     unverified but are marked `[UNVERIFIED]` wherever persisted.
   - Update TASKS.md: move to Ready for Test if approved, back to In Progress if issues found
   - Update STATUS.md with review status
   - If critical issues, create new bug entries in the Bug-Fix Lane of TASKS.md
   - If the subagent found gotchas, add them to GOTCHAS.md
   - Update claude-progress.txt
   - **Commit linkage check:** Verify `git log --oneline --grep="TASK-XXX"`
     returns at least one commit for the reviewed task before moving it forward.
   - Commit all state file updates (include task ID)
   - Report the review summary to the user

6. **UI-facing changes get a UX pass too.** If the reviewed change is
   something a human will look at and click through (screens,
   components, styling, flows), also delegate a **ux-critic** pass
   (cognitive walkthroughs with friction counts + rendered rubric
   scoring) and persist its return to .claude/review-findings.md under
   the same dated section. Code review alone does not move user-facing
   work to Ready for Test; a REJECT verdict from the ux-critic sends
   the task back to In Progress exactly like a critical code finding.
