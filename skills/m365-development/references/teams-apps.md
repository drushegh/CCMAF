# Teams App Development

Built with the **Microsoft 365 Agents Toolkit** (formerly Teams Toolkit)
in VS Code/Visual Studio, or the Developer Portal for Teams. An app =
app package (`manifest.json` + colour/outline icons) + your hosted web
services. Capabilities are declared in the manifest; one app can combine
tabs, bots, message extensions and meeting extensions.

## App manifest essentials

- `appPackage/manifest.json` against the current schema; Agents Toolkit
  validates it — validate before every sideload/submission.
- Manifest ≥1.13 lets Teams apps run across Microsoft 365 (Outlook,
  M365 app); use `requirementSet`/element relationships to gate
  capabilities per host.
- Bots and message extensions reference a `botId` (Entra app ID)
  registered with Azure Bot Service.
- Project automation lives in `m365agents.yml` /
  `m365agents.local.yml` (provision/deploy actions, formerly
  `teamsapp.yml`).

## Capabilities

| Capability | Notes |
|------------|-------|
| **Tabs** (static/configurable) | Web content + Teams JS SDK (`@microsoft/teams-js` v2+); also the host for SPFx-built tabs |
| **Bots** | Conversational; build new bots on the M365 Agents SDK (→ `copilot-studio-development/references/pro-code-agents.md`); Bot Framework is legacy |
| **Message extensions** | Search/action commands from compose box; max 10 commands, single `composeExtensions` entry; built on the bot infrastructure |
| **Meeting apps** | Tabs/bots in meeting surfaces |
| **Adaptive Cards** | UI payloads for bots/MEs; renderer differences per host — test in each |

## SSO (tabs and bots)

Entra app registration must expose an API (`api://<domain>/<appid>`)
and pre-authorise the client applications for every surface you target:

| Client | ID |
|--------|----|
| Teams desktop/mobile | 1fec8e78-bce4-4aaf-ab1b-5451cc387264 |
| Teams web | 5e3ce6c0-2b1f-4285-8d4b-75ee78787346 |
| Microsoft 365 web | 4765445b-32c6-49b0-83e6-1d93765276ca |
| Microsoft 365 desktop | 0ec893e0-5785-4de6-99da-4ed124e5296c |
| M365 mobile / Outlook desktop | d3590ed6-52b3-4102-aeff-aad2292ab01c |
| Outlook Web Access | bc59ab01-8403-45c6-8796-ac3ef710b3e3 |
| Outlook mobile | 27922004-5251-4030-b22d-91ecd9a37ea4 |

Missing entries = SSO failure only on the missing surface — confusing to
debug. Token exchange for Graph uses OBO server-side.

## Extending to Outlook / M365 / Copilot

- Manifest ≥1.13, then enable the **Microsoft 365 channel** on the Azure
  Bot resource (alongside Teams). Missing channel = HTTP 500 on
  invocation from Outlook; Copilot in Teams also requires it.
- Specify runtime requirements so the app only surfaces where it works.

## Local development loop

Agents Toolkit handles: dev tunnel for the bot endpoint, Entra app +
bot registration provisioning (`botAadApp/create`,
`botFramework/create` actions), env files, F5 debug into a Teams web
client. Provision applies Bicep to Azure; Deploy pushes code.

## Distribution

Sideload (personal testing) → share link → **org catalogue via admin
approval** (M365 admin center) → optionally Partner Center for the
commercial marketplace. Store submission enforces icon specs, manifest
schema currency and validation guidelines.

## Boundaries

- Bot conversational logic and agent SDKs → `copilot-studio-development`.
- SPFx-hosted tabs → `spfx-development.md`.
- Graph calls from the app backend → `graph-fundamentals.md` / `graph-sdks.md`.
