---
name: code-review-development
description: >-
  Senior-level code review — reviewing a code change, diff, pull/merge
  request or commit the way a disciplined staff engineer would: judging
  design, correctness and edge cases, security, performance, tests,
  readability and maintainability against one bar — the change must
  improve the codebase's health — then producing prioritised,
  severity-labelled, kind-but-direct feedback (Conventional Comments),
  and covering the author side too (small focused changes, clear
  descriptions, self-review, responding to comments). Use whenever asked
  to review code or a PR/MR/diff/commit, "review this before I merge",
  "is this safe to ship", "look over my change", "give PR feedback",
  self-review before raising a PR, or acting as a reviewer gate in CI —
  even when the word "review" is implicit. Owns CODE review; security
  depth routes to secure-development and test strategy to
  testing-development. Architecture/design-doc and written-document
  review are deliberately separate skills.
---

# Code Review

How to review a code change like a senior engineer who is accountable
for the result. The whole discipline rests on one principle, from
Google's engineering practices and worth internalising:

> **Favour approving a change once it definitely improves the overall
> health of the codebase, even if it isn't perfect.** There is no perfect
> code — only better code. Seek continuous improvement, not perfection.

That sentence resolves most review dilemmas: you are not hunting for
reasons to block, nor waving things through — you are asking *"does the
system end up healthier than before, and do I understand it well enough
to stand behind that?"*

This skill owns **code** review — a concrete change to source. It is
language-agnostic and leans on siblings for depth: security →
`secure-development`; test strategy and what-to-test →
`testing-development`; HTTP contract/versioning → `api-development`;
query/index/migration safety → `sql-development`; CI gating →
`devops-development`; language-specific correctness → the relevant
language skill (`python-development`, `dotnet-development`,
`typescript-development`, …). Architecture and design-document review,
and written-document review, are separate skills — keep this one about
the code.

## Non-negotiables

1. **Optimise for code health over time, not perfection.** Approve when
   the change improves the system; never block on polish. Codebases rot
   through many small accepted degradations — so don't accept changes
   that *worsen* health, but don't gate a net-positive change for days
   over things that aren't important. Mark non-critical points clearly
   (a `Nit:` prefix or a non-blocking label) so the author can choose.
2. **Understand the change before you judge it.** Read the description
   and intent first, then the broad design, then *every line you were
   asked to review*. If you can't understand the code, that is itself a
   finding — ask the author to clarify; future readers will struggle
   too. Never approve code you don't understand.
3. **Facts and principles overrule preferences.** Technical data and
   sound design principles win; the project's style guide is the
   authority on style; software *design* is almost never pure taste. If
   the author shows several options are equally valid, defer to them.
   Don't bikeshed personal preference as if it were correctness.
4. **Prioritise and label every comment.** Lead with the highest
   severity. Make the blocking/non-blocking status of each comment
   unambiguous (see `references/severity-and-prioritisation.md`). A wall
   of equally-weighted comments hides the one that matters.
5. **Spend judgement where machines can't.** Formatting, style, types,
   obvious bugs and known-bad patterns belong to linters, formatters,
   type checkers and CI — push them there so review attention goes to
   design, correctness, edge cases, security and tests
   (`references/automation-tooling-and-ai.md`).
6. **Be specific, kind and actionable; never rubber-stamp.** Locate the
   issue, explain *why* it matters, and offer a concrete fix or
   question. Review the code, not the author. Praise good work. "LGTM"
   without having read the change is a defect, not a courtesy —
   especially for an AI/agent reviewer, which must stay calibrated and
   surface its uncertainty rather than approving to be agreeable.
7. **Be timely and decisive.** Respond within about a business day; a
   stalled review blocks a person. Reach a clear outcome — approve,
   approve-with-nits, or request changes with a concrete path — and
   don't let a change rot in disagreement (escalate instead;
   `references/the-standard.md`).
8. **AI-generated code gets a dedicated pass.** In an agentic codebase
   most changes are AI-written, and AI has a *predictable* failure
   profile — duplication instead of reuse, dead/orphaned code,
   hallucinated dependencies and APIs, plausible-but-wrong logic,
   convention drift, and comment/stub noise. Fluency is not correctness,
   and it breeds overconfidence in reviewer and author alike. Run the
   AI-specific checks in `references/ai-generated-code.md` on any
   AI-written change.

