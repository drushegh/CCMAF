# Lakehouses and Medallion Architecture

## Lakehouse anatomy

Creating a lakehouse (set `enableSchemas: true` — without it you only
get `dbo`) provisions: `Tables/` (managed Delta, auto-discovered),
`Files/` (unmanaged staging), a **SQL analytics endpoint** (read-only
T-SQL over the Delta tables), and OneLake paths. Deleting one cascades:
SQL endpoint gone, OneLake data gone, dependent shortcuts dead,
referencing notebooks fail at runtime.

Schemas organise tables (`bronze`/`silver`/`gold` within a lakehouse, or
domain separation) and enable four-part Spark SQL names:
`workspace.lakehouse.schema.table` for cross-workspace reads.

**Lakehouse vs warehouse**: lakehouse = Spark-first, files + tables,
SQL endpoint is read-only. Warehouse = T-SQL-first with full DML/DDL,
multi-table transactions. Same OneLake storage underneath. Pick by the
team's primary skill set and write patterns; don't run both for the
same data.

## Medallion: must / prefer / avoid (Microsoft's own rules)

**Must**: separate lakehouse per layer (default: separate *workspaces*
per layer — `{project}-bronze-{env}` etc. — with per-layer RBAC); Delta
format everywhere; Bronze metadata columns (ingestion timestamp, source
file, batch ID); data-quality rules at Bronze→Silver (dedupe, nulls,
range checks); partition-aware overwrite in Silver/Gold; validation
after each layer (row counts, schema checks).

**Prefer**: incremental processing (watermark pattern) over full
refresh; one notebook per layer; Z-ORDER on filtered Gold columns;
OPTIMIZE after Silver/Gold writes; shortcuts to expose Gold to consumer
workspaces; Variable Libraries for paths/config; engineers own
Bronze/Silver, analysts own Gold.

**Avoid**: all layers in one lakehouse; skipping Silver; hard-coded
workspace/lakehouse IDs; `SELECT *` without LIMIT on Bronze;
VACUUM without dependency checks; shortcut chains between layers;
reading external URLs directly from Spark (land in `Files/` first).

## Layer optimisation profiles

| Layer | Profile | Settings |
| --- | --- | --- |
| Bronze | write-heavy | V-Order **off**, autoCompact on, partition by ingestion_date |
| Silver | balanced | V-Order on, AQE, partition by business date, Z-ORDER on filter columns |
| Gold | read-heavy | `spark.sql.parquet.vorder.default=true`, `optimizeWrite.enabled=true` (`binSize` 1g), Z-ORDER, pre-aggregated metrics |

Set the Gold session configs **before any writes** in the notebook.

## End-to-end flow (don't stop early)

Create workspaces/lakehouses → create notebooks (valid `.ipynb`: every
code cell has `"outputs": []`, `"execution_count": null`) → **bind each
notebook's default lakehouse** (`metadata.dependencies.lakehouse`) →
execute sequentially Bronze→Silver→Gold (`jobType=RunNotebook`,
execution config needs both lakehouse `id` and `name`) → validate row
counts → connect Power BI to Gold (Direct Lake model over the SQL
endpoint) → create the orchestration pipeline. "Notebooks created" is
half a job — the official skill calls stopping there out by name.

## Silver/Gold write patterns

```python
# Partition-aware overwrite (Silver/Gold) — only replaces touched partitions
(df.write.format("delta").mode("overwrite")
   .option("replaceWhere", f"business_date = '{processing_date}'")
   .saveAsTable("silver.orders"))

# Schema evolution when the source changed (coordinate downstream first)
(df.write.format("delta").mode("append")
   .option("mergeSchema", "true")
   .saveAsTable("silver.orders"))
```

Time travel (`VERSION AS OF` / `TIMESTAMP AS OF`) is the Bronze audit
and rollback tool — retention bounded by `VACUUM`, so set Bronze
retention deliberately.

Docs: https://learn.microsoft.com/fabric/data-engineering/lakehouse-overview ·
https://learn.microsoft.com/fabric/data-engineering/lakehouse-schemas ·
https://learn.microsoft.com/fabric/onelake/onelake-medallion-lakehouse-architecture
(plus microsoft/skills-for-fabric e2e-medallion-architecture)
