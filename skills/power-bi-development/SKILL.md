---
name: power-bi-development
description: >-
  Power BI development: semantic model design (star schema, relationships,
  RLS), DAX authoring and performance, Power Query / M and query folding,
  TMDL and PBIP file formats, report layer, and deployment/ALM. Use this
  skill whenever Power BI work is created, edited, reviewed, or debugged —
  even if the user says "dataset", "data model", "report", or "dashboard".
  Triggers include: DAX measures or calculated columns, slow visuals or
  queries, star schema or relationship design, .pbip / .tmdl / PBIR files,
  Power Query M partitions, query folding, RLS roles, semantic model
  audits, deployment pipelines, XMLA, VertiPaq size, or Copilot/AI
  readiness of a model.
---

# Power BI Development

Consolidated Power BI engineering for agents, grounded in Microsoft Learn
and data-goblin/power-bi-agentic-development (Kurt Buhler's plugin
marketplace — exceptionally rigorous, SQLBI/MS Learn-sourced throughout).
Fabric platform work (lakehouses, pipelines, notebooks, Direct Lake
plumbing) belongs to fabric-development; this skill covers the semantic
model and report layers wherever they run.

## Star Schema Is Not Optional

Fact tables plus conformed dimensions, single-direction 1:M
relationships. Snowflakes get flattened upstream; **two facts are never
related to each other** (relate both to shared dimensions). Header/detail
sources are denormalised to line grain — a fact-to-fact join on a
high-cardinality order number is a measured 15x CPU regression. Decide
storage mode and refresh strategy **before** building; both are near
one-way doors after publish.

## The Correctness Traps (memorise these)

- **Variables freeze at definition.** `VAR x = [Sales]` then
  `CALCULATE(x, SAMEPERIODLASTYEAR(...))` is a no-op time-shift — the
  most common silently-wrong refactor. Keep the measure reference inside
  the `CALCULATE`.
- **DIVIDE by default**; bare `/` only inside hot iterators with a
  proven non-zero denominator.
- **Measure vs calculated column**: if the value must respond to user
  filters it must be a measure — a calc column is frozen at refresh.
  `CALCULATE` inside a calc column is the circular-dependency generator.
- **Filter columns, not tables**, in `CALCULATE` predicates.
- **Limited relationships drop unmatched rows silently** (inner join, no
  blank member). Many-to-many and cross-source-group relationships are
  limited; orphaned fact rows just vanish from totals.
- Always test measures **against a slicer selection** — unfiltered
  visuals hide context bugs.

## The Workspace Confirmation Rule (MANDATORY)

Before the FIRST operation that touches a shared workspace or published
model — deploy, publish, XMLA write, refresh trigger: state the target
workspace/model, verify the connection, get explicit confirmation.
Dev/test/prod workspaces coexist in every tenant. Once confirmed for a
session+target, don't re-ask per operation.

## Editing Models as Files

PBIP + TMDL is the source-control-native format: one `.tmdl` per table,
`relationships.tmdl`, `expressions.tmdl`, roles per file. TMDL
indentation is **semantic** (tabs in PBIP), `///` is the Description
property, names with spaces/digits get single quotes. Full syntax and the
namespace-collision trap: references/tmdl-pbip.md.

## Model Hygiene Defaults

Keys/attributes/dates/flags get `summarizeBy: none`; surrogate keys are
hidden, never deleted; every measure ships with FormatString,
DisplayFolder, and a Description (Copilot truncates after ~200 chars —
write them for it); auto date/time off, one marked date table; no
implicit measures in production models; report-scoped measures migrate
into the model.

## Agent Workflow Rules

- Inspect before changing: read the TMDL/model metadata, enumerate
  relationships (`INFO.VIEW.RELATIONSHIPS()` via a DAX query) — never
  assume the topology.
- Prove DAX rewrites by **executing both versions across filter
  contexts** and diffing results, not by inspection.
- Renames break downstream reports silently — check lineage before
  renaming, then propagate to report bindings.
- Push transforms upstream: source/warehouse → Power Query (folded) →
  calc column → measure is the cost ladder; prefer the leftmost rung
  that's correct (measures when filter context is needed).
- For tooling-heavy workflows (Tabular Editor CLI, BPA, VertiPaq
  analysis, live traces), data-goblin/power-bi-agentic-development is the
  reference marketplace — use it rather than improvising.

## References

| File | Load when |
| --- | --- |
| references/semantic-modeling.md | Star schema, SCD2, bridges, relationships, ambiguity |
| references/dax-authoring.md | Writing correct DAX: variables, context, common traps |
| references/dax-performance.md | Slow measures/queries, FE/SE, optimization patterns |
| references/power-query-m.md | M partitions, query folding, transform placement |
| references/tmdl-pbip.md | TMDL syntax, PBIP project structure, file editing |
| references/deployment-reports.md | Workspaces, pipelines, XMLA, report layer, RLS ops |
