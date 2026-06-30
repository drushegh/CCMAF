# Schema design — types, keys, constraints, naming

## Data types

PostgreSQL defaults:

```sql
CREATE TABLE app.users (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  is_active   boolean NOT NULL DEFAULT true,
  price       numeric(10,2),
  metadata    jsonb
);
```

- `bigint` identity, not `int` (overflow at 2.1bn) and not `serial`
  (legacy; identity is SQL-standard and grant-friendlier).
- `text`, not `varchar(n)`, unless the length limit is a real business
  rule — performance is identical.
- `timestamptz` always; bare `timestamp` loses offset information.
- `numeric` for money; never `float`/`real` for exact quantities.
- UUID keys: prefer `uuidv7()` (PG 18+) over `gen_random_uuid()` for
  index locality.

SQL Server / Azure SQL defaults:

- `int`/`bigint` identity surrogate keys; avoid random `UNIQUEIDENTIFIER`
  as the clustered key (page splits) — if a GUID key is required, use
  `NEWSEQUENTIALID()` or cluster on a different column.
- `datetime2(3)` (or `datetimeoffset` when offset matters), never `datetime`
  (3.33 ms precision, 1753 floor) or `smalldatetime`.
- `decimal(p,s)` for money — the `money` type rounds awkwardly in division.
- Size string columns deliberately: `NVARCHAR(50)` etc. `NVARCHAR(MAX)`
  can't be an index key and pushes data off-row; use only for genuinely
  unbounded text. Use `VARCHAR` when the data is provably ASCII-safe and
  volume matters; mind collation joins.
- SQL Server 2025 adds a native `json` type and `vector`; on older
  versions/compat levels store JSON in `NVARCHAR(MAX)` with `ISJSON()`
  checks.

Both platforms: never store numbers, dates or booleans as strings; never
encode multiple values in one column (comma lists) — use a child table or
array/jsonb (PG) with a justification.

## Keys and constraints

- Every table gets a primary key. Add `UNIQUE` constraints for every
  natural key the business relies on — the optimiser also uses them.
- Foreign keys ON by default; `ON DELETE` behaviour chosen explicitly
  (`RESTRICT`/`NO ACTION` unless cascading is a designed behaviour).
  Trusted FKs let both optimisers eliminate joins.
- `CHECK` constraints for domain rules (status values, ranges,
  cross-column rules). PG: `CHECK` + lookup table or enum; enums are
  cheap but `ALTER TYPE ... ADD VALUE` has transactional quirks — a
  lookup table is the flexible default.
- `NOT NULL` everywhere a value is logically required. Adding it later:
  PG ≥12 validates `NOT NULL` via a cheap constraint check; T-SQL needs
  `WITH CHECK` and a scan — plan the window.
- Constraint violations are cheaper than the bugs they prevent; "validate
  in the app instead" is a false economy with multiple writers.

## Naming and identifiers

- PG: lowercase `snake_case` only. Quoted mixed-case identifiers infect
  every future query with quoting requirements.
- T-SQL: consistent `PascalCase` or `snake_case` per estate convention;
  always schema-qualify (`dbo.Orders`, `app.users`) in code and grants.
- Name constraints and indexes deterministically:
  `pk_<table>`, `fk_<table>_<ref>`, `uq_<table>_<cols>`,
  `ix_<table>_<cols>` (T-SQL) / `<table>_<cols>_idx` (PG convention).
  Auto-generated names make migrations and drift comparison painful.
- No `sp_` prefix on stored procedures (reserved lookup path in SQL
  Server).

## Normalisation pragmatics

- Default to 3NF for transactional schemas; denormalise only with a
  measured read-path justification, and document the update anomaly you
  accepted.
- Wide "god tables" with 100+ nullable columns are a smell — split by
  access pattern or use jsonb/sparse columns for genuinely open-ended
  attributes.
- Reporting workloads belong in a star schema or a read model, not in
  ever-wider joins over the OLTP schema (cross-ref: `power-bi-development`
  for the modelling side, `fabric-development` for warehouse SQL).

## Partitioning (when, not how-to-everything)

- Consider only when a single table's size causes real maintenance or
  query pain (typically ≥100 GB / billions of rows) or a sliding-window
  retention requirement exists.
- T-SQL: partition function/scheme; keep indexes aligned or partition
  switching breaks. Elimination requires SARGable predicates on the
  partitioning column — verify it in the plan, don't assume it.
- PG: declarative range/list partitioning; indexes are per-partition;
  ensure the partition key is in every unique constraint.
- Partitioning is a manageability feature first; it rarely speeds up
  well-indexed point queries and can slow them down.
