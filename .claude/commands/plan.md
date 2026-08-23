Follow the Cold Start sequence (canonical list in CLAUDE.framework.md — CLAUDE.md merely @imports it).

> **Step 0 — v2 self-route (read this first):** if `.claude/.framework-version` contains a
> `FRAMEWORK_LINE=v2` line, this project runs the CCMAF v2 plugins — invoke the
> `ccmaf:plan` skill (Skill tool) and follow IT instead of this file; stop reading
> here. This bare command is the v1-line copy, kept as authored source.

Then, acting as the project architect:

1. Do the pre-task context check. If projected >= 90%, ask user.
2. Read the relevant spec from .claude/framework/docs/specs/ (produced by /analyse)
   - If no spec exists yet, ask the user whether to run /analyse first
     or proceed with planning from the requirements directly
3. Design contracts and write them to ECOSYSTEM.md (or per-file `contracts/`, per project CLAUDE.md)
4. Break work into tasks in TASKS.md with lifecycle statuses, priorities, and dependencies.
   **Granularity: one board task per user story / feature** — not one umbrella task. Each
   task carries that story's acceptance criteria / use-cases (they become the verify
   checklist later). Split anything the human could accept-or-reject independently into
   its own task. This 1:1 story→task mapping is what lets each feature become a reviewable
   Verify story on handback — see `.claude/framework/agent_docs/verify-handback.md`.
5. Record all decisions with rationale — in DECISIONS.md (or per-file `decisions/`, per project CLAUDE.md)
6. Write a plan to .claude/framework/docs/plans/
7. Do NOT write production code
8. Update STATUS.md and claude-progress.txt when done

This work is lightweight — it stays in main context. Do not delegate to a subagent.
