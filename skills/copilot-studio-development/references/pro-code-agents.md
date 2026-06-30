# Pro-Code Adjacency: Declarative Agents, ATK and the M365 Agents SDK

The pro-code routes for M365 Copilot extensibility. Full SDK depth lives in
the saved reference skills (microsoft-skills-official `m365-agents-dotnet/
-ts/-py`; sebastienlevert/m365-copilot-skills for TypeSpec).

## Declarative vs custom engine (MS Learn decision frame)

| | Declarative agent | Custom engine agent |
|---|---|---|
| Orchestrator/model | Copilot's own | Yours (any model) |
| Proactive triggers | No — user-initiated only | Yes |
| Channels | M365 apps | M365 + external (web, SMS, …) |
| Compliance | Inherits M365 compliance/RAI | Your responsibility |
| Hosting | Microsoft 365 | M365 (Copilot Studio) or external (Agents SDK, AI Foundry) |

Declarative when: focused M365 scenario, Copilot's orchestration suffices,
compliance inheritance is desirable. Custom engine when: own models/
orchestration, proactive automation, or non-M365 channels.

## Declarative agent tooling

| Tool | Approach | Fit |
|------|----------|-----|
| **Agents Toolkit (ATK)** + TypeSpec | Pro-code | Full control, source control, CI/CD, local Agents Playground testing, best Adaptive Cards support |
| **Copilot Studio** | Low-code | Power Platform connectors + ALM; Adaptive Cards ≤1.6; departmental scale |
| **Agent Builder** | No-code | Personal/team productivity agents |
| **SharePoint agents** | No-code | SharePoint-content-scoped Q&A |

### ATK CLI — scaffolding (exact command; alternatives do not exist)

```bash
npx -p @microsoft/m365agentstoolkit-cli@latest atk new -n <project-name> -c declarative-agent -with-plugin type-spec -i false
```

There is **no** `atk init`, `atk create`, `atk scaffold` or `--template`
flag — these are common hallucinations. Deploy with `atk provision`.
After any agent edit, re-provision before handing back to the user.

TypeSpec authoring: agent defined with the `@agent` decorator; capabilities
configured with scoping; API plugin actions with auth; document models and
operations with `@doc`. (Source: sebastienlevert/m365-copilot-skills —
saved in Reference skills with full TypeSpec best-practice references.)

## M365 Agents SDK (custom engine agents)

Multichannel agents (Teams, M365 Copilot, Copilot Studio integration,
external channels) with full code control.

**.NET**: packages `Microsoft.Agents.Hosting.AspNetCore`,
`Microsoft.Agents.Authentication.Msal`, `Microsoft.Agents.Storage`,
`Microsoft.Agents.CopilotStudio.Client`. ASP.NET Core hosting,
`AgentApplication` routing, MSAL auth; configure `TokenValidation`,
`Connections`/`ConnectionsMap` in appsettings. Verify current APIs and
package versions on NuGet/MS Learn before generating code — the SDK moves
quickly.

**TypeScript/Node**: `AgentApplication` routing, Express hosting, streaming
responses, Copilot Studio client integration.

`Microsoft.Agents.CopilotStudio.Client` (and its TS equivalent) lets
external code converse with a published Copilot Studio agent — the bridge
between this skill's low-code core and pro-code hosts.

## When to step up to AI Foundry

Own RAG pipeline, fine-tuned/industry models, Azure-native hosting and
observability, or agent-lifecycle management outside M365 → AI Foundry
hosted agents. See `azure-development/references/ai-foundry.md` — do not
duplicate that material here.

## Boundary notes

- Teams app manifests, SPFx, Graph API depth → `m365-development`.
- Bot Framework is legacy for new work; the Agents SDK is its successor —
  flag any new Bot Framework proposal.
- Declarative agent manifests evolve fast (monthly release notes on MS
  Learn) — verify capability availability (e.g. which knowledge scopes
  and capabilities are GA vs preview) before committing to a design.
