# Open questions and approval

The gate between *a plan that proceeds on stated assumptions* and *a plan that
guesses silently and breaks at the wrong layer*. This reference covers the Open
Questions block, the clarify-vs-assume rule, the approval step, and why the
written plan — not the chat — is the source of truth. The plan structure itself
is in `plan-anatomy.md`; the sceptical pass that *finds* the ambiguities you park
here is in `self-review.md`.

## The Open Questions block

It lives at the **bottom** of the plan, after risks and verification, because it
is the last thing a reviewer reconciles against everything above it. Each item
is marked `[NEEDS CLARIFICATION]` — a GitHub Spec Kit convention — and carries a
**recommended default**: the resolution the plan proceeds on once **approved**,
unless the reviewer overrides it — the proposal, not a licence to skip sign-off.
A question with no default is an abdication: it stalls the plan and forces the
reviewer to do your design work.

```markdown
## Open Questions

1. [NEEDS CLARIFICATION] Soft-delete or hard-delete for retired accounts?
   Affects: the migration shape and the `accounts` unique index (irreversible).
   RECOMMENDED DEFAULT: soft-delete with a `deleted_at` timestamp — reversible,
   matches the `audit_log` retention policy already in `db/schema.sql`.
```

Only **genuine** ambiguities belong here — ones that, resolved either way,
change architecture, scope, the UX contract, a data shape, or rollout. Those
**block approval**: a reviewer cannot sign off on a one-way-door decision you
quietly picked for them. Everything else is not an open question — it is an
assumption you state inline and move past (see below). If there are none, write
"none" and mean it; a padded Open Questions block trains reviewers to skim it.

What does **not** go here: anything you can resolve by reading the code (resolve
it), pure implementation detail with no design consequence (just decide it), or
questions phrased as "how should I build X" (those are an option-menu you owe
the reader as a decided **Approach**, not a question — see `plan-anatomy.md`).

## Clarify vs assume

The default is **assume and proceed**, stating the assumption. Asking is the
expensive path — it stalls the plan and offloads thinking onto the reader — so
spend it only where it pays.

- **Do not ask how to build something.** "Which caching strategy?" is design
  work you were asked to do. Explore the options, reject the losers with a
  reason, and commit to one in **Decisions** / **Approach**. Present, don't poll.
- **Ask only the highest-leverage questions** — typically **2–4**, never a
  questionnaire. A question qualifies only if **both** hold: its answer would
  *change the design* (not just a label or a default), and you *cannot resolve
  it from the code, `CLAUDE.md`/`AGENTS.md`, or the repo's existing patterns*.
- **Batch them.** Surface all of them at once with the plan, not drip-fed across
  turns. A reviewer answers a numbered list in one pass; serial questions burn
  round-trips and context.
- **Otherwise, state the assumption explicitly and proceed.** "Assuming the API
  stays REST/JSON (no GraphQL in the repo today)" is a recorded decision a
  reviewer can veto in one line — far better than a silent guess or a question
  that didn't need asking.

The test: *would the answer change a box in the file map or a diagram, in a way
I can't settle myself?* If yes, it is a question. If no, it is an assumption.

## The approval gate

**Presenting the plan and naming the affected files/areas *is* the approval
step.** A complete plan — outcome, decisions, file map, open questions — is the
sign-off request. Do **not** tack on a separate "does this look good?": it adds
nothing the plan didn't already ask, and it signals the plan wasn't self-
sufficient. The plan is the question.

In Claude Code, plan mode makes this concrete. It is an **enforced read-only
state** entered via **Shift+Tab**, a `/plan` prefix, or `--permission-mode plan`;
no source edits happen while you are in it. When the plan is ready, the user can:

1. **approve it** — and pick the edit mode that takes effect on exit;
2. **keep planning** — feed back corrections, which you fold into the plan; or
3. **open the plan in their editor** and edit it directly before proceeding.

Leaving plan mode *without* approving makes **no edits** at all (verified June
2026; re-verify at code.claude.com/docs/en/permission-modes). So the plan you
present must stand on its own — the reviewer may hand-edit it into the contract
you then build against, never having typed a word of chat.

## The plan is the source of truth

Approval binds you to the written plan, not to the conversation that produced it.

- **When scope shifts, update the plan — don't course-correct only in chat.** A
  decision made in a chat reply is invisible to a fresh reader and evaporates
  under compaction. If reality diverges from the approved plan, **return to
  planning**: amend the file map, the decisions, the open questions, then
  proceed. A chat aside is not a plan amendment.
- **Re-read the approved plan before each major step.** It is the spec; drift
  happens when you implement from memory of the plan rather than the plan.
- **Re-surface for approval when a change crosses a one-way door** the original
  approval didn't cover (a new migration, an API break, a new dependency). Minor
  reversible deltas you note in the plan and carry on; irreversible ones earn a
  fresh look.

## Context durability

Anything that must **survive context compaction** belongs in the **written
plan**, not the conversation. Treat the chat as volatile and the plan file as
durable storage. Constraints, rejected options (and *why* they were rejected, so
they aren't relitigated), the recommended defaults, and the resolved answers to
former `[NEEDS CLARIFICATION]` items all go into the Markdown. The test for any
load-bearing fact: *if the conversation were truncated to its last few messages,
would this still be recoverable from the repo?* If not, it is not yet recorded —
write it into the plan.
