# Capacities, fab CLI, CI/CD, Governance

## Capacity mechanics (CU smoothing and throttling)

Every workspace runs on a capacity (F-SKU). Operations are classified
**interactive** (user-initiated queries) or **background** (refreshes,
jobs — warehouse ops and Copilot count as background). Consumption is
**smoothed**: interactive over ≥5–64 minutes, background over 24 hours
(2,880 × 30-second timepoints), with **bursting** letting operations
exceed provisioned CUs for speed.

Throttling is progressive, triggered by *future-capacity* debt:

| Future usage consumed | Effect |
| --- | --- |
| ≤ 10 min | overage protection — nothing happens |
| 10–60 min | interactive operations delayed 20 s |
| 60 min – 24 h | interactive rejected; background still runs |
| > 24 h | everything rejected until debt burns down |

Consequences: a "sudden" rejection storm is accumulated background debt
(check the **Capacity Metrics app**: Utilization / Throttling /
Overages → timepoint drill-through); one runaway Spark job can poison a
shared capacity for hours; RTI skips the delay stage (real-time) and
warehouse hides under background smoothing. Separate
capacities for dev vs prod BI consumers where budget allows; treat
sustained >100% as a sizing/design defect.

## fab CLI (operational surface)

Install `uv tool install ms-fabric-cli`; works against Pro/PPU/Fabric.
Filesystem metaphor: `fab ls`, `fab exists
"<ws>.Workspace/<item>.<Type>"`, `fab find 'name' -P type=Report -l`,
`fab get -q "definition"`, `fab export` / `fab import`, `fab cp`,
`fab assign` (capacity). Rules of engagement: `fab auth status` first;
`--help` per command before first use (surface changes regularly);
append `-f` for non-interactive runs (confirmation prompts otherwise
hang automation — but ask first when sensitivity labels are in play);
`mkdir -p` export targets (export doesn't create directories); never
rm/mv items without explicit instruction.

## CI/CD

- **Git integration**: workspace ↔ Azure DevOps/GitHub repo; items
  serialise to folder definitions (PBIP shapes for BI items, platform
  files for others). Branch-per-workspace pattern: feature workspaces
  sync feature branches, merge via PR, sync main into integration
  workspaces. Not all item types are git-supported — check before
  promising full coverage.
- **Deployment pipelines**: dev → test → prod stage promotion with
  deployment rules (rebind connections, lakehouse references, semantic
  model parameters per stage).
- **fabric-cicd / REST**: for pipeline-driven deployment (Azure DevOps/
  GitHub Actions), service principal + item definition APIs; the
  fabric-cicd Python library wraps the patterns. Construction details
  belong to devops-development.
- **Variable Libraries** carry per-environment values; deployment rules
  or value sets switch them per stage — the antidote to hard-coded
  workspace GUIDs discovered at 2 a.m.

## Governance

- Workspace roles: Admin/Member/Contributor/Viewer; data-plane access
  additionally via item permissions, lakehouse/SQL endpoint
  object-level GRANTs, and OneLake data access roles (folder-level
  security on lakehouses).
- Tenant settings gate features (service principals, git integration,
  external sharing) — audit them before architecting around a feature
  (`microsoft/skills-for-fabric` has a dedicated audit skill;
  data-goblin's fabric-admin plugin likewise).
- Domains group workspaces for data-mesh-style ownership; endorsement
  (Promoted/Certified) and sensitivity labels behave as in Power BI.
- Capacity admins ≠ tenant admins ≠ workspace admins — name the right
  audience in designs and proposals.

Docs: https://learn.microsoft.com/fabric/enterprise/throttling ·
https://learn.microsoft.com/fabric/enterprise/metrics-app ·
https://learn.microsoft.com/fabric/cicd/git-integration/intro-to-git-integration ·
https://learn.microsoft.com/fabric/cicd/deployment-pipelines/intro-to-deployment-pipelines ·
https://learn.microsoft.com/fabric/onelake/security/get-started-data-access-roles
