Follow the Cold Start sequence (canonical list in CLAUDE.framework.md — CLAUDE.md merely @imports it).

`/board-heal` — reconcile the board (`.claude/TASKS.md`) with demonstrable reality: advance
tasks stranded in non-terminal columns to their TRUTHFUL status, backfill missing verify seeds,
renumber suffixed sub-IDs, and decompose genuine umbrella tasks — so the board and the Console's
Verify tab tell the truth. This is the FIX half of `contract:board-coherence`; the DETECT half is
doctor Check 15 (`board-coherence`) + Check 13. **Before starting, read**
`.claude/framework/agent_docs/verify-handback.md` (the seed schema + the retroactive/decompose
procedure) and the `contract:board-coherence` + `contract:verify-handback` blocks in
`.claude/ECOSYSTEM.md`.

## When this runs
- From a doctor obstruction: cold-start step 3 raised a `board-coherence` WARNING (missing seeds /
  orphan seeds / a base ID in two columns / an RfR pile-up) or a Check-13 SUFFIXED-ID warning, and
  the user chose *fix now*. Or on demand.
- Typical trigger: a consumer opted into the Console, or pulled a framework update, and the next
  cold start's doctor flagged the drift. (The update itself never mutates the board — it delivers
  this healer; the cold start triggers it, with consent. That is what "self-heal on update" means.)

## Guardrails (NON-NEGOTIABLE)
- This command MUTATES `.claude/TASKS.md` and WRITES seed files. It **never touches a recorded
  human verdict** — an existing `.claude/console/verify/<ID>.json` is left byte-for-byte alone
  (WRITE-ONCE). Only missing seeds are created.
- **Baseline first (git is the dry-run):** if the working tree has uncommitted `.claude/` changes,
  commit them (or stop and surface them) so the ENTIRE heal is one reviewable `git diff`. Revert is
  `git checkout`. No bespoke backup.
- **Idempotent:** skip existing seeds; renumber only still-suffixed IDs; a second `/board-heal`
  immediately after must be a no-op (and doctor must come back clean).
- **Evidence over assumption:** NEVER bulk-move tasks by a blanket policy. Judge EACH task against
  demonstrable reality (Step 2) and ask the human ONLY where the evidence is genuinely ambiguous.
- **Do the pre-task context check.** On a large board (20+ tasks) this is real work — if projected
  context >= 90%, tell the user and offer a fresh session.

## Step 0 — Open a board task for the heal itself
Create `#### [TASK-N]` (next free numeric id = max existing TASK number + 1) in the Feature lane's
`### In Progress`: `Board heal — reconcile board with reality (run <YYYY-MM-DD>)`. Every commit this
command makes carries that ID (commit convention is non-negotiable), and the heal earns its own
Verify story.

## Step 1 — Renumber suffixed sub-IDs → distinct numeric IDs
Doctor lists them (`[TASK-Na]` bracketed, or bare `TASK-Na`). The canonical ID is numeric; a
trailing alpha suffix is unsanctioned and NON-CANONICAL (current Console builds, ccmaf-console
0.2.3+, surface it flagged; older builds dropped a bracketed `[TASK-017b]` / mis-parsed a bare
`TASK-017b` into TASK-017). For each, in ascending board order:
- Allocate the next free numeric id.
- Rewrite the heading (`#### [TASK-017b] Title` → `#### [TASK-<new>] Title`) and add a body line
  `- **Was:** TASK-017b (renumbered by /board-heal <YYYY-MM-DD>)` — past commits reference the old
  id; the alias preserves the archaeology.
