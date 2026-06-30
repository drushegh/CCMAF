# AKS specifics

Azure Kubernetes Service is the managed target in this estate. AKS runs the
control plane; you own workloads, node pools and configuration. Provisioning
(Bicep/Terraform, VNet, private cluster) → `azure-development`; this is what to
know when operating on AKS. (Verify current defaults — AKS moves fast.)

## Cluster mode

- **AKS Automatic** (default recommendation) — curated, secure-by-default:
  Node Auto-Provisioning, workload autoscaling (HPA/KEDA/VPA), Azure CNI
  Overlay+Cilium, app routing, monitoring and Deployment Safeguards
  preconfigured. Use unless you need control it doesn't expose.
- **AKS Standard** — full control of networking, node pools and autoscaling;
  more setup and ongoing responsibility.

## Identity (no static credentials)

- **Microsoft Entra ID** for cluster auth + **Azure RBAC for Kubernetes**
  authorization; bind Kubernetes RBAC to Entra groups.
- **Workload Identity** (federated) for pods → Azure resources; the **kubelet
  identity** pulls from ACR (attach with `az aks update --attach-acr`).
- **Key Vault** secrets via the **Secrets Store CSI driver** (azure-keyvault
  -secrets-provider add-on) using workload identity.

## Networking

- **Azure CNI Overlay** (recommended) — pod IPs from an overlay, scales large;
  **Azure CNI (VNet-routable)** when pods must be addressable from the VNet/
  on-prem; **Cilium** data plane (eBPF) for performance + network policy +
  observability.
- **App routing add-on** (managed NGINX, supports Gateway API) is the default
  for HTTP/S ingress; **Istio add-on** for mesh/mTLS/canary; **Application
  Gateway for Containers** for L7 + WAF.
- Enable **NetworkPolicy** (Azure/Cilium or Calico); **LocalDNS** on node pools
  for DNS reliability; static egress (UDR + Azure Firewall) for controlled
  outbound.

## Node pools

- **System** pool (runs cluster services) separate from **user** pools (your
  workloads); user pools can scale to zero.
- Separate long-running and bursty workloads into different pools; **Spot**
  pools for interruptible work (with priority-expander/affinity).
- Use **availability zones** (set at creation — can't change later); for
  zonal balance with the autoscaler use one node pool per zone or
  `--balance-similar-node-groups`.
- **Cluster autoscaler / Node Auto-Provisioning** adds nodes for pending pods.

## Governance and security

- **Azure Policy for AKS** + **Deployment Safeguards** enforce guardrails
  (required limits, no privileged, approved registries) at admission.
- Allow only signed/approved images (Azure Policy + **Ratify**); prefer **ACR**
  (Defender for Containers scanning — see `containers-development`).
- Encryption at rest (etcd; KMS/Key Vault option) and in transit.

## Observability and reliability

- **Azure Monitor managed Prometheus** + **Container Insights** (+ Grafana);
  High Scale mode for hundreds of nodes.
- Enable control-plane **diagnostic logs** (`kube-audit-admin`,
  `cluster-autoscaler`, `kube-controller-manager`, `guard`) to Log Analytics.
- Recommended Prometheus alert rules; spread across zones; PDBs for upgrades.

## Upgrades and lifecycle

Stay within the supported Kubernetes window (AKS tracks N-2). Upgrade control
plane then node pools; use **maintenance windows** and node surge. Keep node
**OS SKU** supported — **Azure Linux 2.0 retired (Nov 2025; images removed Mar
2026)**, migrate to AzureLinux3 / a supported image by upgrading node pools.
