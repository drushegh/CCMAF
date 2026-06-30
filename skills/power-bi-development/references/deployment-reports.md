# Deployment, ALM, and the Report Layer

## Workspace and release shape

Dev → test → prod **workspaces**, promoted by deployment pipelines or
Git, never by republishing a `.pbix` from someone's laptop. Consumers
get content through **apps** (audience-scoped), not workspace access.
Workspace roles bypass RLS (admin/member/contributor) — viewers and app
audiences are the RLS-tested population.

## Promotion options

- **Fabric deployment pipelines**: assign workspaces to stages;
  **deployment rules** rebind data source connections and parameters per
  stage (this is why connections are parameterised — see
  power-query-m.md). Deploys metadata; data refreshes in the target
  afterwards.
- **Fabric Git integration**: workspace ↔ repo sync in PBIP folder
  shape; PR review + branch-per-feature for models and reports. Pair
  with CI checks (TMDL validation, BPA rules) on pull request.
- **XMLA endpoint** (Premium/Fabric capacities): read/write access for
  Tabular Editor, scripted deployments (TMSL/TOM), and fine-grained
  model alterations without full republish. An XMLA-written change to a
  model makes it non-downloadable as `.pbix` — commit the source in git
  or you've orphaned the artefact.

## Refresh operations

- Scheduled refresh per model; incremental refresh policies turn full
  loads into partition refreshes (requires foldable RangeStart/RangeEnd
  filters). First publish of an IR model needs the initial full refresh
  to build partitions.
- Gateways for on-prem sources: use a gateway **cluster**, map data
  sources explicitly, and keep gateway data-source credentials owned by
  a service account, not an individual.
- Large models: XMLA refresh with `applyRefreshPolicy`/effective date
  overrides beats deleting and reloading; refresh failures partway
  through leave prior data intact (transactional per refresh).

## Report layer rules

- Reports bind to model objects **by name** — model renames without
  lineage-checked propagation are the classic "visual shows error after
  deploy" cause.
- Live-connect thin reports (report separate from the shared model) are
  the default for team-scale work; one shared endorsed model, many
  reports. Avoid per-report copies of the same import model.
- Report-level measures are tactical only; promote recurring ones into
  the model where every report (and Copilot) sees them.
- Performance: fewer visuals per page beats clever DAX (every visual is
  ≥1 query); top-N + "Other" beats unbounded tables; slicers with
  high-cardinality columns hurt (use filter pane); avoid bidirectional
  slicer chains.
- Themes: one theme JSON in source control; no per-visual hex-pasting.
  Accessibility: tab order, alt text, contrast — auditable, so audit.

## Endorsement and governance

Endorse the shared model (**Promoted** → team standard, **Certified** →
governed). Sensitivity labels flow from model to dependent items.
Discourage new models when an endorsed one answers the question — model
sprawl is the BI estate's tech debt.

## Pre-release checklist

1. Workspace confirmation rule (SKILL.md) — right target, confirmed.
2. BPA/model audit clean or exceptions documented.
3. RLS tested as viewer with a real non-admin account (fail-closed
   verified).
4. Deployment rules rebind every parameterised connection — no dev
   endpoints in prod.
5. Refresh succeeds in target (credentials/gateway mapped) **after**
   deployment; IR partitions built.
6. Reports against the deployed model spot-checked — bindings intact,
   no broken visuals.
7. App updated and published — deploying the workspace does not update
   the app.

Docs: https://learn.microsoft.com/fabric/cicd/deployment-pipelines/intro-to-deployment-pipelines ·
https://learn.microsoft.com/fabric/cicd/git-integration/intro-to-git-integration ·
https://learn.microsoft.com/power-bi/enterprise/service-premium-connect-tools ·
https://learn.microsoft.com/power-bi/collaborate-share/service-endorsement-overview
