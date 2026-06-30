---
name: kubernetes-development
description: >-
  Kubernetes platform engineering: workloads and scheduling, Services/Ingress/
  Gateway API and NetworkPolicy, ConfigMaps/Secrets and external secrets,
  RBAC/Pod Security Admission/admission control, storage, Helm and Kustomize
  packaging, GitOps (Argo CD/Flux), autoscaling (HPA/VPA/KEDA/cluster
  autoscaler), operations/troubleshooting, and AKS specifics. Use whenever a
  task goes beyond shipping one container into cluster/platform territory:
  kubectl, helm, kustomize, k8s/ or manifests/ YAML, StatefulSets, DaemonSets,
  RBAC, NetworkPolicy, Ingress/Gateway, PV/PVC/StorageClass, HPA/KEDA, Argo
  CD/Flux, "the cluster", node pools, or AKS. Triggers include Chart.yaml,
  kustomization.yaml, Argo Application manifests, kubeconfig, and "deploy to
  Kubernetes/AKS". PROACTIVELY activate before designing cluster topology,
  RBAC, network policy or a Helm chart.
---

# Kubernetes Development

Platform-level Kubernetes engineering. `containers-development` covers the
image and a working-level Deployment/Service/Ingress to ship one service; this
skill owns the **cluster and platform** — the controllers, scheduling,
network/security posture, packaging, GitOps and operations that make a fleet
run reliably. Default managed target in this estate is **AKS**.

Version context (June 2026 — re-verify): Kubernetes 1.36 is current (N-2
support window); pin to a version your cluster (AKS) still supports and upgrade
within it. AKS retired Azure Linux 2.0 node images (Nov 2025 / removal Mar
2026) — keep node pools on a supported OS SKU. Gateway API is the modern
successor to Ingress; both are in use.

## Non-negotiables

1. **Declarative, in Git, reconciled.** All cluster state is versioned YAML
   applied by a controller (GitOps: Argo CD/Flux), not imperative `kubectl
   edit`/`create` in production. The cluster converges to Git, not to whoever
   last typed a command.
2. **Requests and limits on every container.** `requests==limits` →
   `Guaranteed` QoS for critical workloads; never `BestEffort` in production
   (first evicted). The scheduler and autoscaler reason from requests.
3. **Security baseline, always.** `runAsNonRoot`, non-root UID,
   `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem`, `drop: [ALL]`,
   `seccompProfile: RuntimeDefault`; enforce **Pod Security Admission
   `restricted`** at the namespace; no privileged/hostNetwork/hostPath without
   written justification.
4. **NetworkPolicy default-deny, then allow.** Without a policy every pod is
   reachable by every other. Deny ingress+egress by default per namespace and
   open only required flows.
5. **RBAC least-privilege.** Named Roles bound to ServiceAccounts/groups; no
   wildcard `*` verbs/resources in production; one ServiceAccount per workload,
   automount off unless needed.
6. **Pin images by digest; only run approved images.** `@sha256:…` in
   manifests; admission policy (Azure Policy/Ratify, Kyverno/Gatekeeper) to
   block unsigned or non-registry images.
7. **HA by construction.** ≥2–3 replicas, `PodDisruptionBudget`, topology
   spread / anti-affinity across nodes and zones, `maxUnavailable: 0` for
   zero-downtime rollouts.
8. **Secrets are not config and not in Git as plaintext.** Back Secrets with
   an external store (Key Vault via Secrets Store CSI / External Secrets
   Operator); seal/encrypt anything that must live in the GitOps repo.
9. **Validate before apply.** `kubectl --dry-run=server`, `kubeconform`, a
   policy check (Kyverno/Conftest), and a breaking-diff in CI.

## Decision tables

