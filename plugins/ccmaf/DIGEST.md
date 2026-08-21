# CCMAF v2 — standing session rules

This project runs the CCMAF framework (v2, plugin-served; ccmaf-kernel is the
safety floor). This digest is the always-loaded discipline. Per-workflow detail
lives in the `/ccmaf:*` command runbooks (loaded on invocation); cross-cutting
reference (hook profiles, permission gating, code-quality rules, MCP guidance,
unattended policies) in `${CLAUDE_PLUGIN_ROOT}/agent_docs/OPERATIONS.md` — read
it when those areas come up, not preemptively.

## State files (NON-NEGOTIABLE)

- `.claude/TASKS.md` — update whenever a task status changes. Entries are
  bracketed level-4 headings `#### [TASK-N] Title`; preserve heading levels,
  bracketed IDs, `**Field:**` markers, and `·` separators exactly.
- `.claude/STATUS.md` — claim work at session start, record results at end.
- `.claude/claude-progress.txt` — session summary at end; flush a `## WIP`
  section at natural checkpoints (the load-bearing habit — a compaction can
  only lose what disk doesn't hold).
- Significant decisions → `.claude/DECISIONS.md` with rationale. Contract
  changes → `.claude/ECOSYSTEM.md` FIRST (prose AND machine-readable blocks).
  No hook enforces these two — treat them as equally binding.
- The Stop hook blocks session end without TASKS/STATUS/progress updates.

## Commits

- Every commit carries the task/bug ID: `type: description (TASK-XXX)`.
- No task reaches Ready for Review or Done without a linked commit.

## Agents

- Architect plans · Developer implements · Tester tests · Reviewer reviews.
  Supporting: verifier (confirms claims), researcher (cited evidence),
  ui-designer / ux-critic (UI), reconciler (horizontal audit). Spawn as
  `ccmaf:<role>`; fall back to the bare role name if that doesn't resolve.
- The agent that writes code never reviews it; the agent that made a claim
  never verifies it.
- Contract mismatch → STOP and flag it. Tightening inline is fine; widening
  escalates to the Architect.

## Verify handback

- One board task per user story/feature — never bundle features in one task.
- On Ready for Test, emit a verify seed `.claude/console/verify/<ID>.json`
  (only when `.claude/console/` exists; write-once). Human verdicts move
  Verify → Done.

## Session lifecycle

- Disk is the source of truth. Checkpoint (WIP flush) at breakpoints;
  `/ccmaf:wrapup` is the handoff (externalise, commit, push). Cold start
  rehydrates from disk. After any compaction, RECONCILE: re-read state files
  and `git status`/`git diff` against the lossy summary — disk wins for
  committed facts, the summary only covers in-flight work.
- Context: the watermark hook measures — never estimate token costs yourself.
  At its high-watermark nudge: checkpoint, then compact.

## Budgets

- Every dispatched task carries a tool-call budget (S≈30 · M≈60 · L≈120);
  the counter hook nags at half and at breach. On breach: stop, write
  findings to disk, return `blocked: <one-line question>`. Unattended: log
  the question, mark the task Blocked, move to the next task.

## Cold start (after this digest, the check table, and the boot view)

1. Handle raised flags — attended: ONE batched AskUserQuestion covering all
   of them; unattended (`CLAUDE_UNATTENDED=1`): log, don't ask.
   Doctor-CRITICAL always blocks until resolved.
2. `git pull --ff-only` — on non-fast-forward, stop and surface it; never
   merge or rebase blind.
3. If the project app should run: `bash ${CLAUDE_PLUGIN_ROOT}/scripts/start-project.sh`.
4. Pick the highest-priority unblocked task from the board; check
   `.claude/GOTCHAS.md` for entries in that area.
