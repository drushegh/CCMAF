# Ingestion and Orchestration

## Choosing the tool (decision table)

| Need | Use |
| --- | --- |
| Recurring copy from external sources (HTTP, DBs, SFTP, cloud storage) | **Pipeline Copy activity** |
| Code transforms, quality rules, medallion layer logic | **Notebook** (Spark) |
| Low-code/self-service shaping by analysts | **Dataflow Gen2** (Power Query, writes to lakehouse/warehouse) |
| Data already in ADLS/S3/GCS/another workspace | **OneLake shortcut** (no copy) |
| Bulk load into warehouse tables | **COPY INTO** (T-SQL) |
| Streaming events | **Eventstream** → lakehouse/eventhouse |

Anti-patterns: Dataflows Gen2 for heavy engineering transforms (cost
and opacity — that's notebook work); copying data a shortcut could
mount; Spark reading external URLs (land in `Files/` first — Copy
activity, OneLake API upload, or `notebookutils.fs`).

## Pipeline orchestration (medallion flow)

- Sequential activities Bronze → Silver → Gold, each gated on previous
  success; independent Gold aggregations in parallel; validation and
  notification activities in the chain.
- **Parameterise the processing date** at pipeline level (default
  yesterday), pass to every notebook; dynamic expressions for paths.
- **Watermark pattern** for incremental loads: persist the high-water
  mark (last-modified/ID) in a control table; each run processes only
  the delta; periodic full refresh for corrections.
- Error handling: retry with backoff for transients, alerting on
  persistent failures, graceful degradation (downstream reads previous
  good data if upstream fails).
- Notebook activities receive parameters into the Parameters cell and
  return values via `notebookutils.notebook.exit()` — branch the
  pipeline on the exit value. Inside a notebook,
  `notebook.runMultiple()` runs a DAG of child notebooks with
  concurrency and retries — use it for fan-out transforms within one
  Spark session instead of N pipeline activities (cheaper session
  reuse).
- Schedules align to source refresh; pipelines are the scheduler,
  notebooks the logic — avoid notebook-internal sleep/poll loops.

## Real-Time Intelligence (boundary sketch)

Eventstream ingests streaming sources (Event Hubs, IoT, CDC) with
no-code routing to **eventhouse** (KQL database — time-series/log
analytics, KQL queries) or lakehouse Delta. Activator triggers actions
on data conditions. Use eventhouse for high-volume telemetry queried by
time; don't force streaming telemetry into batch medallion shapes, and
don't use KQL databases as general analytical stores — shortcut KQL
data into the lakehouse when Spark/BI needs it.

## Mirroring and gateways

Database mirroring replicates operational stores (Azure SQL, Cosmos,
Snowflake…) into OneLake Delta continuously — prefer it over scheduled
copy pipelines when the source is supported. On-prem sources need the
on-premises data gateway (cluster, service-account-owned credentials —
same rules as Power BI).

Docs: https://learn.microsoft.com/fabric/data-engineering/load-data-lakehouse ·
https://learn.microsoft.com/fabric/data-factory/data-factory-overview ·
https://learn.microsoft.com/fabric/real-time-intelligence/overview ·
https://learn.microsoft.com/fabric/database/mirrored-database/overview
