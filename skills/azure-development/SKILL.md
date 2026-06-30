---
name: azure-development
description: >-
  Azure development: service selection, Bicep/Terraform infrastructure as
  code, azd workflows, Azure Functions, App Service and Container Apps,
  Entra ID identity and managed identities, Key Vault, storage and
  messaging, Azure AI Foundry, monitoring, reliability, and cost. Use this
  skill whenever Azure work is created, edited, reviewed, or debugged —
  even if the user just says "the cloud", "deploy it", or names a single
  service. Triggers include: Bicep or Terraform files, azure.yaml / azd
  commands, az CLI scripts, Functions triggers/bindings, app
  registrations or managed identity, RBAC roles, Key Vault references,
  Service Bus / Event Grid choices, App Insights, AI Foundry / OpenAI
  model deployment, private endpoints, or Azure cost questions.
---

# Azure Development

Consolidated Azure engineering for agents, grounded in Microsoft's
official skills repo (microsoft/skills azure-skills plugin) and MS
Learn. Azure DevOps/GitHub pipeline construction belongs to
devops-development; Fabric capacity/data topics to fabric-development.

## Plan → Validate → Deploy (never skip the middle)

Microsoft's own deployment skills enforce a hard sequence: write a
deployment plan first, generate IaC against it, **validate** (template
compiles, quotas, prerequisites), only then deploy (`azd up` /
`terraform apply`). Adopt the same discipline: no improvised
portal-clicking or raw `az` resource creation for anything that will
outlive the afternoon — if it matters, it's in IaC and it was validated
before it ran.

## The Subscription Confirmation Rule (MANDATORY)

Before the FIRST operation that touches a subscription/environment:
state subscription + resource group + region, verify the active context
(`az account show`), get explicit confirmation. Tenants hold dev, test,
prod and *customer* subscriptions side by side. Once confirmed for a
session+target, don't re-ask per operation.

## Identity Non-Negotiables

- **Managed identity first** — code on Azure compute authenticates to
  Azure services with its identity + RBAC, never connection strings or
  client secrets where avoidable. `DefaultAzureCredential` in code.
- **No SQL passwords in IaC, ever**: Entra-only authentication
  (`azureADOnlyAuthentication: true`) — Microsoft's skill forbids
  generating `administratorLoginPassword` in any branch of a template.
- Secrets that must exist live in **Key Vault**, referenced (App
  Service/Functions Key Vault references, `@Microsoft.KeyVault(...)`),
  never in app settings as plaintext or committed config.
- App registrations: least-privilege scopes, certificates over client
  secrets for daemons, and document the consent story.

## Destructive-Action Rules

Never delete resource groups, projects, or workspace directories on a
user's behalf without explicit per-action confirmation. `azd init` with a template is for NEW projects only — running it in an existing
workspace overwrites; plain `azd init` is the existing-workspace form.

## Cost Is a Design Input

Every service choice carries a billing shape (per-instance, per-
execution, per-CU, per-GB). State the cost model of what you propose;
prefer consumption tiers for spiky workloads and reserved/savings plans
for steady state; tag resources for cost attribution. Orphaned disks,
public IPs, and forgotten previews are the classic waste — sweep them.

## Agent Workflow Rules

- Inspect before changing: `az account show`, existing IaC, existing
  resource state — never assume greenfield.
- One source of truth: if the project uses Bicep, don't introduce
  Terraform (and vice versa) without an explicit decision.
- After deployment, verify the running thing (health endpoint, smoke
  test, App Insights live metrics), not just the exit code.
- For AI/agent workloads on Foundry, follow the foundry reference —
  quota/capacity check **before** model deployment, evals before
  production.
- Region availability and quotas vary — check both before promising a
  service/SKU in a design or proposal.

## References

| File | Load when |
| --- | --- |
| references/infrastructure-iac.md | Bicep/Terraform, azd, deployment workflow |
| references/compute-services.md | Service selection, App Service, Container Apps, Functions, AKS |
| references/logic-apps.md | Logic Apps Standard vs Consumption, stateful/stateless, connectors, Sentinel playbooks |
| references/identity-security.md | Entra ID, managed identity, RBAC, Key Vault, networking |
| references/azure-ml.md | Azure Machine Learning: workspace, compute, MLflow, online/batch endpoints, MLOps |
| references/data-messaging.md | Storage, SQL/Cosmos, Service Bus/Event Grid/Event Hubs |
| references/ai-foundry.md | Azure AI Foundry: projects, models, agents, evals |
| references/operations-reliability.md | App Insights, diagnostics, reliability, cost, quotas |
