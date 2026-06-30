# Transactions and concurrency

## Baseline rules (both platforms)

- Keep transactions short. Never hold one open across user/agent
  interaction, HTTP calls or queue waits.
- Acquire locks in a consistent order (e.g. ascending key) across all code
  paths that touch the same rows — that alone removes most deadlocks.
- Batch large DML (`DELETE TOP (5000)` loop / PG `DELETE ... WHERE id IN
  (SELECT ... LIMIT 5000)`) to cap lock footprint and log growth.
- Expect transient failure: deadlock victims (T-SQL 1205, PG `40P01`) and
  serialisation failures (PG `40001`) are retryable — wrap write
  transactions in bounded exponential-backoff retry **at the application
  level, retrying the whole transaction**, not the failed statement.

## T-SQL error + transaction template

Every writing procedure:

```sql
CREATE OR ALTER PROCEDURE dbo.TransferFunds
  @FromId int, @ToId int, @Amount decimal(19,4)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;   -- abort + roll back on any error, incl. timeouts
  BEGIN TRY
    BEGIN TRANSACTION;
    UPDATE dbo.Accounts SET Balance = Balance - @Amount WHERE Id = @FromId;
    UPDATE dbo.Accounts SET Balance = Balance + @Amount WHERE Id = @ToId;
    COMMIT TRANSACTION;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;   -- rethrow original error; do not swallow
  END CATCH;
END;
```

`SET XACT_ABORT ON` is non-negotiable: without it, client timeouts can
leave transactions open and locks held. Use `THROW`, not legacy
`RAISERROR`, to preserve the original error.

## Isolation levels

| Level | T-SQL behaviour | PG behaviour |
|---|---|---|
| READ COMMITTED | Default. Locking reads unless RCSI; with RCSI (default ON in Azure SQL) readers see versioned snapshots — writers don't block readers | Default. Statement-level snapshot (MVCC); readers never block writers |
| REPEATABLE READ | Range not protected (phantoms possible) | Full transaction snapshot; serialisation failures possible on write conflict |
| SNAPSHOT | Transaction-level versioning (must be enabled) | (= PG REPEATABLE READ, near enough) |
| SERIALIZABLE | Range locks — high blocking cost | SSI — optimistic, aborts instead of blocking; retry `40001` |

- Don't "fix" blocking with `NOLOCK`/`READ UNCOMMITTED` — dirty, duplicate
  and missed rows. On-prem SQL Server with reader/writer blocking:
  evaluate enabling RCSI (tempdb version-store cost) — Azure SQL already
  has it.
- PG long-running transactions (idle-in-transaction included) block vacuum
  and bloat tables — set `idle_in_transaction_session_timeout`.

## Deadlock prevention and queues

```sql
-- Lock in consistent order before updating (PG; T-SQL: UPDLOCK hint)
BEGIN;
SELECT id FROM accounts WHERE id IN (1, 2) ORDER BY id FOR UPDATE;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

Work-queue pickup without convoying:

```sql
-- PostgreSQL
WITH next AS (
  SELECT id FROM jobs
  WHERE status = 'queued'
  ORDER BY created_at
  LIMIT 10
  FOR UPDATE SKIP LOCKED
)
UPDATE jobs AS j SET status = 'running', started_at = now()
FROM next WHERE j.id = next.id
RETURNING j.id;
```

```sql
-- T-SQL equivalent (CTE form gives defined pickup order;
-- READCOMMITTEDLOCK is required because READPAST is rejected under
-- RCSI at read committed — and RCSI is ON by default in Azure SQL)
WITH next AS (
  SELECT TOP (10) Id, Status, StartedAt
  FROM dbo.Jobs WITH (UPDLOCK, READPAST, READCOMMITTEDLOCK, ROWLOCK)
  WHERE Status = 'queued'
  ORDER BY CreatedAt
)
UPDATE next
SET Status = 'running', StartedAt = SYSUTCDATETIME()
OUTPUT inserted.Id;
```

Diagnosis: T-SQL — `system_health` extended-events session holds the
deadlock graph; Azure SQL surfaces it in Query Store/portal diagnostics.
PG — `log_lock_waits = on`, check `pg_stat_database.deadlocks`, inspect
`pg_locks` joined to `pg_stat_activity` for live blocking.

## Advisory locks (PG)

Application-level mutual exclusion without locking rows:
`pg_advisory_xact_lock(key)` (auto-released at transaction end — prefer
over session-scoped `pg_advisory_lock`, which leaks on connection-pool
reuse). Typical uses: singleton schedulers, migration runners, dedup of
concurrent job submission. T-SQL near-equivalent: `sp_getapplock` with
`@LockOwner = 'Transaction'`.

## Optimistic concurrency for app data

Detect lost updates without long locks: T-SQL `rowversion` column compared
on `UPDATE`; PG `xmin` system column or an explicit `version int`
incremented per update. Reject (and surface) on mismatch rather than
last-writer-wins — silently losing a write is a data-loss bug.
