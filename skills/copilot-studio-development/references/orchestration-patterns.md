# Generative Orchestration Patterns

Production patterns from microsoft/skills-for-copilot-studio (pattern
statuses: proven / recommended / experimental as marked). Platform
limitations are date-stamped — re-verify before relying on them.

## How routing works

With `GenerativeActionsEnabled: true`, the orchestrator LLM routes on the
`modelDescription` (and `modelDisplayName`) of every topic, action, tool
and knowledge source. Write modelDescriptions as routing prompts: precise,
intent-scoped, with vocabulary the user would actually use. Trigger phrases
become secondary hints. In classic orchestration, `triggerQueries` pattern
matching is primary instead.

## Orchestrator-generated variables (proven)

`AutomaticTaskInput` lets the orchestrator populate topic inputs at
orchestration time — classification/extraction with zero extra cost or
latency (it reuses the routing LLM call):

```yaml
kind: AdaptiveDialog
inputs:
  - kind: AutomaticTaskInput
    propertyName: searchCategory
    description: |-
      Classify the user's query into one of these categories:
      HR, IT, Finance, Other
    shouldPromptUser: false
```

Rules: declare in **both** `inputs` and `inputType.properties` (must
match); `shouldPromptUser: false` resolves silently; list exact allowed
values in `description`. Use for knowledge routing, entity extraction,
priority flags. Not for multi-step reasoning — use an AI Prompt action.

## Preventing tool-call leaks (recommended)

Agents with connector/MCP tools can emit internal JSON
(`explanation_of_tool_call`, `new_instruction`) to users. Two layers:

1. Instructions rule (simpler, not guaranteed): "Return only the final
   user-facing answer. Do not include internal reasoning, tool call
   explanations, or diagnostic JSON."
2. `OnGeneratedResponse` interception (reliable):

```yaml
kind: AdaptiveDialog
beginDialog:
  kind: OnGeneratedResponse
  id: main
  actions:
    - kind: ConditionGroup
      id: leakCheck
      conditions:
        - id: hasLeak
          condition: |
            =IsMatch(Lower(System.Response.FormattedText), "explanation_of_tool_call")
          actions:
            - kind: SetVariable
              id: suppress
              variable: System.ContinueResponse
              value: false
```

Apply both to any production agent with tools.

## Deterministic MCP calls (experimental; limitations as of 2026-03)

MCP tools are generative actions: no `/` force-syntax in instructions, and
topics cannot call MCP tools directly. Workarounds, in escalation order:

1. **Name the tool in agent instructions** — "When the user asks about
   <intent>, you MUST call the <MCP Tool Name> tool." High but not
   guaranteed reliability.
2. **Child agent wrapper** — a child agent whose only job is calling that
   tool; parent routes via intent. Near-deterministic. Combine with output
   variables if the parent must own response formatting.

Revisit when native deterministic MCP invocation ships.

## Channel-aware behaviour (experimental)

`System.Activity.ChannelId` is compound: `msteams:Copilot` (M365 Copilot in
Teams), `webchat:Sharepoint`, `directlinespeech`, etc. Gate with:

```yaml
- kind: SetVariable
  id: setIsTeams
  variable: Global.IsTeamsClient
  value: =StartsWith(Lower(System.Activity.ChannelId), "msteams")
```

Use for: per-surface Adaptive Card variants, suppressing broken affordances
(file upload differs per channel), shortening responses in embedded
surfaces, speech-specific output.

## Child agent response control

Child agents (`agents/*.mcs.yml`, kind `AgentDialog`) message users
directly by default. For parent-controlled output: instruct the child to
populate output variables and never send activities; parent reads outputs
and formats the response.

## Other named patterns (read source repo for full YAML)

- **JIT glossary / JIT user context**: load acronyms or M365 profile
  (country, department) into globals on first message — improves knowledge
  search and personalisation. Combine into one `conversation-init`
  OnActivity topic.
- **Date context**: inject `=Text(Now(), …)` into instructions for
  date-relative queries.
- **Knowledge hold message**: randomised "working on it" via
  `OnKnowledgeRequested` for slow searches.
- **Chain-of-thought logging**: high-level "Thinking…" updates during
  multi-tool orchestration; aids observability and perceived latency.
- **Conversation history variable**: best-effort transcript capture for
  escalation/logging.
- **RAI error handling**: classify Azure OpenAI content-filter subcodes in
  `OnError` for category-specific messaging (Azure OpenAI models only).
