# ALM, pac pages CLI, Caching Operations

## Data model versions — check before anything else

Two site data models exist; CLI operations must match:

- **Standard** (`adx_` tables) — `--modelVersion 1`
- **Enhanced** (`mspp_` virtual tables over `powerpagecomponent`) —
  `--modelVersion 2`; default for new sites and required for
  **solution-based** site ALM

`pac pages list -v` shows which a site uses. Uploading with the wrong
model version fails or, worse, partially applies.

## Core CLI loop (configured sites)

```bash
pac auth create --name DEV --url https://contoso-dev.crm4.dynamics.com
pac auth list && pac auth select --index 1
pac org who                                  # environment confirmation rule
pac pages list -v
pac pages download --path ./site --webSiteId <guid> --modelVersion 2
# edit YAML/HTML locally, source-control it
pac pages upload --path ./site/<site-folder> --modelVersion 2
```

- Upload transfers **changed content only**; `--forceUploadAll` for full.
- The CLI moves **site configuration only** — Dataverse tables/columns/
  forms/views travel separately as solutions; deploy those first or the
  upload fails on missing schema.
- Target environment file-size limits must be ≥ source (attachment/web
  file uploads fail otherwise).
- Code sites use `download-code-site` / `upload-code-site` instead (see
  code-sites.md).

## Deployment profiles (per-environment values)

`deployment-profiles/<name>.deployment.yml` next to the site content holds
environment-specific overrides (site setting GUIDs/values etc.):

```bash
pac pages upload --path ./site/contoso --deploymentProfile prod --modelVersion 2
```

Keep tenant URLs, app registration IDs, and external endpoints in
profiles, not in committed site settings.

## Pipelines and solutions

- **Enhanced-model sites can ship inside Power Platform solutions**, which
  unlocks Power Platform pipelines / standard solution ALM for site
  config. Target environment must also have the enhanced model enabled.
- First deployment to a target environment needs **site reactivation**
  (provisions the site record/URL), then subsequent deploys are
  config-only. Clear the target site's cache after each deployment.
- Azure DevOps/GitHub Actions: wrap the pac CLI loop (`microsoft/powerplatform-actions`
  provides tasks); branch per site, PR-review the downloaded YAML/HTML
  diffs — they're line-diffable by design. Details of generic pipeline
  tooling belong to devops-development.

## Server-side caching — the operational facts

- **Configuration tables** (web pages, templates, snippets, site settings,
  forms, permissions — fixed list of adx_/mspp_ tables): cached for all
  users, auto-invalidated on change with a **15-minute SLA**.
- **Business data tables**: cached per user (global-permission and
  anonymous data cached shared). CRUD **through the site** invalidates that
  table's cache instantly for all users; changes from plug-ins, workflows,
  or direct Dataverse edits take up to 15 minutes. The SLA is not
  configurable — don't promise faster, don't build features needing it.
- Manual clears: design studio **Preview**, or `{site}/_services/about` →
  **Clear config** (config tables only — prefer this) / **Clear cache**
  (everything — causes temporary slowness on busy sites; use sparingly).
  Requires a web role with all website access permissions.
- Stale data beyond 15 min ⇒ check change tracking on the table and run
  Site Checker (cache invalidation diagnostics).
- Header/footer web templates support **output caching**
  (`Header/OutputCache/Enabled`, `Footer/OutputCache/Enabled`, default on
  for new sites) — wrap per-request fragments in `{% substitution %}` or
  they render stale/wrong per user.

## Bootstrap 3 → 5 migration (classic sites)

```bash
pac pages download --path ./dl -id <guid>
pac pages bootstrap-migrate -p ./dl/<site-folder>   # writes <folder>V5
pac pages upload --path ./dl/<site-folder>V5
# then clear server-side cache
```

Review the generated diff (VS Code `bootstrap diff` command). Revert =
re-upload the v3 folder + delete the `Site/BootstrapV5Enabled` site
setting + clear cache. Check current version in the site's
`bootstrap.min.css` web file.

## Migration gotchas

- Website metadata transfer between environments: enhanced model →
  solutions; either model → CLI download/upload; legacy Configuration
  Migration tool still works but the CLI is the maintained path.
- Match the website template type and any custom schema in the target
  before importing site config.
- Authentication/site-visibility settings are environment-specific —
  exclude them from blind copies (deployment profiles exist for this).

Docs: https://learn.microsoft.com/power-platform/developer/cli/reference/pages ·
https://learn.microsoft.com/power-pages/configure/power-platform-cli-tutorial ·
https://learn.microsoft.com/power-pages/admin/clear-server-side-cache ·
https://learn.microsoft.com/power-pages/admin/enhanced-data-model ·
https://learn.microsoft.com/power-pages/configure/migrate-bootstrap
