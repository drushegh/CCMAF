# GitOps and operations

## GitOps — Git as the source of truth

OpenGitOps principles: the system is **declarative**, **versioned and
immutable** (in Git), **pulled automatically** by an agent, and **continuously
reconciled** (actual converges to desired). You change Git; a controller makes
the cluster match. No `kubectl apply` by hand in production.

- **Argo CD** — an `Application` points at a repo path/chart and a target
  cluster/namespace; UI + health/sync status; app-of-apps for fleets.
- **Flux** — GitOps toolkit controllers (source, kustomize, helm); CRD-driven,
  no UI by default.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/org/gitops
    path: apps/production/app
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

`selfHeal` reverts manual drift; `prune` deletes resources removed from Git.
Structure the repo so promotion is a PR (staging → production overlay/branch).
Secrets stay as encrypted/External-Secret references (see `config-secrets.md`).
Progressive delivery (canary/blue-green) via Argo Rollouts or Flagger.

## Observability

- **Metrics**: `metrics-server` (for HPA) + **Prometheus**. On AKS use **Azure
  Monitor managed Prometheus** + **Container Insights** + Grafana; enable
  control-plane diagnostic logs (`kube-audit-admin`, `cluster-autoscaler`,
  `kube-controller-manager`, `guard`) to Log Analytics.
- **Logs**: containers log to stdout/stderr; ship via the platform agent.
- **Alerts**: enable the recommended Prometheus alert rules; alert on the
  symptoms that page (saturation, error rate, pod restarts), not noise.

## Troubleshooting playbook

```bash
kubectl get pods -n NS -o wide
kubectl describe pod POD -n NS        # events: scheduling, image pull, probes
kubectl logs POD -n NS [-p] [-c CTR]  # -p = previous (crashed) container
kubectl get events -n NS --sort-by=.lastTimestamp
```

- **CrashLoopBackOff** → app exits/fails liveness; read previous logs, check
  config/secrets and the command.
- **Pending** → unschedulable: insufficient requests vs capacity, taints, PVC
  unbound, topology constraints. `describe pod` shows why.
- **ImagePullBackOff** → tag/digest wrong, registry auth (ACR pull identity),
  network.
- **OOMKilled** → memory limit too low or a leak; raise limit or fix the app.
- **0/N ready** → readiness probe failing or dependencies down.

## Upgrades

Upgrade within the supported version window (K8s N-2; AKS tracks). Upgrade the
control plane, then node pools (surge nodes); keep node OS SKUs supported (AKS
Azure Linux 2.0 retired). Test in non-prod, respect PDBs, and have a rollback
(Git revert for app state; node-pool/control-plane rollback per AKS guidance).
Maintenance windows on AKS schedule this safely.
