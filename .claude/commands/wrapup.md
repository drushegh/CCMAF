Run the /wrapup sequence before ending a session (end of day, PC ↔ laptop switch, fresh-context restart).

> **Step 0 — v2 self-route (read this first):** if `.claude/.framework-version` contains a
> `FRAMEWORK_LINE=v2` line, this project runs the CCMAF v2 plugins — invoke the
> `ccmaf:wrapup` skill (Skill tool) and follow IT instead of this file; stop reading
> here. This bare command is the v1-line copy, kept as authored source.

**Goal:** flush everything in *your current context window* to disk so nothing is lost on the next cold start. Cheaper to surface a risk now than to re-derive context tomorrow.

This is the **Handoff** in the session-lifecycle model (CLAUDE.framework.md "Session Lifecycle"): externalise → commit → **push**. The push is what makes a cold-start Rehydrate on another machine correct — *no push = no handoff*. (Contrast: a mid-run **Checkpoint** flushes the in-flight working-set to `claude-progress.txt`'s `## WIP` section without committing — `/pre-compact` is the command form of that Checkpoint, for clearing the window before a manual `/compact`; `/wrapup` is the full, committed-and-pushed version, run only at session END.)

Run each check in order. Report the result of each as a single line prefixed with ✓ (clean), ⚠ (action needed), or — (skipped / not applicable). After all checks, emit the final verdict.

---

## 1. Uncommitted or untracked files

Run `git status --short`. Triage what to *keep* vs *drop* — the actual
commit happens once, at step 8.

- **Modified or staged** → keep for the step-8 commit, or stash with a
  descriptive label, or discard after confirmation.
- **Untracked** → keep, add to `.gitignore`, or delete after confirmation.
- If you see temporary files you yourself created (scratch dirs, fixtures,
  debug output, crash dumps), propose deleting them now so they don't get
  swept into the commit.

If `git status --short` is empty, report ✓ and move on.

## 2. Decisions / gotchas / suggestions that exist only in this conversation

First, run the instinct miner — it scans the session transcript for moments
you redirected the agent (corrections, standing directives) that are easy to
forget by session end:

```bash
bash .claude/framework/insights/instinct-miner.sh
```

If it writes `.claude/.instinct-candidates.md`, read it and fold its candidates
into the review below — but treat them as pointers, not finished lessons (it's
a heuristic with false positives). It NEVER writes to any state file; you do,
only on approval. Delete the candidates file when done.

Then scan your current context for:

- **Architectural or technical decisions** made this session that are NOT yet in `DECISIONS.md` (or the project's per-file `decisions/` per CLAUDE.md). A decision isn't just "we did X" — it includes rationale and rejected alternatives.
- **Non-obvious behaviours or workarounds** you discovered that are NOT yet in `GOTCHAS.md`. Anything that would make a future session say "how was I supposed to know that?".
- **Framework improvement ideas** you noticed that are NOT yet in `FRAMEWORK-SUGGESTIONS.md`. Even small ones — they compound.

For each candidate, quote the specific thing from your context and ask: add it (propose the exact text), skip it (note why briefly so you don't reconsider next session), or defer. If add, write it now (the commit happens once, at step 8).

## 3. STATUS.md accuracy

Read STATUS.md. Verify each section:

- **Active Work** — reflects what's *currently* in-flight, not something you finished hours ago.
- **Recently Completed** — includes anything finished this session.
- **Blockers** — still current (resolved blockers should be removed).
- **Next Up** — points at something a future-you could pick up *without* re-reading this whole conversation. Be specific: task IDs, file paths, or a one-line "pick up from here" directive.

If anything is stale, propose the edit.

## 4. claude-progress.txt session entry

Verify this session has an entry under the Session Log with all required fields:

- Task IDs touched
- Files created / modified (or a representative sample if many)
- Tests status (if any were run)
- Contract changes (or "none")
- Decisions made (or pointer to DECISIONS.md / `decisions/` if fully captured there)
- **"Next session should"** directive — this is load-bearing. Future-you reads it first on cold start to orient.

If the entry is missing, thin, or lacks the "next session should" line, write it now. Use hash-linked commits where possible.

## 5. Memory entries worth saving for cross-session persistence

Scan your context for things that belong in auto-memory (outside the project). Candidates:

- **User** — role, preference, workflow detail not derivable from the code.
- **Feedback** — guidance the user gave (correction OR validated approach) that should apply beyond this session. Watch for quiet confirmations, not just explicit corrections.
- **Project** — motivation, constraint, deadline, stakeholder ask not derivable from git history. Convert relative dates to absolute.
- **Reference** — pointer to an external system the user mentioned (Linear, Grafana, shared docs).

For each candidate, propose the memory type + filename + one-line hook for MEMORY.md, then save if the user confirms. Re-check that you aren't duplicating an existing entry first.

## 6. Pending TodoWrite items

If the in-session todo list has any `pending` or `in_progress` items:

- Promote to TASKS.md (feature lane or bug-fix lane) if the work should outlive the session.
- Discard if they were session-scoped and no longer relevant.

Clear the todo list when done — stale todos from yesterday are worse than none.

## 7. Unanswered questions

Scan the conversation for:

- **AskUserQuestion threads** that were asked but not answered.
- **Open decisions** ("let's come back to X") that were never returned to.
- **Pending commits or pushes** you promised but didn't execute.

Surface each — either resolve now with one more turn, or note it explicitly in STATUS.md "Next Up" so it doesn't get dropped.

## 8. Commit & push

Once checks 1–7 are settled, ask **one** question with AskUserQuestion:

> **Commit and push all changes to main?** — Yes / No

- **Yes** →
  1. Stage explicitly — NOT `git add -A`. Review `git status --short` and
     `git add` each path you triaged as "keep" in step 1 plus the
     state-file edits from steps 2–6 (`.claude/...` state files,
     application files you worked on). A blanket `-A` sweeps in anything
     a weak `.gitignore` misses — `.env.local`, crash dumps, scratch
     files — and publishes it on push.
  2. Commit with a message that summarises the session and references
     **every** `TASK-`/`BUG-` ID touched (the commit convention requires
     the ID; for a multi-task session, list them). Follow the project's
     commit convention and any trailer the session normally appends.
  3. Push: `git push`. If the current branch has no upstream, set it
     (`git push -u origin <branch>`). The user asked for **main** — if you
     are NOT on `main`/the default branch, stop and confirm whether to push
     this branch or merge to main first; don't silently push elsewhere.
  4. Report the commit hash and that the push succeeded (or paste the error
     verbatim if it failed — never report success you didn't verify).
- **No** → leave the working tree as-is. Note in your verdict that changes
  are uncommitted so the next session knows to pick them up.

Pre-commit/pre-push hooks may run. If one fails, surface the failure and
fix the underlying issue — don't bypass with `--no-verify`.

## 9. Stop the project Console (session end)

`/wrapup` is the session-END boundary, so tear down this project's Console if it
was opted in (`.claude/.console-version` or the legacy `.claude/.console-enabled`):

```bash
node tools/console.mjs stop
```

This gracefully shuts the project's Console down (the tray Hub drops it, and the
Hub exits when its last console closes — `contract:console-lifecycle`). It is a
safe no-op if the project isn't opted in or no Console is running, so just run it.
Do **not** do this in `/pre-compact` — that is a mid-session Checkpoint, not a
session end, and the Console must stay up across a manual compaction. Report the
result on one line (✓ stopped / — not opted in / — none running).

---

## Final verdict

First, two computed read-backs (both fail-soft — if a script is missing,
emit one line saying so and move on; never block the wrapup):

```bash
bash .claude/framework/insights/session-summary.sh
bash .claude/framework/insights/push-state.sh
```

Include the push-state line verbatim in the verdict. Do NOT hand-write
push/ahead/behind prose anywhere (STATUS.md included) — prose goes stale
the moment anything is committed; this line is computed from git each
time it's needed.

Include its single output line in the verdict as a **Session efficacy** item,
verbatim. The script is fail-soft — if telemetry is unavailable it says so on
the same line and exits 0; never let it block the wrapup (if the script itself
is missing, emit `Session efficacy: telemetry unavailable (script missing)`
and move on).

Then, after all nine steps, emit one of:

- **`✓ Safe to close — all context flushed to disk.`** — every check clean, nothing pending (and either committed+pushed, or "No" was chosen deliberately).
- **`⚠ N item(s) to resolve before close:`** followed by a numbered list of the residuals. Each item: what's open, and what the user needs to do (answer a question / approve an edit / make a call).

If you noticed any `/housekeeping` thresholds looking close or exceeded (TASKS.md Done > 20, DECISIONS.md > 50, review-findings backlog), append a reminder: *"Consider running `/housekeeping` before the next long stretch — archiving thresholds are due."*

Then, as the **last thing you output**, emit a copy-paste prompt for the
next session — a fenced block the user can paste into a fresh session to
resume without re-reading this one. Build it from STATUS.md "Next Up" and
the latest `claude-progress.txt` "Next session should" line:

````
## ▶ Next session — paste this to resume

Cold start, then: <the single highest-priority next action, with task ID
and any file paths — specific enough to act on without re-deriving context>.
````

Keep the directive to one or two lines. If there is genuinely nothing
queued, say so instead: `## ▶ Next session — board is clear; pick the top unblocked task after cold start.`

---

## Why this exists

Context is ephemeral. Everything you know right now that isn't on disk disappears at cold start. A 30-second wrapup pass is cheaper than re-deriving half a session's state tomorrow from diffs and commit messages. This command is the discipline that says: **don't leave anything important in the volatile layer.**
