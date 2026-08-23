Framework maintenance tasks. Run this deliberately when needed — not part of
any agent's normal workflow.

> **Step 0 — v2 self-route (read this first):** if `.claude/.framework-version` contains a
> `FRAMEWORK_LINE=v2` line, this project runs the CCMAF v2 plugins — invoke the
> `ccmaf:housekeeping` skill (Skill tool) and follow IT instead of this file; stop reading
> here. This bare command is the v1-line copy, kept as authored source.

## Rolling Summary

Check claude-progress.txt. If there are ~10+ detailed entries since the
last Rolling Summary update:

1. Read all detailed entries since the last summary
2. Rewrite the "## Rolling Summary" section: compress into 5 bullets
   covering key decisions, tasks completed, patterns established, and
   current trajectory
3. If detailed entries exceed ~30, move older ones to
   .claude/framework/docs/archives/progress-archive.txt and keep the most
   recent 15

## Framework Metrics

Update framework-metrics.md:

1. Read `.claude/telemetry/.hook-metrics` for raw hook counters (written by `.claude/framework/insights/rollup.sh`)
2. Read `.claude/review-findings.md` for review finding stats
   (total, acted on, ignored, wontfix)
3. Count bugs in the Bug-Fix Lane of TASKS.md (reported, fixed, cycle time)
4. Check for contract drift events in recent review findings
5. Fill in the metric tables in framework-metrics.md
6. Reset raw counters in `.claude/telemetry/.hook-metrics`
7. Note any actionable insights — if a metric looks bad, log a suggestion
   in FRAMEWORK-SUGGESTIONS.md

## State File Archiving

Check if any state files need archiving:

- TASKS.md Done section > ~20 items → archive older (see semantic-decay below)
- DECISIONS.md > ~50 entries (or per-file `decisions/`, per project CLAUDE.md) → move older to .claude/framework/docs/archives/decisions-archive.md
- review-findings.md fully resolved cycles → move to .claude/framework/docs/archives/findings-archive.md
- test-findings.md fully resolved cycles → move to .claude/framework/docs/archives/findings-archive.md
- STATUS.md > ~50 KB (or large enough that the Read tool refuses it at cold-start step 8) → STATUS is *current* state, not a log: prune superseded session-claim / "Next session" prose, keeping only the active session, Next Up, and the recent Recently-Completed rows. The chronological record lives in `claude-progress.txt` — don't duplicate it here. (Distil any still-relevant constraint forward per semantic-decay before pruning.)

### Semantic decay (don't just move — distil first)

Blunt "move the oldest N to an archive file" loses the signal those tasks
carried. Before archiving completed TASKS.md entries, **summarise them
forward** so the knowledge survives in active state, not just cold storage:

1. Group the about-to-be-archived Done entries by theme (a feature area, a
   bug class, a subsystem).
2. For each group, write ONE distilled line into the live record where it
   belongs — *not* a new log:
   - A durable pattern those tasks established → a positive-pattern entry in
     `GOTCHAS.md` (or a `FRAMEWORK-SUGGESTIONS.md` note if it implies a
     framework change). This is the same "what worked, generalise it"
     capture the instinct-miner proposes — housekeeping is where stragglers
     get distilled.
   - A still-relevant constraint or direction → fold into STATUS.md
     "Next Up" or the claude-progress Rolling Summary.
3. THEN move the raw entries to `.claude/framework/docs/archives/tasks-archive.md`, prefixed with a one-line
   header pointing at where their distilled lesson now lives.

The test: after archiving, a fresh session reading only the *live* state
files should still know what those completed tasks taught — the archive is
provenance, not the only copy of the lesson. Skip distillation only for
purely mechanical tasks that taught nothing (a rename, a version bump).

## Adopted-Feedback Reconciliation

Your GOTCHAS.md and FRAMEWORK-SUGGESTIONS.md entries about the *framework
itself* may already be fixed upstream — the framework team sweeps consumer
feedback files, adopts items, and ships the fixes in updates. The registry
of adoptions ships with the framework:

1. Read `.claude/framework/docs/ADOPTED-FEEDBACK.md` (framework-owned,
   updated on every framework update you pull).
