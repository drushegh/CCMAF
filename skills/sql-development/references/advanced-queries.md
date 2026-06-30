# Advanced queries — windows, CTEs, APPLY/LATERAL, upserts, JSON

## Window functions

```sql
-- Top 3 orders per customer, latest first
WITH ranked AS (
  SELECT o.customer_id, o.id, o.amount,
         ROW_NUMBER() OVER (PARTITION BY o.customer_id
                            ORDER BY o.order_date DESC) AS rn
  FROM orders AS o
)
SELECT customer_id, id, amount FROM ranked WHERE rn <= 3;
```

- `ROW_NUMBER` (unique sequence) vs `RANK` (gaps on ties) vs `DENSE_RANK`
  (no gaps) — pick deliberately; dedup uses `ROW_NUMBER`.
- Running totals: `SUM(x) OVER (ORDER BY ... ROWS BETWEEN UNBOUNDED
  PRECEDING AND CURRENT ROW)` — specify the frame; the default
  `RANGE`-based frame is slower and surprises on ties.
- `LAG`/`LEAD` replace self-joins for previous/next-row comparisons.
- An index matching `PARTITION BY` + `ORDER BY` columns avoids the sort.

## CTEs and recursion

- CTEs are readability tools. T-SQL inlines them (referenced twice =
  computed twice — materialise to a temp table instead). PG ≥12 also
  inlines unless `WITH x AS MATERIALIZED (...)` — use `MATERIALIZED` to
  force the old fence when that's the point.
- Recursive CTEs for hierarchies; T-SQL: cap with
  `OPTION (MAXRECURSION n)`; PG: `WITH RECURSIVE`, guard cycles
  (`CYCLE` clause PG 14+, or a path array).

```sql
WITH RECURSIVE org AS (
  SELECT id, manager_id, name, 1 AS depth
  FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.id, e.manager_id, e.name, org.depth + 1
  FROM employees AS e JOIN org ON e.manager_id = org.id
  WHERE org.depth < 100
)
SELECT * FROM org;
```

## APPLY (T-SQL) / LATERAL (PG)

Row-correlated subqueries done right — top-N per row, TVF calls,
unpivoting:

```sql
SELECT c.CustomerID, o.OrderID, o.Amount
FROM dbo.Customers AS c
CROSS APPLY (SELECT TOP 3 OrderID, Amount
             FROM dbo.Orders
             WHERE CustomerID = c.CustomerID
             ORDER BY OrderDate DESC) AS o;
```

```sql
SELECT c.id, o.id AS order_id, o.amount
FROM customers AS c
CROSS JOIN LATERAL (SELECT id, amount FROM orders
                    WHERE customer_id = c.id
                    ORDER BY order_date DESC LIMIT 3) AS o;
```

`OUTER APPLY` / `LEFT JOIN LATERAL ... ON true` keep unmatched outer rows.

## Upserts

```sql
-- PostgreSQL: atomic, the default answer
INSERT INTO settings (user_id, key, value)
VALUES ($1, $2, $3)
ON CONFLICT (user_id, key) DO UPDATE
SET value = EXCLUDED.value, updated_at = now();
```

- `ON CONFLICT` requires a matching unique index/constraint; `DO NOTHING`
  silently drops rows — only when that's the requirement.

```sql
-- T-SQL: MERGE needs a concurrency guard under load
MERGE dbo.Settings WITH (HOLDLOCK) AS t
USING (VALUES (@UserId, @Key, @Value)) AS s (UserId, SettingKey, SettingValue)
   ON t.UserId = s.UserId AND t.SettingKey = s.SettingKey
WHEN MATCHED THEN UPDATE SET SettingValue = s.SettingValue
WHEN NOT MATCHED THEN INSERT (UserId, SettingKey, SettingValue)
                      VALUES (s.UserId, s.SettingKey, s.SettingValue);
```

A guarded `UPDATE` then conditional `INSERT` inside a serialisable-range
transaction is a legitimate, often simpler alternative; either way, test
the race. Use `OUTPUT $action, inserted.*, deleted.*` to audit changes.

## Grouping and pivoting

- Multi-level aggregates in one pass: `GROUP BY GROUPING SETS / ROLLUP /
  CUBE` (both platforms); `GROUPING()` distinguishes real NULLs from
  subtotal rows.
- Pivot small fixed sets with conditional aggregation
  (`SUM(CASE WHEN ... THEN ... END)` / PG `FILTER (WHERE ...)`) — more
  portable and optimiser-friendly than `PIVOT`.
- String aggregation: `STRING_AGG(col, ',') WITHIN GROUP (ORDER BY ...)`
  (T-SQL) / `string_agg(col, ',' ORDER BY ...)` (PG).

## JSON

PostgreSQL — `jsonb` is mature; index it deliberately:

```sql
CREATE INDEX docs_payload_idx ON docs USING gin (payload jsonb_path_ops);
SELECT id FROM docs WHERE payload @> '{"status": "open"}';
```

Extract hot fields into generated columns and index those instead of
querying deep paths everywhere.

T-SQL — `OPENJSON` to shred, `JSON_VALUE`/`JSON_QUERY` to extract, `FOR
JSON PATH` to emit; index via computed column over `JSON_VALUE`. SQL
Server 2025 adds a native `json` type and `JSON_ARRAYAGG`/`JSON_OBJECTAGG`
— only on compat 170 (verify target before using; June 2026).

Relational data that always gets shredded back into columns should be
columns. JSON is for genuinely open-ended or document-shaped payloads.
