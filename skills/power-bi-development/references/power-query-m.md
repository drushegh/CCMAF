# Power Query / M for Semantic Models

Each import table's partition is a `let ... in` M expression: connect →
navigate → transform. Shared parameters (`#"SqlEndpoint"`) live at model
level (`expressions.tmdl` in PBIP).

```m
let
    Source = Sql.Database(#"SqlEndpoint", #"Database"),
    Data = Source{[Schema="dbo", Item="Orders"]}[Data],
    Filtered = Table.SelectRows(Data, each [Status] <> "Cancelled"),
    Selected = Table.SelectColumns(Filtered, {"OrderId", "Date", "Amount", "CustomerId"})
in
    Selected
```

## Query folding — the one performance concept that matters

Foldable steps translate to native source queries (SQL); the first
fold-breaking step pulls everything into the mashup engine and every
later step runs in memory.

| Folds (SQL sources) | Breaks folding |
| --- | --- |
| `Table.SelectColumns` / `RemoveColumns` → SELECT | `Table.AddColumn` with custom M logic |
| `Table.SelectRows` → WHERE | `Table.Buffer` (prefer `Table.StopFolding`) |
| `Table.Sort` → ORDER BY | `Table.LastN` |
| `Table.FirstN` → TOP | `Table.Combine` across different sources |
| `Table.Group` → GROUP BY | complex `each` expressions |
| `Table.RenameColumns` → aliases | anything after a fold-breaker |

- `Table.TransformColumnTypes` **frequently breaks folding** for
  text→number/date on SQL sources — `Table.TransformColumns` with
  explicit converters (`Number.From`) folds more reliably.
- Order of operations: filter rows and select columns **first** (they
  fold), custom columns and M-only transforms **last**.
- Verify folding: right-click step → View Native Query (greyed out =
  not folding), or `Value.Metadata` / query diagnostics. Don't trust
  assumptions — folding behaviour is source- and connector-specific.

## Placement ladder

Source/warehouse view → folded M → (rarely) non-folded M → DAX calc
column → measure. Push business logic as far left as the team's
ownership allows; non-folded M over large tables is the slow-refresh
generator. If the same shaping appears in several models, it belongs
upstream (warehouse view or dataflow), not copy-pasted M.

## Practical rules

- Parameterise connections (server, database, environment) — hard-coded
  connection strings break multi-environment deployment; deployment
  pipeline rules can rebind parameters per stage.
- Name steps meaningfully; `#"Changed Type1"` archaeology wastes
  everyone's time.
- Each partition should return the **declared columns exactly** — TMDL
  `sourceColumn` references break silently when M renames drift.
- Errors: `try ... otherwise` per cell; `Table.SelectRowsWithErrors` /
  remove-errors steps for bulk handling — but fix the type mismatch at
  source rather than suppressing it.
- Incremental refresh requires the `RangeStart`/`RangeEnd` datetime
  parameters filtering the fact **in a foldable step**; non-folding IR
  filters silently degrade to full scans per partition.
- Privacy levels / firewall errors ("Formula.Firewall") mean a query
  mixes sources at incompatible privacy settings — restructure into
  staging queries rather than disabling the firewall in shared models.

Docs: https://learn.microsoft.com/power-query/query-folding-basics ·
https://learn.microsoft.com/power-query/power-query-folding ·
https://learn.microsoft.com/power-bi/connect-data/incremental-refresh-overview
