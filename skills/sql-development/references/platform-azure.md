# Azure platforms — Azure SQL Database and PG Flexible Server

Stamped June 2026 — tiers, limits and defaults move; re-verify on
learn.microsoft.com before committing numbers to a design or proposal.

## Azure SQL Database — tier selection

| Model | Choose when |
|---|---|
| vCore (default) | Predictable sizing, reserved-capacity discounts, serverless option, Hyperscale |
| DTU | Small/simple workloads already on it; no serverless, coarse control |

| vCore tier | Use for |
|---|---|
| General Purpose | Most workloads; serverless option for intermittent use |
| Business Critical | Low-latency IO, built-in readable replica, In-Memory OLTP |
| Hyperscale | >4 TB, fast scale, named read replicas, snapshot-fast restores |

- **Serverless** (GP): auto-pause saves cost on intermittent workloads, but
  resume adds cold-start latency — set min vCores / disable auto-pause for
  latency-sensitive apps.
- **Elastic pools**: many small databases with non-correlated spikes share
  one resource budget — the standard answer for per-client database
  multi-tenancy. Size from the sum of average loads, not the sum of peaks;
  verify no two hot tenants peak together.
- Right-sizing evidence: `sys.dm_db_resource_stats` (15-second grain, last
  ~hour), `sys.resource_stats` (14 days). Sustained avg <40% across
  CPU/IO/log → downsize candidate.

## Azure SQL operational notes

- **Query Store is on by default** — regression triage and plan forcing
  live there. Automatic tuning (`FORCE_LAST_GOOD_PLAN`) is worth enabling;
  `CREATE_INDEX`/`DROP_INDEX` auto-tuning only with review of what it did.
- **Retry logic is mandatory**: transient errors (40613 database not
  currently available, 40197, 10928/10936 throttling) occur during
  reconfigurations. Use the platform retry support in the client
  (`Microsoft.Data.SqlClient` configurable retry / EF Core
  `EnableRetryOnFailure` — wiring belongs to `dotnet-development`).
- **Not available vs boxed SQL Server**: SQL Agent (use Elastic Jobs,
  Azure Functions or Logic Apps), cross-database queries on the same
  server (Elastic Query external tables), linked servers, `BULK INSERT`
  from local files (use blob storage with
  `CREATE EXTERNAL DATA SOURCE ... TYPE = BLOB_STORAGE`), FILESTREAM.
- Hyperscale read scale-out: `ApplicationIntent=ReadOnly` in the
  connection string routes to replicas — replicas are eventually
  consistent; don't read-your-writes through them.
- Database-level firewall + private endpoints over server-level rules;
  Entra-only auth is configurable and preferable.

## Azure Database for PostgreSQL — Flexible Server

(Single Server is retired; Flexible Server is the platform. Supports PG
11–18 as of June 2026; PG 18 GA'd there Nov 2025.)

- **Compute tiers**: Burstable (B-series — dev/test only; CPU credits run
  out under sustained load), General Purpose, Memory Optimised. Storage
  scales independently; IOPS scale with storage size or provisioned —
  under-provisioned IOPS masquerades as query slowness.
- **High availability**: zone-redundant HA = synchronous standby in
  another AZ (RPO 0, ~60–120 s failover, doubles compute cost). Without
  HA, maintenance windows mean brief restarts — design retry anyway.
- **Connection pooling: PgBouncer is built in** (enable it; port 6432,
  transaction pooling mode). PG connections are process-per-connection —
  serverless/burst clients without pooling exhaust `max_connections`
  fast. With transaction pooling, avoid session state: no session-scoped
  advisory locks, `SET` without `LOCAL`, prepared statements unless the
  pooler version supports them.
- **Extensions are allow-listed**: enable via `azure.extensions` server
  parameter, then `CREATE EXTENSION`. `pg_stat_statements` available by
  default; `pgaudit`, `postgis`, `pgvector` etc. on the allow-list —
  verify a required extension is supported before designing around it.
- Read replicas: async, cross-region capable — reporting offload, not HA.
- Server parameters worth a first look: `work_mem` (per sort/hash, not per
  query — be conservative), `shared_buffers` (platform-managed),
  `autovacuum_*` scale factors for hot tables,
  `idle_in_transaction_session_timeout`.

## Choosing between them (decision level)

- Existing T-SQL estate, D365/Power Platform adjacency, SSDT tooling →
  Azure SQL.
- Open-source alignment, jsonb/PostGIS/pgvector needs, per-core licence
  sensitivity → PostgreSQL.
- Either way the runtime sits behind the same patterns: pooled
  connections, retry on transient faults, Entra auth, private networking.
- SQL Server on Azure VMs / Managed Instance: instance-scoped features
  (Agent, cross-DB, CLR, Service Broker) at the cost of more ops —
  decision detail in `azure-development`.

## Cost levers (both)

Reserved capacity (1/3-year) on steady workloads; serverless/auto-pause or
Burstable for intermittent ones; stop paying Business Critical prices for
read replicas that a Hyperscale named replica or PG read replica covers;
archive cold data out of premium storage. Egress and cross-AZ traffic are
rarely the problem at this estate's scale — compute SKU sprawl is.
