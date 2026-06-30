# Data and Messaging Selection

## Data stores

| Need | Choice | Watch for |
| --- | --- | --- |
| Relational, T-SQL, existing SQL skills | **Azure SQL Database** | Entra-only auth (no SQL passwords in IaC); serverless tier for spiky dev/test; elastic pools for many small DBs |
| Open-source relational | PostgreSQL/MySQL Flexible Server | HA mode and maintenance windows are choices, not defaults |
| Global/low-latency NoSQL, flexible schema | **Cosmos DB** | Partition key choice is forever; RU costs punish cross-partition queries; serverless vs provisioned by traffic shape |
| Blobs, files, queues, tables | **Storage account** | Data-plane RBAC roles; lifecycle policies to cool/archive; soft delete + versioning on |
| Caching | Azure Cache for Redis / Managed Redis | A cost hotspot — size deliberately, expire aggressively |
| Analytics at scale | Fabric/OneLake (see fabric-development) | Don't build a warehouse on serverless SQL ad hoc |

Dataverse is its own platform (dynamics-365 / power-platform skills) —
don't propose SQL-direct integrations where Dataverse APIs exist.

## Messaging: the three-way choice

| Pattern | Service |
| --- | --- |
| Commands, ordered queues, transactions, dead-lettering, sessions | **Service Bus** (queues/topics) |
| Reactive events, fan-out notification of state changes (resource or custom events), push to webhooks/Functions | **Event Grid** |
| High-throughput telemetry/streams, partitioned, replayable | **Event Hubs** |

Rules: events describe what happened (no expectation), commands tell
someone to do something (one owner) — pick the service accordingly;
at-least-once delivery everywhere ⇒ idempotent consumers; dead-letter
queues are monitored, not decorative; storage queues only for trivial
single-consumer cases.

## Integration patterns that age well

- Queue between web front ends and heavy work (load levelling); never
  do >2s work in a request handler that a queue could absorb.
- Outbox pattern when a DB write and a message publish must both
  happen.
- Retry with exponential backoff + jitter and a circuit breaker on
  every remote call (Polly in .NET); the SDKs' built-in retries cover
  transient faults only.
- Schema-version messages from day one (`v` property beats a breaking
  redeploy of every consumer).

Docs: https://learn.microsoft.com/azure/architecture/guide/technology-choices/data-store-decision-tree ·
https://learn.microsoft.com/azure/event-grid/compare-messaging-services ·
https://learn.microsoft.com/azure/cosmos-db/partitioning-overview ·
https://learn.microsoft.com/azure/architecture/patterns/
