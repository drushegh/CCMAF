---
name: containers-development
description: >-
  Container engineering: writing and reviewing Dockerfiles, docker compose
  for local development, image size/security hardening, registries, and
  running containers on Azure (Container Apps vs AKS vs App Service) plus
  working-level Kubernetes manifests. Use whenever a task involves a
  Dockerfile, .dockerignore, compose.yaml/docker-compose.yml, a container
  image, "containerise this app", base-image or multi-stage choices, image
  size or CVE reduction, SBOM/provenance/signing, pushing to a registry
  (ACR/GHCR/Docker Hub), or Kubernetes Deployment/Service/Ingress YAML.
  Triggers include Dockerfile/*.dockerfile files, compose files, k8s/ and
  manifests/ YAML, "distroless", "chiselled", "non-root container", kubectl,
  helm, and "scan the image". PROACTIVELY activate before recommending a
  base image, build stage, or container host.
---

# Containers Development

Engineering standards for building, securing and running containers. Default
target is **Linux containers on the OCI/Docker toolchain**, deployed to
**Azure** (this estate's cloud) or a Kubernetes cluster. Kubernetes is
covered at working level — enough to ship and operate a service, not a full
platform-engineering skill (see Boundaries).

Version context (June 2026 — re-verify before asserting): Docker Engine 29.x
with the BuildKit builder and the `docker compose` v2 plugin; the Compose
`version:` top-level key is obsolete and ignored. Kubernetes 1.36 is current
(N-2 support window); pin to a version your target cluster (e.g. AKS) still
supports. .NET 10 is GA and its container images dropped Debian — see
`references/dotnet-images.md`. Don't assume a feature exists on an older
engine, cluster or base image than the target actually runs.

## Non-negotiables

1. **Multi-stage builds by default.** Build/SDK tooling never ships in the
   runtime image. Copy only the produced artefacts into a minimal final
   stage. A single-stage image that carries compilers or `node_modules` dev
   deps is a defect.
2. **Pin the base image.** A specific tag (`python:3.13-slim`), and a digest
   (`@sha256:…`) for production and anything reproducibility-critical. Never
   `:latest` in a committed Dockerfile.
3. **Run as non-root.** An explicit `USER` (numeric UID for Kubernetes
   `runAsNonRoot`), never the implicit root. `.NET` images: use `$APP_UID`.
4. **Smallest viable runtime base.** Prefer distroless / chiselled, then
   `-slim`, then Alpine (mind musl/glibc), over a full distro. Fewer packages
   = smaller attack surface and faster pulls.
5. **No secrets in the image.** Not in layers, not in `ENV`, not in
   `--build-arg`. Build-time secrets via BuildKit `--mount=type=secret`;
   runtime secrets via the orchestrator (K8s Secret / Container Apps secret /
   Key Vault reference). Layer history is forever, even after `rm`.
6. **A `.dockerignore` exists** and excludes `.git`, secrets, build output and
   `node_modules` — both to shrink the build context and to prevent leaking
   files into the image.
7. **Order layers cache-friendliest-first.** Dependency manifests and
   `restore`/`install` before source `COPY`; collapse related `RUN` steps and
   clean package caches in the same layer.
8. **Define health and limits.** A `HEALTHCHECK` (or orchestrator
   liveness/readiness/startup probes) and explicit CPU/memory
   requests+limits. An unbounded container is a noisy-neighbour incident
   waiting to happen.
9. **Scan before you promote.** Image vulnerability scan (Trivy / Grype /
   Docker Scout / Defender for Containers) in CI; fail on fixable
   critical/high. Generate an SBOM + provenance attestation for anything
   released.

## Decision tables

| Runtime base | Use when |
|---|---|
| Distroless / chiselled (e.g. `*-noble-chiseled`, distroless) | Production default for compiled/runtime-only apps; no shell, smallest CVE surface |
| `-slim` (Debian/Ubuntu) | Need a shell, `apt`, or glibc-linked native deps; broad compatibility |
| Alpine | Size-critical and the stack is musl-safe and well-tested (watch DNS, native wheels, glibc assumptions) |
| Full distro (`ubuntu`, `debian`) | Only as a build stage, or when a genuinely heavy dependency set demands it |
| Scratch | Static binaries (Go/Rust) with no runtime deps and you provide CA certs/tzdata yourself |

| Azure container host | Choose when |
|---|---|
| **Container Apps** | Default for microservices/APIs/jobs: serverless scale (incl. scale-to-zero), revisions/traffic-split, Dapr/KEDA, no cluster to run. Single workload + shared security boundary |
| **AKS** | You need the Kubernetes API, custom networking/node pools, a service mesh, or to host multiple disparate workloads with namespace isolation — and have the ops capacity |
| **Web App for Containers (App Service)** | A straightforward HTTP web app/API, especially existing App Service customers wanting slots and simplicity over control |
| **Container Instances (ACI)** | A single short-lived/burst container or a virtual-node backend; not a long-running fleet |
| **Functions (containerised)** | Event-driven, trigger-based, spiky workloads benefiting from scale-to-zero |

## High-frequency pitfalls

- **`COPY . .` before dependency install** — busts the cache on every source
  change and drags ignored files in. Copy manifests, install, then source.
- **`latest` / unpinned base** — non-reproducible builds and silent base
  drift; a passing scan yesterday means nothing today.
- **Root by default** — most base images run as root unless you set `USER`;
  Kubernetes `runAsNonRoot: true` then refuses to start a root image.
- **Secrets via `ARG`/`ENV`** — both are recoverable from image metadata and
  `docker history`. This includes NuGet/npm tokens.
- **Alpine for everything** — musl breaks some native wheels/glibc assumptions
  and DNS edge cases; verify, don't assume the size win is free.
- **No resource limits** — one container starves the node; in K8s this also
  pins you to the `BestEffort` QoS class (first to be evicted).
- **Liveness probe doing heavy/dependency checks** — restarts a healthy pod
  during a downstream blip. Liveness = "am I alive"; readiness = "route to me".
- **`maxUnavailable > 0` (default 25%)** when you needed zero-downtime — set
  `maxUnavailable: 0` and a sane `maxSurge`.
- **Secrets in ConfigMaps** — ConfigMaps aren't encrypted; credentials belong
  in Secrets (ideally backed by Key Vault via the Secrets Store CSI driver).
- **Ignoring `terminationGracePeriodSeconds` / SIGTERM** — connections cut
  mid-flight on rollout; handle the signal and drain.

## Workflow for containerising / changing an image

1. Identify the app's runtime, build tool, listen port, and persistent state.
2. Write a multi-stage Dockerfile + `.dockerignore`; pin the base; non-root;
   minimal final stage.
3. Build with BuildKit; check size (`docker history`, `docker scout
   quickview`) and lint (`hadolint`).
4. Scan the image; resolve fixable critical/high; emit SBOM + provenance.
5. Choose the host (table above); write compose for local dev, manifests or
   platform config for the target.
6. Verify the running container — health endpoint and a smoke test — not just
   that the build/apply succeeded.

## Reference index

Load on demand:

- `references/dockerfiles.md` — multi-stage, caching, base images, non-root, build secrets, ENTRYPOINT/CMD, HEALTHCHECK
- `references/dotnet-images.md` — .NET on containers: mcr tags, `$APP_UID`, chiselled/distroless, .NET 10 changes, AOT
- `references/compose.md` — compose.yaml for local dev: services, networks, volumes, secrets, profiles, watch
- `references/image-security.md` — scanning, SBOM/provenance, signing, minimal base, runtime hardening
- `references/registries-acr.md` — registries and Azure Container Registry: auth, scanning, retention, tasks, AKS integration
- `references/azure-runtime.md` — Container Apps vs AKS vs App Service vs ACI vs Functions: the hosting decision
- `references/kubernetes.md` — working-level manifests: Deployment/Service/Ingress, security context, probes, rollout, validation

## Boundaries

- **CI/CD pipelines that build, scan and push images** → `devops-development`
  (this skill owns the Dockerfile and the scan/SBOM step's intent, not the
  pipeline YAML).
- **Deep Azure provisioning** (Bicep/Terraform for ACR/ACA/AKS, networking,
  private endpoints, managed identity wiring) → `azure-development`. This
  skill makes the container-host decision; that skill builds it.
- **Application build/runtime detail per language** (how the app compiles,
  test, framework specifics) → the language skill (`dotnet-development`,
  `python-development`, etc.). This skill owns the *containerisation*.
- **Supply-chain security frameworks, SBOM policy, secrets management** →
  `secure-development` (supply-chain). This skill applies the container-side
  controls and cross-references it.
- **Cluster monitoring queries / SIEM** → `sentinel-development` (KQL);
  **deep observability platform** → `azure-development` (operations).
- **Full Kubernetes platform engineering** (operators, multi-tenancy, mesh,
  Helm/Kustomize, GitOps, RBAC/NetworkPolicy, autoscaling, AKS platform) →
  `kubernetes-development`. This skill stops at the image, a working-level
  manifest, and the Azure container-host decision.
