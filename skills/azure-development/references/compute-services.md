# Compute Service Selection

## The decision table

| Workload | First choice | Notes |
| --- | --- | --- |
| Web app / API, standard scale | **App Service** | Simplest ops; slots for safe deploys; Linux plans default |
| Containerised microservices, event-driven scale, Dapr | **Container Apps** | Scale-to-zero, KEDA scaling, revisions; the default container host before AKS |
| Event/timer/queue-triggered logic | **Functions** | Consumption/Flex for spiky, Premium for VNet+warm |
| Full Kubernetes control, large estates | **AKS** | Only with the team to run it; Automatic SKU lowers the bar |
| Static front end + API | **Static Web Apps** | Built-in Functions API, auth, CDN |
| Long-running stateful orchestration | **Durable Functions** (+ Durable Task Scheduler) | Fan-out/fan-in, sagas, human-interaction timeouts |
| Connector-based integration / workflow / SOAR playbooks | **Logic Apps** | Visual + JSON workflows, hundreds of connectors; Standard (single-tenant, VNet) vs Consumption — see `logic-apps.md` |

Default ladder: App Service / Container Apps / Functions first; AKS is
the answer to organisational, not technical, scale. The portal's newest
shiny tier is not an architecture.

## Azure Functions essentials

- Triggers/bindings over hand-rolled SDK polling; one responsibility
  per function; idempotent handlers (every trigger is at-least-once).
- Hosting: Consumption (cheap, cold starts), Flex Consumption (VNet +
  faster scale), Premium (no cold start, VNet), Dedicated (App Service
  plan reuse). VNet integration and Key Vault references need
  Premium/Flex or better.
- Configuration via app settings (which are environment variables);
  local parity via `local.settings.json` (never committed).
- Durable Functions for orchestration: deterministic orchestrators (no
  I/O, no clocks, no random in the orchestrator body), activities do
  the work, external events for human steps.
- Concurrency/scaling per trigger type is configurable in host.json —
  the queue-storm killer.

## Containers

ACR for images (managed identity pull, no admin user in production);
Container Apps revisions for blue/green; health probes (liveness +
readiness) are mandatory, not optional polish. Jobs (Container Apps
Jobs) for run-to-completion workloads.

## App Service operational notes

Deployment slots + slot swap for zero-downtime; auto-heal rules for
known failure modes; Always On for anything with background work;
per-app scaling on shared plans. Run from package for immutable
deploys.

Docs: https://learn.microsoft.com/azure/architecture/guide/technology-choices/compute-decision-tree ·
https://learn.microsoft.com/azure/azure-functions/functions-best-practices ·
https://learn.microsoft.com/azure/container-apps/ ·
https://learn.microsoft.com/azure/well-architected/
