# Dependency and Supply-Chain Security (A03/A08:2025)

The 2025 Top 10 elevated supply chain to A03 and broadened it beyond
"vulnerable components" to the whole acquisition-build-delivery
chain. NIS2 also makes supply-chain security an explicit obligation
(`nis2.md`) — this is now contractual material, not hygiene.

## Dependencies

1. **Lockfiles committed and honoured** (`package-lock.json`,
   `packages.lock.json`, `poetry.lock`, `Cargo.lock`); CI installs
   from the lockfile (`npm ci`), never floating resolution.
2. **SCA in CI**: Dependabot/Renovate + a scanner (OWASP
   Dependency-Check, `npm audit`/`dotnet list package --vulnerable`,
   Trivy/Grype). Triage by reachability and exploitability, not raw
   CVE counts — but never let "no time to triage" mean "ignore".
3. **Vet before adopting**: maintenance signals (recent releases,
   maintainer count), install scripts (`preinstall`/`postinstall` are
   code execution at install time — audit or disable), typosquatting
   (exact names), licence fit.
4. **Minimise**: every dependency is attack surface; prefer stdlib/
   platform for trivial needs; remove unused packages.
5. **Update cadence**: scheduled minor/patch updates beat heroic
   yearly majors; security patches expedited with a defined SLA.
6. Watch for dependency confusion: internal package names registered
   publicly — scope internal feeds, pin registries explicitly.

## Build and artefact integrity (A08)

- Builds run in clean, ephemeral CI runners from declared sources;
  no artefacts hand-built on laptops reach production.
- **Pin third-party CI actions/tasks by commit SHA** (the
  devops-development skill's pipeline-security reference covers
  mechanics) and restrict workflow permissions/OIDC scopes.
- Sign and verify: container images (cosign), packages, releases;
  verify base image digests; generate **SBOMs** (CycloneDX/SPDX) at
  build and keep them per release — buyers and NIS2 incident response
  both ask "do you ship X?".
- Updates your software delivers to others must be signed and
  verified on the client (A08's classic failure: unsigned
  auto-update).
- Protect the pipeline itself: branch protection, reviewed PRs to
  workflow files, no secrets in fork-triggered runs, environment
  gates for prod deploys (→ `devops-development`).

## Runtime third-party surface

- CDN scripts: Subresource Integrity (SRI) + version pinning, or
  self-host; a third-party script IS your XSS surface (Magecart
  pattern).
- Webhooks/integrations: verify signatures (HMAC with rotation),
  allow-list sources.
- SaaS/API dependencies: document data shared, apply DPA/GDPR view
  (`gdpr.md`) and concentration risk for NIS2-relevant services.

## Vulnerability response loop

1. Inventory (SBOM per release) → 2. Monitor (advisories matched to
   inventory) → 3. Assess (reachable? exploited in the wild? KEV
   list?) → 4. Patch/mitigate within SLA by severity → 5. Record
   (evidence for audits and the assurance question "describe your
   vulnerability management process").

## Review checklist for a new dependency/integration

Licence ok · maintained · install scripts audited · pinned + locked ·
SCA clean or triaged · data it can access documented · failure mode
if it's compromised understood (blast radius) · removal plan exists.