| Workload | Controller |
|---|---|
| Stateless app/API | **Deployment** |
| Stable identity / ordered / per-pod storage | **StatefulSet** |
| One pod per node (agents, CNI, logging) | **DaemonSet** |
| Run-to-completion | **Job**; scheduled → **CronJob** |
| Leader-elected / complex lifecycle | **Operator/CRD** (don't hand-roll) |

| Expose a service | Use |
|---|---|
| In-cluster only | **ClusterIP** (+ headless for StatefulSet peers) |
| HTTP(S) north-south, host/path routing, TLS | **Ingress** or **Gateway API** (prefer Gateway API for new work) |
| Advanced traffic mgmt, mTLS, canary | **Service mesh** (Istio; AKS Istio add-on) — adopt only if the need is real |
| Raw L4 to the internet | **LoadBalancer** (sparingly; prefer ingress) |

| Config/secret source | Use |
|---|---|
| Non-sensitive config | **ConfigMap** (immutable where possible) |
| Sensitive value | **Secret** backed by Key Vault (CSI driver / ESO) |
| Per-pod identity to Azure | **Workload Identity** (federated), not stored creds |

## High-frequency pitfalls

- **No NetworkPolicy** — flat, open pod network. Default-deny per namespace.
- **`BestEffort` / missing requests** — unschedulable surprises and first-to-evict.
- **`latest`/unpinned images** and unsigned images admitted — supply-chain risk.
- **Liveness probe doing dependency checks** — restarts healthy pods during a
  downstream blip; liveness = "am I alive", readiness = "route to me".
- **Secrets in ConfigMaps or plaintext in the GitOps repo** — not encrypted.
- **Cluster-admin everywhere / wildcard RBAC** — blast radius.
- **One giant namespace** — use namespaces as the isolation + policy boundary.
- **Helm values sprawl** — undocumented values, no schema, `:latest` subcharts.
- **Imperative drift** — `kubectl edit` in prod that GitOps then reverts (or
  worse, that nothing reconciles). Change Git, not the cluster.
- **Ignoring `terminationGracePeriodSeconds`/SIGTERM** — connections cut on rollout.
- **StatefulSet treated like a Deployment** — storage/identity/ordering lost.

## Workflow

1. Model the workload → pick the controller; define requests/limits, probes,
   security context (or inherit a hardened baseline).
2. Namespace + RBAC + NetworkPolicy + PSA label as the isolation boundary.
3. Package with Helm/Kustomize; parameterise per environment; schema-validate.
4. Deliver via GitOps (Argo/Flux) — PR → reconcile, not `kubectl apply` by hand.
5. Wire autoscaling (HPA/KEDA + cluster autoscaler/NAP) and observability
   (managed Prometheus + Container Insights) before load, not after an incident.
6. Verify the running fleet: rollout status, events, probes, dashboards — and
   rehearse rollback (`kubectl rollout undo` / Git revert).

## Reference index

Load on demand:

- `references/workloads-scheduling.md` — controllers, rollout, scheduling, autoscaling, PDB
- `references/networking.md` — Services, Ingress, Gateway API, DNS, NetworkPolicy, mesh
- `references/config-secrets.md` — ConfigMaps, Secrets, external secrets, projected volumes
- `references/security-rbac.md` — RBAC, Pod Security Admission, security context, admission control
- `references/storage.md` — volumes, PV/PVC, StorageClass, CSI, StatefulSet storage
- `references/packaging.md` — Helm charts and Kustomize: structure, values, templating, when each
- `references/gitops-operations.md` — Argo CD/Flux, observability, troubleshooting, upgrades, rollback
- `references/aks.md` — AKS specifics: identity, node pools, networking, add-ons, upgrades

## Boundaries

- **The Dockerfile, image security, and a single service's working-level
  manifest + the ACA-vs-AKS-vs-App-Service decision** → `containers-development`.
  This skill takes over once you're operating a cluster.
- **AKS provisioning (Bicep/Terraform), VNet/private endpoints, broader Azure
  identity wiring** → `azure-development`. This skill consumes the cluster; that
  one builds it.
- **CI/CD pipelines that build/scan/push and trigger deploys** →
  `devops-development` (this skill owns the GitOps/manifest intent).
- **Supply-chain/threat frameworks, SBOM policy** → `secure-development`;
  **KQL/Container-Insights queries** → `sentinel-development`.
- **Shell scripting around kubectl** → `bash-development`; **the Linux node OS**
  → `linux-administration`.
