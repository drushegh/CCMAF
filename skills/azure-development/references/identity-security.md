# Identity, Security, Networking

## Managed identity first

Code running on Azure compute (App Service, Functions, Container Apps,
AKS, VMs) gets a **system-assigned** (or shared **user-assigned**)
managed identity; access to other services is granted via **RBAC roles
on the target** (Storage Blob Data Contributor, Key Vault Secrets User,
etc.). In code: `DefaultAzureCredential` — works locally (developer az
login) and deployed (MI) without branching. Connection strings and
client secrets are the legacy path; every one you keep is a rotation
liability and an audit finding.

## RBAC discipline

- Scope as low as possible (resource > resource group > subscription);
  built-in roles before custom; groups over direct user assignments.
- Control plane (Owner/Contributor/Reader) ≠ data plane (the `*Data*`
  roles) — Contributor on a storage account still can't read blobs via
  Entra auth; assign the data-plane role.
- Service principals for CI/CD get exactly the deployment scope, with
  **federated credentials (OIDC)** from GitHub/Azure DevOps instead of
  secrets — no PAT/secret rotation treadmill.

## Entra app registrations

One registration per logical app; redirect URIs exact; least-privilege
**delegated** scopes for user-facing flows, **application** permissions
(admin-consented) only for daemons; certificates or federated
credentials over client secrets; secret expiry ≤ 12 months when
unavoidable. Multi-tenant only when the product genuinely is. For
customer-facing identity, External ID (CIAM) — cross-ref
power-pages-development for portal auth.

## Key Vault

- One vault per app per environment (RBAC-mode authorisation, not
  legacy access policies).
- Consumers use **references** (App Service/Functions
  `@Microsoft.KeyVault(SecretUri=...)`) or read at startup with MI —
  secrets never transit IaC parameters or app settings in plaintext.
- Soft delete + purge protection on; rotation automated where the
  service supports it.

## Network isolation

- Default public endpoints are fine for dev; production data services
  get **private endpoints** + private DNS zones, compute gets VNet
  integration; disable public network access once private paths work.
- Front public workloads with Front Door (global, WAF, CDN) or App
  Gateway (regional, WAF); never expose origin directly when a WAF
  fronts it (lock origin to the fronting service).
- NSGs deny-by-default between tiers; service tags over IP lists.
- Foundry/OpenAI workloads support the same pattern (managed VNet or
  BYO VNet) — see ai-foundry.md.

## Baseline checklist

1. MI + RBAC wired for every service-to-service call; zero secrets in
   code, IaC, or pipeline variables (federated creds for CI/CD).
2. Key Vault for residual secrets, references not copies.
3. Diagnostic settings → Log Analytics on every resource.
4. Defender for Cloud recommendations triaged, not ignored.
5. HTTPS/TLS minimums enforced; storage/SQL public access reviewed;
   CORS explicit, not `*` in production.

Docs: https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/ ·
https://learn.microsoft.com/azure/role-based-access-control/best-practices ·
https://learn.microsoft.com/azure/key-vault/general/best-practices ·
https://learn.microsoft.com/azure/architecture/framework/security/
