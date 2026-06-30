# Configuration and secrets

Separate config from image (12-factor): the same image runs in every
environment, parameterised at deploy time.

## ConfigMaps

Non-sensitive configuration as key-value or files. Consume as env vars or
mounted files; mount files when the app hot-reloads or expects a config file.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
immutable: true        # prevents drift; bump the name to change
data:
  LOG_LEVEL: "info"
  appsettings.json: |
    { "FeatureX": true }
```

`immutable: true` improves performance and stops accidental edits — you create
a new (versioned) ConfigMap and update the workload to point at it, which also
makes the change roll out. A ConfigMap change alone does **not** restart pods;
trigger a rollout (e.g. a checksum annotation, or `kubectl rollout restart`).

## Secrets

Kubernetes Secrets are **base64, not encrypted** by default. Treat them as
references to a real secret store, and enable **encryption at rest** (etcd) on
the cluster (AKS does this; KMS/Key Vault-backed encryption for stronger
guarantees).

- **Mount as files** under `tmpfs` rather than env vars where possible — env
  vars leak into logs, crash dumps and child processes.
- Set `automountServiceAccountToken: false` on workloads that don't call the
  API server.

## External secrets (the production pattern)

Don't author long-lived Secrets by hand. Pull them from Azure Key Vault:

- **Secrets Store CSI Driver + Azure Key Vault provider** — mounts secrets as
  files; can sync to a native Secret. Uses **Workload Identity** for auth (no
  stored credentials).
- **External Secrets Operator (ESO)** — reconciles a `SecretStore` +
  `ExternalSecret` into native Secrets from Key Vault/other backends; fits
  GitOps (you commit the *reference*, not the value).

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: app-secrets
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: azure-kv
    kind: SecretStore
  target:
    name: app-secrets
  data:
    - secretKey: db-password
      remoteRef:
        key: prod-db-password
```

## Secrets in GitOps repos

Never commit plaintext secrets. If a secret must live in Git, **encrypt** it —
Sealed Secrets (controller-decryptable) or SOPS+age — or, better, keep only an
`ExternalSecret` reference in Git and let the operator fetch the value. Rotate
via Key Vault; the CSI driver / ESO picks up changes on its refresh interval.

## Projected volumes

Combine ConfigMap, Secret, ServiceAccount token and downward-API data into one
mount when an app expects several config sources in a single directory.
