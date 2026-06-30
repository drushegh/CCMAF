# Query tuning — evidence-first workflow

Optimise from verified evidence, never from query text alone. If key facts
are missing, return diagnostics + conditional guidance, and label every
assumption.

## Intake (verify or mark unknown)

- Engine version/edition/compat level, or Azure SQL tier / PG Flexible
  Server SKU.
- Full statement text, representative parameter values, execution
  frequency, runtime target.
- DDL of involved tables (incl. temp tables/TVFs), data types of join and
  filter columns, existing indexes, approximate row counts.
- Allowed change types: rewrite only? new index? stats? hint? no code
  change?

## Get the evidence

```sql
-- T-SQL: actual plan + IO/time
SET STATISTICS IO, TIME ON;
-- run statement; capture actual execution plan (or Query Store plan)
```

```sql
-- PostgreSQL: actual plan with buffer counts
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;
```

Rank findings by measured impact: logical reads/shared buffers hit, actual
vs estimated rows (≥10× gap = estimate problem), spills (T-SQL
sort/hash-spill warnings; PG `external merge` / `Batches > 1`), lookups ×
executions, scans where seeks were expected.

## SARGability — fix first

| Non-SARGable | Rewrite |
|---|---|
| `WHERE YEAR(OrderDate) = 2026` | `WHERE OrderDate >= '20260101' AND OrderDate < '20270101'` |
| `WHERE CONVERT(date, Dt) = @d` | `WHERE Dt >= @d AND Dt < DATEADD(day, 1, @d)` |
| `WHERE LEFT(Name,3) = 'ABC'` | `WHERE Name LIKE 'ABC%'` |
| `WHERE Amount * 1.1 > 1000` | `WHERE Amount > 1000 / 1.1` |
| `WHERE VarcharCol = 123` (implicit convert) | match literal/parameter type to column |
| PG: `WHERE lower(email) = $1` without index | expression index on `lower(email)`, or `citext` |

A syntactically clean predicate can still scan when a parameter, temp-table
column or join key has the wrong type, length or collation — check the plan
for `CONVERT_IMPLICIT` (T-SQL) / unexpected `::` casts (PG).

## Rewrite templates (least-invasive first)

| Situation | Template |
|---|---|
| Selective predicate ahead of huge joins | Stage selective keys into an indexed temp table, then join |
| Join used only for existence | `EXISTS` semi-join |
| `OR` across different columns | `UNION ALL` branches with duplicate guards |
| Catch-all optional filters | Dynamic SQL (`sp_executesql`) or `OPTION (RECOMPILE)` |
| Aggregate-then-join possible | Aggregate the detail table early when grouping preserves semantics |
| Deep `OFFSET` pagination | Keyset pagination on an indexed key |
| T-SQL table variables driving bad estimates | Temp tables (real statistics), or inline TVFs |

Prove rewrites: same results (`EXCEPT` both directions, row counts) and
better measured cost — never just a prettier plan.

## Parameter sensitivity

Confirm before fixing: does the data skew, and do compiled vs runtime
values differ (Query Store / plan cache; PG: generic vs custom plan —
`plan_cache_mode`)?

| Option | Best for | Caution |
|---|---|---|
| `OPTION (RECOMPILE)` | Variable shapes, low frequency | Compile CPU each run |
| `OPTIMIZE FOR (@p = x)` / `UNKNOWN` | Stable representative value | Ages as data changes |
| Query Store hints / forced plan | Azure SQL & 2022+, no code change | Review on regression |
| PSP optimisation (compat 160+) | Eligible skewed parameters, automatic | Pattern-limited |
| PG `plan_cache_mode = force_custom_plan` | Skewed prepared statements | Per-session/role scope |

## Statistics and cardinality

- T-SQL: `DBCC SHOW_STATISTICS` for histogram vs reality;
  `UPDATE STATISTICS ... WITH FULLSCAN` selectively. Table variables and
  multi-statement TVFs produce fixed low estimates on older compat levels —
  prefer temp tables when row counts matter.
- PG: `ANALYZE` after bulk changes; raise per-column statistics target for
  skewed high-cardinality columns
  (`ALTER TABLE ... ALTER COLUMN ... SET STATISTICS 1000`); extended
  statistics (`CREATE STATISTICS`) for correlated columns.

## Workload-level diagnostics

```sql
-- T-SQL: top CPU queries from Query Store (last hour)
SELECT TOP 20 qt.query_sql_text,
       rs.avg_cpu_time/1000.0 AS avg_cpu_ms, rs.count_executions
FROM sys.query_store_query AS q
JOIN sys.query_store_query_text AS qt ON qt.query_text_id = q.query_text_id
JOIN sys.query_store_plan AS p ON p.query_id = q.query_id
JOIN sys.query_store_runtime_stats AS rs ON rs.plan_id = p.plan_id
JOIN sys.query_store_runtime_stats_interval AS rsi
  ON rsi.runtime_stats_interval_id = rs.runtime_stats_interval_id
WHERE rsi.start_time >= DATEADD(hour, -1, GETUTCDATE())
ORDER BY rs.avg_cpu_time * rs.count_executions DESC;
```

```sql
-- PostgreSQL: requires pg_stat_statements (enabled by default on
-- Azure Flexible Server; CREATE EXTENSION once per database)
SELECT total_exec_time, mean_exec_time, calls, rows, query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Query Store is on by default in Azure SQL — use it for regression triage
(plan forcing) before reaching for hints in code.
