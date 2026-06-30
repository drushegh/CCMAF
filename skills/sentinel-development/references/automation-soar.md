# Automation and SOAR

## The two-layer model

**Automation rules** = orchestration: centrally defined, condition-based
responses to incident/alert events (created, updated). They set
severity/status/owner, add tasks, apply tags, suppress noise, and call
playbooks. **Playbooks** = execution: Logic Apps workflows doing the
actual work (enrich, notify, contain, ticket).

Rules order by an explicit `Order` value; an automation rule can expire
(useful for time-boxed suppression during maintenance windows).
Alert-trigger playbooks attached directly to analytics rules are the
legacy pattern — migrate them to automation rules (documented migration
path) so triggering logic lives in one place.

## Automation rule conditions and actions

- Triggers: incident created/updated, alert created.
- Conditions: analytics rule name, severity, status, tactics, entity
  values, custom details — including "Updated by" filters to react to
  specific change sources.
- Actions: run playbook, change status/severity/owner, add task, add
  tags. Incident **tasks** standardise analyst workflow (and are
  auditable) — encode your SOC runbook steps as tasks on the relevant
  rule categories.

## Playbook engineering (Logic Apps)

- Triggers: Microsoft Sentinel incident / alert / entity (entity
  triggers enable per-entity actions from the investigation UI).
- Identity: use **managed identity** for the Logic App; grant it
  Microsoft Sentinel Responder (and target-system roles) —
  no connection-owner personal credentials in production.
- Permissions wrinkle: Sentinel needs permissions to run playbooks in
  their resource group (the "Microsoft Sentinel Automation
  Contributors" grant) — cross-subscription/tenant setups need this
  explicitly.
- Standard patterns: enrich (TI lookup, geo-IP, asset/HR lookup via
  watchlist or external API), notify (Teams adaptive card with
  approve/deny), contain (disable user via Entra ID connector, isolate
  machine via Defender connector, block IP via firewall connector),
  record (ticket in ServiceNow/Jira/DevOps).
- Defender portal era: prefer XDR-native remediation actions for
  Microsoft-stack containment (automatic attack disruption may act
  before your playbooks — design for both).
- Idempotency: incidents update repeatedly; guard side-effecting
  playbooks against re-execution (status checks/tags as latches).

## Operational rules

1. Every playbook failure is a silent SOC gap — monitor Logic Apps run
   history and alert on failures (Azure Monitor alert on failed runs).
2. Test with replayed incidents in a dev workspace before production;
   playbooks are code — version their ARM definitions
   (→ `devops-development`).
3. Keep secrets in Key Vault references, never in Logic App parameters.
4. SOC metrics: automation rules that set status/severity feed
   incident metrics (MTTA/MTTR) — instrument before optimising.
5. Document which automation acts on which rule categories — overlapping
   automation rules with conflicting actions resolve by Order, which
   surprises people.

## Boundaries

Logic Apps language/connector depth → `azure-development`; Power
Automate (different product, not for SOC automation) →
`power-platform-development`.
