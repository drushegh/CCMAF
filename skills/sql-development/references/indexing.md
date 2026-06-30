# Indexing — design, platform specifics, maintenance

Index advice must be workload-aware: the best index for one query can hurt
writes, storage and other queries. Never emit DDL from a missing-index
DMV/hypothetical-index suggestion without comparing existing indexes and
counting the write cost.

## Design workflow

1. Map query columns by role: equality predicates → leading key columns
   (most selective/reused first); join keys → seek keys; range predicate →
   after equality keys (only one range seeks deeply); `ORDER BY`/`GROUP BY`
   → key order to avoid sorts; output-only columns → INCLUDE (T-SQL) /
   `INCLUDE` (PG 11+) or accept the heap/lookup fetch.
2. Fix SARGability and type mismatches first — an index can't help a
   predicate wrapped in a function or fighting a `CONVERT_IMPLICIT`.
3. Compare against existing indexes: extend one, merge overlapping
   candidates, delete duplicates (same leading keys) before adding.
4. Cost it: write frequency, storage, maintenance window, and (T-SQL)
   whether the table is too hot for an offline build.

```sql
-- Equality (CustomerID), then range (OrderDate), covering two outputs
CREATE NONCLUSTERED INDEX IX_Orders_CustomerDate
ON dbo.Orders (CustomerID, OrderDate)
INCLUDE (Status, TotalAmount);
```

```sql
-- PostgreSQL equivalent; build without blocking writes
CREATE INDEX CONCURRENTLY orders_customer_id_order_date_idx
ON orders (customer_id, order_date) INCLUDE (status, total_amount);
```

## Platform index types

| Need | SQL Server / Azure SQL | PostgreSQL |
|---|---|---|
| Default row store | Clustered index (choose deliberately: narrow, unique, static, increasing) | Heap + B-tree indexes (no clustering; `CLUSTER` is one-off) |
| Selective subset | Filtered index | Partial index |
| Avoid lookups | INCLUDE columns | INCLUDE columns (covering, enables index-only scans — needs healthy visibility map) |
| Analytics scans | Clustered/nonclustered columnstore | BRIN (correlated data), or partitioning + pre-aggregation |
| jsonb / arrays | — (use computed columns + index) | GIN (`jsonb_path_ops` for `@>`-only workloads) |
| Text search | Full-text index | GIN on `tsvector` (see PG full-text docs) |
| Expression | Index on persisted computed column | Expression index directly |

Filtered/partial index caveat (both platforms): the query predicate must
imply the filter at plan time. Parameterised queries often can't use
`WHERE Status = 'Open'` filtered indexes — verify in the plan; consider
literal-bearing dynamic SQL or accept a normal index.

PostgreSQL: **foreign keys are not auto-indexed.** Index every referencing
column unless measured as pointless — joins and parent deletes depend on it.
T-SQL auto-indexes nothing either, but the FK-join pain is identical; the
difference is PG developers more often assume otherwise.

Columnstore (T-SQL): load in ≥102,400-row batches to skip the deltastore;
`REORGANIZE` to merge rowgroups; avoid high-frequency singleton updates.

## What to watch in usage data

```sql
-- T-SQL: usage since restart — candidates for consolidation/removal
SELECT OBJECT_NAME(i.object_id) AS TableName, i.name,
       ius.user_seeks, ius.user_scans, ius.user_lookups, ius.user_updates
FROM sys.indexes AS i
LEFT JOIN sys.dm_db_index_usage_stats AS ius
  ON ius.object_id = i.object_id AND ius.index_id = i.index_id
 AND ius.database_id = DB_ID()
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1;
```

```sql
-- PostgreSQL: unused indexes (check replicas too before dropping)
SELECT relname, indexrelname, idx_scan
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;
```

High `user_updates` with near-zero reads (T-SQL) or `idx_scan = 0` (PG,
across all nodes, over a representative window) → consolidation candidate.
Missing-index DMV output ranks by estimated impact only — merge overlapping
suggestions and sanity-check key order yourself.

## Maintenance

- T-SQL rule of thumb: <5% fragmentation ignore; 5–30% `REORGANIZE`;
  >30% `REBUILD` — only when page count is non-trivial (≥~1,000 pages)
  and the workload actually suffers. Azure SQL: use
  `ONLINE = ON, RESUMABLE = ON` for large rebuilds.
- Statistics matter more than fragmentation for plan quality:
  `UPDATE STATISTICS ... WITH FULLSCAN` selectively after large data
  changes; rely on auto-update + auto-create otherwise.
- PG: autovacuum is the maintenance system — don't disable it, tune it
  (per-table `autovacuum_vacuum_scale_factor` for hot tables). Bloat from
  long-running transactions blocking vacuum is the usual culprit, not
  "index rot". `REINDEX CONCURRENTLY` for genuinely bloated indexes.
- After bulk loads: PG `ANALYZE` explicitly; T-SQL check stats freshness.
