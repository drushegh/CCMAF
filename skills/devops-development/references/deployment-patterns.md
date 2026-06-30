# Deployment Patterns

## Build once, promote artifacts

One Build stage produces a versioned, immutable artifact (container
image by digest/sha tag, zip by build ID, signed package). Every later
stage **deploys that artifact** — never rebuilds. Version stamping at
build time (GitVersion / `Build.BuildId` / tag-driven semver) so any
running system answers "which build is this?".

## Gates and progression

- dev (auto on merge) → test (auto + smoke tests) → UAT/staging
  (approval) → prod (approval + change window where required).
- Approvals live on **environments** (both platforms), not as manual
  pipeline pauses someone forgets.
- Post-deployment verification is a pipeline stage: health endpoint
  probe, smoke test suite, error-rate check (App Insights query) —
  failing it triggers the rollback path automatically or pages a
  human.

## Progressive exposure

| Pattern | Mechanism |
| --- | --- |
| Blue/green | App Service slot swap (deploy to staging slot, warm, swap; swap back = rollback); Container Apps revisions with traffic shift |
| Canary | Traffic-split revisions / Front Door weights, watch metrics, promote |
| Feature flags | App Configuration feature flags decouple deploy from release — ship dark, enable gradually |

Rollback is **redeploying the previous known-good artifact** (or
swapping back) — designed and rehearsed, not "fix forward at 2am".
Database changes make rollback hard: migrations must be
backward-compatible one version (expand/contract pattern), deployed
before the code that needs them.

## IaC in the pipeline

- Bicep: `az deployment group what-if` as a PR/pre-deploy gate —
  reviewable infra diffs; then `create` in the deploy stage.
- Terraform: `plan` artifact reviewed/approved, `apply` of **that
  plan** in the deploy stage; state in remote backend with locking.
- azd: `azd provision`/`azd deploy` in CI with environment-scoped
  config; pair with the azure-development plan/validate/deploy
  discipline.
- Infra and app pipelines may be separate cadences, but the same
  artifact-promotion and approval discipline applies to both.

## Quality gates worth wiring

PR validation (build + unit tests + linters) as branch policy; test
results published (NUnit/JUnit format) so failures are readable;
coverage trend tracked, not worshipped; SAST/dependency scanning
(Defender for DevOps / CodeQL / dependabot alerts) in CI;
"no new criticals" as the merge bar.

## Observability of the pipeline itself

Deployment markers/annotations into App Insights (correlate releases
with error spikes); pipeline failure alerts to the owning team channel;
DORA-style basics (deployment frequency, lead time, failure rate, MTTR)
from pipeline data when the engagement cares about delivery metrics.

Docs: https://learn.microsoft.com/azure/architecture/framework/devops/release-engineering-cd ·
https://learn.microsoft.com/azure/app-service/deploy-staging-slots ·
https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-what-if ·
https://learn.microsoft.com/azure/azure-app-configuration/concept-feature-management