## What a review covers (the dimensions)

Run the change against each; depth and smells per dimension are in
`references/what-to-look-for.md`, and the concrete defect classes to
hunt are in `references/defect-hunting.md`.

| Dimension | The question |
|-----------|--------------|
| Design | Does this change belong here, integrate cleanly, and fit the system? |
| Correctness | Does it do what's intended, including edge cases and failure paths? |
| Security | Untrusted input, authz/authn, secrets, injection? → `secure-development` |
| Performance | Will it scale — allocations, N+1, unbounded work, hot paths? |
| Error handling | Are errors surfaced, not swallowed; resources released; retries safe? |
| Concurrency | Shared mutable state, races, deadlocks, ordering assumptions? |
| Tests | Right level, meaningful assertions, fail when the code breaks? → `testing-development` |
| Readability | Clear names, honest comments (why not what), low complexity? |
| Complexity | Over-engineered or speculative (YAGNI)? Simpler option available? |
| Contract | Backward-compatible API/schema/flags; migrations safe? → `api-development`, `sql-development` |
| Observability | Can you tell in production whether this works? Logs/metrics/traces? |
| Dependencies | New deps justified, vetted, licence-clean? → `secure-development` |
| Docs | READMEs/usage/reference updated when behaviour or interfaces change? |

## Workflow

1. **Context.** Read the change's description and linked ticket; know
   the intent and the blast radius before reading code.
2. **Broad pass.** Does this change belong, and is the overall design
   sound? If the *approach* is wrong, say so now — before line-level
   comments that would be wasted on rework.
3. **Detailed passes.** Read every assigned line; view whole files, not
   just diff hunks, so you catch the 4-line change that should have
   split a 50-line method (`references/review-workflow.md`).
4. **Verify where it matters.** Pull and run it for user-facing/UI
   changes or anything with concurrency — behaviour you can't be sure of
   by reading.
5. **Prioritise.** Sort findings by severity; decide what blocks.
6. **Write feedback.** Specific, reasoned, labelled; praise the good;
   open with a short summary and your decision
   (`references/giving-feedback.md`).
7. **Decide and follow up fast.** Approve / approve-with-nits / request
   changes; re-review promptly when the author responds.

## Anti-patterns (calling these out is part of the job)

- **Rubber-stamping** — LGTM without reading; the most damaging habit.
- **Nitpick storms / bikeshedding** — burying a real issue under style
  opinions; gating on personal preference.
- **Scope creep** — "while you're here, also refactor X"; file a
  follow-up instead.
- **The unreviewable mega-PR** — push back for a split; you cannot
  meaningfully review thousands of lines at once.
- **Slow/ghosting reviews** and **gatekeeping** — treating review as a
  power checkpoint rather than a shared improvement.

## References

| File | Load when |
|------|-----------|
| `references/the-standard.md` | The philosophy, principles, mentoring, and resolving reviewer/author conflict |
| `references/review-workflow.md` | The process end-to-end — context, passes, navigating a diff, speed, multiple reviewers |
| `references/what-to-look-for.md` | The dimensions in depth, with the smell to watch for in each |
| `references/defect-hunting.md` | A concrete checklist of high-value bug classes linters miss |
| `references/severity-and-prioritisation.md` | The severity rubric, blocking vs non-blocking, the approval decision |
| `references/giving-feedback.md` | Comment craft, Conventional Comments labels, tone and psychological safety |
| `references/author-side.md` | Preparing a reviewable change and responding to review well |
| `references/automation-tooling-and-ai.md` | What to automate, PR-platform mechanics, and using AI/agent reviewers well |
| `references/ai-generated-code.md` | Reviewing AI/LLM-generated code — its characteristic failure modes and the concrete signal to catch each |

## Boundaries with sibling skills

- Security threat-modelling and vulnerability depth → `secure-development`;
  test design and coverage strategy → `testing-development`; API
  contract/versioning → `api-development`; SQL/index/migration safety →
  `sql-development`; CI checks and required reviewers →
  `devops-development`; accessibility review → `accessibility-development`.
- Language idioms and per-language correctness stay with the language
  skill being reviewed.
- Reviewing architecture/design documents, and reviewing written
  documents (proposals, specs), are out of scope here — separate skills.
