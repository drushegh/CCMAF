# Delta Optimisation and Direct Lake Interplay

File layout is the shared performance contract for every engine reading
OneLake (Spark, SQL endpoint, Direct Lake).

## The levers

- **V-Order** (`spark.sql.parquet.vorder.default=true`): Fabric's
  columnar sort/compression pass on Parquet — the single biggest read
  win for Direct Lake and SQL endpoint. On for Silver/Gold; **off for
  Bronze** (write-heavy, nothing reads it interactively).
- **Optimize Write** (`spark.databricks.delta.optimizeWrite.enabled=true`,
  `binSize` ~1g): coalesces small partition writes into right-sized
  files at write time — the small-file-problem preventer.
- **OPTIMIZE** (compaction) after significant Silver/Gold writes;
  `OPTIMIZE ... ZORDER BY (col, ...)` co-locates frequently filtered
  columns. Schedule it; don't rely on ad hoc runs.
- **VACUUM** reclaims old files but kills time travel beyond retention
  — check downstream dependencies (auditors, reprocessing, Direct Lake
  framing) before running; never default-VACUUM Bronze.
- **Partitioning**: by ingestion date (Bronze) / business date
  (Silver/Gold). Don't over-partition — high-cardinality partition
  columns create the small-file problem Optimize Write exists to solve.
- Prefer fewer, larger Delta tables with schemas over many small
  tables; integer keys over strings; drop unused columns at Silver.

## Direct Lake (the consumer that punishes sloppy layout)

Direct Lake semantic models read Delta files straight from OneLake — no
import copy, no DirectQuery translation per visual. The platform facts
that matter to data engineers:

- **Framing**: a "refresh" of a Direct Lake model just re-points it at
  the current table version — cheap and instant. Data freshness is
  governed by your Delta writes, not model refresh schedules.
- **DirectQuery fallback**: queries fall back to the SQL endpoint
  (slower, different semantics) when guardrails are exceeded (row/size
  limits per SKU) or features force it. Fallback shows up as sudden
  inconsistent performance — check the guardrails before blaming DAX.
- **No design-time validation**: relationship one-side uniqueness is
  checked at **query time** — duplicate keys in the Delta table fail
  visuals in production. Validate uniqueness in Silver/Gold quality
  checks (`COUNTROWS` vs `DISTINCTCOUNT` probes) and exercise joins
  with a real `SUMMARIZECOLUMNS` query after changes.
- Exact data-type match required across relationships (cast
  GUID/binary to string upstream); calculated columns/tables don't
  materialise on Direct Lake — push them into the Delta tables.
- Write-pattern discipline: many tiny appends churn versions and
  degrade framing; batch writes, OPTIMIZE after, keep V-Order on.

Model-side design (DAX, relationships, RLS) is power-bi-development's
territory — but the Delta layout obligations above are yours.

## SQL analytics endpoint notes

Read-only T-SQL over lakehouse Delta; metadata sync from Delta to the
endpoint can lag briefly after writes — pipelines that write then
immediately query the endpoint need a sync check, not a sleep-and-hope.
Warehouse (not lakehouse) is the answer when full T-SQL DML and
multi-table transactions are the workload.

Docs: https://learn.microsoft.com/fabric/data-engineering/delta-optimization-and-v-order ·
https://learn.microsoft.com/fabric/fundamentals/direct-lake-overview ·
https://learn.microsoft.com/fabric/data-warehouse/sql-analytics-endpoint-performance
