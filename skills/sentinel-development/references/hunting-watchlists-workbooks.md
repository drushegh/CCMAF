# Hunting, Watchlists and Workbooks

## Threat hunting

- Hunting queries are saved KQL with MITRE tactic/technique tags; run
  ad hoc across longer windows than analytics rules. Content Hub
  solutions ship hunting query packs per domain.
- Workflow: hypothesis → hunt → bookmark interesting results (bookmarks
  attach entities + notes, can be promoted into incidents) → if the
  pattern recurs, promote the query to an analytics rule (or Defender
  custom detection) with proper entity mapping.
- Livestream: run a hunting query continuously for short-term watch of
  an emerging situation without creating a rule.
- Defender portal: advanced hunting unifies XDR tables and Sentinel
  workspace tables in one KQL surface — prefer it for cross-domain
  hunts; workspace() syntax still covers multi-workspace needs.
- Notebook-based hunting (Jupyter + MSTICPy) suits ML-heavy or
  iterative investigations; keep it for genuinely exploratory work.

## Long-window and aggregate querying

| Mechanism | Use |
|-----------|-----|
| Summary rules | Pre-aggregate high-volume data into compact tables on a schedule (cheap to query, feed detections/reports) |
| Search jobs | Asynchronous scan of huge/archived datasets (results land in a `*_SRCH` table) |
| KQL jobs (data lake) | Scheduled/one-off queries over data-lake-tier tables |

Choose per the MS Learn decision doc ("KQL jobs vs summary rules vs
search jobs"); interactive queries over archived data are not a thing —
plan restores/jobs.

## Watchlists

- CSV-backed named lists (allowlists, VIP users, known-bad IPs, asset
  inventories) queried via `_GetWatchlist('name')` and correlated in
  rules/hunts.
- Treat as reference data, NOT a database: item/size limits apply
  (check current limits before designing), updates propagate with lag,
  and large-list maintenance belongs in automation (Logic Apps/API),
  not hand edits.
- Deleting and recreating a watchlist mid-flight breaks dependent rules
  (AUTO DISABLED risk) — edit in place.

## Workbooks

- Azure Monitor workbooks surfaced in Sentinel: parameterised KQL
  visualisations for SOC dashboards, connector health, coverage views.
  Content Hub solutions ship workbook templates; customise copies, not
  originals.
- Build on summary rules / pre-aggregated tables for heavy dashboards —
  workbook viewers re-run queries per view, which multiplies cost and
  latency.
- Workbooks are ARM resources — export and version them with the rest
  of the Sentinel content (Repositories feature / pipelines →
  `devops-development`).
- For business-facing reporting prefer Power BI over stretching
  workbooks (`power-bi-development` sibling skill); workbooks are for
  operational SOC views.

## UEBA

User and Entity Behavior Analytics builds baselines per entity
(accounts, hosts, IPs) and surfaces anomalies into `BehaviorAnalytics`
and `IdentityInfo` tables — correlate them in hunts and detections
(e.g. join sign-in anomalies to high-value-asset watchlists). Requires
entity mapping discipline upstream (`detection-engineering.md`).
