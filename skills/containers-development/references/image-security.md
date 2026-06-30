# Image and runtime security

Container security spans three moments: the **base image** you start from, the
**supply-chain metadata** you produce, and the **runtime constraints** you
impose. The broader framework (threat modelling, dependency policy, secrets
strategy) lives in `secure-development` (supply-chain) — this is the
container-side application of it.

## Reduce the attack surface first

- Minimal base (distroless / chiselled) means fewer packages, hence fewer
  CVEs and nothing for an attacker to pivot through (no shell, no package
  manager). This is the single biggest lever.
- Keep base images current — yesterday's clean scan is meaningless after a new
  CVE drops. Automate rebuilds on base-image updates (ACR Tasks, Renovate,
  Dependabot).
- One concern per image; no debugging tools (`curl`, `netcat`, compilers) in
  the runtime stage.

## Scan in CI, gate on severity

Scan both the Dockerfile and the built image; fail the build on fixable
critical/high.

```bash
hadolint Dockerfile
trivy image --severity HIGH,CRITICAL --exit-code 1 --ignore-unfixed myapp:latest
docker scout cves myapp:latest
```

Options: Trivy, Grype, Docker Scout (`docker scout quickview` / `cves` /
`recommendations`), and — for images in Azure Container Registry — Microsoft
Defender for Containers (scans on push, on import, and weekly for images
pulled in the last 30 days). Use `--ignore-unfixed` so the gate reflects
actionable findings, and track an exceptions file with expiry dates rather
than disabling the gate.

## SBOM and provenance attestations

Produce a Software Bill of Materials and build provenance for every released
image so consumers can verify contents and origin.

```bash
docker buildx build --sbom=true --provenance=mode=max -t myapp:1.2.3 --push .
```

BuildKit emits an SPDX SBOM (via Syft by default; Docker Scout is an
alternative generator) and SLSA provenance as in-toto attestations attached to
the image. Inspect them:

```bash
docker buildx imagetools inspect myapp:1.2.3 --format "{{json .SBOM}}"
docker scout sbom myapp:1.2.3
```

## Sign and verify

Sign released images and verify before deploy (admission policy in K8s, or a
pipeline gate).

```bash
cosign sign myregistry.azurecr.io/myapp:1.2.3
cosign verify --certificate-identity-regexp '.*' \
  --certificate-oidc-issuer-regexp '.*' myregistry.azurecr.io/myapp:1.2.3
```

Prefer Cosign keyless signing (OIDC, transparency log) over long-lived keys;
Docker Content Trust / Notary v1 is legacy. Scope verification to your actual
signer identity and issuer in production, not the permissive regexes above.

## Runtime hardening

What the image can't enforce, the runtime must. In Kubernetes
(`references/kubernetes.md`) and Container Apps:

- `runAsNonRoot: true`, a numeric non-root UID, `allowPrivilegeEscalation:
  false`, `seccompProfile: RuntimeDefault`.
- `readOnlyRootFilesystem: true` with explicit writable `emptyDir`/tmpfs
  mounts for the few paths that need it.
- `capabilities: { drop: [ALL] }`, adding back only what's required.
- No privileged containers, no host network/PID/IPC, no hostPath mounts unless
  unavoidable and justified.

Locally these map to `docker run --read-only --cap-drop=ALL
--security-opt=no-new-privileges --user 10001 …`.

## Never in the image

Secrets, private keys, tokens, `.env` files, cloud credentials. They persist
in layer history even if deleted later. Build-time secrets → BuildKit
`--mount=type=secret`; runtime secrets → orchestrator secret store / Key Vault.
Scan for accidental inclusion (Trivy/Scout detect secrets) as part of the gate.
