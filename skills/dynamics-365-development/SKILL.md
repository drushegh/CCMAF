---
name: dynamics-365-development
description: >-
  Dynamics 365 Customer Engagement / Dataverse pro-code development:
  plug-ins, client API scripting, PCF code components, Web API/SDK
  operations, solutions and ALM, with detailed topic references loaded on
  demand. Use this skill whenever D365 CE or Dataverse work is created,
  edited, reviewed, or debugged — even if the user says "CRM" or "Power
  Apps backend". Triggers include: IPlugin / plugin registration,
  formContext or web resources, PCF components, FetchXML/OData queries
  against Dataverse, pac CLI, solution export/import, entity/table or
  column customisation, business rules vs code decisions, sandbox or
  ILMerge errors.
---

# Dynamics 365 (CE) Development

Consolidated D365 CE / Dataverse pro-code engineering for agents, grounded
in Microsoft Learn and Microsoft's official dataverse-skills plugin. Scope
is CE/Dataverse — Business Central (AL) and Finance & Operations (X++) are
different stacks, not covered here. Shared Power Platform concepts
(canvas apps, Power Automate, broader ALM) belong to
power-platform-development.

## Declarative First — code is the last resort

Before writing any code, exhaust the declarative options: business rules,
calculated/formula columns, Power Automate, classic workflows. Plug-ins
are for logic that genuinely needs transactions, complex computation, or
synchronous data-consistency guarantees. The cheapest code to maintain in
a Dataverse estate is the code you didn't write.

## The Environment Confirmation Rule (MANDATORY)

Before the FIRST operation that touches a specific environment —
deploying a plugin, importing a solution, creating metadata, writing data:

1. State the environment URL you intend to target.
2. Verify the active connection matches (`pac org who`).
3. Get explicit confirmation before proceeding.

Dev/test/prod credentials coexist on every consultant's machine; assuming
the active profile is correct is how prod gets customised by accident.
Once confirmed for a session+environment, don't re-ask per operation.

## Plug-in Non-Negotiables (from Microsoft's best-practice set)

- **Stateless `IPlugin`** — the platform caches and reuses instances; no
  mutable fields/properties, everything flows through the execution
  context. Constants and config-from-constructor are the exceptions.
- **Never swallow `OrganizationService` exceptions** to "continue
  processing" — any data-operation failure inside a synchronous plug-in
  dooms the transaction; raise `InvalidPluginExecutionException` with a
  user-meaningful message.
- **Register precisely**: filtering attributes on Update steps (or the
  plugin fires on every update); no duplicate step registrations; avoid
  sync plugins on Retrieve/RetrieveMultiple.
- **No `ExecuteMultiple`/`ExecuteTransaction`, no parallel threading**
  inside plug-ins — unsupported in the pipeline.
- **`ITracingService` always** — it's the only production diagnostics.
- Sync plug-ins are user-perceived latency — fast or async.

Details: [references/plugins.md](references/plugins.md).

## Tooling

```bash
pac auth create --environment ORGURL     # authenticate (never hand-rolled tokens)
pac org who                             # verify target before anything
pac solution list --environment ORGURL
pac plugin init                         # scaffold plug-in project
pac pcf init                            # scaffold PCF component
```

PAC CLI for lifecycle operations; the Dataverse SDK (official client
libraries) for data/metadata code; raw Web API only where the SDK
genuinely lacks coverage. Tool hierarchy and casing traps:
[references/dataverse-operations.md](references/dataverse-operations.md).

## Critical Pitfalls — always check

- **Publisher prefix `new_`** — never. Discover existing publishers, ask
  which to use; the prefix is permanent on every component.
- **OData casing**: `$select`/`$filter` take lowercase logical names;
  `$expand` and `@odata.bind` take case-sensitive navigation/schema names
  (`new_AccountId@odata.bind`) — wrong casing 400s.
- **`MSCRM.SolutionName` header misspelled** → components silently land
  in the Default solution. Always verify components after creation.
- **Early-bound `Target` writes** — read via
  `context.InputParameters["Target"].ToEntity()` is fine; assigning an
  early-bound entity back into InputParameters throws
  `SerializationException`.
- **Unsupported client scripting** — direct DOM manipulation, undocumented
  APIs; only the documented `formContext` surface survives updates.
- **PCF touching `formContext`** — code components must not depend on it
  (they run in canvas/portals too); bind columns and use OnChange.
- **External calls from plug-ins** without explicit `Timeout` and
  `KeepAlive=false` — sandbox workers stall.
- Unmanaged in dev, **managed packages downstream** (test/prod) — never
  unmanaged into prod.

## Agent Workflow Rules

1. **Inspect first**: existing solution structure, publisher/prefix,
   registered plugin steps, naming conventions; mirror them.
2. **Custom logic decision ladder**: business rule → formula column →
   Power Automate → async plugin → sync plugin. Justify each step down.
3. **Plug-in changes**: build (signed, ≤16MB, .NET Framework 4.6.2 until
   the 4.8 runtime ships) → register/update step with filtering
   attributes → test with Plug-in Profiler trace → add to THE solution
   (single solution per assembly).
4. **Verify after solution operations**: components present
   (`pac solution list-components`), forms published, plugins activated —
   import success ≠ working system.
5. **Before completion**: solution exported/unpacked to the repo (source
   of truth in git), validation queries run, no hardcoded environment
   URLs or GUIDs in code.

## Reference Index

| Load when the task involves... | File |
|---|---|
| Plug-ins: pipeline, context, images, registration, transactions, debugging | [references/plugins.md](references/plugins.md) |
| Form scripting: formContext, events, notifications, web resources | [references/client-scripting.md](references/client-scripting.md) |
| PCF code components: lifecycle, manifest, WebApi, packaging | [references/pcf.md](references/pcf.md) |
| Queries, data ops, metadata, casing rules, publisher discipline | [references/dataverse-operations.md](references/dataverse-operations.md) |
| Solutions: export/import, components, validation, security roles | [references/solutions-alm.md](references/solutions-alm.md) |
