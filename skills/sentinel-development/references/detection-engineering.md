# Detection Engineering (Analytics Rules)

## Choosing the rule type

| | Defender XDR custom detection | Scheduled analytics rule | NRT analytics rule |
|---|---|---|---|
| Positioning | **Microsoft's recommended path for new rules** (unified Sentinel+XDR data, no ingestion cost on XDR tables, near-real-time options, automatic entity mapping, XDR remediation actions) | Classic Sentinel workhorse; richest configuration | Fast detection (~1 min) for high-value, simple logic |
| Cadence | Configurable incl. continuous | 5 min–14 days interval and lookback | Fixed: every 1 min, 1-min lookback, ~2-min delay |
| Time basis | — | `TimeGenerated` (5-min built-in delay) | `ingestion_time()` (avoids lag misses) |
| Limits | XDR/advanced-hunting context | Full feature set | No scheduling/threshold config; other documented limits |

Other Sentinel rule types: Fusion (ML multi-stage, mostly preconfigured),
ML behaviour analytics (templates), Threat Intelligence matching.

## Scheduled rule configuration facts

- Query: 1–10,000 characters; `search *`/`union *` forbidden; UDFs can
  compress long logic; instant validation in the wizard.
- Interval and lookback each 5 minutes–14 days; lookback > interval gives
  overlap (duplicate-tolerant logic needed); alert threshold optional.
- Event grouping: `SingleAlert` (default) vs `AlertPerResult`.
- Suppression: stop the query for a period after a result.
- Prefer **ASIM parsers** over native tables so rules survive source
  changes; guard with `column_ifexists()` after `bag_unpack`.

## Alert enrichment (limits matter)

| Mechanism | Limits | Purpose |
|-----------|--------|---------|
| Entity mapping | ≤10 entities/rule, ≤3 identifiers each; at least one required identifier; prefer strong identifiers | Correlation, UEBA, investigation graph |
| Custom details | ≤20 key/value pairs | Surface query fields in alerts/incidents |
| Alert details override | name ≤256 chars, description ≤5,000, ≤3 `{{columnName}}` placeholders each, exact column names (no spaces in braces); can drive tactics/severity from columns | Dynamic, self-describing alerts |

Defender portal caveat: the XDR correlation engine names incidents —
custom alert names may be overridden at incident level.

For solution-packaged rules: include `StartTime = max(TimeGenerated),
EndTime = min(TimeGenerated)` (those exact names) and at least one
primary entity (Host/Account/IP).

## Ingestion delay

Scheduled rules run with a built-in 5-minute delay, but source-side lag
can exceed it. The documented pattern compares `ingestion_time()` to the
rule window so late-arriving events are caught exactly once:

```kql
let ingestion_delay = 10m;
let rule_look_back = 5m;
MyTable
| where TimeGenerated >= ago(ingestion_delay + rule_look_back)
| where ingestion_time() > ago(rule_look_back)
```

Quantify per-source delay before tuning (compare `ingestion_time()` vs
`TimeGenerated` distributions).

## Tuning and health

- Reduce false positives with automation-rule suppression for known
  benign patterns rather than over-narrowing queries; Sentinel's
  detection tuning recommendations highlight noisy rules.
- **AUTO DISABLED**: repeated permanent query failures (dropped columns,
  deleted functions/watchlists) silently disable rules — monitor
  `SentinelHealth` and rule integrity, alert on disablement.
- Review rule execution delay/health when queries run long; optimise
  per `kql-language.md` performance rules.
- Keep MITRE tactic/technique tags current — they drive the coverage
  view (`defender-xdr-mitre.md`).

## Detections as code

Export/author rules as ARM templates (or YAML for solution publishing)
and deploy via the Repositories feature or pipelines. Entity mappings,
custom details and alert overrides are all schema fields
(`entityMappings`, `customDetails`, `alertDetailsOverride`,
`eventGroupingSettings`) — review them in code review like any logic
change. Pipeline mechanics → `devops-development`.
