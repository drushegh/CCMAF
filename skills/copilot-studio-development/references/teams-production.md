# Channels, Publishing and Teams/M365 Copilot Production Hardening

## Channel landscape

Native channels: Teams + Microsoft 365 Copilot (one combined channel),
SharePoint, demo website, custom website, mobile app, WhatsApp, Facebook,
plus Azure Bot Service channels (Slack, Telegram, Twilio, Direct Line
Speech, email, …). Custom applications integrate via **Direct Line**
(REST + WebSocket) with React Web Chat / WebChat JS as stock clients.
Markdown/Adaptive Card support varies per channel — test per surface.

Demo website ≠ production: it's for stakeholder testing only; never share
the URL with end customers. Live-website embedding has its own web channel
security settings (secrets/token exchange).

## Publish flow to Teams / M365 Copilot

1. Publish the agent (at least once) → Channels → **Teams + Microsoft 365
   Copilot**; tick "Make agent available in Microsoft 365 Copilot" if
   wanted; edit display details.
2. Distribution tiers: sideload for personal testing → share install link →
   **submit to org catalogue (requires M365 admin approval)** → optionally
   Partner Center for the commercial marketplace (multi-tenant).
3. Admin side: M365 admin center → Agents → All agents → **Requests** —
   admin reviews metadata/data sources/actions, then publishes to everyone,
   no one, or specific users/groups. Plan for this approval step in
   delivery timelines; it is a hard gate for org-wide rollout.
4. Live-agent handoff (Dynamics 365 Omnichannel or other engagement hub)
   uses a custom adapter relaying Direct Line + handoff context.

## Teams production hardening framework (apply as a set, not pick-and-mix)

Eight coordinated patterns; shared state: `Global.InactiveConversation`,
`Global.UserContext`, `Topic.Confirm`.

1. **`OnInstallationUpdate`** → redirect reinstalls to `ConversationStart`
   (reinstall does not fire conversation start).
2. **`OnInactivity`** → clear variables + `ConversationHistory`, set
   `Global.InactiveConversation = true`, `CancelAllDialogs`.
3. **Post-reset notice** — `OnActivity` handler checks
   `Global.InactiveConversation`, resets it, shows a "Start over" card.
4. **Cross-channel context init** — low-priority `OnActivity` topic fills
   `Global.UserContext` when blank (context variables behave differently
   in M365 Copilot vs web chat — this normalises them).
5. **Rebuild Reset Conversation** — override `OnSystemRedirect`: clear
   scoped variables + history, route to `ConversationStart`.
6. **Start Over with diagnostics** — replace the Boolean prompt with an
   Adaptive Card question (closed-list YesNo entity) including a collapsed
   diagnostics panel: `/debug clearstate`, `/debug clearhistory`,
   `/debug conversationid`, plus `System.Bot.EnvironmentId/TenantId/Name/
   Id/SchemaName`, `System.User.Language/Id`, `System.Activity.ChannelId`,
   `System.Conversation.Id`, UTC timestamp.
7. **`OnError` with diagnostics + telemetry** — actionable message, same
   diagnostics panel, `LogCustomTelemetryEvent`, end with
   `CancelAllDialogs`.
8. **Suggested prompts** — 3–4 at agent level; surface in both Teams and
   M365 Copilot for first-run guidance.

## Channel-specific gotchas

- Compound `ChannelId` values (`msteams:Copilot`, `webchat:Sharepoint`) —
  `StartsWith` checks only (see `orchestration-patterns.md`).
- Adaptive Cards: Copilot Studio supports schema ≤1.6; card rendering
  differs between Teams, M365 Copilot and web chat — test each target.
- Line breaks: use `<br /><br />` inside message/question nodes for
  reliable paragraph spacing across channels.
- M365 Copilot is an embedded surface: shorter responses, citation style
  matters, some affordances (file upload prompts) differ from Teams.
- Deployed channels, web channel security, Direct Line secrets, manual
  auth settings and App Insights settings are **not solution-aware** —
  they must be reconfigured per environment after deployment
  (see `alm-governance.md`).
