---
name: m365-development
description: >-
  Microsoft 365 platform development: Microsoft Graph API and SDKs (auth
  flows, OData, paging, throttling, batching, delta queries, change
  notifications), SPFx web parts and extensions, Teams apps (tabs, bots,
  message extensions, app manifest, Agents Toolkit), SharePoint Online
  data access (PnPjs/REST/Graph) and Office add-ins. Use for ANY work
  involving Microsoft Graph, SPFx, Teams app development, SharePoint
  Framework, PnPjs, Teams manifests, Office.js, or programmatic access to
  M365 data (users, mail, calendar, files, sites, Teams).
---

# Microsoft 365 Development

Standards for building against the Microsoft 365 platform. Grounding:
MS Learn, github/awesome-copilot msgraph-sdk, sudharsank/
spfx-enterprise-skills, wyre-technology Graph patterns (all in Reference
skills). This platform moves monthly — verify versions and API shapes
against live docs (Graph changelog, SPFx release notes) before asserting.

## Non-negotiables

1. **Pick the auth flow from the decision tree first** (top Graph mistake):
   daemon/no user → client credentials (app-only); acting for a signed-in
   user → On-Behalf-Of; Azure-hosted → managed identity via
   `DefaultAzureCredential`; CLI/local → device code or interactive
   browser; SPA → auth code + PKCE. Never client credentials where user
   context is required — Graph enforces application vs delegated at the
   permission level. Never hardcode secrets; prefer certificates over
   client secrets in production.
2. **Least-privilege scopes.** Request the narrowest permission that
   works (e.g. `Mail.Read` not `Mail.ReadWrite`; `Sites.Selected` for
   scoped SharePoint app access). Check the permissions reference; every
   scope is an audit and approval burden in enterprise tenants.
3. **Always handle pagination.** Any Graph collection can return
   `@odata.nextLink` — use the SDK `PageIterator` or follow links until
   absent. Code that assumes one page is a latent production bug.
4. **Shape queries server-side.** `$select` always (default payloads are
   large), `$filter` server-side rather than in memory, `$expand` only
   for small relationships. Advanced Entra queries need
   `ConsistencyLevel: eventual` + `$count=true`.
5. **Respect throttling.** Honour `Retry-After` on 429/503 with
   exponential backoff (SDKs have middleware — don't disable it). Batch
   up to 20 independent calls via `$batch`; match responses by `id`
   (they arrive unordered).
6. **`graph.microsoft.com/v1.0` for production.** `/beta` is unstable
   and unsupported for production; isolate any beta dependency and flag
   it.
7. **SPFx version discipline.** SPFx versions pin Node and toolchain:
   v1.21 = Node 22, gulp; **v1.22+ (Dec 2025) = Heft-based toolchain**
   (gulp is gone for new projects; webpack remains underneath). Check
   `.yo-rc.json`/`package.json` for the project's version and match
   tooling — never mix toolchain advice across this boundary.
8. **Teams apps are manifest-first** and built with the **Microsoft 365
   Agents Toolkit** (the renamed Teams Toolkit) — `appPackage/
   manifest.json` declares capabilities; bots and message extensions
   register through Azure Bot Service with the Teams (and Microsoft 365,
   for Outlook/Copilot reach) channels enabled.

## Decision guides

**Data access for SharePoint/M365 content**: SharePoint REST or PnPjs
(`@pnp/sp`) for SP-only data; Graph (or `@pnp/graph`) for cross-service
data (users, mail, Teams, files). PnPjs preferred in SPFx for fluent
API, batching and caching. Full table → `references/sharepoint-data.md`.

**Surface choice**: SPFx web part (SharePoint pages, Teams tabs, Viva
Connections) vs Teams app (Teams-first, bots/message extensions) vs
Office add-in (document-centric, Office.js). Copilot agents and
Copilot Studio → `copilot-studio-development` (sibling skill).

## Workflow

1. Identify tenant constraints first: admin consent process, conditional
   access, Sites.Selected policies — these shape what is buildable.
2. Register the Entra app (or reuse) with least-privilege scopes; prefer
   certificate credentials and managed identity.
3. Build with the appropriate SDK/framework (`references/graph-sdks.md`,
   `references/spfx-development.md`, `references/teams-apps.md`).
4. Handle the platform realities: paging, throttling, consent errors,
   subscription renewal for change notifications.
5. Test against a dev tenant (Microsoft 365 developer programme);
   validate Teams manifests with Agents Toolkit before sideload.
6. Ship: SPFx `.sppkg` to the app catalogue; Teams apps through org
   catalogue admin approval; add-ins via central deployment.

## High-frequency pitfalls

- 403 with valid token = missing/wrong permission **type** (delegated vs
  application) more often than missing scope.
- Graph change notification subscriptions expire (mail/calendar
  typically 1–3 days) — renew before `expirationDateTime` and implement
  lifecycle notifications, or you silently stop receiving events.
- Delta queries: store the `deltaLink` durably; restarting from scratch
  re-syncs everything.
- SPFx: don't bind static singletons to web part instances; thin shells
  with `services/`, `components/`, `hooks/` separation.
- Teams SSO: the Entra app must list the Teams/M365/Outlook client IDs
  as authorised clients or SSO breaks per surface
  (`references/teams-apps.md` has the table).
- Message extensions: max 10 commands, one `composeExtensions` entry;
  enable the Microsoft 365 channel or Outlook/Copilot invocations fail
  with HTTP 500.

## References

| File | Load when |
|------|-----------|
| `references/graph-fundamentals.md` | Any Graph call — OData, paging, batching, delta, notifications, throttling |
| `references/graph-sdks.md` | Writing Graph code in .NET, TypeScript/JS or Python |
| `references/spfx-development.md` | SPFx web parts/extensions, toolchain, architecture |
| `references/sharepoint-data.md` | SPO lists/content types, PnPjs vs REST vs Graph |
| `references/teams-apps.md` | Teams tabs/bots/message extensions, manifest, SSO |
| `references/office-addins.md` | Office.js add-ins, manifests, requirement sets |

## Boundaries with sibling skills

- Copilot Studio agents, declarative agents, M365 Agents SDK →
  `copilot-studio-development`.
- Tenant administration / PowerShell automation (Graph PowerShell, PnP
  PowerShell, Exchange Online) → `powershell-development`.
- Entra ID app registration depth, Azure hosting → `azure-development`.
- React component patterns in SPFx → `react-development`;
  TypeScript typing → `typescript-development`.
