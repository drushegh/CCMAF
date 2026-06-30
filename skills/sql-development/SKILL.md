---
name: sql-development
description: >-
  Relational database engineering for SQL Server / Azure SQL (T-SQL) and
  PostgreSQL. Use whenever a task involves writing or reviewing SQL, designing
  or migrating schemas, indexes, slow queries or execution plans, stored
  procedures, window functions or CTEs, transactions/isolation/deadlocks,
  database security (least privilege, RLS, injection-safe dynamic SQL), or
  choosing/operating Azure SQL tiers and Azure Database for PostgreSQL
  Flexible Server. Triggers include .sql files, T-SQL, pgSQL, "slow query",
  "add an index", "deadlock", EXPLAIN/execution plan output, MERGE/upsert,
  schema change or migration scripts, and connection-pool issues. PROACTIVELY
  activate before recommending any index, hint or schema change.
---

# SQL Development

Engineering standards for the two platforms that matter in this estate:
**SQL Server / Azure SQL Database (T-SQL)** and **PostgreSQL** (typically
Azure Database for PostgreSQL Flexible Server). Apply both-platform rules by
default; platform-specific guidance is marked.

Version context (June 2026 — re-verify before asserting): SQL Server 2025 is
GA (Nov 2025, compatibility level 170); PostgreSQL 18 is current (19 in
beta); Flexible Server supports PG 18. Don't assume features beyond the
target's actual version/compat level.

## Non-negotiables

1. **Parameterise everything.** No string-concatenated SQL, ever — in
   application code, in dynamic SQL (`sp_executesql` with typed parameters /
   PG `EXECUTE ... USING`), in examples. Injection-unsafe code is a defect
   even in a draft.
2. **Set-based, not row-by-row.** Cursors and per-row loops need written
   justification. Rewrite RBAR as joins, window functions or batched DML.
3. **Evidence before optimisation.** No index, hint or rewrite
   recommendation without the actual execution plan (or `EXPLAIN (ANALYZE,
   BUFFERS)`), row counts and existing-index DDL. If evidence is missing,
   provide diagnostics to gather it, plus conditional guidance — not a final
   prescription. State assumptions explicitly.
4. **SARGable predicates.** No functions, expressions or implicit
   conversions on filtered/joined columns. Match parameter and column types
   exactly (length, precision, collation).
5. **Explicit transaction discipline.** T-SQL: `SET XACT_ABORT ON` +
   `TRY/CATCH` + `THROW` in every procedure that writes. Both platforms:
   keep transactions short; never hold one across user/agent interaction or
   external calls.
6. **Least privilege.** Application principals get object/schema-level
   grants, never `db_owner`/superuser. Schema-qualify object references.
7. **Correct types from the start.** PG: `bigint` identity keys, `text`,
   `timestamptz`, `numeric` for money. T-SQL: avoid `NVARCHAR(MAX)` as a
   default, use `datetime2`/`datetimeoffset` not `datetime`, `decimal` for
   money. Never store numbers, dates or booleans as strings.
8. **Migrations are forward-only, idempotent and reviewed** — expand →
   migrate → contract for anything a live application depends on.

## Decision tables

| Need | Use |
|---|---|
| Upsert (T-SQL) | `MERGE` with `HOLDLOCK`/serialisable guard, or guarded `UPDATE`+`INSERT`; capture changes with `OUTPUT` |
| Upsert (PG) | `INSERT ... ON CONFLICT DO UPDATE` |
| Top-N per group | `ROW_NUMBER()` in CTE; T-SQL `CROSS APPLY ... TOP n` / PG `LATERAL ... LIMIT n` |
| Pagination | Keyset (cursor) pagination on an indexed key — not `OFFSET` for deep pages |
| Existence test | `EXISTS`, not `JOIN` + `DISTINCT`, not `COUNT(*) > 0` |
| Queue/worker pickup | `SELECT ... FOR UPDATE SKIP LOCKED` (PG) / `READPAST` + `UPDLOCK` (T-SQL) |
| Optional predicates (`@p IS NULL OR col=@p`) | Dynamic SQL via `sp_executesql`, or `OPTION (RECOMPILE)` for low-frequency paths |
| Analytics over large fact tables | Columnstore (T-SQL); BRIN/partitioning + aggregates (PG) |

