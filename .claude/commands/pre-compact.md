Prepare for a MANUAL `/compact` — flush your in-context working-set to disk so the
compaction summary can't lose anything load-bearing. This is the lightweight, **in-session**
counterpart to `/wrapup`: NOT a session-end (no commit/push ceremony, no instinct-miner, no
memory sweep) — the session continues right after you `/compact`.

**Do NOT stop the project's Console** — the session is continuing; only `/wrapup` tears it
down.

Run in order:

1. **Flush the working-set to `claude-progress.txt`'s `## WIP` section** — the load-bearing
   step. Capture, in enough detail that a fresh window could resume from disk alone:
   - the current task (ID) + what's done so far + the immediate next step;
   - key in-flight decisions and the files you're mid-change on;
   - anything that currently lives ONLY in the conversation (not yet on disk).
2. **If the project uses the orchestrator-state pattern** (`.claude/NOW.md` and/or
   `.claude/GROUND-TRUTH.md` already exist — see
   `.claude/framework/agent_docs/orchestrator-state.md`), bring them current before compacting:
   rewrite `NOW.md`'s in-flight section (delegated work + what it owns, next actions in order,
   open asks) and add any new fact to `GROUND-TRUTH.md` — quote it, don't paraphrase. **If
   neither file exists, don't create them here** — a manual compact doesn't establish the
   pattern on its own. Suggest creating `NOW.md` once, only if this session's in-flight
   orchestration state (delegated subagents, open asks) is non-trivial and would otherwise live
   only in the WIP prose above; never repeat the suggestion within a session.
3. **Update STATUS.md "Active Work"** if it's stale — it should reflect what's in-flight
   *right now*, not an hour ago.
4. **Make in-flight work reconcilable:** run `git status --short`. Uncommitted changes are
   fine (a manual compact stays in-session) AS LONG AS each is either (a) captured in the WIP
   above or (b) visible to `git diff` — `/post-compact` rebuilds from both. You do NOT need to
   commit (that's `/wrapup`'s job); just make sure nothing load-bearing lives solely in context.
5. Do NOT run the full `/wrapup` checks (instinct-miner, memory sweep, decisions audit) — this
   is a Checkpoint, not a Handoff.

Then output one line: `✓ Flushed to disk — safe to /compact. Run /post-compact afterwards.`
