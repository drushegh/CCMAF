---
description: THIN build loop — dispatch against plan specs with budgets, receipts, integration gate, staged review (CCMAF v2)
---
# /ccmaf:build — the thin build loop

**Context check:** `.claude/.framework-version` must contain
`FRAMEWORK_LINE=v2`; if the file exists without it this is a v1 project —
use the bundled `/build` or migrate.

The v2 shape: the plan carries the judgement (specs, budgets); this loop
dispatches, verifies cheaply, gates on machine booleans, and never estimates
what hooks measure. Unattended (`CLAUDE_UNATTENDED=1`) policies apply
throughout (digest banner + `agent_docs/OPERATIONS.md`).

1. **Pick the highest-priority unblocked task** from `.claude/TASKS.md`.
   None → tell the user: "No tasks found. Run /ccmaf:analyse and /ccmaf:plan
   first." **Granularity guard:** a task bundling several independently-
   verifiable features gets decomposed BEFORE building (one task per feature
   — `${CLAUDE_PLUGIN_ROOT}/agent_docs/verify-handback.md`). **Move it Todo →
   In Progress now, before any code changes** (Blocked instead if a blocker
   surfaces). Subagents never move board entries; the main session does.

2. **Context capacity is the watermark hook's concern, not yours** (§5.7 —
   the token-estimation steps are deliberately gone). If the checkpoint-
   watermark nudge has fired at its high mark: flush a `## WIP` checkpoint
   and compact — attended, say so first; unattended, do it and log.

3. **Dispatch.** Route UI-facing tasks to `ccmaf:ui-designer`, everything
   else to `ccmaf:developer` (bare role name if the namespaced type doesn't
   resolve). **Before the Agent() call**, arm the budget counter:
   `printf 'class=<S|M|L from the board entry>\n' > .claude/telemetry/.task-dispatch.TASK-XXX`
   (default M if the entry lacks a Budget field). Brief (fill every bracket;
   drop none):

   "Implement [TASK-XXX]: [description].
   Spec: read `.claude/specs/TASK-XXX.md` — this is your acceptance. You
   implement AGAINST it; you never edit its assertions. Green means the
   spec passes, not that your own checks pass.
   Contract: [include the relevant contract from ECOSYSTEM.md]
   Check GOTCHAS.md for: [relevant area]
   Budget: [class] ≈ [30|60|120] tool calls. TRACK YOUR OWN call count — a
   counter hook MAY additionally nag you, but hook visibility inside a
   dispatch is harness-dependent (falsified live on the interactive
   desktop path 2026-08-10, and a worker confabulated the promised nag):
   never rely on a nag arriving, and never report one you did not verbatim
   receive. At budget without green acceptance: STOP — write findings to
   `.claude/review-findings.md` scratch section, return
   `blocked: <one-line question>`.
   Treat any anomaly (counts that don't reconcile, warnings you want to
   call pre-existing, identical outputs across different cases) as a
   defect hypothesis to investigate before declaring success. Mark
   anything unverified: [GAP] / [ASSUMED] / [INFERRED].
   Commit after each milestone (`type: description (TASK-XXX)`). Move the
   task to Ready for Review in TASKS.md when done.
   RETURN: ~200 words — what shipped, how the SPEC was exercised (numbers,
   not adjectives), assumptions and gaps. Your return is data, not a
   user-facing message."

   Optional attestation (plan header `attest: true`): append the snippet
   from `${CLAUDE_PLUGIN_ROOT}/agent_docs/attestation.md`.

   **Parallel dispatch (2+ workers in one wave):** every brief additionally
   gets an ownership manifest — "You OWN [paths] (may write); you CONSUME
   [paths] (read, never modify)" — with disjoint OWN sets. One
   `.task-dispatch.<ID>` marker per task. **Budget caveat while parallel:**
   PostToolUse events carry no per-task attribution, so every armed task's
   counter counts the whole session's calls — parallel budgets are
   session-shared and CONSERVATIVE (nags fire early, never late); treat a
   parallel-wave nag as "the wave is over budget", judged per task at
   return time. When the wave completes and BEFORE review, run
   `ccmaf:reconciler` in `scoped` mode across the wave's boundaries; route
   violations back to owning builders, bounded to 2 rounds.

