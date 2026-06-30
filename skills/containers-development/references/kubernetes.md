# Kubernetes manifests (working level)

Enough to ship and operate a service safely. Platform engineering —
operators, multi-tenancy, service mesh, library Helm charts, GitOps — is out
of scope (flag a `kubernetes-development` skill if a task needs it). Kubernetes
ignores Dockerfile `HEALTHCHECK`; it uses its own probes.

## A production-shaped Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
  labels:
    app.kubernetes.io/name: myapp
    app.kubernetes.io/version: "1.4.2"
    app.kubernetes.io/component: api
    app.kubernetes.io/part-of: myplatform
    app.kubernetes.io/managed-by: helm
spec:
  replicas: 3
  selector:
    matchLabels:
      app.kubernetes.io/name: myapp
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  template:
    metadata:
      labels:
        app.kubernetes.io/name: myapp
        app.kubernetes.io/version: "1.4.2"
    spec:
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: myapp
          image: myregistry.azurecr.io/myapp@sha256:abc123
          ports:
            - containerPort: 8080
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8080
            periodSeconds: 10
          startupProbe:
            httpGet:
              path: /healthz
              port: 8080
            failureThreshold: 30
            periodSeconds: 5
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

## Service and Ingress

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: myapp
  ports:
    - port: 80
      targetPort: 8080
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp
spec:
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: myapp
                port:
                  number: 80
  tls:
    - hosts: ["myapp.example.com"]
      secretName: myapp-tls
```

`ClusterIP` for internal services; expose externally via Ingress (TLS
termination, host/path routing), not a `LoadBalancer` per service.

## Rules that prevent incidents

- **Resources on every container.** `requests == limits` → `Guaranteed` QoS
  for critical apps; never `BestEffort` (no requests/limits) in production —
  it's evicted first.
- **Three probes, distinct jobs.** Startup protects slow boots; readiness
  gates traffic; liveness restarts a hung process. Keep liveness cheap — don't
  check downstream dependencies in it or a blip cascades into restarts.
- **`maxUnavailable: 0`** for zero-downtime rollouts; pair with a
  **PodDisruptionBudget** (`minAvailable`) so voluntary disruptions
  (drains/upgrades) can't take all replicas.
- **Spread replicas** with `topologySpreadConstraints` / anti-affinity across
  nodes and zones for HA.
- **Secrets in `Secret`, config in `ConfigMap`** — ConfigMaps aren't
  encrypted. Back Secrets with Key Vault via the Secrets Store CSI driver.
- **NetworkPolicy default-deny**, then allow required flows; without a policy,
  pods are open to all others.
- **Pin images by digest**; enforce Pod Security Admission `restricted` at the
  namespace.
- **Autoscale** with HPA on CPU/custom metrics, or KEDA for event sources.

## Validate before apply

```bash
kubectl apply --dry-run=server -f manifest.yaml
kubeconform -strict -summary manifest.yaml
kubectl rollout status deployment/myapp
kubectl rollout undo deployment/myapp   # rollback
```

Run `kubeconform` (schema) and a policy check (Kyverno/OPA Conftest) in CI.
Rollout/rollback is `kubectl rollout status|undo|history deployment/NAME`.
