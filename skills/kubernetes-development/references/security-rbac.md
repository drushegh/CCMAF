# Security: RBAC, Pod Security, admission

Defence in depth: who can act on the API (RBAC), what pods may do (Pod Security
+ security context), and what is allowed to run at all (admission control).

## RBAC — least privilege

`Role`/`ClusterRole` define permissions; `RoleBinding`/`ClusterRoleBinding`
grant them to a subject (ServiceAccount, user, group). Scope to a namespace
with `Role` unless the resource is cluster-wide.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: deployment-manager
  namespace: production
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "update", "patch"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
```

Rules:
- No wildcard `verbs: ["*"]` / `resources: ["*"]` in production roles.
- **One ServiceAccount per workload**; `automountServiceAccountToken: false`
  unless the pod calls the API. Don't reuse `default`.
- Bind human access to **groups** (Entra ID on AKS), not individuals.
- Audit with `kubectl auth can-i --list --as=...`.

## Pod Security Admission

Enforce the **restricted** standard at the namespace — the built-in replacement
for PodSecurityPolicy:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/audit: restricted
```

`restricted` requires non-root, dropped capabilities, no privilege escalation,
seccomp, etc. Use `baseline` only where a workload genuinely can't comply, and
document why.

## Security context (pod + container)

```yaml
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 10001
    fsGroup: 10001
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: app
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop: ["ALL"]
```

Writable paths → explicit `emptyDir`/`tmpfs` mounts. No `privileged`,
`hostNetwork`, `hostPID`, or `hostPath` without written justification.

## Admission control — enforce policy cluster-wide

Validate/mutate resources at admission so bad config never lands:

- **Kyverno** (YAML policies) or **OPA Gatekeeper** (Rego) — require labels,
  block `:latest`, enforce probes/limits, restrict registries.
- **Image trust**: only signed, approved images — Azure Policy + Ratify on AKS,
  or Kyverno verifyImages with Cosign. (Image build/SBOM →
  `containers-development` / `secure-development`.)

## Identity to cloud

Pods authenticate to Azure with **Workload Identity** (federated token →
managed identity + RBAC), never stored credentials or connection strings. Key
Vault access flows through it (see `config-secrets.md`).
