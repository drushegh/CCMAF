# KQL Language Reference (general — Sentinel, Log Analytics, ADX, eventhouse)

Distilled from the official microsoft/skills `kql` skill (full version with
4 deep references saved at `Reference skills/microsoft-skills-official/
.github/skills/kql/` — load it for advanced patterns, discovery queries,
error recovery and templates). Test queries against the public help
cluster: `https://help.kusto.windows.net`, database `Samples`.

## Model

Pipe-forward chains: `Table | where … | summarize … | top …`. Two
planes: queries (start with table/`let`/`print`/`datatable`) and
management commands (start with `.`); management output can pipe into
query operators, never the reverse.

## Dynamic type discipline (top error source)

Any dynamic column used in `summarize by`, `order by` or `join on` must
be cast explicitly:

```kql
StormEvents | summarize count() by tostring(StormSummary.Details.Location)
StormEvents | order by tolong(StormSummary.TotalDamages) desc
```

Error text "is of a 'dynamic' type" → add `tostring()`/`tolong()`/
`todouble()`.

## Join rules

- Equality only — no `<`, `>`, `!=`, or function calls in `on`. Range
  joins: pre-bin (`extend b = bin(Value, 100)`) or spatial-cell bucket
  (`geo_point_to_s2cell`) and join on the bucket; mind bin-boundary
  neighbours.
- Both sides must be column references: `on $left.X == $right.Y`.
- Check cardinality (`summarize dcount(Key)`) before joining >10k-row
  tables — cross-join explosions cause `E_RUNAWAY_QUERY`.
- Default `kind` is `innerunique` (deduplicates the left side) — specify
  `kind=inner` when duplicates matter.

## Datetime

- `datetime` arithmetic yields `timespan`; use `ago(1h)`, `between
  (T1 .. T2)`, `bin(TimeGenerated, 5m)` for bucketing.
- `format_datetime()` for output only — filter on the raw column so
  indexes apply.
- Sentinel rule queries: lookback windows reference `TimeGenerated`;
  ingestion lag means late events miss naive windows — see
  `detection-engineering.md`.

## Strings and regex

- Case-insensitive operators (`=~`, `has`, `contains`) vs case-sensitive
  (`==`, `has_cs`, `contains_cs`). Prefer `has` (term-indexed) over
  `contains` (substring scan) for performance.
- `extract()`, `parse` operator, `matches regex` use RE2 — no
  backreferences or lookbehind.
- `parse` is positional and fails silently to empty — validate pattern
  against real samples.

## Performance and result discipline

- Filter early (`where` before `extend`/`join`); project only needed
  columns; `summarize` before join where possible.
- `take`/`limit` while exploring; `top N by X` for ordered heads.
- Serialization: `row_number()`/`prev()`/`next()` require `serialize`
  or a preceding `order by`.
- `materialize()` caches a subquery used multiple times in one query.
- Result caps exist (~500k rows / 64 MB in many surfaces) — aggregate,
  don't export raw.

## Sentinel/Log Analytics specifics

- Rule queries: 1–10,000 chars; no `search *` / `union *`; user-defined
  functions can wrap long logic.
- `bag_unpack` then projecting a possibly-missing column fails — use
  `project field1 = column_ifexists("field1","")`.
- `ingestion_time()` differs from `TimeGenerated`; NRT rules key off
  ingestion time.
- Cross-workspace: `workspace("name").Table`; workspace count limits
  apply in queries and scheduled rules.
- ADX functions in the Log Analytics query window are not supported.

## Frequently-needed operators

`summarize` (+`arg_max`/`arg_min` for latest-per-key), `make-series` +
`series_decompose_anomalies` for time-series anomaly detection, `mv-expand`
for arrays, `parse_json` (then cast), `lookup` for dimension joins,
`union` with `isfuzzy=true` for optional tables, `let` for readability,
`externaldata()` for ad-hoc reference data, `evaluate pivot`.