- Update any in-board references to the old id (its mentions in other tasks' prose) to the new id.
- Do NOT look for a seed to rename: a suffixed id never had a valid seed (the seed filename is
  numeric-only), so there is nothing to move.
- Skip an id that is already numeric (idempotent).

## Step 2 — Place each stranded task at its TRUTHFUL status (evidence-driven — the core step)
For every task NOT in a terminal column (`Done`) and not in `Todo`/`Blocked` — i.e. `In Progress`,
`Ready for Review`, `Ready for Test` — determine where it ACTUALLY belongs from demonstrable
evidence, not from where it currently sits. Gather, per task:
- **Built?** `git log --oneline --grep="TASK-N" -- . ':(exclude).claude'` shows an implementation
  commit; the code/files exist.
- **Reviewed?** a review commit, a `.claude/review-findings.md` entry, a reviewer sign-off.
- **Tested?** tests exist AND pass (run them if cheap); a `.claude/test-findings.md` entry.
- **Shipped?** a deploy commit, a tag/release, a screenshot, the app is live.

Map evidence → status:
- built + reviewed + tested (± shipped) but never walked forward → **Verify** (awaiting human
  acceptance — the human is the last gate; this is the common autonomous-build case).
- built, not reviewed → **Ready for Review**.
- built + reviewed, not tested → **Ready for Test**.
- not actually built (stub/abandoned) → **Todo** (or **Blocked** with a reason).

**Ambiguous?** — evidence conflicts, OR the task shipped but skipped the review/test gates (does it
fast-track to Verify, or walk back through the gates?) → ASK THE HUMAN via AskUserQuestion, one
decision per ambiguous cluster: *fast-track to Verify (it shipped; acceptance is what's owed)* /
*walk it back through review→test* / *leave as-is*. **Never silently fast-track a task past a gate**
— whatever the human decides is recorded in Step 5.

## Step 3 — Backfill verify seeds (gated on `.claude/console/` existing; WRITE-ONCE)
If `.claude/console/` does NOT exist → SKIP this entire step (zero coupling — the project isn't
using a verify UI). Otherwise, for every task now in **Verify** (Feature lane) with NO
`.claude/console/verify/<TASK-ID>.json`:
- **VERIFY ONLY — never seed a Ready-for-Test task.** A task Step 2 left in Ready for Test hasn't
  been tested; the Tester emits its seed (the *curated* use-cases) on PASS as it moves the task to
  Verify. Because seeds are WRITE-ONCE, a premature seed authored here would permanently lock out
  that authoritative one. Leave Ready-for-Test tasks seedless — `/test` seeds them.
- Emit the seed per `contract:verify-handback`:
  `{ "schemaVersion": 1, "task": "<ID>", "status": "in-review", "items": [ … ] }`, with `items[]` =
  that task's acceptance criteria / use-cases (from the task's body bullets, its spec, or the
  delivered feature). Each item: `{ "id": "<stable-slug>", "kind": "use-case", "title": "<non-empty>",
  "verdict": "pending", "severity": null }`. Keep `id` a stable slug (the reconcile key).
- **WRITE-ONCE:** never overwrite an existing seed. Create only the missing ones.
- If a task genuinely exposes no distinct use-cases, emit ONE item (title = the task title) rather
  than an empty `items[]` — an empty checklist is not reviewable.

## Step 4 — Decompose genuine umbrella tasks (ONLY if bundled)
If a SINGLE task bundles multiple independently-verifiable features (an "implement the app"
umbrella), follow verify-handback.md's retroactive path: create one `#### [TASK-N]` per feature in
the Verify section, each carrying its use-cases, and seed each (Step 3). Keep the umbrella as a
parent/epic reference (note the children) or close it — don't delete delivered history.
**Granularity test:** "could the human accept feature A but reject feature B?" If yes → separate
tasks. **If the board is already 1-task-per-feature (the common case), there is nothing to
decompose — skip this step.**

## Step 5 — Record + commit + verify
- If Step 2 made any judgment call that skips a gate (e.g. fast-tracking N Ready-for-Review tasks →
  Verify because they shipped), add a `DECISIONS.md` entry: what moved, the evidence, and that the
  human authorised it. This is what stops the heal itself from becoming the next board-vs-reality
  drift.
- Update `STATUS.md` + `claude-progress.txt` with what the heal changed (renumbers, seeds, advances,
  decompositions).
- Commit everything under the Step-0 task id, e.g.
  `fix: board heal — <N seeds backfilled, M IDs renumbered, K tasks advanced> (TASK-N)`.
- Re-run `bash .claude/framework/doctor/doctor.sh` and confirm the `board-coherence` / suffixed-ID
  findings are gone (explain any that remain by design). **A second `/board-heal` must be a no-op.**

## Result
The board reflects reality: every Verify/Ready-for-Test task has a seed, IDs are numeric, stranded
tasks sit at their truthful status, and the whole change is one reviewable commit. On a
Console-opted-in project the Verify tab now renders one story per delivered feature — the per-feature
review surface the batch build never produced.
