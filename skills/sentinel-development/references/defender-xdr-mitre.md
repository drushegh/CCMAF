# Defender Portal, XDR Integration and MITRE Coverage

## The unified SOC platform (state as of June 2026)

- Sentinel is GA in the **Microsoft Defender portal** for all customers
  (no XDR/E5 prerequisite). **Azure portal support ends 31 March 2027**
  (extended from July 2026); remaining users will be redirected. New
  first-workspace onboardings since July 2025 land in the Defender
  portal automatically.
- Onboarding to the Defender portal auto-enables the Defender XDR
  connector: XDR incidents, alerts and advanced-hunting events stream
  into Sentinel; incidents stay bi-directionally synchronised.
- No limit on workspaces onboarded to the Defender portal (since July
  2025), but Log Analytics query and scheduled-rule workspace-count
  limits still apply.
- The **XDR correlation engine owns incident creation/naming** in the
  unified portal — alert-level customisations can be overridden at
  incident level; design incident-handling automation accordingly.
- Advanced hunting in the Defender portal queries XDR tables and
  Sentinel workspace tables side by side — one KQL surface.

## What changes for engineering

| Area | Implication |
|------|-------------|
| Detections | Defender custom detections recommended for new rules over XDR data (no ingestion cost for XDR tables); Sentinel scheduled/NRT rules remain for non-XDR sources and complex correlation |
| Cost | XDR data queried in place avoids double-ingestion — reassess connectors that copy Defender data into the workspace |
| Automation | Attack disruption (automatic containment) may act before SOAR playbooks; XDR remediation actions available alongside Logic Apps |
| RBAC | Unified RBAC in the Defender portal alongside Azure RBAC on the workspace — plan the permission model across both |

## Multi-workspace and MSSP

- Multiple workspaces per tenant supported in the Defender portal; one
  primary workspace concept applies — check current behaviour before
  architecting.
- Cross-workspace queries (`workspace()`) and cross-tenant via Azure
  Lighthouse remain the MSSP backbone; Lighthouse-delegated users keep
  Azure-portal-era flows longer (check current guidance).
- MSSP IP protection guidance (hide your detection logic from customer
  tenants) is documented — apply for productised detection content.

## MITRE ATT&CK coverage

- Every analytics rule, hunting query and (where applicable) automation
  carries tactic + technique tags; the **MITRE coverage view** in
  Sentinel aggregates active coverage and simulated coverage across
  templates.
- Engineering use: identify gaps per tactic before writing new
  detections; audit use: export coverage evidence.
- Tag honestly — a log-source-less technique tagged on a weak rule is
  fake coverage; the matrix is only as good as the tagging discipline.
- ATT&CK versions update; template tags follow Microsoft's mapping —
  note the framework version when reporting coverage externally.

## Defender XDR integration without the unified portal (legacy)

The Defender XDR connector can be enabled manually from the Azure
portal (incidents/alerts/advanced hunting sync) — relevant only until
portal retirement; plan migrations now (move-to-defender guidance).

## Threat intelligence

TI (STIX/TAXII, Defender TI, upload API) lands in TI tables and powers
TI-matching analytics and enrichment. Manage indicators in the Defender
portal intel experience; correlate via TI mapping rules or `lookup`
joins in custom detections.
