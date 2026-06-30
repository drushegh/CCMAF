# Networking

## Services

- **ClusterIP** (default) — stable in-cluster virtual IP + DNS
  (`svc.namespace.svc.cluster.local`). The backbone for east-west traffic.
- **Headless** (`clusterIP: None`) — DNS returns pod IPs directly; for
  StatefulSet peer discovery.
- **NodePort / LoadBalancer** — L4 exposure. Prefer an ingress/Gateway over a
  LoadBalancer-per-service (cost, sprawl).
- Match `selector` to pod labels; `targetPort` to the container port. Services
  load-balance across *ready* endpoints only — readiness probes matter.

## North-south: Ingress and Gateway API

- **Ingress** — HTTP(S) host/path routing + TLS termination via an ingress
  controller (NGINX, or AKS **application routing add-on**). Mature, ubiquitous.
- **Gateway API** — the successor: role-oriented (`GatewayClass`/`Gateway`/
  `HTTPRoute`), richer traffic control, portable. **Prefer it for new work**;
  AKS supports it via the app routing add-on and Istio.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: app
spec:
  parentRefs:
    - name: web-gateway
  hostnames: ["app.example.com"]
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: app
          port: 80
```

Terminate TLS at the gateway with cert-manager (or Key Vault certs on AKS); don't
expose a `LoadBalancer` Service per app.

## DNS

CoreDNS resolves Services and pods cluster-wide. On AKS enable **LocalDNS** on
node pools for reliable, performant resolution. Don't hard-code IPs — use
Service DNS names.

## NetworkPolicy — default-deny, then allow

Without a policy, the pod network is flat and open. Apply a default-deny per
namespace, then allow only required flows. Requires a CNI that enforces
policy (Azure CNI/Cilium, Calico).

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: production
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: production
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: backend
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: frontend
      ports:
        - protocol: TCP
          port: 8080
```

Remember egress too — restrict outbound (DNS, specific CIDRs) for sensitive
namespaces. Cilium adds L7-aware policy and observability (Hubble).

## Service mesh — only when justified

A mesh (Istio — AKS Istio add-on; or Linkerd) buys mTLS everywhere, fine
traffic shaping (canary/mirroring), and rich telemetry — at real operational
cost. Adopt it for a concrete need (zero-trust mTLS mandate, advanced
canarying), not by default. NetworkPolicy + ingress + good probes cover most
workloads without a mesh.
