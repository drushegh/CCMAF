---
description: FAT planning — contracts, 1:1 story tasks, per-task acceptance specs + budget classes (CCMAF v2)
---
# /ccmaf:plan — the fat plan

**Context check:** `.claude/.framework-version` must contain
`FRAMEWORK_LINE=v2`; if the file exists without it, this is a v1 project —
use the bundled `/plan` or migrate. Otherwise run `/ccmaf:init` first.

The v2 principle (HANDOVER §5.4): **orchestration intelligence lives in the
plan artifact.** The plan carries the judgement — acceptance specs, budgets,
contracts — so dispatch briefs and the orchestrator stay thin, and **workers
implement against tests they did not author**: "green" means "matches the
spec", never "matches what I built".

Acting as the project architect (this work stays in main context — do not
delegate it):

1. Read the relevant spec from the project's `docs/` (produced by
   `/ccmaf:analyse`). If none exists, ask the user whether to run
   `/ccmaf:analyse` first or plan from requirements directly (unattended:
   plan from requirements, log the choice).
2. Design contracts and write them to `.claude/ECOSYSTEM.md` FIRST — prose
   AND machine-readable `<!-- contract:ID -->` blocks.
3. Break work into board tasks in `.claude/TASKS.md`. **Granularity: one
   board task per user story / feature** — never an umbrella task. Each task
   carries that story's acceptance criteria (they become the human verify
   checklist). Split anything the human could accept-or-reject independently
   into its own task. (`${CLAUDE_PLUGIN_ROOT}/agent_docs/verify-handback.md`.)
4. **Per-task acceptance spec (the fat-plan step, NON-NEGOTIABLE):** for each
   task write `.claude/specs/TASK-N.md`:
   - **Executable where the stack allows:** name the test file/script the
     worker must make pass (write the test skeleton yourself when cheap —
     the worker fills implementation, never edits the spec's assertions).
   - Otherwise a **prose acceptance list**: numbered, each item naming the
     REAL consumer of the artefact and the check proving it works for them
     (e.g. "endpoint returns the contract shape the console renders") —
     never a proxy like "the build passes".
   - Reference the spec from the board entry: `**Spec:** .claude/specs/TASK-N.md`.
5. **Per-task budget class (TASK-152):** add `**Budget:** S|M|L` to each
   board entry (S≈30 · M≈60 · L≈120 tool calls). Calibrate by scope: S =
   one-file fix; M = typical feature; L = cross-module feature. /ccmaf:build
   enforces these via the counter hook.
6. Record decisions with rationale in `.claude/DECISIONS.md`.
7. Optional quality pass: if the advisors plugin is installed (the
   `/advisors:consult` skill resolves) and the plan is high-stakes, run a
   spec review consult; fold verdicts in. Absent → skip with a note.
8. Do NOT write production code.
9. Update `.claude/STATUS.md` and `.claude/claude-progress.txt`; commit the
   plan (`docs: plan <scope> (TASK-XXX..YYY)`).
