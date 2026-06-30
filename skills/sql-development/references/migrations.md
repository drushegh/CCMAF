# Schema migrations and database deployment

Pipeline wiring (YAML, agents, approvals) → `devops-development`; EF Core
migrations as a tool → `dotnet-development`. This file owns the database
side: safe change patterns and the state-based vs migration-based choice.

## Two deployment models

| Model | Tooling | Strengths | Watch for |
|---|---|---|---|
| **State-based** (declare desired schema, tool computes diff) | SSDT database projects + DACPAC / SqlPackage (T-SQL) | Whole schema in source control, drift detection, build-time validation | Diff engine choices on destructive changes — always review the generated script; data motion needs pre/post-deploy scripts |
| **Migration-based** (ordered, versioned scripts) | Flyway, Liquibase, EF Core migrations, plain numbered scripts | Explicit control, works for both platforms, replayable history | Script discipline: forward-only, idempotent, journaled |

T-SQL estates with SSDT already in play: stay state-based, keep the
database project authoritative, gate deploys on the generated script
review. PG (and mixed estates): migration-based is the default — Flyway
or equivalent with a schema-history table.

Rules that hold for either model:

- Forward-only. "Down" scripts give false comfort — restore from backup or
  roll forward with a fix.
- Idempotent guards (`IF NOT EXISTS` / `CREATE OR ALTER` /
  `DROP ... IF EXISTS`) so re-runs are safe.
- Migrations run under a deploy identity with DDL rights; the app identity
  has none.
- Every migration reviewed as code, deployed via pipeline, never run by
  hand against production.

## Expand–migrate–contract

Anything a live application reads must change in three deployable steps:

1. **Expand** — additive only: new nullable column / new table / new index.
   Old and new code both work.
2. **Migrate** — backfill in batches; dual-write or sync trigger if the
   window is long; flip application code to the new shape.
3. **Contract** — after the old path is provably unused: enforce
   `NOT NULL`, drop old column/table, remove compat views.

Renames are a drop+add in disguise — do them as expand/contract with a
compatibility view or computed column bridging the gap, never as an
in-place rename under live traffic.

## Locking-aware DDL

PostgreSQL:

- `CREATE INDEX CONCURRENTLY` (no table-write block; can't run in a
  transaction; cleans up as INVALID on failure — check and drop/retry).
- Adding a column with a constant default is metadata-only (PG 11+);
  adding `NOT NULL` later: add `CHECK (col IS NOT NULL) NOT VALID` →
  `VALIDATE CONSTRAINT` (brief lock only) → `SET NOT NULL`.
- `ALTER TABLE ... ADD FOREIGN KEY NOT VALID` then `VALIDATE` to avoid a
  long share lock on big tables.
- Any `ALTER TABLE` taking `ACCESS EXCLUSIVE` queues behind long-running
  queries and then blocks everyone behind it — set `lock_timeout` in the
  migration session and retry, rather than wedging production.

SQL Server / Azure SQL:

- `CREATE/ALTER INDEX ... WITH (ONLINE = ON, RESUMABLE = ON,
  MAX_DURATION = 60)` for large indexes.
- Adding a NOT NULL column with a default is metadata-only on
  Enterprise/Azure SQL (runtime constant default).
- Use `WAIT_AT_LOW_PRIORITY` options on index operations against hot
  tables; batch data backfills (`UPDATE TOP (n)` loops) to respect the log
  and lock budget.

## Data motion

- Backfills are migrations too: batched, resumable (track a high-water
  mark), throttled, and verified by row-count/checksum comparison —
  `sql-server-table-reconciliation`-style checks, or PG
  `SELECT count(*), sum(hashtext(t::text)) FROM t` per shard, before
  cutting over.
- Large one-off loads: disable/queue nonessential indexes and rebuild
  after; PG: `COPY` not row inserts, then `ANALYZE`; T-SQL: bulk-load via
  blob storage external data source on Azure SQL.

## ORM and framework migration tools

EF Core, Prisma, Drizzle, Django and golang-migrate generate migrations from
model/schema changes. They're convenient but **the generated SQL is a draft, not
a plan** — the tool doesn't know your lock budget or zero-downtime constraints.
Two rules govern all of them:

1. **Review the generated SQL** and apply expand–contract + locking-aware DDL
   (above) yourself. A tool's "rename column" or "alter type" is often an
   unsafe in-place change under live traffic — split it into expand/contract.
2. **Never let a dev-convenience command touch production.** Each tool has a
   destructive/auto-apply mode for local dev and a separate
   review-and-apply-pending mode for prod. Wire the prod path into the pipeline
   (→ `devops-development`); never auto-migrate on app startup.

| Tool | Dev (don't run in prod) | Prod path | Notes |
|---|---|---|---|
| **EF Core** | `dotnet ef database update` | `migrations script --idempotent` → review → apply in pipeline | Tool detail → `dotnet-development`; never auto-migrate at startup |
| **Prisma** | `migrate dev` (can reset/lose data) | `migrate deploy` (applies pending only) | Edit `migration.sql` for lock-safety; data changes = separate raw-SQL step |
| **Drizzle** | `drizzle-kit push` (no history) | `drizzle-kit generate` → review SQL → `migrate` | `push` is dev-only — it has no migration history |
| **Django** | `migrate` on a dev DB | reviewed `migrate` in pipeline | Keep `RunPython` **data** migrations separate from schema; `--fake` with care |
| **Flyway / Liquibase / golang-migrate** | — | versioned scripts + schema-history table, forward-only | Plain-SQL discipline; the safest with the patterns above |

Data migrations (backfills) belong in their own step, not bundled into a schema
migration — keep DDL and DML separable so each can be batched, retried and
reviewed independently (see Data motion below).

## Drift and environments

- Drift detection: SqlPackage `/Action:DeployReport` (or schema compare)
  against production before deploying; migration-based tools detect
  journal divergence — investigate, never force.
- Same artefact through dev → test → prod. Per-environment differences are
  parameters (SQLCMD variables / Flyway placeholders), not edited scripts.
- Restore-test production backups into a staging slot on a schedule; a
  migration tested only against an empty dev database has not been tested.
