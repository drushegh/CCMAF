---
name: devops-development
description: >-
  CI/CD engineering on Azure DevOps and GitHub Actions: pipeline and
  workflow YAML, templates and reusable workflows, service connections
  and OIDC federated credentials, environments and approvals, pipeline
  security and supply-chain hardening, deployment patterns, and Power
  Platform / Azure deployment automation. Use this skill whenever
  pipeline or workflow work is created, edited, reviewed, or debugged —
  even if the user says "the build", "the release", or "automate
  deployment". Triggers include: azure-pipelines.yml or
  .github/workflows files, stages/jobs/steps, service connections, PAT
  or OIDC questions, variable groups, build agents/runners, pipeline
  failures, solution export/import automation, azd or Bicep in CI, pac
  CLI in pipelines, or release approvals.
---

# DevOps Development (Azure DevOps + GitHub Actions)

Consolidated CI/CD engineering for agents, grounded in MS Learn,
akin-ozer/cc-devops-skills, and github/awesome-copilot. What gets
deployed comes from the other skills (azure, power-platform, power-bi,
fabric, d365); this skill owns how it gets there.

## Pin Everything

Unpinned references are deferred failures: GitHub **actions pinned to a
commit SHA** (with version comment), agent/runner images pinned
(`ubuntu-22.04`, not `-latest`, for anything that matters), task and
tool versions explicit, deploy tags **immutable**
(`$(Build.BuildId)`/`${{ github.sha }}`) — never deploy `latest`.

## No Secrets — Federate

Pipeline identity to Azure is **workload identity federation / OIDC**:
ADO service connections with federated credentials, GitHub
`azure/login` with OIDC (`permissions: id-token: write`). PATs and
client secrets in pipelines are migration debt with an expiry-day
outage attached. Residual secrets live in Key Vault (linked variable
groups / actions secrets), masked, never echoed, never in YAML.

## The Pipeline Confirmation Rule (MANDATORY)

Before the FIRST run that deploys anywhere: state the target
(org/project or repo, pipeline, target environment), confirm service
connection scope matches intent, get explicit confirmation. A pipeline
is automation holding production credentials — treat edits to it with
production-change seriousness.

## Structural Defaults

- **CI on PR + main; CD gated by environment approvals** (ADO
  Environments / GitHub Environments with required reviewers) — humans
  approve promotion, not re-run builds.
- Build **once**, promote the same artifact through stages — rebuilding
  per stage deploys something you never tested.
- Reuse via **templates** (ADO: extends/includes) and **reusable
  workflows / composite actions** (GitHub) — copy-pasted YAML across
  repos is the maintenance tarpit.
- Timeouts on every job; cleanup steps `condition: always()` /
  `if: always()`; `concurrency` groups to cancel superseded runs.
- Validate YAML before pushing: `actionlint` for workflows, ADO
  pipeline validation API / dry runs for azure-pipelines.yml.

## Least Privilege

GitHub: top-level `permissions: contents: read`, escalate per job only
as needed; treat `pull_request_target` and fork-triggered workflows as
hostile-input surfaces. ADO: scoped service connections (one per
environment), pipeline permissions on protected resources, branch
policies on main. Both: production environments restricted to
protected branches.

## Agent Workflow Rules

- Read the existing pipeline + templates before editing; mirror the
  repo's established patterns.
- Diagnose failures from the actual logs (download, search) before
  proposing fixes; "re-run it" is not a diagnosis.
- State assumptions (stack, branch model, environments) explicitly when
  generating; safe defaults: CI on `main`+`develop`, prod deploys from
  `main` only.
- Verify deployments with a post-deploy check stage (health endpoint,
  smoke test), and make rollback a designed path (redeploy previous
  artifact), not an aspiration.

## References

| File | Load when |
| --- | --- |
| references/azure-pipelines.md | azure-pipelines.yml, templates, environments, agents |
| references/github-actions.md | Workflows, reusable workflows, actions, runners |
| references/pipeline-security.md | OIDC, secrets, supply chain, fork risks |
| references/deployment-patterns.md | Gates, blue/green, rollback, versioning, IaC in CI |
| references/power-platform-cicd.md | Solutions, pac/azd in pipelines, Power BI/Fabric/Pages CI-CD |
