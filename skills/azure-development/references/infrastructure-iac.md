# Infrastructure as Code and azd

## The workflow (from microsoft/skills azure-prepare/validate/deploy)

1. **Plan**: write the deployment plan to disk first (services, SKUs,
   regions, identity model, data stores, estimated cost) and get it
   approved before generating anything.
2. **Prepare**: generate IaC (Bicep or Terraform — one, not both),
   `azure.yaml` for azd projects, Dockerfiles where containerised.
3. **Validate**: template compiles (`az bicep build` /
   `terraform validate` + `plan`), quotas available, prerequisites
   (resource providers registered, names available), no policy
   violations. Only a real validation pass marks the plan validated.
4. **Deploy**: `azd up` (provision + deploy) or `azd provision` +
   `azd deploy`, `terraform apply`, `az deployment group create` — with
   error recovery, then post-deploy verification.

## azd (Azure Developer CLI)

`azure.yaml` maps services → hosting; `infra/` holds the IaC; `azd env`
holds per-environment values (`azd env get-values`). `azd up` =
provision + deploy; `azd deploy` = code only. Templates
(`azd init -t <template>`) scaffold **new** projects only. azd
environments are the per-stage parameterisation mechanism — no
hard-coded names/regions in templates.

## Bicep rules

- Modules per service; parameters with `@description` and sensible
  defaults; `@secure()` for anything secret (and prefer not passing
  secrets at all — managed identity).
- Naming via `uniqueString(resourceGroup().id)` salts + a consistent
  abbreviation convention; expose outputs other modules need rather
  than re-deriving.
- **Never** author SQL `administratorLogin`/`administratorLoginPassword`
  — Entra-only auth, unconditionally.
- Prefer Azure Verified Modules (AVM) where they fit before hand-rolling
  resource declarations.
- Idempotency is the contract: a second deploy of the same template is
  a no-op. Anything imperative (data plane seeding, key generation)
  goes in deployment scripts or post-deploy steps, clearly marked.

## Terraform on Azure

azurerm provider with remote state (Azure Storage backend +
state locking); `terraform plan` output reviewed before every apply;
workspaces or directory-per-environment for stage separation. Don't mix
half-Bicep half-Terraform estates — when converting a template-derived
project, finish the conversion and remove the superseded files.

## What belongs where

| Concern | Home |
| --- | --- |
| Resource topology, SKUs, identity wiring | IaC |
| Per-environment values | azd env / tfvars / parameter files |
| Secrets | Key Vault (referenced, not copied) |
| App configuration that changes without redeploys | App Configuration service |
| Deployment orchestration, gates | CI/CD (devops-development) |

Docs: https://learn.microsoft.com/azure/azure-resource-manager/bicep/best-practices ·
https://learn.microsoft.com/azure/developer/azure-developer-cli/ ·
https://azure.github.io/Azure-Verified-Modules/ ·
(plus microsoft/skills azure-prepare / azure-validate / azure-deploy)
