# Environments, Solutions, and Platform ALM

Platform-level lifecycle management. pac solution command mechanics and
solution-component internals are covered in dynamics-365-development
(solutions-alm); Azure DevOps/GitHub pipeline construction belongs to
devops-development. This file is the strategy and the platform-native
tooling.

## Environment strategy

Minimum healthy shape: **dev → test → prod**, separate environments, with
UAT/SIT/training added as the organisation needs. Per-developer dev
environments isolate concurrent work. Enterprise-scale features to lean
on:

- **Managed Environments** — premium governance (usage insights, sharing
  limits, solution checker enforcement). Note: from **February 2026**
  Microsoft auto-enables Managed Environments on Power Platform pipeline
  target environments — design for it rather than fighting it.
- **Environment groups + rules** apply governance policies in bulk;
  **default environment routing** keeps makers out of the default
  environment (nothing of value should live there).
- DLP policies decide which connectors may coexist; check them before
  designing a solution around a connector, not after.

## Solutions

- Unmanaged in dev only; export **managed** for test/prod. The unpacked
  unmanaged solution in git is the source of truth.
- One publisher, meaningful prefix, semantic-ish versioning
  (`major.minor.build.revision` — bump on every export).
- **Environment variables** for per-environment values (URLs, IDs,
  feature toggles) and **connection references** for connections; both
  get values supplied at deploy time (pipelines prompt, or a deployment
  settings file). Hard-coded environment values in apps/flows are
  defects.
- Layering: managed solutions stack; unmanaged customisations on top of
  managed ("active layer") block updates — keep target environments free
  of unmanaged tinkering.

## Power Platform pipelines (in-product CI/CD)

The low-code deployment path — host environment + pipeline records,
deploy from the maker portal or `pac pipeline deploy`:

- **Delegated deployments**: run the deployment as a **service
  principal** (or stage owner) rather than the requesting maker. SP needs
  Deployment Pipeline Administrator on the host and System Administrator
  on targets (lesser roles can't deploy code components).
- Approvals integrate via the `OnApprovalStarted` trigger + cloud flow
  (approve/reject through `UpdateApprovalStatus`).
- Connection references without a previously-deployed value can't be set
  during deployment — seed them on first deploy.
- Single-tenant only; cross-tenant promotion needs Azure DevOps/GitHub.
- `pac admin create-service-principal --environment <id>` bootstraps the
  Entra app + application user (returns the client secret once — store it
  properly; it can't be retrieved again).

When pipelines aren't enough (gates, tests, cross-tenant, artefact
retention), step up to Azure DevOps / GitHub Actions with
microsoft/powerplatform-actions or the Build Tools — construction details
in devops-development.

## Deployment hygiene checklist

1. `pac org who` — confirm target (environment confirmation rule).
2. Export managed, with solution version bumped.
3. Deployment settings ready: environment variable values + connection
   reference bindings for the target.
4. Import; then verify flows are **on**, connection references bound,
   environment variables resolved.
5. Smoke-test as a real (non-admin) user — security roles in the target
   differ from dev, and admin testing hides authorisation gaps.
6. Point-in-time restore exists (environment backups) — know the restore
   path before you need it, but treat it as disaster recovery, not an
   undo button.

Docs: https://learn.microsoft.com/power-platform/alm/environment-strategy-alm ·
https://learn.microsoft.com/power-platform/guidance/adoption/environment-strategy ·
https://learn.microsoft.com/power-platform/alm/pipelines ·
https://learn.microsoft.com/power-platform/alm/delegated-deployments-setup ·
https://learn.microsoft.com/power-platform/developer/cli/reference/pipeline
