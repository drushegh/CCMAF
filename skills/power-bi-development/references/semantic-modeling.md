# Semantic Model Design

## Star schema patterns

- **SCD2 (history-keeping) dimensions**: surrogate key per version,
  durable/natural key per entity, `ValidFrom`/`ValidTo`. Two silent bugs
  arrive with them: `DISTINCTCOUNT(Fact[CustomerKey])` counts *versions*
  (use `COUNTROWS(SUMMARIZE(Fact, Dim[DurableCode]))` — evaluated through
  the fact so the storage engine solves it); and slicing by a changing
  attribute gives point-in-time grouping by default. For current-state
  reporting, split the changing attributes into a separate type-1
  dimension keyed on the durable key — "region now" and "region at time
  of sale" become different tables, chosen explicitly.
- **Junk dimensions**: fold several low-cardinality flags into one
  dimension (Cartesian of distinct values, or observed tuples to avoid
  impossible slicer pairs). Only viable while the product of distinct
  counts stays small.
- **Header/detail**: denormalise header attributes onto the line fact.
  Header-grain measures (freight, fees) then double-count if summed —
  de-dup with `SUMX(VALUES(Sales[OrderNo]), CALCULATE(MAX(Sales[Freight])))`
  and hide the raw column; or, when header measures are numerous, keep
  two facts *at their natural grains* related only to shared conformed
  dimensions.
- **Many-to-many**: prefer a **factless-fact bridge** (two keys, two
  regular 1:M legs, exactly one leg bidirectional) over a native M:M
  relationship — same filtering, but inspectable, RLS-capable, and
  Regular (RI violations surface under blank instead of vanishing). M:M
  grand totals are non-additive — document that in the measure
  description so it isn't read as a bug.
- **Degenerate dimensions**: one attribute → hidden fact column; two
  correlated attributes (order no + line no) → separate 1:1 dimension on
  a composite surrogate, built at fact grain.

## Relationships

- **Regular vs limited** is inferred, not set: M:M cardinality or
  cross-source-group ⇒ limited. Regular 1:M joins LEFT OUTER and shows
  RI violations under (Blank); **limited joins INNER and silently drops
  orphaned rows from every total**. `RELATED()` errors across a limited
  relationship. Probe orphans with an anti-join on the keys before
  trusting totals.
- **Ambiguity** is resolved by fixed priority tiers (1:M-only paths
  first), then path weight — or rejected as an error only when tied.
  Adding "the relationship the measure needs" can flip the chosen path
  and change every cross-table total without an error. Map topology
  before/after edits; for diamonds keep one active path and select per
  measure with `USERELATIONSHIP`.
- **Inactive relationships nothing activates are defects**: cross-ref
  inactive relationships against `USERELATIONSHIP` usage; each dead one
  is a missing measure, a deletion candidate, or a role-playing
  dimension that should be physically duplicated (the duplicate-table
  pattern also keeps Q&A/Copilot working — they can't inject
  `USERELATIONSHIP`).
- Bidirectional cross-filter is a last resort: prefer `CROSSFILTER(...,
  BOTH)` scoped inside one measure, or a bridge with one bidirectional
  leg. Model-level bidirectional flags are the usual ambiguity source
  and interact badly with RLS.
- **Direct Lake validates nothing**: one-side uniqueness is unchecked
  until **query time** — duplicates in the Delta table fail visuals at
  runtime, not at deploy. Exact data-type match required across the
  relationship. After any Direct Lake relationship change, run a real
  `SUMMARIZECOLUMNS` query to exercise the join. (Direct Lake mechanics
  live in fabric-development.)

## Security (RLS/OLS)

- RLS = role + DAX table filters; static (`[Region] = "IE"`) or dynamic
  (`[Email] = USERPRINCIPALNAME()` against a security mapping table).
- Filters flow along relationships; bidirectional + RLS either blocks or
  leaks — set `securityFilteringBehavior` deliberately and test with
  "view as role" plus a real non-admin account.
- Fail **closed**: a user matching no mapping rows must see nothing —
  verify the no-match case explicitly; an unfiltered fallback is the
  classic fail-open defect.
- `USERELATIONSHIP` is blocked on RLS-bearing relationships.
- OLS (object-level security) hides tables/columns per role — breaks any
  visual referencing the hidden object, so pair with report design.
- Workspace roles trump RLS: members/admins bypass it; RLS applies to
  viewers and app consumers only.

## Storage modes

Import (VertiPaq, fastest, refresh-bound) → default. DirectQuery only
for genuine real-time/size constraints — most "we need DirectQuery"
requirements are refresh-frequency requirements in disguise. Dual for
shared dimensions in composites. Direct Lake (Fabric) reads Delta
directly with framing semantics — see fabric-development. Calculated
columns/tables don't materialise under DirectQuery or Direct Lake;
default to measures or upstream columns when a model might move there.

Docs: https://learn.microsoft.com/power-bi/guidance/star-schema ·
https://learn.microsoft.com/power-bi/transform-model/desktop-relationships-understand ·
https://learn.microsoft.com/power-bi/enterprise/service-admin-rls ·
https://learn.microsoft.com/fabric/fundamentals/direct-lake-overview
