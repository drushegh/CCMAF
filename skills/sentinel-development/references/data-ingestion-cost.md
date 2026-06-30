# Data Ingestion, Connectors and Cost Control

Ingestion strategy IS cost strategy: Sentinel billing is dominated by
data volume and tier. Decide per table: who queries it, how fast, how
often, and for how long.

## Connector landscape

| Type | Examples | DCR support |
|------|----------|-------------|
| Service-to-service | Defender XDR, Entra ID, Office 365, AWS S3 | Workspace transformation DCR (supported tables) |
| AMA-based | Windows Security Events, CEF via AMA, Syslog via AMA | One or more DCRs on the agent |
| Logs Ingestion API | Custom sources | DCR specified per call |
| Codeless Connector Framework (CCF) | Modern API-based connectors | DCR created for connector |
| Diagnostic-settings-based | Azure resources | Workspace transformation DCR |
| Legacy (Functions-based, legacy codeless) | Various | No DCR transformation |

**Deadline:** the legacy HTTP Data Collector API is unsupported after
14 September 2026 — migrate custom ingestion to the Logs Ingestion API
or CCF. The Defender XDR connector is auto-enabled when onboarding to
the Defender portal.

## CEF/Syslog via AMA (the appliance workhorse)

- Architecture: devices → syslog daemon (rsyslog/syslog-ng, port 514
  default) on a dedicated Linux **log forwarder** VM → AMA (TCP 28330
  for AMA ≥1.28.11) → workspace. CEF lands in `CommonSecurityLog`,
  syslog in `Syslog`.
- Install the relevant Content Hub solution first; the connector setup
  creates the DCR and installs AMA; then run the forwarder script and
  configure each appliance (per-device instructions on MS Learn).
- **Filter in the DCR** (facilities, log levels — API-created DCRs allow
  level-specific filters the portal UI can't) — every dropped event is
  money saved before ingestion.
- Known skew: `TimeGenerated` (forwarder processing, UTC) vs `EventTime`
  (header, no timezone) differ across time zones.

## Data tiers and retention

- **Analytics tier**: full KQL, real-time rules — premium price. The
  default for detection-grade sources.
- **Data lake tier**: low-cost ingestion/storage for high-volume,
  low-fidelity sources (verbose network/firewall logs); query via KQL
  jobs and search jobs rather than interactive analytics; promote
  subsets when needed. Choose per the "data lake tier use cases" and
  "KQL jobs vs summary rules vs search jobs" decision docs.
- Retention: per-table interactive retention + long-term archive;
  restore/search jobs pull archived data on demand (with job costs).
- Commitment tiers / simplified pricing and pre-purchase plans cut unit
  cost at volume — flag to whoever owns the Azure bill.

## Cost-control checklist (apply before and after connecting)

1. Estimate volume first (vendor sizing or trial ingestion;
   `Usage` table for actuals: `Usage | summarize sum(Quantity) by
   DataType`).
2. DCR transformations to drop fields/rows you will never query.
3. Right-tier each table; don't pay analytics prices for compliance
   archives.
4. Watch `Operation` and SentinelHealth for ingestion failures and
   delays (silent gaps = silent detection failure).
5. Review the official cost-reduction levers (billing-reduce-costs doc)
   quarterly — features move fast.
6. Benign-but-bulky Microsoft sources (e.g. full Entra sign-in
   diagnostics) often dominate bills — scope diagnostic settings
   deliberately.

## ASIM (Advanced Security Information Model)

Normalisation layer: source-specific tables → normalised schemas
(NetworkSession, Authentication, DNS, etc.) via parsers. Write
detections/hunting against ASIM parsers for source independence
(`_Im_*` unifying parsers). Custom sources can ship their own ASIM
parser. Performance: unifying parsers union many sources — scope with
parser parameters where volume hurts.

## Health monitoring

Enable the data connector health feature; alert on stalled ingestion
per critical table (`ago()` freshness checks per table are a cheap
watchdog detection).
