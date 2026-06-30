---
name: sentinel-development
description: >-
  Microsoft Sentinel SIEM/SOAR engineering and general KQL expertise:
  detection engineering (scheduled/NRT analytics rules, entity mapping,
  tuning), hunting queries, data connectors and ingestion cost control,
  workbooks, automation rules and Logic Apps playbooks, Defender XDR/
  unified SOC portal integration, MITRE ATT&CK mapping — plus a general
  KQL language reference for Log Analytics, Application Insights, ADX
  and Fabric eventhouse querying. Use for ANY work involving Sentinel,
  SIEM detections, KQL/Kusto queries, analytics rules, SOC automation,
  threat hunting, or security log ingestion.
---

# Microsoft Sentinel Development

Standards for building detections, automation and data pipelines in
Microsoft Sentinel, plus general KQL. Grounding: MS Learn (Sentinel docs)
and the official microsoft/skills `kql` skill (saved in Reference skills);
atc-net's azure-sentinel skill provides a categorised MS Learn URL index
(also saved) — use it to locate deep documentation fast.

## Current platform reality (verify dates before quoting)

- **Sentinel in the Azure portal retires 31 March 2027** (extended from
  July 2026); the Microsoft Defender portal is the home of Sentinel —
  GA for all customers including those without Defender XDR/E5. New
  tenants since July 2025 are auto-onboarded to the Defender portal.
  Build new guidance Defender-portal-first.
- **Defender XDR custom detections** are now Microsoft's recommended
  unified path for new detection rules across Sentinel + XDR data
  (cost and real-time advantages); classic Sentinel analytics rules
  remain fully supported — see the comparison in
  `references/detection-engineering.md` before choosing.
- The legacy **HTTP Data Collector API is unsupported after
  14 September 2026** — custom ingestion must use the Logs Ingestion
  API or the Codeless Connector Framework (CCF).

## Non-negotiables

1. **KQL discipline first.** Cast dynamics before `by`/`on`/`order by`;
   joins are equality-only; check cardinality before large joins; never
   `search *` or `union *` in rule queries. Full rules:
   `references/kql-language.md`.
2. **Write detections against ASIM parsers**, not native tables, where a
   schema exists — detections survive new data sources. Guard optional
   columns with `column_ifexists()` after `bag_unpack`.
3. **Map entities on every analytics rule** (up to 10 entities, ≤3
   identifiers each; prefer strong identifiers). Unmapped alerts cripple
   incident correlation, UEBA and investigation graphs.
4. **Account for ingestion delay.** Scheduled rules look back on
   `TimeGenerated`; events arriving late fall through naive windows.
   Apply the documented `ingestion_time()` offset pattern or accept
   quantified gaps deliberately.
5. **Tag MITRE ATT&CK tactics/techniques on every rule** — coverage
   mapping (and audit evidence) depends on it.
6. **Cost is a design input.** Every connector decision is a billing
   decision: choose analytics vs data-lake tier per table on access
   patterns, filter at the DCR before ingestion, and review the cost
   levers in `references/data-ingestion-cost.md` before adding sources.
7. **Automation rules orchestrate; playbooks execute.** Trigger
   playbooks from automation rules (alert-trigger playbooks are the
   legacy migration path). Least-privilege managed identities for Logic
   Apps.
8. **Date-stamp platform claims** — Sentinel ships changes monthly;
   verify against What's New before asserting limits or portal
   behaviour.

## Workflow for a new detection

1. Confirm the data source is connected and the table/ASIM schema
   populated (`references/data-ingestion-cost.md`).
2. Prototype the query in Logs; validate volumes and false-positive
   rate over a representative window.
3. Choose rule type: Defender custom detection vs scheduled vs NRT
   (`references/detection-engineering.md` decision table).
4. Configure enrichment: entity mapping, custom details (≤20 pairs),
   alert details override (≤3 placeholders) — make alerts
   self-describing.
5. Set scheduling/lookback (5 min–14 days), alert grouping and
   suppression deliberately; document the ingestion-delay assumption.
6. Tag MITRE; set severity rationally; wire automation
   (`references/automation-soar.md`).
7. Deploy as code (ARM/Bicep API templates or repositories feature) —
   pipeline mechanics → `devops-development`.

## High-frequency pitfalls

- NRT rules: fixed 1-minute cadence on ingestion time, no query
  scheduling/threshold options, other limits — don't treat as
  fast scheduled rules.
- Defender portal: the XDR correlation engine owns incident naming —
  custom alert names can be overridden at incident level.
- `TimeGenerated` vs `EventTime` skew on syslog forwarders in other
  time zones (header lacks zone info).
- AUTO DISABLED rules: persistent query failures (schema drift, deleted
  watchlist/function) cause silent rule disablement — monitor rule
  health (SentinelHealth table).
- Watchlist edits: large watchlists have item limits and propagation
  lag; treat as reference data, not a database.
- Workspace deletion/retention changes have data-loss consequences
  beyond Sentinel (shared Log Analytics) — coordinate.

## References

| File | Load when |
|------|-----------|
| `references/kql-language.md` | Writing/reviewing ANY KQL query |
| `references/detection-engineering.md` | Analytics rules, entity mapping, tuning, NRT vs scheduled vs custom detections |
| `references/data-ingestion-cost.md` | Connectors, AMA/CEF/Syslog, DCRs, tiers, cost control |
| `references/hunting-watchlists-workbooks.md` | Hunting queries, watchlists, summary/search jobs, workbooks |
| `references/automation-soar.md` | Automation rules, playbooks, incident tasks |
| `references/defender-xdr-mitre.md` | Defender portal, XDR integration, MITRE coverage, multi-workspace/MSSP |

## Boundaries with sibling skills

- App Insights instrumentation and general Azure Monitor →
  `azure-development`. Fabric eventhouse/Real-Time Intelligence →
  `fabric-development` (KQL language itself lives HERE).
- CI/CD for Sentinel content → `devops-development`.
- Defender for Cloud, Azure platform security configuration →
  `azure-development` / `secure-development`.
- Purview audit of Copilot Studio agents feeding Sentinel →
  `copilot-studio-development` (alm-governance).
