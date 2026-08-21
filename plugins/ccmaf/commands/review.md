---
description: Review Ready-for-Review tasks — receipts to the orchestrator, findings to disk, verified before acted on (CCMAF v2)
---
# /ccmaf:review

**Context check:** `.claude/.framework-version` must contain
`FRAMEWORK_LINE=v2`; otherwise say so in one line and stop (v1 → bundled
`/review` or migrate).

1. Find tasks marked "Ready for Review" in `.claude/TASKS.md` (or review the
   wave diff when invoked from /ccmaf:build step 9 — same flow, task list =
   the wave).
2. Gather the file list:
   `git log --oneline --name-only --grep="TASK-XXX" -- . ':(exclude).claude'`.

3. **Watcher mode (advisors plugin, double-gated).** Run the codex
   cross-check ONLY when BOTH hold: (a) a registry exists
   (`.claude/advisors.toml`, else `~/.claude/advisors.toml`) with
   `[modes] active = "watcher-*"`; (b) the advisors plugin is installed —
   `timeout 10 claude plugin list --json` shows `advisors@ccmaf` enabled;
   take its `installPath` from that JSON. Then launch in the BACKGROUND:
   `bash <installPath>/scripts/watcher.sh reviewer TASK-XXX`.
   Either gate failing → skip with a one-line note ("watcher: not
   configured / plugin absent") and proceed Claude-only. Augment adds
   signal; it never blocks.

4. Delegate to the `ccmaf:reviewer` subagent (bare `reviewer` fallback):
   "Review [TASK-XXX]: [description].
   Files changed: [the git-log list]
   Spec: `.claude/specs/TASK-XXX.md` — review against the plan's
   acceptance, not just general quality.
   Contract: [include the relevant contract from ECOSYSTEM.md]
   Conventions: read docs/code-conventions.md (project-owned; scaffolded by
   /ccmaf:init)
   Check GOTCHAS.md for known issues in this area.
   RETURN: your findings in your instructed output format, prefaced by a
   3-line RECEIPT: verdict (approve / issues), top-3 issues with
   severities, count by severity. The findings block is data to persist,
   not a user-facing message."

5. When the reviewer returns (it is read-only — ALL writes happen here):
   - **FIRST:** persist the findings block verbatim to
     `.claude/review-findings.md` as a date-stamped section prepended at
     the top — no reading or deduping of existing sections.
   - **Watcher cross-check** (if launched): read
     `_advisors/watch-<task>-reviewer/RESULT.md` when the background job
     finishes. PASS → compile the cross-check (`[both]` / `[claude-only]` /
     `[codex-only]`; persist under the same dated section, labelled
     `client-attested`); a `[codex-only]` P0/P1 is a claim to VERIFY, never
     an auto task-mover. DEGRADED/NONE → one-line note, proceed.
   - **Verify before acting (P0/P1):** delegate P0/P1 findings as claims to
     `ccmaf:verifier` (fresh context — never the reviewer that produced
     them). Append CONFIRMED/REFUTED/DOWNGRADED verdicts to the persisted
     section. Act on CONFIRMED as reported, DOWNGRADED at the new severity;
     REFUTED move no tasks (keep with refutation — it calibrates the
     reviewer). P2/P3 may be acted on unverified, marked `[UNVERIFIED]`.
     (Watcher verifier seat: same double-gate as step 3, role `verifier`,
     claims file as third arg; disagreement is surfaced, never
     auto-resolved — the Claude verdict governs the move.)
   - Update TASKS.md (approved → Ready for Test; issues → In Progress),
     STATUS.md, GOTCHAS.md (new gotchas), claude-progress.txt; critical
     issues → Bug-Fix Lane entries.
   - **Escaped-defect ratchet (§5.8):** any confirmed finding that tests
     SHOULD have caught becomes a new test case in the task's
     `.claude/specs/` file — the plan learns; the orchestrator does not
     start reading more.
   - Commit linkage check, then commit state updates (task ID).
   - Report the RECEIPT (verdict + top-3 + counts) to the user — detail
     stays on disk, pulled on demand.

6. **UI-facing changes also get a `ccmaf:ux-critic` pass** (cognitive
   walkthroughs + rendered rubric); persist under the same dated section.
   Code review alone never moves user-facing work forward; a REJECT sends
   the task back to In Progress like a critical code finding.
