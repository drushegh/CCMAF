# Adversarial self-review

One sceptical pass over the *written* plan, before you hand it to a human or a
fresh agent. Its only job is to find what is weak, missing or wrong — not to
praise, not to summarise, not to re-research. Grounding already happened while
drafting (`grounding-and-reuse.md`); this pass checks the *output*, the plan text
and its blocks, against the codebase you already read. It is the
**plan-reviewer** pattern: a fresh perspective interrogates the plan before any
implementation, the same way `code-review-development` interrogates a diff after
the fact. This is current plan-first practice (verified June 2026).

Treat it as cheap and non-blocking. You are not gating the plan on a perfect
review; you are spending two minutes to catch the failures that are expensive to
discover during implementation or, worse, after merge.

## When to run it — be proportionate

The review costs attention, so spend it where a wrong plan is expensive.

| Run it | Skip it |
|---|---|
| Architecture, backend, data-model, migration | One genuinely single-decision plan |
| Multi-file or cross-module change | A rename or one well-specified function |
| Public API / wire format / auth touched | A change whose diff fits in one sentence |
| Anything risky or hard to reverse | Anything the altitude gate already waved through |

If the plan barely cleared the altitude gate in the parent skill, the self-review
costs more than it saves — say so and proceed. Reserve it for the plans where a
one-way-door mistake hides in plausible prose.

## The sceptical-reviewer checklist

Read the plan as an adversary who wants it to fail review. For each item, the
question is *"where is this true?"*, not *"is the plan nice?"*.

1. **Implicit one-way doors.** Find every hard-to-reverse decision made *in
   passing* or not at all: wire/serialisation format, ID scheme, schema shape,
   auth boundary, ownership/module placement, dependency adoption. Each must be a
   named decision with a rationale, not an assumption buried in a code fence.
   Route the *shape* of these to `grounding-and-reuse.md`.
2. **Unanchored steps.** Every step must point at a *real* file or symbol you
   verified. Flag any step phrased over abstractions ("update the auth layer")
   with no concrete `path/file.ext` or function behind it — that is a research
   gap dressed as a plan.
3. **Option-menus where the plan should commit.** "We could do A, B, or C" is a
   draft, not a plan. If exploration is genuinely finished, the plan **commits**
   to one and records the rejected alternatives as rationale. A surviving menu
   means either commit now or escalate it (below).
4. **Obvious missing decisions.** Ask the questions a reviewer will ask: *"what
   happens when X fails / is empty / is concurrent?"*, *"why not Y?"*,
   *"what about the migration / rollback / the existing rows?"*. A gap here is the
   cheapest bug you will ever fix.
5. **Padding and single-step filler.** Cut ceremony, restated context, and steps
   that exist only to make the plan look thorough. A one-real-step plan is a
   sentence, not a document — collapse it.
6. **Inconsistency with the codebase.** Check the plan against the project's
   existing patterns, architecture and conventions (`CLAUDE.md`/`AGENTS.md`). A
   plan that introduces a second error-handling style, a parallel data-access
   path, or a naming scheme the repo doesn't use is wrong even if internally
   coherent. This is the core of the fresh-perspective check: a plausible plan
   that fights the codebase.

```text
weak:   "Add validation to the request handler."
strong: "In src/api/orders.ts:createOrder, reuse validateBody() (src/lib/
         validate.ts) — same pattern as updateOrder; reject with 422 to match
         the existing error contract."
```

## Fix vs ask

Every finding lands in exactly one bucket. The split is whether resolving it
needs *judgement you don't have* or merely *work you do*.

- **Fix it yourself** — anything clear-cut. Tighten a vague non-goal, anchor an
  unanchored claim against the file you already read, add an obvious missing
  decision, collapse padding, align a step to the repo's convention. These have a
  single correct answer; resolve them silently and move on.
- **Ask, never silently decide** — a genuine judgement call where a wrong guess
  is expensive and the answer would change the design. Park it in the plan's
  Open Questions block as `[NEEDS CLARIFICATION]`, or fold it into the single
  batched ask-the-user (`open-questions-and-approval.md`). Do **not** flip a coin
  on an irreversible bet to keep the plan looking finished — an unsurfaced
  one-way-door guess is the failure this whole pass exists to prevent.

The line: if you can defend the fix from the code, fix it. If defending it needs
a fact only the user has, ask it. When unsure which bucket, ask — a surfaced
question is cheap; a silent wrong decision is not.

## What this pass is not

- Not re-research. If a claim can't be verified, that is a finding to fix or ask,
  not a prompt to re-open the codebase mid-review.
- Not a rewrite. Apply the clear-cut fixes in place; don't restructure a sound
  plan for taste.
- Not the approval gate. Self-review precedes handoff; the human (or fresh agent)
  sign-off is still the real gate (`open-questions-and-approval.md`).
