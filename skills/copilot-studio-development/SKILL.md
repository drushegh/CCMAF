---
name: copilot-studio-development
description: >-
  Microsoft Copilot Studio agent development: YAML-first authoring of topics,
  triggers, actions and knowledge; generative orchestration; MCP tools;
  Teams/M365 Copilot channels; agent ALM, governance and DLP; plus the
  pro-code adjacency (declarative agents, M365 Agents SDK, Agents Toolkit).
  Use for ANY work involving Copilot Studio, .mcs.yml files, custom agents,
  declarative agents for Microsoft 365 Copilot, generative answers/
  orchestration, agent topics or trigger phrases, Power Platform agent ALM,
  or choosing between Copilot Studio, the Agents SDK and AI Foundry.
---

# Copilot Studio Development

Standards for building, testing and shipping Microsoft Copilot Studio agents,
written for autonomous agents working YAML-first. Authoritative grounding:
Microsoft Learn and microsoft/skills-for-copilot-studio (official plugin repo).

## Choosing the right agent type (decide FIRST)

| Need | Build |
|------|-------|
| Extend M365 Copilot with instructions + knowledge + actions, Copilot's own orchestrator/model | **Declarative agent** (Agent Builder, Copilot Studio, or ATK/TypeSpec) — see `references/pro-code-agents.md` |
| Custom agent with own orchestration, connectors, multi-channel (web, Teams, WhatsApp, Direct Line) | **Copilot Studio custom agent** (this skill's core) |
| Full code control: own models, hosting, proactive triggers, ASP.NET/Express hosting | **M365 Agents SDK** custom engine agent — see `references/pro-code-agents.md` |
| Azure-hosted agents, own RAG pipeline, fine-tuned models | **AI Foundry** — see `azure-development/references/ai-foundry.md` (sibling skill) |

Declarative agents inherit M365 compliance/RAI boundaries; custom engine
agents own their compliance story. Flag this trade-off in any recommendation.

## Non-negotiables

1. **Schema before YAML.** Never invent `kind:` values, node properties or
   trigger types. Work from the schema reference (`references/yaml-authoring.md`)
   and validate structure before delivering. Invalid kinds are the top
   hallucination failure in this domain.
2. **Power Fx subset only.** Copilot Studio supports a fixed subset of Power
   Fx functions (listed in `references/yaml-authoring.md`). Using an
   unsupported function fails at runtime. Check the list; don't assume
   canvas-app parity.
3. **Generative orchestration routes on `modelDescription`**, not trigger
   phrases. With `GenerativeActionsEnabled: true`, write precise
   modelDescription text for every topic, action and tool; trigger phrases
   are secondary hints. Classic orchestration is the reverse.
4. **Variable discipline.** `Topic.` scope dies with the topic; `Global.`
   spans the conversation and is defined in `variables/*.mcs.yml`;
   first assignment uses `init:` prefix. Set `aIVisibility: Hidden` on
   globals the orchestrator must not reason about.
5. **YAML-only features are UI-fragile.** Features like `triggerCondition`
   Power Fx on knowledge sources and `OnKnowledgeRequested` custom search
   work at runtime but are invisible in the Studio UI — UI edits can
   silently remove them. Document any YAML-only feature you use.
6. **Solutions from day one.** Create agents inside a custom Power Platform
   solution with a custom publisher/prefix. Never customise outside a dev
   environment; deploy managed everywhere else. See `references/alm-governance.md`.
7. **Never expose internal reasoning.** Agents with connector/MCP tools can
   leak orchestrator metadata (`explanation_of_tool_call` JSON) to users —
   apply the interception pattern in `references/orchestration-patterns.md`
   for any production agent with tools.
8. **Date-stamp platform claims.** Copilot Studio evolves monthly. Platform
   limitations (e.g. MCP tools not callable from topics, `OnOutgoingMessage`
   non-functional) carry dates in the references — verify against MS Learn
   before asserting them as current.

## Core authoring workflow

1. **Scope the agent**: knowledge-only Q&A, transactional (connector
   actions), or hybrid. Choose orchestration mode (generative is the default
   for new agents; classic only for fully deterministic flows).
2. **Author YAML** under solution control: `agent.mcs.yml` (metadata),
   `settings.mcs.yml`, `topics/`, `actions/`, `knowledge/`, `variables/`,
   `agents/` (child agents). File kinds table in `references/yaml-authoring.md`.
3. **Wire knowledge and tools**: knowledge sources with tight
   `modelDescription`s; connector actions as `TaskDialog` with
   `AutomaticTaskInput` for AI-supplied parameters; MCP servers as
   generative tools. See `references/knowledge-actions.md`.
4. **Harden**: error topics (`OnError` with telemetry), fallback
   (`OnUnknownIntent`), tool-leak suppression, channel-aware gating,
   and Teams production patterns if targeting Teams/M365 Copilot
   (`references/teams-production.md`).
5. **Test and evaluate**: test panel for authoring loops; evals for
   regression (`references/testing-evals.md`); Direct Line or the
   Copilot Studio client SDK for programmatic testing.
6. **Ship through ALM**: export managed, deploy via pipelines/DevOps,
   re-apply non-solution-aware settings post-deploy, publish channels,
   obtain M365 admin approval where required (`references/alm-governance.md`).

## High-frequency pitfalls

- **`$`-prefixed OData parameters** (SharePoint connectors): `TaskDialog`
  inputs need double-then-single quoting (`"'$filter'"`); inline
  `InvokeConnectorAction` uses `parameters/$filter:` instead. Never mix the
  two formats.
- **Compound channel IDs**: `System.Activity.ChannelId` can be
  `msteams:Copilot` or `webchat:Sharepoint` — use `StartsWith`, not equality.
- **`ManualTaskInput` only hardcodes strings** — numeric/enum values need
  post-push review in the Studio UI.
- **Child agents answering users directly** — instruct children to populate
  output variables; the parent owns user-facing responses.
- **Stale Teams sessions** — without `OnInactivity`/`OnInstallationUpdate`
  handling, returning Teams users hit stale context. Apply the production
  hardening framework before org-wide rollout.
- **DLP surprises at publish time**: data policy enforcement is mandatory
  (since early 2025) — blocked connectors/channels surface as publish
  failures. Check environment data policies before building against a
  connector, not after.
- **Declarative agent scaffolding**: the only valid ATK scaffold command is
  `npx -p @microsoft/m365agentstoolkit-cli@latest atk new …` — `atk init`,
  `atk create` and `--template` flags do not exist.

## References

| File | Load when |
|------|-----------|
| `references/yaml-authoring.md` | Writing/reviewing any `.mcs.yml` — kinds, triggers, actions, variables, Power Fx subset |
| `references/orchestration-patterns.md` | Generative orchestration design, AutomaticTaskInput, MCP reliability, leak prevention, channel gating |
| `references/knowledge-actions.md` | Knowledge sources, generative answers nodes, connector actions, MCP tools |
| `references/teams-production.md` | Teams/M365 Copilot channels, publishing, admin approval, production hardening |
| `references/alm-governance.md` | Solutions, environments, pipelines, DLP/data policies, governance controls |
| `references/pro-code-agents.md` | Declarative agents, ATK CLI/TypeSpec, M365 Agents SDK, agent-type decisions |

## Boundaries with sibling skills

- **Dataverse design, solution mechanics, environment strategy detail** →
  `power-platform-development`. **Pro-code Dataverse plugins/PCF** →
  `dynamics-365-development`.
- **AI Foundry hosted agents, Azure OpenAI** → `azure-development`
  (`ai-foundry.md`).
- **CI/CD pipeline construction** → `devops-development`
  (`power-platform-cicd.md`).
- **Graph API, SPFx, Teams app manifests** → `m365-development`.
