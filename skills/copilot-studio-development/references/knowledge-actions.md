# Knowledge Sources, Actions and Tools

## Knowledge sources (`knowledge/*.mcs.yml`)

Kind `KnowledgeSourceConfiguration`. Built-in source kinds include
`SharePointSearchSource` and `PublicSiteSearchSource` (templates exist in
the official repo); Dataverse and connector-backed sources are configured
in the Studio UI or YAML. Each source's `modelDescription` is a routing
prompt — scope it tightly so the orchestrator searches the right source.

YAML-only: `triggerCondition` accepts arbitrary Power Fx
(e.g. `=Global.UserDepartment = "HR"`) to gate a source per conversation;
the UI only shows an on/off toggle (`=false` excludes from
`UniversalSearchTool`). UI edits can silently strip it — document usage.

### Answer node selection

| Node | Grounding | Use |
|------|-----------|-----|
| `SearchAndSummarizeContent` | Knowledge sources | Default generative answers |
| `AnswerQuestionWithAI` | Conversation history + model knowledge only | No-knowledge chat; never for factual org content |
| `SearchKnowledgeSources` | Knowledge sources, raw results | Custom result processing, no AI summary |
| `CreateSearchQuery` | — | AI-rewritten query from user input |

### Custom knowledge via OnKnowledgeRequested (YAML-only)

Implement a custom search backend: trigger fires on knowledge search,
read `System.SearchQuery` / `System.KeywordSearchQuery`, call your API
(connector action), populate `System.SearchResults` (columns: Content,
ContentLocation, Title). Also the hook for hold messages during slow
searches.

## Connector actions (`actions/*.mcs.yml`, kind TaskDialog)

```yaml
kind: TaskDialog
modelDisplayName: Get open tickets
modelDescription: Retrieves the user's open support tickets from ServiceNow
inputs:
  - kind: AutomaticTaskInput        # AI supplies from context
    propertyName: userEmail
    description: The requesting user's email address
  - kind: ManualTaskInput           # fixed value — STRINGS ONLY
    propertyName: timezone
    value: "GMT Standard Time"
outputMode: All
action:
  kind: InvokeConnectorTaskAction
  connectionReference: cref_servicenow   # registered in connectionreferences.mcs.yml
  connectionProperties:
    mode: Invoker                  # Invoker = end user's credentials; Maker = maker's
  operationId: GetRecords
```

- `mode: Invoker` (user credentials) is the governance-friendly default for
  agents acting on org data; `Maker` shares the maker's connection with all
  users — flag the data-access implications whenever you choose it.
- `ManualTaskInput` hardcodes strings only; numeric/enum values need review
  in the Studio UI after push.
- Operation-specific inputs/outputs are connector-specific — look them up
  (connector metadata, or the official repo's connector-lookup tooling);
  do not guess property names.

## `$`-prefixed OData properties (SharePoint etc.)

Two formats; never mix:

```yaml
# TaskDialog (actions/*.mcs.yml): outer double quotes + inner single quotes
- kind: ManualTaskInput
  propertyName: "'$filter'"
  value: "Status eq 'Active'"

# InvokeConnectorAction (inline in topics): parameters/ prefix, no inner quotes
- kind: InvokeConnectorAction
  operationId: GetItems
  input:
    parameters/$filter: "Status eq 'Active'"
```

## MCP servers as tools

MCP servers connect via connectors and surface tools to the generative
orchestrator. Implications:

- Tools are invoked generatively — see `orchestration-patterns.md` for the
  deterministic-call workarounds (instructions nudge → child agent wrapper).
- Tool descriptions function as modelDescriptions: precise, intent-scoped.
- DLP: MCP connectors are governable by Power Platform data policies like
  any connector — confirm environment policy before building against one.
- MCP-app UI patterns (rendering tool results) live in the
  power-platform-skills `mcp-apps` plugin (saved in Reference skills).

## Authentication for tools

Agent-level auth options: none, Microsoft (Entra), or manual (incl.
certificate providers). Tools can run with user credentials by default
("Run tools with user credentials") — prefer this for least-privilege.
`OnSignIn` + `OAuthInput` handles the sign-in flow; `System.SignInReason`
distinguishes triggers.
