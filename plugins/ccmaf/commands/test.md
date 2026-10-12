---
description: Test Ready-for-Test tasks against their plan specs; emit verify seeds; receipt returns (CCMAF v2)
---
# /ccmaf:test

**Context check:** `.claude/.framework-version` must contain
`FRAMEWORK_LINE=v2`; otherwise say so in one line and stop (v1 → bundled
`/test` or migrate).

1. Find tasks marked "Ready for Test" in `.claude/TASKS.md`.
2. Delegate testing to the `ccmaf:tester` subagent (bare `tester` if the
   namespaced type doesn't resolve):
   "Test [TASK-XXX]: [description].
   **Spec first (v2):** read `.claude/specs/TASK-XXX.md` — the plan-authored
   acceptance. Your PRIMARY job is exercising THAT spec (its named test
   files/scripts, its prose acceptance items) against the implementation.
   The implementer did not author it — your green is independent.
   Contract: [include the relevant contract from ECOSYSTEM.md]
   Check GOTCHAS.md for known issues in this area.
   Write additional tests at the appropriate layer for what changed.
   **Evidence rules:** user-facing work → drive the RUNNING route/UI
   journey with real input events (Playwright locator actions,
   user-event, keyboard), not `.click()`/`dispatchEvent`; curl is not a
   UI test. Fault-inject every guard: break it and confirm a test goes
   red; a check that cannot fail is not a check. Type-check = the
   project's full script (`npm run type-check` / `tsc -b`), never bare
   `tsc --noEmit` on a references-only tsconfig; trust project lint
   scripts over IDE diagnostics. **Flake triage:** a failure outside the
   task's diff → re-run that test/module alone, then the full suite once.
   Green both = flake: log it (test name + conditions) in
   test-findings.md, don't fix it here. Red alone = real defect. No
   further retry-until-green.
   Write findings to .claude/test-findings.md (NOT review-findings.md).
   Do NOT commit (RED-LINE §7) — leave your test files in the working tree
   and list their paths in your RETURN; the orchestrator commits them.
   **Verify handback (${CLAUDE_PLUGIN_ROOT}/agent_docs/verify-handback.md):**
   if the task passes, EMIT the seed — `.claude/console/verify/<TASK-ID>.json`,
   `items[]` = the task's use-cases (every `verdict: pending`). GATED on
   `.claude/console/` existing (absent → skip, zero coupling). WRITE-ONCE —
   never overwrite an existing seed (it holds the human's verdicts).
   Update TASKS.md: passing → **Verify** (the human-acceptance stage — NOT
   Done); bugs found → back to In Progress. Update STATUS.md.
   Mark anything unverified: [GAP] / [ASSUMED] / [INFERRED].
   RETURN (a receipt, ~200 words): verdict (pass / fail / partial), the
   suite numbers YOU observed (pass/fail/skip counts — not adjectives, not
   the implementer's claim) with the runner's literal pass line pasted,
   workspace totals summed per package, SKIP counted as not run; spec
   items exercised vs total, top findings, gaps. Numeric claims you
   can't paste a line for (coverage, mutation) cite a committed log.
   Full detail goes to test-findings.md, not the return."

3. POST-DELEGATION VERIFICATION (diff-based):
   a. `git diff --stat -- .claude/TASKS.md .claude/STATUS.md .claude/claude-progress.txt`
      + changed hunks only: passing tasks → Verify (NOT Done), failing →
      In Progress; STATUS current; progress entry present. Fix gaps
      yourself from the receipt.
   b. **Commit linkage:** `git log --oneline -E --grep='TASK-XXX([^0-9]|$)' -- . ':(exclude).claude'`
      — a task cannot advance to Verify without an implementation commit
      (ID-less merge commits are fine; one ID-carrying commit is the bar).
      A receipt claiming work LANDED on a branch: confirm with
      `git merge-base --is-ancestor <commit> <branch>`.
   c. **Seed check:** `.claude/console/` exists → confirm each passing
      task's `verify/<TASK-ID>.json` exists; missing → emit it yourself
      (write-once). Absent console dir → correctly skipped.
   d. **Findings-file check:** `.claude/test-findings.md` gained a
      date-stamped section for this run; missing → persist the receipt's
      findings there yourself (prepend, no dedup).
4. Commit the tester's test files (the explicit paths its receipt lists,
   `git add -- <paths> && git commit -m "test: … (TASK-XXX)" -- <paths>`)
   and the state updates (task/bug ID). Report the receipt's verdict +
   numbers to the user.
