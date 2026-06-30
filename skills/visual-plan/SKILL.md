---
name: visual-plan
description: >-
  Turn an implementation idea into a reviewable, GROUNDED implementation plan —
  in plain Markdown with Mermaid diagrams, file maps, annotated code/diffs and an
  explicit open-questions gate — BEFORE any code is written. The plan is the
  approval gate and the source of truth, judgeable by a fresh reader without the
  chat history. Use whenever about to make a non-trivial change: a multi-file
  feature, a refactor, a schema/API/data-model change, or anything ambiguous,
  risky or hard to reverse. Triggers: "plan this", "how would you approach",
  "write a plan/spec/design", "what will change", "before you start", plan mode,
  spec-driven work. PROACTIVELY produce a plan before editing for substantial
  work; skip it for one-line or single well-specified changes. Grounds every
  named file/symbol in the real repo (no invention). Heavy exportable diagrams →
  drawio-development; rendering/critiquing UI → ui-verification; layout reasoning
  → ux-design; reviewing the finished change → code-review-development.
---

# Visual Plan

How to turn an idea into a **reviewable implementation plan** that a human (or a
fresh agent) can approve before a single line is written. A plan in chat prose is
not reviewable: it has no file list, no diagrams, no standalone shape, and it
evaporates under context compaction. A *visual plan* is a standalone Markdown
artefact — grounded in the real repository, carrying diagrams, a file map,
annotated code, the hard-to-reverse decisions, and an explicit open-questions
gate — that makes the proposed change legible *before* it touches disk.

