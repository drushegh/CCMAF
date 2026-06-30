# Power Platform, D365, Power BI, Fabric in CI/CD

The pipeline mechanics for the estates covered by the other skills.
Solution/ALM concepts: dynamics-365-development (solutions-alm) and
power-platform-development (alm-environments); this file is the
pipeline wiring.

## Tooling

- **Azure DevOps**: Power Platform Build Tools tasks
  (PowerPlatformToolInstaller, ExportSolution, UnpackSolution,
  PackSolution, ImportSolution, PublishCustomizations, SetSolutionVersion,
  Checker).
- **GitHub**: `microsoft/powerplatform-actions` (same verbs as
  actions).
- Both wrap **pac CLI** — anything the tasks miss, script with pac
  directly (install via tool installer task / `actions/setup` +
  `dotnet tool install`).
- Auth: service principal per environment ("Application user" in
  Dataverse with security role); ADO Power Platform service connection
  or GitHub secrets/OIDC-fetched credentials. SPN needs the Dataverse
  application-user setup, not just Entra existence.

## The canonical solution flow

```text
CI (per PR / merge):
  export solution (unmanaged, from dev)         # or trust the repo as source
  unpack to source  →  commit/diff review
  pack as managed (from source)                 # build artifact
  solution checker (gate on critical/high)
CD (per environment):
  import managed solution (test → uat → prod, approvals between)
  publish customizations; run post-deploy config (connection refs,
  environment variables via deployment settings file)
  activate flows; smoke-test as non-admin user
```

- The **repo's unpacked solution is the source of truth**; dev
  environments are workstations. Version bump per export
  (SetSolutionVersion).
- Deployment settings JSON supplies environment-variable values and
  connection-reference bindings per target — never imported unbound.
- In-product **Power Platform pipelines** cover simple estates;
  step up to ADO/GitHub when you need gates, checker enforcement,
  artifact retention, or cross-tenant.

## D365 code components

Plug-ins/PCF/web resources build like .NET/TS code (restore, build,
test), then land **inside the solution** (pack picks up built
assemblies/bundles) — sequence the code build before solution pack.
Checker runs on the packed solution.

## Power Pages

`pac pages download/upload` (model version!) scripted in the pipeline,
or enhanced-data-model sites inside solutions; clear cache post-deploy.
Code sites: build SPA → `pac pages upload-code-site`. (Details:
power-pages-development alm-deployment.)

## Power BI / Fabric

- PBIP + **Fabric Git integration**: branch → feature workspace, PR
  validation runs TMDL/PBIR checks + BPA rules; merge syncs main to
  the integration workspace.
- **fabric-cicd** (Python lib) or Fabric REST item APIs for
  pipeline-driven deployment of workspace items with SPN auth;
  deployment pipelines (in-product) for stage promotion where that
  suffices; deployment rules rebind connections per stage.
- Semantic model post-deploy: refresh + RLS test as viewer (see
  power-bi-development deployment-reports).

## Always

Environment confirmation before first deploy run; managed solutions
only downstream; one artifact promoted; checker/BPA as gates not
suggestions; smoke tests under a real non-admin user in the target.

Docs: https://learn.microsoft.com/power-platform/alm/devops-build-tools ·
https://github.com/microsoft/powerplatform-actions ·
https://learn.microsoft.com/power-platform/alm/tutorials/github-actions-start ·
https://learn.microsoft.com/fabric/cicd/cicd-overview
