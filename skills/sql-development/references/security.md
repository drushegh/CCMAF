# Database security

Injection taxonomy, secrets handling and app-side controls live in
`secure-development`; this file owns the SQL-side patterns.

## Injection-safe SQL

Parameterise every value that originates outside the database. String
concatenation into SQL text is a defect regardless of "trusted" input.

```sql
-- T-SQL dynamic SQL done right: typed parameters via sp_executesql
DECLARE @sql nvarchar(max) = N'
  SELECT OrderID, TotalAmount
  FROM dbo.Orders
  WHERE CustomerID = @CustomerID AND OrderDate >= @Since';
EXEC sys.sp_executesql
  @sql,
  N'@CustomerID int, @Since datetime2',
  @CustomerID = @CustomerID, @Since = @Since;
```

Identifiers (table/column names) can't be parameters: allow-list them
against catalog views and quote with `QUOTENAME()` — never interpolate raw.

```sql
-- PostgreSQL dynamic SQL inside PL/pgSQL
EXECUTE format('SELECT count(*) FROM %I WHERE owner_id = $1', tbl_name)
  USING owner_id;
-- %I quotes identifiers; values always go through USING, never format()
```

`EXEC(@sql)` with concatenated values, and PG `format('%s', value)`, are
the two classic self-inflicted injection holes — reject in review.

## Least privilege

- Application logins get exactly the rights the code path needs:
  `GRANT SELECT, INSERT, UPDATE, DELETE ON SCHEMA::app TO app_rw;` —
  schema-level grants to roles, users in roles, no direct user grants.
- Never `db_owner` / PG superuser / `azure_pg_admin` for an application
  identity. Separate migration/deploy identities (DDL rights) from runtime
  identities (DML only).
- Stored procedures as a security boundary (T-SQL): grant `EXECUTE` on the
  procedure, not the tables — ownership chaining covers static DML inside.
  Dynamic SQL breaks the chain; consider `EXECUTE AS` + module signing.
- PG functions: `SECURITY DEFINER` only with `SET search_path = pg_catalog,
  pg_temp` pinned, owner minimal-privileged. Default `SECURITY INVOKER`
  otherwise.
- Prefer Entra ID (managed identity) auth over SQL/password logins on both
  Azure SQL and PG Flexible Server — no credential to leak or rotate.

## Row-Level Security

PostgreSQL — native and idiomatic:

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = current_setting('app.tenant_id')::bigint);
```

- Policies apply to every query once enabled (owners bypass unless
  `FORCE`). Performance: wrap per-row function calls so they evaluate once
  — `USING (tenant_id = (SELECT current_setting('app.tenant_id')::bigint))`
  — and index the policy columns.
- Connection-pooled apps must set the context variable per transaction
  (`SET LOCAL app.tenant_id = ...`), or RLS silently filters on a stale
  identity.

SQL Server — security policy + predicate function:

```sql
CREATE FUNCTION app.fn_TenantPredicate (@TenantId int)
RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS ok
          WHERE @TenantId = CAST(SESSION_CONTEXT(N'TenantId') AS int);
GO
CREATE SECURITY POLICY app.TenantFilter
ADD FILTER PREDICATE app.fn_TenantPredicate(TenantId) ON dbo.Documents
WITH (STATE = ON);
```

Filter predicates hide rows; add `BLOCK` predicates to stop writes across
the boundary too. RLS is defence-in-depth for multi-tenant data — it does
not replace `WHERE tenant_id = @t` correctness in the app.

## Encryption and data exposure

- In transit: TLS enforced by default on Azure SQL and PG Flexible Server
  — don't disable; set `Encrypt=Strict`/`sslmode=verify-full` where the
  client supports it.
- At rest: TDE (Azure SQL, on by default) / storage encryption (Flexible
  Server) is table stakes, not a control against privileged DB users.
- Column-level: Always Encrypted (T-SQL) when even DBAs must not read
  values — mind the query limitations (equality only, client-side keys);
  PG `pgcrypto` for selective column encryption (key management is yours).
- Dynamic data masking is a display nicety, not a security boundary —
  inference attacks trivially bypass it.
- Avoid `SELECT *` on tables containing sensitive columns; views as the
  read surface make accidental exposure reviewable.

## Auditing

Azure SQL auditing → Log Analytics/storage; PG Flexible Server →
`pgaudit` extension. Audit DDL, permission changes and access to sensitive
tables; route logs to the SIEM (KQL-side analysis → `sentinel-development`).
