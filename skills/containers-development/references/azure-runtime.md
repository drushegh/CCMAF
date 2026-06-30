# Running containers on Azure — the hosting decision

You have an image; where does it run? This is a decision-level reference.
Provisioning (Bicep/Terraform, networking, identity wiring) belongs to
`azure-development`; deep Kubernetes mechanics to `references/kubernetes.md`.

## The shortlist

| Service | What it is | Pick it when |
|---|---|---|
| **Azure Container Apps (ACA)** | Serverless containers on a managed Kubernetes/Dapr/KEDA/Envoy substrate, no cluster to operate | Default for microservices, APIs and jobs. Want scale-to-zero, revisions/traffic-split, service discovery, event-driven scale — without running Kubernetes |
| **AKS** | Managed Kubernetes with full API access | You need the Kubernetes API, custom CNI/node pools, a service mesh (Istio add-on), GPU/specialised nodes, or to host many disparate workloads with namespace isolation — and have the ops capability |
| **Web App for Containers (App Service)** | PaaS web hosting for a container | A straightforward HTTP web app/API; existing App Service users wanting deployment slots and simplicity over control |
| **Container Instances (ACI)** | Single serverless containers, per-second billing | Short-lived jobs, burst, or a virtual-node backend — not a long-running fleet |
| **Functions (containerised)** | Event-driven FaaS packaged as a container | Trigger/binding-driven, spiky workloads that benefit from scale-to-zero |

## How to reason about it

1. **Event-driven and bursty, or trigger-based?** → Functions or ACA jobs.
2. **A web app/API and you want the least to operate?** → App Service or ACA.
   Choose App Service for the simplest slot-based web hosting; ACA when you
   want microservice primitives (per-app scaling, scale-to-zero, traffic
   split, Dapr).
3. **Do you genuinely need the Kubernetes API** — CRDs, operators, a specific
   mesh, fine node/network control, or multi-tenant isolation? → AKS. If not,
   AKS is usually more operational cost than the workload justifies.
4. **A one-off or burst container?** → ACI.

Default bias for new container workloads in this estate: **start with
Container Apps**, escalate to AKS only when a concrete Kubernetes requirement
forces it. ACA is the managed-best-practice path; AKS is the control-and-
responsibility path.

## What carries across all of them

- **Managed identity** for the app's access to Azure resources (ACR pull, Key
  Vault, SQL, storage) — no secrets in config. ACR pull via the platform/
  kubelet identity.
- **Ingress / TLS**: ACA built-in ingress with managed certs; App Service
  built-in TLS; AKS via an ingress controller (e.g. application routing
  add-on / NGINX) + cert-manager; expose only what must be public.
- **Secrets**: platform secret store backed by Key Vault (ACA secrets / App
  Service Key Vault references / AKS Secrets Store CSI driver).
- **Observability**: Container Apps and App Service stream to Log Analytics /
  Application Insights out of the box; AKS via Azure Monitor managed Prometheus
  + Container Insights.
- **Scaling**: ACA and Functions scale to zero; AKS scales pods (HPA/KEDA) and
  nodes (cluster autoscaler), but a baseline node cost remains; App Service
  scales instances within a plan (no scale-to-zero).

## Boundaries

- IaC for any of these, identity/RBAC and networking detail →
  `azure-development`.
- The Dockerfile and image the host runs → `references/dockerfiles.md`.
- CI/CD that deploys to the host → `devops-development`.
