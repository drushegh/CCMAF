# Pipeline Security and Supply Chain

## Identity: federate, don't store

- **GitHub → Azure**: Entra app registration (or user-assigned MI) with
  a **federated credential** matching the repo + branch/environment
  claim; workflow gets `permissions: id-token: write` and uses
  `azure/login` — no secret exists to leak. Scope one credential per
  environment (subject claim includes `environment:production`).
- **Azure DevOps → Azure**: service connection with **workload
  identity federation**; convert legacy secret-based connections — the
  expiring-secret outage is a when, not an if.
- PATs: last resort, minimal scopes, short expiry, owned by service
  accounts. Anything wanting a PAT probably supports OIDC or a
  GitHub App by now — check first.

## Secrets hygiene

Key Vault as the source (linked variable groups / `azure/keyvault`
fetch); masked everywhere; never `echo`/log values, never pass via
command line where process lists leak (use env/stdin); rotation
automated; secret scanning + push protection on repos so leaked
secrets die at commit time.

## Supply chain

- **Pin third-party actions to commit SHAs** (version comment
  alongside); review what a pinned action actually does before trust;
  restrict allowed actions org-wide (allow-list) on sensitive estates.
- Dependabot/Renovate to bump pins deliberately — pinning without
  update automation is just freezing vulnerabilities.
- Lock dependency installs (`npm ci`, locked NuGet/pip) in CI; internal
  feed (Azure Artifacts) with upstream proxy beats raw public pulls
  for governed estates.
- Build provenance: artifact attestations / SBOM generation where the
  client's assurance framework asks (increasingly common for governed
  estates).

## Hostile-input surfaces

- **Fork PRs**: `pull_request` runs with read-only token and no
  secrets — keep it that way. `pull_request_target` runs with secrets
  in the base context — never check out and execute PR code under it.
- **Script injection**: any `${{ github.event.* }}` text interpolated
  into `run:` is attacker-controlled (PR titles, branch names) — route
  via `env:` and quote.
- Self-hosted runners/agents never serve public repos; ephemeral
  (fresh per job) where possible.
- ADO: protect service connections/environments with
  pipeline-permission grants and **required template checks**; branch
  policies stop direct pushes to main from bypassing CI.

## Audit posture

Pipeline changes via PR like any code; CODEOWNERS on
`.github/workflows/` and pipeline templates; deployment history per
environment retained (who approved what, when) — this is the evidence
chain client audits ask for.

Docs: https://learn.microsoft.com/azure/devops/pipelines/release/configure-workload-identity ·
https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect ·
https://docs.github.com/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