This is the forward mirror of `code-review-development` (which reviews a change
after the fact) and the planning half of any plan-first harness (Claude Code's
plan mode, GitHub Spec Kit's Spec→Plan→Tasks→Implement). It is built entirely on
open primitives — Markdown, Mermaid, ASCII wireframes, file-trees, diff fences —
so the plan lives in the repo, diffs in a PR, and renders everywhere, with no
hosted service.

## Non-negotiables

1. **Gate to the right altitude.** A plan is a review surface for *meaningful*
   work, not ceremony. Skip a heavyweight plan for a one-line fix, a rename, or a
   single well-specified function whose diff fits in one sentence — say so and
   proceed. Reserve the plan for multi-file, refactor-shaped, ambiguous, risky,
   or state/security/data-touching work. Never pad a plan with filler or ship a
   single-step plan.
2. **Research the real repo first; ground every named thing.** Before drafting,
   read the actual files, search the codebase, and build a small impact map of
   what genuinely changes. Name *real* files, symbols, types and patterns — never
   invent an API, path, function or package. Unverified names are the single most
   damaging AI failure mode (`references/grounding-and-reuse.md`).
3. **Reuse before new.** For each step, name what it *reuses* — existing
   functions, types, components, helpers, conventions — before what is new, so
   the plan explains the genuine delta and doesn't duplicate what exists.
4. **Decide hard-to-reverse bets up front.** Identify the one-way-door decisions
   (schema/migration shape, public API/wire format, data IDs, auth boundaries,
   dependency adoption, module layout) and get them right *in the plan*, even if
   most code ships later. Move fast on reversible (two-way-door) choices and label
   them as such. Record the rationale (`references/grounding-and-reuse.md`).
5. **Plain Markdown, standalone, no proprietary surface.** The plan is judgeable
   without the chat history. If a prior plan exists, treat it as source material
   and rewrite a clean standalone proposal — no "this revision changes…" framing.
   The plan lives in the repo as Markdown; never depend on a hosted plan service.
6. **Planning is read-only.** Make no source edits while building or reviewing the
   plan. Start editing only after the plan is approved — this is exactly what
   Claude Code's plan mode enforces (verified June 2026).
7. **Open questions are an explicit gate, not silent guesses.** Don't ask *how to
   build it* — explore, then present approaches. Ask only the 2–4 high-leverage
   questions whose answer would change the design and that you can't resolve from
   code; otherwise state the assumption and proceed. Park unresolved items in a
   bottom Open Questions block marked `[NEEDS CLARIFICATION]`
   (`references/open-questions-and-approval.md`).
8. **The plan is the approval gate and the source of truth.** Presenting it and
   asking for sign-off *is* the approval step — don't tack on a separate "does
   this look good?". When scope shifts, update the plan, don't just course-correct
   in chat; re-read the approved plan before major steps.
9. **Right visual for the question, and check it renders.** Pick the diagram type
   to the need (below); don't add visual chrome by default. Verify Mermaid parses
   and ASCII aligns at monospace width before you present — a broken diagram
   undermines the whole plan.

## Anatomy of a visual plan

Top to bottom; include only the parts the change needs
(`references/plan-anatomy.md`):

1. **Outcome** — what changes and *why*, in 1–3 sentences. Concrete, product-level.
2. **Approach** — the shape of the solution and the alternatives rejected.
3. **Decisions** — each hard-to-reverse bet, labelled reversible/irreversible,
   with rationale.
4. **File map** — a `file-tree` of touched/new files with a one-line note each.
5. **Per-step changes** — what each step does, naming reuse before new, with
   diagrams / annotated code / diff fences next to the prose they explain.
6. **Risks & verification** — what could break, and how it'll be tested.
7. **Open Questions** — the `[NEEDS CLARIFICATION]` gate (or "none").

## Choosing the visual surface

Don't default to one diagram type — match it to the question the reader has.
Mermaid is plain text, so it diffs, commits, and renders on GitHub/GitLab/VS Code.

| The question | Surface |
|---|---|
| Control flow, branching, decision logic | Mermaid `flowchart` |
| Order of calls across components / async timing | Mermaid `sequenceDiagram` |
| Data model / schema change | Mermaid `erDiagram` |
| Lifecycle / status machine | Mermaid `stateDiagram-v2` |
| System / deployment topology | Mermaid `architecture-beta` or a labelled `flowchart` |
| Type / class relationships | Mermaid `classDiagram` |
| A UI change before code exists | ASCII/Unicode wireframe (or small inline HTML) |
| Structural / file-layout change | `file-tree` listing |
| The exact edit or new signature | fenced ```` ```diff ```` / language fence |
| No spatial relationship to show | prose only — don't force a diagram |

Mermaid C4 is flagged experimental and `architecture-beta` is a beta keyword
(verified June 2026; re-verify at mermaid.js.org). Diagram syntax and the
wireframe conventions are in `references/diagrams-and-wireframes.md`.

## Workflow

1. **Inspect & gather.** Explore the codebase (delegate wide exploration to
   subagents so only findings return to context); read `CLAUDE.md`/`AGENTS.md` and
   the project's conventions. If a source plan exists, gather its exact text.
2. **Draft.** Write the plan from the anatomy above, grounded in the impact map,
   reuse-first, with the right visuals beside the prose.
3. **Self-review.** Run one sceptical pass over the *written* plan — implicit
   hard-to-reverse decisions, unanchored claims, option-menus that should commit,
   obvious missing decisions, padding. Fix the clear-cut; route judgement calls to
   Open Questions (`references/self-review.md`).
4. **Surface & request approval.** Present the plan, name the affected
   files/areas, and ask for sign-off. Do not edit yet.
5. **Revise from feedback, then implement.** Apply feedback into the plan, then —
   only after approval — execute against it, returning to the plan if reality
   diverges.

## Pitfalls

- **Hallucinated grounding** — naming files/functions/packages that don't exist
  (or are renamed/deprecated). Verify every named symbol against the real repo.
- **Planning from assumptions** — a plausible plan that targets the wrong module
  or duplicates existing functionality because the research step was skipped.
- **Chat-message, not artefact** — vague prose, no file list, not standalone.
- **Over-planning trivia** — ceremony around a one-liner.
- **Silent ambiguity** — guessing instead of surfacing a `[NEEDS CLARIFICATION]`.
- **Rushing a one-way door** — an expensive-to-undo schema/API/format choice made
  in passing.
- **Diagram-type mismatch / broken diagrams** — forcing a sequence into a
  flowchart; shipping invalid Mermaid or ASCII that only aligns at the author's
  width.
- **Plan drift** — editing freely after approval without updating the plan.

## Reference index

Load on demand:

- `references/plan-anatomy.md` — the canonical plan structure section-by-section,
  with a worked Markdown skeleton and what each block is for.
- `references/grounding-and-reuse.md` — researching the real repo, the impact map,
  naming real symbols, reuse-before-new, the no-invention rule, and one-way- vs
  two-way-door decisions with rationale.
- `references/diagrams-and-wireframes.md` — the Mermaid diagram-type decision
  table and syntax notes, ASCII/Unicode wireframing, file-trees and annotated
  diff/code fences, and rendering/checking before handoff.
- `references/open-questions-and-approval.md` — the `[NEEDS CLARIFICATION]` gate,
  clarify-vs-assume, batching questions, the approval step, and keeping the plan
  the source of truth.
- `references/self-review.md` — the adversarial self-review pass (the sceptical
  plan-reviewer checklist) and the fix-it-yourself vs ask-the-user split.

## Boundaries

- **Heavy, exportable, standalone diagrams** (auto-layout, brand icons, PNG/SVG
  export, committable `.drawio`) → `drawio-development`. This skill uses inline
  Mermaid/ASCII for lightweight planning diagrams.
- **Actually rendering and critiquing a UI** → `ui-verification`; **how a layout
  will behave for a user** → `ux-design`; **WCAG/a11y constraints** →
  `accessibility-development`. This skill *plans* the change; those judge the result.
- **Reviewing the finished change** → `code-review-development` (the after-the-fact
  mirror). **Agent harness / plan mode / sub-agent orchestration** →
  `llm-development`.
- **API contract / versioning** → `api-development`; **schema/migration safety** →
  `sql-development`; **per-language implementation correctness** → the relevant
  language skill (`python-development`, `typescript-development`, …).