| Symptom | First check |
|---|---|
| Scan where seek expected | SARGability, type/collation mismatch (`CONVERT_IMPLICIT`), missing/unsuitable index |
| Fast for some parameters, slow for others | Parameter sniffing — confirm skew via Query Store / `pg_stat_statements` before fixing |
| Estimate vs actual off ≥10× | Stale statistics, table variables/TVFs (T-SQL), correlated predicates |
| Blocking/deadlocks | Transaction length, lock ordering, missing FK indexes (PG), isolation level |
| Sudden regression, no deploy | Plan change — Query Store forced plan (T-SQL) / `ANALYZE` + plan check (PG) |

## High-frequency pitfalls

- **Missing-index DMV/hypopg output treated as design.** It's a candidate:
  merge with existing indexes, count the write cost, then decide.
- **PG foreign keys are not auto-indexed** — index the referencing column or
  pay for it on every join and parent delete.
- **`NOLOCK` as a performance fix.** It reads dirty/duplicate/missing rows.
  Prefer RCSI (on by default in Azure SQL) or fix the blocking cause.
- **`MERGE` without a concurrency guard** races under load; PG `ON CONFLICT`
  needs the right unique constraint, and `DO NOTHING` silently drops rows.
- **Filtered/partial indexes that parameterised queries can't use** — the
  predicate must provably imply the filter at compile time.
- **Wide "covering" indexes** whose INCLUDE bloat costs more than the
  lookups they save; duplicate/overlapping indexes never consolidated.
- **GUID/UUIDv4 clustering keys** fragmenting T-SQL clustered indexes — use
  sequential surrogates (PG 18+: `uuidv7()` mitigates).
- **`WHERE` predicates on the outer table of a `LEFT JOIN`** silently
  converting it to an inner join.
- **Untested restores and unbounded autogrowth** — backups exist when a
  restore has been proven, not before.

## Workflow for changes

1. Capture intent + current behaviour (plan, reads, duration, frequency).
2. Verify schema, types, constraints, existing indexes, row counts.
3. Choose the least-invasive fix: rewrite → statistics → index → hint.
4. Prove equivalence for rewrites (`EXCEPT` both directions / row counts).
5. Measure before/after with the same evidence type you started with.
6. Ship schema changes as reviewed, idempotent migration scripts.

## Reference index

Load on demand:

- `references/schema-design.md` — types, keys, constraints, naming, normalisation pragmatics
- `references/indexing.md` — index types and design on both platforms, maintenance
- `references/query-tuning.md` — evidence-first tuning, plans, statistics, parameter sensitivity
- `references/advanced-queries.md` — window functions, CTEs, APPLY/LATERAL, upserts, JSON
- `references/transactions-concurrency.md` — isolation, locking, deadlocks, retry patterns
- `references/security.md` — injection-safe dynamic SQL, privileges, RLS, encryption
- `references/platform-azure.md` — Azure SQL tiers/tuning; PG Flexible Server; connections
- `references/migrations.md` — expand–contract, SSDT/DACPAC vs script-based, online changes

## Boundaries

- **EF Core / data access from .NET** → `dotnet-development` (ef-core).
- **KQL / Log Analytics queries** → `sentinel-development`.
- **Fabric warehouse / lakehouse SQL** → `fabric-development`.
- **Dataverse tables and TDS endpoint** → `dynamics-365-development` /
  `power-platform-development`.
- **Injection taxonomy, secrets handling, supply chain** →
  `secure-development` (this skill owns the SQL-side patterns).
- **CI/CD pipelines that deploy databases** → `devops-development`.
