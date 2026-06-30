# Operations, Reliability, Cost

## Observability

- **App Insights on everything** (workspace-based, into Log Analytics):
  auto-instrumentation where supported, SDK + custom telemetry where it
  matters; distributed tracing across services via W3C trace context.
- Diagnostic settings on every resource → the same Log Analytics
  workspace per environment; KQL is the query surface (alerts,
  workbooks, dashboards).
- Alert on symptoms users feel (availability tests, failed-request
  rate, latency P95, dead-letter depth, queue age), not just CPU.
  Action groups route to the people who can act.
- Sampling keeps ingestion costs sane — configure it, don't discover
  the bill.

## Reliability (Well-Architected essentials)

- **Zone redundancy** for production tiers that offer it (App Service,
  SQL, Storage ZRS, Service Bus Premium); multi-region only with an
  explicit RTO/RPO requirement — it doubles cost and complexity.
- Health checks wired to the platform (App Service health check path,
  Container Apps probes) so the platform can actually replace bad
  instances.
- Retries + circuit breakers on all remote calls; timeouts everywhere
  (the default infinite timeout is an outage multiplier).
- Backups/PITR verified by **restoring**, not by the tick-box;
  infrastructure re-creatable from IaC (the real DR plan).
- Assess existing estates systematically: discover resources → assess
  against reliability checklist (priority-classified) → fix via CLI now
  or patch IaC (the durable fix) → re-assess (microsoft/skills
  azure-reliability follows exactly this loop).

## Cost management

- Cost Management APIs/portal: query by scope (subscription / RG /
  management group), forecast, and set **budgets with alerts** per
  environment.
- Standard waste sweep: orphaned disks/IPs/NICs, stopped-but-allocated
  VMs, empty App Service plans, over-provisioned Redis/Cosmos RU,
  non-prod running 24/7 (auto-shutdown), premium SKUs in dev.
- Right-size from telemetry (Advisor recommendations), then commit:
  reservations/savings plans for steady state.
- Tag taxonomy (owner, environment, cost-centre, project) enforced via
  Azure Policy — untagged spend is unaccountable spend.

## Quotas and regions

Quota (vCPU families, OpenAI TPM, public IPs) is per subscription per
region and **bites at deploy time** — check before designs or proposals
promise a SKU/region (`az vm list-usage`, Foundry capacity APIs,
Quotas API; increases take time). Not every service/SKU exists in every
region — verify availability for the client's required residency (e.g. EU data residency: North Europe/West Europe pairing).

## Governance quick map

Management groups → subscriptions (prod/non-prod separation) → resource
groups per workload+environment. Azure Policy for guardrails (allowed
regions, required tags, denied SKUs); Defender for Cloud for posture;
activity + resource logs retained per compliance needs.

Docs: https://learn.microsoft.com/azure/well-architected/reliability/ ·
https://learn.microsoft.com/azure/azure-monitor/app/app-insights-overview ·
https://learn.microsoft.com/azure/cost-management-billing/ ·
https://learn.microsoft.com/azure/governance/policy/overview
