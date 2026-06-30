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
2. **Update STATUS.md "Active Work"** if it's stale — it should reflect what's in-flight
   *right now*, not an hour ago.
3. **Make in-flight work reconcilable:** run `git status --short`. Uncommitted changes are
   fine (a manual compact stays in-session) AS LONG AS each is either (a) captured in the WIP
   above or (b) visible to `git diff` — `/post-compact` rebuilds from both. You do NOT need to
   commit (that's `/wrapup`'s job); just make sure nothing load-bearing lives solely in context.
4. Do NOT run the full `/wrapup` checks (instinct-miner, memory sweep, decisions audit) — this
   is a Checkpoint, not a Handoff.

Then output one line: `✓ Flushed to disk — safe to /compact. Run /post-compact afterwards.`
