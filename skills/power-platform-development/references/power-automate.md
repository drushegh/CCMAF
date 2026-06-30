# Power Automate Cloud Flows

From Microsoft's coding guidelines for cloud flows plus the error
reference. The recurring theme: flows are integration code — design them
with the same failure-mindedness as any service.

## Triggers

- **Trigger conditions** filter at the trigger so non-matching events
  never start a run (cheaper, cleaner history) — instead of triggering on
  everything and branching with a Condition action. Failed condition =
  `TriggerConditionNotMet` (no run). Debug by removing the condition,
  inspecting a real trigger payload (**Peek code**), then reinstating.
- Dataverse triggers: scope to the table, **filter to specific columns**
  (fires on any update otherwise — same discipline as plug-in filtering
  attributes), and set the row scope (organization/business unit/user).
- **Concurrency control**: default is unbounded parallelism, which
  invites dirty reads (flow A reads, flow B updates, flow A acts on stale
  data). Degree of parallelism 1 = strict ordering. **Irreversible once
  applied** — to remove it you recreate the flow, so apply it on a small
  dedicated child flow where possible.

## Error handling — the standard kit

- **Try/Catch scopes**: main actions in a "Try" `Scope`, a "Catch" scope
  with Run After set to *has failed / has timed out* on Try. In Catch,
  `result('Try')` + Filter array (status eq 'Failed') isolates the
  failing action for logging/notification.
- **Run After** per action for alternative paths (notify on failure,
  continue on skip). Triggers and Response actions stay **outside**
  scopes.
- **Retry policy** on fragile actions: exponential backoff preferred;
  default is 4 retries. Tune per action, monitor, adjust.
- **Terminate** with status Failed + message for unrecoverable states —
  a flow that "succeeds" after swallowing an error poisons monitoring.
- Logging: `workflow()` gives run metadata; Compose a run URL for
  notifications. Prefer **Application Insights integration** over
  hand-rolled per-action logging (excessive custom logging is an
  anti-pattern).
- Structural limit: max **8 nested levels** (scopes, conditions,
  switches, apply-to-each) — flows beyond that don't save.

## Performance and shape

- Child flows for reusable logic and for isolating
  concurrency-controlled sections; parent passes/receives via
  Request/Response.
- Filter rows and select columns **in the connector action** (OData
  `$filter`/`$select`), not with Filter array over a full table pull.
- Apply-to-each is slow and serial by default; turn on its concurrency
  where ordering doesn't matter; avoid nesting loops — restructure with
  Filter array or a child flow.
- Use connectors over UI automation wherever an API exists; custom
  connector beats screen-scraping for unsupported systems.

## Desktop flows (RPA)

When a system has **no API or connector**, automate its UI with a desktop flow
(Power Automate for desktop). RPA is the last resort, not the first — it's
brittle (a UI change breaks it), so wrap every step in error handling and
prefer a connector/custom connector whenever one exists.

- **Attended** runs alongside a signed-in user (interactive, user-triggered);
  **unattended** runs with no user on a dedicated/locked session. Unattended
  can't run elevated, and a locked session is required.
- **Machines and machine groups**: register your own Windows machines, or use
  **hosted machines / hosted machine groups** — Microsoft-provisioned Azure
  VMs (Windows 365) that autoscale unattended **bots** up to a max and
  load-balance across groups in the environment. No infrastructure to
  maintain; bring a custom VM image (Azure Compute Gallery) and your own VNet
  if needed.
- **Licensing**: hosted/unattended RPA needs the **Power Automate Hosted
  Process** capacity (one unit per concurrent bot) assigned to the environment
  — size it to peak parallel runs.
- **Orchestrate from a cloud flow**: a parent cloud flow triggers the desktop
  flow via a desktop-flow connection. Hosted machine groups support
  **unattended + direct-connectivity** connections only.
- Treat desktop-flow projects as code: source-control, parameterise inputs,
  and keep credentials in the connection/Key Vault, never in steps.

## AI in flows

- **AI Builder** actions (prebuilt + custom prompts, document/text/image
  models) bring AI into a flow — use prebuilt models before training custom
  ones; mind per-action AI Builder credit consumption.
- Conversational/agent experiences belong in **Copilot Studio**, not a flow
  with bolted-on prompts → `copilot-studio-development`. A flow can be a
  Copilot Studio *action*; keep the orchestration boundary clean.

## Operations

- Connections vs **connection references**: flows in solutions must use
  connection references; bind them at deployment (pipelines prompt, or
  deployment settings file supplies them). After import, flows whose
  references are unbound stay **off**.
- Run-as matters: Dataverse-triggered flows can run as the triggering
  user or the flow owner — decide deliberately; service-account ownership
  for production flows avoids the leaver-disables-the-business problem.
- Common error codes: 400 misconfigured action, 401/403 connection or
  permission, 404 missing resource (replace hardcoded IDs with lookups),
  429 throttling (respect connector limits; add retry/backoff), 5xx
  service-side (retry policy territory).
- Flow owners get failure emails by default; for anything
  business-critical, build explicit alerting in the Catch path instead of
  relying on them.

Docs: https://learn.microsoft.com/power-automate/guidance/coding-guidelines/error-handling ·
https://learn.microsoft.com/power-automate/guidance/coding-guidelines/optimize-power-automate-triggers ·
https://learn.microsoft.com/power-automate/error-reference ·
https://learn.microsoft.com/power-automate/scopes ·
https://learn.microsoft.com/power-automate/desktop-flows/hosted-rpa-overview
