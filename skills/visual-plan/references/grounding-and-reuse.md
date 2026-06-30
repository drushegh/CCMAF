# Grounding and reuse

A plan is only as true as the names in it. To make one *true*: research the real
repository first, name only things that demonstrably exist, prefer extending
what's there over new code, and decide the hard-to-reverse bets deliberately. The
repository — not your training memory — is the single source of truth. This
sharpens non-negotiables 2–4 of the parent `SKILL.md`; the structure these
decisions live in is in `plan-anatomy.md`.

## Research first: build the impact map

Before drafting a word, find out what actually changes — don't reason from the name
of the feature, open the files.

1. **Locate the seam.** Search for the symbols, routes, tables or strings the
   change touches — ripgrep for literals, the language server / code search for
   definitions and references. Find where the behaviour lives *today*.
2. **Read the real files**, not just their names — the module you'll change, its
   callers, its tests, and the nearest sibling that already does something similar
   (that sibling is your template for conventions).
3. **Draw the impact map** — a short list of the real files/modules that change and
   how, the spine of the File map and Per-step sections. Delegate wide exploration
   to subagents so only findings return to context.

```text
modules/sbom/src/model.rs    EDIT  add CycloneDx variant to QueryResult
modules/sbom/src/service.rs  EDIT  reuse SbomService::export_json pattern
modules/sbom/src/http.rs     EDIT  new GET /sbom/{id}/cyclonedx route
modules/sbom/tests/export.rs NEW   round-trip test, mirrors export_json test
```

If the map can't be built from the code, that gap is an Open Question, not a guess.

## The no-invention rule

AI agents hallucinate file paths, APIs, packages and function signatures because
they generate from a statistical prior — the average of every codebase seen in
training — not from *this* repository. The result is plausible and wrong: a path
that should exist, a method with the right shape and wrong name, a package renamed
two majors ago. This is the single most damaging plan failure: a reviewer approves
a confident plan, implementation starts, and the foundations dissolve on first
contact. (Current practice; verified June 2026.) The rule is therefore absolute:
**every named symbol, path, package and signature must be verified to exist in the
repo as written.** Saw it in a file you opened or a search returned it → name it.
Inferred it or "it's probably called that" → verify or treat as unknown; don't
launder a guess into the plan with confident prose. A package/version is a claim
too — confirm it's in the manifest at the version assumed. When you genuinely can't
verify, say so — `[NEEDS CLARIFICATION]` — and keep going. An honest unknown is
cheap; a confident fiction is expensive.

## Name real symbols and patterns

Harness-engineering principle: **the more you constrain the solution space, the
more predictable the output becomes.** A grounded plan is a constraint. Vague
language ("add a serialiser", "wire up the export") leaves the implementer to
re-derive decisions you already made, and re-derive them wrongly. Replace category
nouns with repository coordinates:

| Ungrounded (avoid) | Grounded (do this) |
|---|---|
| "add a result type" | "reuse the `QueryResult` type in `modules/sbom/src/model.rs`" |
| "add a JSON export" | "follow the JSON export pattern in `SbomService::export_json()`" |
| "add a migration" | "add migration after `0007_add_sbom_table`, same `up`/`down` shape" |

Name the file, the symbol, the pattern to mirror. The plan should read like
directions through a city the author has walked, not a description of one imagined.

## Reuse before new

For each step, list the existing functions, types, components and helpers the
change *extends* — explicitly, before naming anything new. This proves the plan
isn't duplicating logic that exists or orphaning a path. New code is a liability
you justify, not a default:

```text
Step 3 — CycloneDX export
  reuses:  QueryResult (model.rs) · SbomService::export_json pattern (service.rs)
  new:     to_cyclonedx() on SbomService — only the format mapping is genuinely new
```

If a step reuses nothing, ask why — either you missed the existing helper, or the
feature truly is greenfield (rare in a mature repo). Reuse-checking is also where
you catch a design that fights the codebase's grain; reviewing the *result* belongs
to `code-review-development`.

## One-way vs two-way doors

Jeff Bezos's framing: a **two-way door** is reversible — walk back if it's wrong; a
**one-way door** is hard or impossible to undo. So **reversible decisions, decide
fast** on ~70% of the information (waiting costs more than the occasional cheap
reversal — internal names, private layout, log formats); **irreversible decisions,
decide slowly and get them right *in the plan***. Common one-way doors — treat each
as deliberate, not incidental:

| Door | Why it's hard to reverse |
|---|---|
| Schema / migration shape | Data already written in the old shape; backfills are risky |
| Public API / wire format | External callers depend on it; breaking changes ripple |
| Public IDs (slugs, keys, URNs) | Leak into links, logs, third-party systems forever |
| Auth / trust boundaries | Mistakes are security incidents → `secure-development` |
| Dependency adoption | Lock-in, supply-chain and licence surface that's hard to shed |
| File / module layout (public) | Import paths and downstream tooling bind to it |

A **Decisions** section labels each choice *reversible*/*irreversible* with a
one-line rationale, so a reviewer spends scrutiny where reversal is expensive
(schema/migration safety → `sql-development`; section shape in `plan-anatomy.md`).
Then scope the smallest first cut that *proves the approach without foreclosing
it* — a thin vertical slice exercising the one-way doors end to end. The test isn't
"is it small?" but "does it commit the irreversible decisions correctly while
leaving the reversible open?"

## Carry the project's conventions

A grounded plan reflects the project's *real* conventions, not a generic structure
you'd impose. Before drafting, read `CLAUDE.md` / `AGENTS.md`, `.cursor/rules/`,
`CONTRIBUTING.md` and the lint/style config — then the nearest existing feature of
the same shape, whose de-facto convention beats any written one when they disagree.
Mirror the project's real naming, layering and test placement: a plan that imposes
`services/` on a repo organised by `modules/`, or adds a test harness the repo
doesn't use, signals the research step was skipped — what `self-review.md` checks.
