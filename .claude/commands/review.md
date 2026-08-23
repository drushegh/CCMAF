Follow the Cold Start sequence (canonical list in CLAUDE.framework.md — CLAUDE.md merely @imports it).

> **Step 0 — v2 self-route (read this first):** if `.claude/.framework-version` contains a
> `FRAMEWORK_LINE=v2` line, this project runs the CCMAF v2 plugins — invoke the
> `ccmaf:review` skill (Skill tool) and follow IT instead of this file; stop reading
> here. This bare command is the v1-line copy, kept as authored source.

Then:

1. Find tasks marked "Ready for Review" in TASKS.md
2. Do the pre-task context check. If projected >= 90%, ask user.
3. Before delegating, gather the file list for the task:
   Run `git log --oneline --name-only --grep="TASK-XXX" -- . ':(exclude).claude'` to get all files
   touched by commits for this task (excludes framework bookkeeping paths so the
   reviewer gets code changes, not state-file updates).

   **Watcher mode (open-model cross-check — TASK-132).** If a `watcher-*` mode is active
   (`.claude/advisors.toml` `[modes] active`), an open (codex) model cross-checks the Claude
   reviewer. Launch it NOW, in the BACKGROUND (Bash `run_in_background: true`) so it runs
   concurrently and its own timeout — not the Bash 600s cap — bounds it:
   `bash .claude/framework/advisors/watcher.sh reviewer TASK-XXX`.
   It is a silent no-op in `normal` mode (prints `WATCHER reviewer - NONE`, exit 0), so this line
   is safe to run unconditionally — skip it only if you already know the mode is `normal`. Collect
   its result in step 5. (See `.claude/framework/advisors/PROTOCOL.md` "Watcher mode": augment,
   never replace; advisory roles only; evidence-verifier fail-closed; client-attested.)

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
   - **Watcher cross-check (watcher mode only):** if you launched a reviewer-watcher in
     step 3, read `_advisors/watch-<task>-reviewer/RESULT.md` once the background job finishes.
     - **PASS** (a finding): compile a CROSS-CHECK against the Claude findings — mark each issue
       `[both]` (Claude + codex both flagged it → high confidence), `[claude-only]`, or
       `[codex-only]`. Persist the watcher finding + the cross-check under the SAME dated section,
       labelled with the advisor + `client-attested`. A `[codex-only]` P0/P1 is a **claim to
       VERIFY** (feed it into the verify step below), NOT an auto task-mover — the Claude reviewer
       + hooks stay the enforcement plane.
     - **DEGRADED / NONE:** note it in one line ("reviewer-watcher degraded: <reason>" / "normal
       mode") and proceed on the Claude reviewer alone. Augment adds signal; it never blocks.
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
     - **Watcher mode:** if the active mode also assigns a `verifier` watcher, write the P0/P1
       claims (including any `[codex-only]` findings from the cross-check) to a temp file and run,
       in the BACKGROUND, `bash .claude/framework/advisors/watcher.sh verifier TASK-XXX <claims-file>`.
       Record its CONFIRMED/REFUTED/UNVERIFIABLE verdicts alongside the Claude verifier's. Where
       they AGREE, confidence is high; where they DISAGREE, surface it — do NOT auto-resolve, and
       the **Claude verifier's verdict governs the task move** (the codex verifier is client-attested
       and evidence-bounded — a cross-check, not the gate).
   - Update TASKS.md: move to Ready for Test if approved, back to In Progress if issues found
   - Update STATUS.md with review status
   - If critical issues, create new bug entries in the Bug-Fix Lane of TASKS.md
   - If the subagent found gotchas, add them to GOTCHAS.md
   - Update claude-progress.txt
   - **Commit linkage check:** Verify `git log --oneline --grep="TASK-XXX" -- . ':(exclude).claude'`
     returns at least one commit for the reviewed task before moving it forward
     (excludes framework bookkeeping commits).
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
