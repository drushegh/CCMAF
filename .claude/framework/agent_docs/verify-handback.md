# Verify Handback — turning delivered work into human-reviewable Verify stories

**Framework-owned (shipped + overwritten on update).** This is the contract and the
procedure that close the loop between "the agent says it's done" and "the human can
actually review it, feature by feature."

## Why this exists

When an agent (or an autonomous build) finishes work, the human needs to *verify* it —
ideally one feature at a time, each with its own checklist of use-cases to walk through
and sign off (or flag as a bug). Without an explicit handback step, a build tends to
collapse into **one umbrella task** ("implement the app") with no per-feature review
surface, and the human is handed a pile of code they can't systematically accept.

The fix is two rules, both NON-NEGOTIABLE:

1. **One board task per user story / feature** — never bundle multiple features under a
   single umbrella task. The 1:1 *story → task* mapping is what lets each feature become
   its own reviewable Verify story.
2. **On reaching Ready for Test, emit a verify-handback seed** — one
   `.claude/console/verify/<TASK-ID>.json` file per task, whose `items[]` are that
   feature's use-cases / acceptance criteria. The human reviews these in the **Verify**
   lifecycle stage; passing → Done. (A consumer's verify UI — e.g. the Console — renders
   one Verify story per seed file, `items[]` as the checklist.)

A task therefore maps to a *story*; its `items[]` map to that story's *use-cases*.

## When to emit (and the opt-in gate)

- Emit when a task moves to **Ready for Test** (the Tester's handback — see
  `commands/test.md`). The Tester owns the use-case content.
- **Gated on `.claude/console/` existing.** If the directory is absent, the consumer
  isn't using a verify UI — **do nothing** (zero coupling, no cost). If it exists, write
  the seed to `.claude/console/verify/<TASK-ID>.json`.
- **WRITE-ONCE.** Never overwrite an existing `<TASK-ID>.json` — that clobbers the
  human's recorded verdicts. `item.id` must stay **stable** across any re-seed. Re-seeding
  (when a task's use-cases genuinely change) flows through the consumer UI's
  reconcile-by-`item.id`, not a blind overwrite — coordinate that handoff before building
  it; v1 is strictly write-once.

## The contract — `contract:verify-handback`

One file per task, at `.claude/console/verify/<TASK-ID>.json` where
`<TASK-ID>` matches `^(TASK|BUG)-[0-9]+$`.

<!-- contract:verify-handback status:draft -->
```jsonc
// .claude/console/verify/<TASK-ID>.json   (<TASK-ID> = ^(TASK|BUG)-[0-9]+$)
{
  "schemaVersion": 1,
  "task": "TASK-123",
  "status": "in-review",            // in-review | processing-fixes | done
  "items": [
    {
      "id": "unique-within-file",   // REQUIRED — reconcile key; keep STABLE across re-seeds
      "kind": "use-case",           // free string
      "title": "non-empty",
      "subject": "optional", "expected": "optional",  // changing either resets the verdict
      "verdict": "pending",         // pending | pass | fail | cr | blocked (legacy "warn" reads as "cr")
      "severity": null,             // P0–P3 ONLY when verdict ∈ {fail,cr}, else null
      "round": 1,                   // int ≥ 1 (retest counter; default 1)
      "bugId": null,                // ^BUG-[0-9]+$ | null  (BUG only, not TASK)
      "noteRounds": [ { "round": 1, "note": "" } ],   // per-round note history
      "notes": ""                   // derived: mirrors the last noteRounds entry
    }
  ]
}
// Emit round:1, bugId:null, noteRounds:[{round:1,note:""}] on fresh items (or omit all
// three — the consumer UI's normalizeItem seeds them). WRITE-ONCE: never overwrite an
// existing file (clobbers human verdicts); re-seeding flows through reconcile-by-`item.id`.
```

The pass-file is FRAMEWORK-owned and versioned: the framework defines the shape, the
consumer's verify UI conforms. `.claude/console/` itself stays consumer/UI-owned — the
framework writes only the seed.

## Forward path (new work) — the default

1. **`/analyse`** captures user stories + acceptance criteria into a spec.
2. **`/plan`** breaks the spec into the board: **one task per user story / feature**,
   each task carrying that story's acceptance criteria / use-cases (so the items are
   already known when the seed is emitted).
3. **`/build`** implements one task → Ready for Review → (review) → Ready for Test.
4. **`/test`** (Tester): on moving the task to **Ready for Test / Verify**, emit the seed
   — `items[]` = the task's use-cases. The human verifies; passing → Done.

## Retroactive path — a batch was delivered under one umbrella task

This is the case after an autonomous / overnight build that produced many features but
only one board task (e.g. an umbrella "implement the app"). Do the handback after the
fact — **decompose, then seed**:

1. **Identify the delivered features** — from the spec's user stories, a `FEATURES.md`,
   the umbrella task's acceptance criteria, or the delivered modules. One feature = one
   story.
2. **Create one board task per feature** in `.claude/TASKS.md` — bracketed
   `#### [TASK-N]` (next free ID, ascending), each in the **Verify** section of the
   Feature lane (the work is built; it's awaiting human acceptance), each carrying that
   feature's acceptance criteria / use-cases as a bullet list. Keep the umbrella task as
   a parent/epic reference (note the children in it) or close it once its children exist
   — don't delete delivered history.
3. **Emit one seed per new task** (gated on `.claude/console/` existing):
   `.claude/console/verify/<TASK-ID>.json`, `items[]` = that feature's use-cases, every
   `verdict: "pending"`. Write-once.
4. Result: N delivered features become N Verify stories, each a per-use-case checklist
   the human can accept or flag-as-bug — the review surface the umbrella task never gave.

> Granularity check: if you find yourself about to write a single task that covers
> several independently-verifiable features, split it. "Could the human want to accept
> feature A but reject feature B?" If yes, they are separate tasks → separate stories.

## Worked shape (illustrative)

A feature "User can reset password" with three use-cases becomes one task
`#### [TASK-42] Password reset` (Verify section) and one seed:

```json
{
  "schemaVersion": 1, "task": "TASK-42", "status": "in-review",
  "items": [
    { "id": "reset-request-email", "kind": "use-case", "title": "Request reset → email sent", "verdict": "pending", "severity": null },
    { "id": "reset-token-expiry",  "kind": "use-case", "title": "Expired token is rejected",   "verdict": "pending", "severity": null },
    { "id": "reset-success-login", "kind": "use-case", "title": "New password logs in",        "verdict": "pending", "severity": null }
  ]
}
```
(The consumer UI seeds `round`/`bugId`/`noteRounds` if omitted; keep `id` stable.)
