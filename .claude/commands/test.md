Follow the Cold Start sequence (canonical list in CLAUDE.framework.md — CLAUDE.md merely @imports it).

Then:

1. Find tasks marked "Ready for Test" in TASKS.md
2. Do the pre-task context check. If projected >= 90%, ask user.
3. Delegate testing to the tester subagent using the Task tool:
   "Test [TASK-XXX]: [description].
   Contract: [read and include the relevant contract from ECOSYSTEM.md, or the matching file in `contracts/` if the project uses per-file contracts — see CLAUDE.md]
   Check GOTCHAS.md for known issues in this area.
   Write tests at the appropriate layer for what changed.
   Write findings to .claude/test-findings.md (NOT review-findings.md).
   Commit test files with task ID linkage.
   **Verify handback (per .claude/framework/agent_docs/verify-handback.md):** if the task
   passes, EMIT the verify-handback seed — write `.claude/console/verify/<TASK-ID>.json`
   with `items[]` = the task's use-cases / acceptance criteria (every `verdict: pending`).
   GATED on `.claude/console/` existing (absent → skip, zero coupling). WRITE-ONCE — never
   overwrite an existing seed (it holds the human's verdicts).
   Update TASKS.md: move to **Verify** if passing (the human-acceptance stage — NOT Done;
   the human accepts it in Verify, then it goes to Done), back to In Progress if bugs found.
   Update STATUS.md with test results.
   Mark anything you couldn't verify inline: [GAP] / [ASSUMED] / [INFERRED]
   (behavioral-principles.md §4).
   RETURN: ~200 words — tests added/changed, the suite numbers YOU observed
   (pass/fail/skip counts, not adjectives, not the implementer's claim),
   findings summary, gaps. Your return is data for this session, not a
   user-facing message."

4. POST-DELEGATION VERIFICATION (mandatory — subagents may not update
   state files reliably):
   a. Read TASKS.md — did passing tasks move to "Verify" (NOT Done — Done is the human's
   call after acceptance), and failing ones back to "In Progress"?
   b. Read STATUS.md — does it reflect test results?
   c. Read claude-progress.txt — is there a session entry?
   d. **Commit linkage check:** verify `git log --oneline --grep="TASK-XXX" -- . ':(exclude).claude'` returns at
   least one commit for the implementation (excludes framework bookkeeping commits). A task cannot advance to Verify without one.
   e. **Seed check:** if `.claude/console/` exists, confirm
   `.claude/console/verify/<TASK-ID>.json` was written for each passing task (`items[]` =
   use-cases). If missing, emit it yourself per verify-handback.md (write-once). If
   `.claude/console/` is absent, skip — that's correct (zero coupling).
   f. **Findings-file check:** confirm .claude/test-findings.md gained a
   date-stamped section for this run (the Tester self-persists, but that
   Write is not guaranteed in every harness). If missing, persist the
   subagent's returned findings there yourself — prepend, no reading or
   deduping of existing sections (same rules as review-findings.md).
   g. If ANY state files are missing, update them yourself from the subagent's output.
5. Commit all state file updates (include task/bug ID). Report test results to the user.
