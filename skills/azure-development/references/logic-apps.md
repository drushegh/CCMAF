# Azure Logic Apps

Serverless workflow/integration: visual + JSON-defined workflows that connect
apps, data and systems via connectors. Two SKUs with materially different
models — choose deliberately. This is also where Sentinel SOAR **playbooks**
live (sentinel-development defers Logic Apps depth to here).

## Consumption vs Standard

| | Consumption | Standard |
|---|---|---|
| Host | Multitenant | Single-tenant (Workflow Service Plan) or ASEv3 |
| Workflows per resource | One | Many |
| Billing | Per-action execution | Hosting plan (+ storage for stateful) |
| VNet / private endpoints | Limited | Yes |
| Connectors | Managed (API connections) | Built-in **service-provider** (in-process) + managed |
| State | Stateful only | Stateful **and** stateless |
| Local dev/debug | Portal-centric | VS Code, packaged with app |

**Default for new/serious workloads: Standard** — VNet integration, private
endpoints, a static outbound IP, higher limits, multiple workflows per
resource, in-process connectors (better throughput/cost), local dev and
cleaner ALM (connections packaged in the build artefact). **Consumption** suits
low-volume, simple or quick automations and many one-off Sentinel playbooks
where per-action billing is cheapest.

## Stateful vs stateless (Standard)

Decided **at creation — cannot be changed later** without a rebuild.

- **Stateful**: persists run history, inputs/outputs and state to external
  storage; resilient (resume after outage), long-running, handles large
  messages, async (202 poll) pattern, all triggers incl. Recurrence.
- **Stateless**: in-memory only, no run history by default; sub-5-minute runs,
  small messages (<64 KB), faster/cheaper, **push triggers only** (Request,
  Event Hubs, Service Bus — no Recurrence), synchronous only. Enable run
  history temporarily for debugging.

Use stateful by default; reach for stateless for short, high-throughput,
small-payload paths.

## Connectors

- **Built-in / service-provider** (Standard): run in-process with the workflow
  — best performance, packaged into the deploy artefact, often support managed
  identity. Prefer these.
- **Managed / API connections**: separate `Microsoft.Web/connections` Azure
  resources you deploy alongside (ARM/Bicep). Hundreds available across SaaS,
  on-prem and Azure.
- Misconfigured service-provider triggers (e.g. no permission to the Service
  Bus/queue) can cause runaway scaling and cost — set up and **test** triggers,
  and monitor them.

## Sentinel SOAR playbooks

A playbook is a Logic Apps workflow triggered by a Sentinel incident, alert or
entity. Authenticate the **Microsoft Sentinel connector with a managed
identity** (not shared credentials): enable system-assigned identity on the
workflow, then grant it **Microsoft Sentinel Responder** (to update
incidents/watchlists) or **Reader** (receive only) on the workspace. Store any
secrets in Key Vault; monitor playbook health. Detection/automation-rule design
→ `sentinel-development`; the workflow engineering is here.

## Engineering discipline

- **Managed identity** for connections wherever the connector supports it; no
  secrets in workflow definitions — Key Vault for the rest.
- **Deploy as code**: workflow definitions are JSON; ship via Bicep/ARM (and,
  for Standard, the packaged artefact). No portal-only production workflows —
  pipeline construction → `devops-development`.
- Stateful workflows make HTTP actions follow the **async 202 poll** pattern by
  default — design long-running calls around it.
- B2B/EDI (AS2, X12, EDIFACT) uses an **integration account**; mention it only
  where the scenario is genuine enterprise integration.
- Migrating Consumption → Standard: export/clone tooling (VS Code extension /
  portal preview) replicates artefacts; it doesn't move history.
