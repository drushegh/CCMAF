# ALM, Governance and DLP for Copilot Studio Agents

Grounding: MS Learn Copilot Studio guidance (ALM strategy, security and
governance key concepts, data policies). Agents are Power Platform solution
components — the platform ALM model applies. Deep solution mechanics live
in `power-platform-development`; this file covers the agent-specific layer.

## Environment and solution strategy

Minimum three environments: dev (sandbox), test (sandbox), production
(production type). Secure each with an Entra security group. Golden rules:

1. Never customise outside a development environment.
2. Always work in the context of solutions (agents are created inside one).
3. Custom publisher and prefix.
4. Separate solutions only for independently deployed components.
5. Environment variables for settings/secrets that change per environment;
   connection references for per-environment connections.
6. Export/deploy as **managed** (unmanaged only in dev).
7. Automate: Power Platform pipelines (low setup, citizen-friendly),
   Azure DevOps + Power Platform Build Tools (full control), or GitHub
   Actions for Power Platform (middle ground). Native Git integration is
   available for source control. Pipeline construction details →
   `devops-development/references/power-platform-cicd.md`.

## Not solution-aware (re-apply after every deployment)

- Azure Application Insights settings
- Manual authentication settings
- Direct Line / web channel security settings
- Deployed channels
- Sharing (makers and end users)

Script or checklist these as post-deployment steps per environment.

## Governance controls by level

| Level | Controls |
|-------|----------|
| **Tenant** | Data policies across all environments: unauthenticated usage, individual channels, knowledge sources, individual connectors, skills, App Insights. Block publishing of gen-AI agents tenant-wide. Cross-geo data movement controls. M365 admin center governs which agents appear in M365 Copilot. |
| **Environment** | Scope data policies in/out; allow/block public data sources (e.g. Bing); gen-AI feature availability; network isolation (VNet support, IP firewall); managed environment rules; environment routing for safe maker spaces. |
| **Agent** | Generative orchestration on/off; AI knowledge/generative answers toggles; authentication mode (none / Microsoft / manual incl. certificates); web channel security; runtime protection status visible to makers; pre-publish security scan warnings. |

Recommended DLP posture: strict policies in personal dev environments,
relaxed-but-managed in dedicated dev, relaxed in test/production after
review (managed environment rules inverse).

## Data policy enforcement (mandatory)

Enforcement applies to **all** tenants and agents since early 2025
(MC973179) — exemptions no longer exist. Practical consequences:

- Blocked connectors/channels fail at publish; the Channels page lists
  violations, with an Excel download (DLP violations + blocked channels,
  policy names/IDs and offending connectors).
- If all channels are blocked by policy, the agent cannot publish at all.
- Check environment data policies **before** designing against a connector
  or channel; misaligned default-block policies have caused production
  outages (e.g. Direct Line or unauthenticated web deployments blocked).

## Audit, compliance, encryption

- Maker activity → Microsoft Purview audit logs; agent activity can be
  monitored/alerted via Microsoft Sentinel (→ `sentinel-development` when
  built).
- Sensitivity labels surface in chat for SharePoint-sourced knowledge
  (highest label shown).
- Customer-managed keys (CMK) available per environment; Customer Lockbox
  supported.
- Autonomous agent capabilities (triggers) are governable via data
  policies — review before enabling autonomous scenarios.
- Copilot Studio follows the Microsoft SDL; compliance certifications via
  the Trust Center. Geographic data residency configurable; gen-AI
  features can be restricted for regions without local Azure OpenAI
  capacity.

## Testing strategy in ALM

Test the published agent per environment (test chat validates drafts; the
published artefact is what users get). Promote through environments only
after evals pass — see `testing-evals.md`. M365 Copilot/Teams distribution
adds the admin-approval gate (see `teams-production.md`) as a final stage.