2. For each registry row, check your `.claude/GOTCHAS.md` and
   `.claude/FRAMEWORK-SUGGESTIONS.md` for a matching entry. Match on
   TOPIC, not wording — your entry is in your own words (the row's last
   column describes what to look for).
3. If your pinned framework version is at or past the row's commit
   (compare `FRAMEWORK_PINNED_SHA` in `.claude/.framework-version` /
   check `git log` of your last update), the local entry is stale:
   remove it, or annotate it `✅ adopted upstream <TASK-XXX>` if its
   context is still useful history.
4. Project-specific entries (about YOUR code, not the framework) are
   never touched by this step.
5. Belt-and-suspenders (the registry can lag — a fix can ship without its
   row): also skim the update's commit list,
   `git log <prev-pinned-sha>..<new-pinned-sha> --oneline`, for `fix:`/`feat:`
   lines whose topic matches an open suggestion of yours. A match upstream
   already shipped is the same staleness even when no registry row exists yet.

This keeps consumer feedback files describing only *open* concerns — a
stale "the framework should X" entry that upstream already shipped misleads
every future session that reads it.

## Memory reconciliation (retire contradicted rules)

Accretive memory files (GOTCHAS.md, CLAUDE.md project rules) drift: a later
session sometimes learns an earlier rule is wrong or superseded, but the old
entry stays, contradicting the new one. Sweep for it:

1. Scan GOTCHAS.md (and CLAUDE.md project rules) for entries a later session's
   evidence has since contradicted or narrowed.
2. Supersede in place — annotate the stale entry `⚠ superseded <date>: <what
   changed>` (or remove it) and point at what replaces it. Keep a one-line
   audit trail; don't silently delete — a future reader needs to know the rule
   was *revised*, not just gone.
3. A `Hypothesis` / `Working theory` GOTCHAS entry (behavioral-principles §4)
   later proven wrong is the highest-priority retire — it was propagating a
   misdiagnosis every session trusted.

This is the deterministic half of memory-lifecycle reconciliation; the
judgement of "does B contradict A" stays in the interactive session (no
metered model call).

## TODO census (deferred-debt ledger)

Harvest the deliberate shortcuts marked in source so a deferral can't
silently become permanent. Read-only — reports, never edits code.

1. Sweep source for deferred-work markers, skipping vendored/build dirs:
   `rg -n -e 'TODO' -e 'FIXME' --glob '!**/{node_modules,dist,build,.git,vendor}/**'`
2. One row per hit, grouped by file. A marker is COMPLIANT only if it carries
   both an owner and a task/ticket reference (the shape code-conventions.md
   mandates); flag any missing either as `ownerless` — those are the ones
   that rot.
3. End with `<N> markers, <M> ownerless.` or `No deferred-debt markers. Clean.`

The fix for an ownerless marker is adding it to TASKS.md, not copying it to
GOTCHAS.md — the inline marker and the task board stay distinct surfaces. The
ledger is derived (a grep), so it can never drift out of sync with the code.

## Ceremony self-audit (the simplicity test, turned inward)

The framework asks *Simplicity First* (behavioral-principles §2) of user
code; honesty requires asking it of the framework's own surface too. Read-
only — recommends, never acts.

For each framework surface this project actually uses (hooks, state files,
agent lifecycle, contracts), ask what *Simplicity First* asks of user code:
does it still answer a LIVE failure at *this* project's scale, or is it
ceremony a senior engineer would call overcomplicated here? Name specific
non-floor hooks to turn off via `CLAUDE_DISABLED_HOOKS`, or surfaces to drop.

**Safety floor — the audit cuts ceremony, not the floor.** Never recommend
disabling the destructive-command guard (`block-dangerous`, the lone
safety-tier hook) or the state-enforcement hook (`enforce-state`, which the
Stop hook depends on). Two mechanisms can strip these, so fence both: an
explicit `CLAUDE_DISABLED_HOOKS` entry overrides even the safety tier, and
`CLAUDE_HOOK_PROFILE=minimal` silences everything except `block-dangerous`
(including `enforce-state`, which runs at the `normal` tier). Only suggest
`minimal` for throwaway or local-model work where the Stop-hook state
discipline genuinely doesn't apply — never for a project whose board and
state files must stay current.

## Commit

Commit all changes with: `chore: framework housekeeping — rolling summary, metrics, archiving`
