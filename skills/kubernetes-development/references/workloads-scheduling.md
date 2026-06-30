# Workloads, scheduling and autoscaling

## Choosing a controller

- **Deployment** — stateless apps/APIs; rolling updates, easy rollback. The default.
- **StatefulSet** — stable network identity (`pod-0`, `pod-1`), ordered
  start/stop, and per-pod storage via `volumeClaimTemplates`. Databases,
  brokers, anything that isn't interchangeable. Pair with a headless Service.
- **DaemonSet** — exactly one pod per (matching) node: CNI, log/metrics agents,
  node tooling.
- **Job / CronJob** — run-to-completion / scheduled. Set
  `backoffLimit`, `activeDeadlineSeconds`, and a `restartPolicy` of `Never`/
  `OnFailure`. Mind `concurrencyPolicy` on CronJobs.
- **Operator/CRD** — for software with a non-trivial lifecycle (leader
  election, backups, failover). Adopt an existing operator; don't hand-roll
  orchestration in a Deployment.

## Rollouts

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0   # zero-downtime
      maxSurge: 1
```

`kubectl rollout status deployment/app`; `kubectl rollout undo deployment/app
[--to-revision=N]`. StatefulSets default to `OrderedReady`; use
`partition` for staged/canary updates. Set `minReadySeconds` and a real
readiness probe so a rollout waits for genuinely-ready pods.

## Scheduling and high availability

- **Requests/limits and QoS**: `requests==limits` → `Guaranteed`;
  `requests<limits` → `Burstable`; none → `BestEffort` (avoid in prod). The
  scheduler places on requests; the autoscaler scales on pending pods, not node
  CPU pressure.
- **Spread for HA**: `topologySpreadConstraints` across `topology.kubernetes.io/
  zone` and `kubernetes.io/hostname`; or pod anti-affinity. Don't let all
  replicas land on one node/zone.
- **Targeting nodes**: `nodeSelector`/`nodeAffinity` for node classes (GPU,
  spot); **taints + tolerations** to reserve nodes for specific workloads.
- **PodDisruptionBudget**: cap voluntary disruption so drains/upgrades can't
  take all replicas.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: app
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app.kubernetes.io/name: app
```

- **PriorityClass** to protect critical pods under contention;
  `terminationGracePeriodSeconds` + SIGTERM handling to drain cleanly.

## Autoscaling

Three independent layers — use together:

- **HPA** — scale pod replicas on CPU/memory or custom/external metrics.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: app
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

- **KEDA** — event-driven scaling (queue depth, Service Bus, Kafka lag, cron);
  scales to zero. The right tool when CPU isn't the signal. AKS KEDA add-on.
- **VPA** — right-sizes requests/limits over time; don't run VPA and HPA on the
  same CPU/memory metric.
- **Cluster autoscaler / Node Auto-Provisioning** — adds/removes *nodes* for
  pending pods. HPA needs nodes to land on; pair them. Separate long-running
  and bursty workloads into different node pools.
