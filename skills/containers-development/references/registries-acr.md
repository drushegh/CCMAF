# Registries and Azure Container Registry

General registry discipline applies to any registry (ACR, GHCR, Docker Hub,
ECR). Azure Container Registry is the default for this estate; deep
provisioning (Bicep/Terraform, networking, private endpoints) belongs to
`azure-development`.

## Tagging and immutability

- Tag with the immutable identity you deploy: a digest (`@sha256:…`) or a
  version/commit tag. Treat `latest` as a moving convenience for local dev
  only — never deploy it.
- Use semantic, traceable tags (`1.4.2`, `1.4.2-<gitsha>`). Enable
  **immutable tags / lock** on release tags in ACR so a tag can't be silently
  overwritten.
- Pull by digest in production manifests for reproducibility; a tag can be
  re-pushed, a digest cannot.

## Authentication — managed identity, not admin user

- **Disable the ACR admin user.** It's a shared static credential. Use
  Microsoft Entra ID auth.
- Azure compute (AKS, Container Apps, App Service, Functions) authenticates to
  ACR with its **managed identity** granted the pull role — no passwords in
  config.

```bash
# Grant a workload's managed identity pull access (ABAC-enabled registry)
az role assignment create \
  --assignee "$PRINCIPAL_ID" \
  --scope "$REGISTRY_ID" \
  --role "Container Registry Repository Reader"   # non-ABAC: use AcrPull
```

- AKS: attach the registry so the kubelet identity gets `AcrPull`:

```bash
az aks update --name "$CLUSTER" --resource-group "$RG" --attach-acr "$ACR_NAME"
```

- For non-Azure or CI callers that can't use managed identity, prefer
  **repository-scoped tokens** over the admin user; restrict to the repos and
  actions needed.

## Vulnerability scanning

Enable **Microsoft Defender for Containers** at the subscription level. It
scans images on push, on import, and re-scans (weekly) images pulled within
the last 30 days, surfacing findings as Defender for Cloud recommendations.
For network-restricted registries, allow trusted Microsoft services so the
scanner can reach the registry. This complements — doesn't replace — the
CI-time scan (`references/image-security.md`).

## Retention, cleanup and base-image patching

- Untagged manifests and stale tags accrue cost. Use a **retention policy** for
  untagged manifests and `az acr purge` (manual or scheduled as an ACR Task)
  to remove images older than a window or beyond a keep-count.

```bash
az acr task create --name purge --registry "$ACR_NAME" \
  --cmd "acr purge --filter 'myapp:.*' --ago 30d --untagged --keep 10" \
  --schedule "0 2 * * Sun" --context /dev/null
```

- **ACR Tasks** can build images in the registry and auto-rebuild on a base
  image update or a Git commit — the mechanism for keeping the base patched
  without a full pipeline. Give Tasks a **managed identity**
  (`--use-identity`) for cross-registry/Key Vault access; never embed
  credentials in task steps.

## Geo-replication and reliability

- Use the **Premium** tier for geo-replication (a single registry endpoint
  with regional replicas — faster pulls, regional resilience), private
  endpoints, and content-trust/immutability features.
- Co-locate the registry region with the compute that pulls from it to cut
  pull latency and egress.

## Checklist

Admin user disabled; managed-identity pull; immutable release tags; deploy by
digest; Defender scanning on; retention/purge configured; base-image
auto-rebuild (Tasks); Premium + private endpoint where the network posture
requires it.