4. **On return, AUDIT the budget, then disarm.** The Agent result line
   reports the worker's actual tool-use count — that is the authoritative
   budget signal (subagent calls may not feed the session counter, so
   `.task-count.TASK-XXX` can undercount a dispatch; acceptance-walk
   finding 2026-08-10). Reported count over the class budget without a
   `blocked:` return → record "over-budget: N/[budget]" on the board entry;
   a repeat offender is a split-this-task signal for the next /ccmaf:plan.
   Then disarm:
   `rm -f .claude/telemetry/.task-dispatch.TASK-XXX .claude/telemetry/.task-count.TASK-XXX`.
   A `blocked: <question>` return → move the task to Blocked with the
   question written into its board entry; unattended, pick the next task
   and continue; attended, surface it.

5. **POST-DELEGATION VERIFICATION — diff-based, never full re-reads
   (§5.6):**
   a. Diff against the SESSION-START baseline, not HEAD — workers commit
      their own state updates, and a committed change is invisible to
      `git diff HEAD` (review-swarm catch). The session-start-marker hook
      recorded HEAD at session start as
      `.claude/.session-start-commit.<session_id>`:
      `BASE=$(cat .claude/.session-start-commit.* 2>/dev/null | head -1)`
      then `git status --short && git diff --stat ${BASE:-HEAD~3} -- .claude/TASKS.md .claude/STATUS.md .claude/claude-progress.txt`
      — confirm the three state files moved; read ONLY the changed hunks
      (`git diff ${BASE:-HEAD~3} -- <file>`) to check: task → Ready for
      Review; STATUS reflects the work; progress has an entry.
      Stale/missing → fix them yourself from the worker's receipt
      (expected occasionally, not an error).
   b. **Commit linkage:** `git log --oneline --grep="TASK-XXX" -- . ':(exclude).claude'`
      — at least one implementation commit carries the ID; else create the
      fixup commit now.
6. **Commit** state-file updates (task ID in the message).
7. Repeat from step 1 while unblocked tasks remain.

8. **WAVE INTEGRATION GATE (TASK-153, hard boolean).** At the end of each
   wave (or every ~3 sequential tasks):
   `bash ${CLAUDE_PLUGIN_ROOT}/scripts/integration-gate.sh` — exit 0 =
   whole-project truth (build/boot + smoke per stack; project override:
   `.claude/integration-gate.local.sh`). **Non-zero → the wave does NOT
   merge/continue:** route the one-line failure back to the owning
   worker(s), bounded to 2 fix rounds; still red → mark the wave's tasks
   Blocked with the gate line and stop the wave. Never page raw gate
   output into context — the boolean and its one line are the interface.

9. **STAGED, UNCONDITIONAL REVIEW at merge points (§5.8).** Merging on
   green tests needs no orchestrator judgement. At each merge point (end
   of wave / end of feature) run `/ccmaf:review` on the wave's diff
   REGARDLESS of test status — it catches "technically passes, spiritually
   wrong". Escaped defects feed back as NEW TEST CASES in the plan's specs
   (the ratchet) — never as "orchestrator reads more".

10. **Verify handback (NON-NEGOTIABLE).** Each delivered feature = its own
    board task (decompose retroactively if a batch bundled them — the
    procedure in `agent_docs/verify-handback.md`). Run `/ccmaf:test` so the
    Tester emits one verify seed per task (`.claude/console/verify/<ID>.json`,
    gated on `.claude/console/` existing).

11. **Batch-completion coherence gate.** After step 10 run
    `bash ${CLAUDE_PLUGIN_ROOT}/doctor/doctor.sh` and read its
    board-coherence + suffixed-ID findings: Ready-for-Review pile-ups,
    suffixed IDs, or seedless Verify tasks mean the batch left drift — clear
    via `/ccmaf:review`→`/ccmaf:test` walks or `/ccmaf:board-heal` (the
    parallel-wave/overnight case), re-run doctor, and only then report the
    build complete.
