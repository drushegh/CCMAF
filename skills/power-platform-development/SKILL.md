---
name: power-platform-development
description: >-
  Power Platform low-code development: canvas apps and Power Apps YAML,
  Power Fx and delegation, Power Automate cloud flows, Dataverse tables and
  columns from the maker side, environments, solutions and platform ALM,
  and Power Apps code apps. Use this skill whenever Power Platform work is
  created, edited, reviewed, or debugged — even if the user just says
  "Power Apps", "a flow", or "low-code". Triggers include: .pa.yaml or
  canvas app screens, Power Fx formulas, delegation warnings, cloud flow
  triggers/actions/error handling, Dataverse table or column design,
  solution export/import, environment strategy, Power Platform pipelines,
  pac solution / pac code commands, connectors and connection references.
---

# Power Platform Development

Consolidated Power Platform low-code engineering for agents, grounded in
Microsoft Learn and Microsoft's official power-platform-skills and
dataverse-skills plugins. Boundaries: Dataverse **pro-code** (plug-ins,
client API, PCF, SDK/Web API operations) is dynamics-365-development;
portal/external sites are power-pages-development; Power BI and Azure
DevOps/GitHub pipelines get their own skills.

## Solutions First, Correct Publisher, Always

Everything customised lives in a solution with a proper publisher prefix —
never the default publisher, never `new_`. Unmanaged in dev (source of
truth), **managed** everywhere downstream. An artefact built outside a
solution is rework waiting to happen; in Managed Environments it's also
increasingly blocked by policy.

## The Environment Confirmation Rule (MANDATORY)

Before the FIRST operation that touches a specific environment — solution
import, table/column creation, flow deployment, `pac code push`:

1. State the environment you intend to target.
2. Verify the active connection matches (`pac org who`).
3. Get explicit confirmation before proceeding.

Once confirmed for a session+environment, don't re-ask per operation.

## Delegation Is the #1 Canvas Correctness Bug

Non-delegable Power Fx queries silently operate on only the first 500
(max 2,000) records — apps pass testing on small data and return **wrong
answers** in production. Treat every delegation warning (yellow triangle /
blue underline) as a defect, not a style nit. Delegability differs per
data source (Dataverse ≫ SharePoint/Excel). During testing set the data
row limit to **1** to make non-delegable formulas instantly visible.
Details: references/power-fx-delegation.md.

## Canvas YAML Quoting — the silent formula killer

In `.pa.yaml`, a Power Fx record literal like `={Value: "Tab1"}` is parsed
as a YAML mapping, not a formula. Quote it: `'={Value: "Tab1"}'`. Same for
any value containing `: `. Multi-line formulas use `|-` with `=` on the
first content line. Full rules: references/canvas-apps.md.

## Flows Fail — Design for It

Every production cloud flow needs: try/catch **scopes** with Run After,
an exponential **retry policy** on fragile actions, **trigger conditions**
(filter at the trigger, not with a condition action), and deliberate
**concurrency** settings (default parallelism invites dirty reads;
concurrency control is irreversible once applied). Details:
references/power-automate.md.

## Dataverse Design Rules (maker level)

- Naming: no `*Id` suffix on custom columns (collides with generated
  lookup names); singular table names; consistent publisher prefix.
- Choices: global choice sets for reuse across tables; lookups when the
  option list is data, not schema.
- Alternate keys are required for upsert semantics; metadata changes can
  lag (propagation delays/lock contention) — build in verification waits.
- Declarative first: business rules / calculated and formula columns
  before code; if it needs code, hand it to dynamics-365-development.

## Agent Workflow Rules

- Inspect before changing: `pac org who`, `pac solution list`, read the
  app/flow definition before editing it.
- Keep environment-specific values in **environment variables** and
  **connection references**, never hard-coded in apps or flows.
- After import to a target environment, verify connection references are
  bound and flows are **on** — imports leave flows off when references
  are unset.
- Verify canvas changes by compiling/validating the YAML where tooling
  exists; never guess control property names — discover them.
- Propose schema changes (tables/columns/relationships) as a reviewable
  plan before creating; metadata is much easier to review than to unwind.

## References

| File | Load when |
| --- | --- |
| references/canvas-apps.md | Canvas app YAML, controls, layout, app structure |
| references/power-fx-delegation.md | Power Fx patterns, named formulas/UDFs, delegation limits |
| references/power-automate.md | Cloud flow triggers, error handling, performance |
| references/dataverse-design.md | Maker-level table/column/choice/relationship design |
| references/alm-environments.md | Environments, solutions, pipelines, deployment |
| references/code-apps.md | Power Apps code apps (SPA, pac code / npm CLI) |
