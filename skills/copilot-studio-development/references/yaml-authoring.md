# Copilot Studio YAML Authoring Reference

Source: microsoft/skills-for-copilot-studio (official) + MS Learn. The
authoritative schema ships with the VS Code Copilot Studio extension
(`bot.schema.yaml-authoring.json`); validate against it where available.

## File types

| File | Kind |
|------|------|
| `agent.mcs.yml` | `GptComponentMetadata` — agent metadata |
| `settings.mcs.yml` | Agent settings (instructions, orchestration flags) |
| `connectionreferences.mcs.yml` | Connector connection references |
| `topics/*.mcs.yml` | `AdaptiveDialog` — conversation topics |
| `actions/*.mcs.yml` | `TaskDialog` — connector-based actions |
| `knowledge/*.mcs.yml` | `KnowledgeSourceConfiguration` |
| `variables/*.mcs.yml` | `GlobalVariableComponent` |
| `agents/*.mcs.yml` | `AgentDialog` — child agents |

## Trigger kinds

| Kind | Fires when |
|------|------------|
| `OnRecognizedIntent` | Routed by modelDescription (generative) or triggerQueries (classic) |
| `OnConversationStart` | Conversation begins |
| `OnUnknownIntent` | No topic matched (fallback) |
| `OnSelectIntent` | Multiple topics matched (disambiguation) |
| `OnEscalate` / `OnError` / `OnSignIn` | Escalation / error / auth required |
| `OnSystemRedirect` | Redirect only (e.g. Reset Conversation) |
| `OnToolSelected` | Child agent invocation |
| `OnKnowledgeRequested` | Custom knowledge search (YAML-only, no UI) |
| `OnGeneratedResponse` | Intercept AI response before sending |
| `OnInstallationUpdate` / `OnInactivity` / `OnActivity` | Teams lifecycle/message events |

`OnOutgoingMessage` exists in the schema but did not fire at runtime as of
2026-03 — do not use without re-verifying.

## Action node kinds (inside topics)

`SendActivity`, `Question`, `SetVariable`, `SetTextVariable` (template
interpolation `{}`, converts non-text types), `ConditionGroup`,
`BeginDialog`, `ReplaceDialog`, `EndDialog`, `CancelAllDialogs`,
`ClearAllVariables`, `SearchAndSummarizeContent` (generative answers,
grounded), `AnswerQuestionWithAI` (history + general knowledge, ungrounded),
`SearchKnowledgeSources` (raw results), `CreateSearchQuery`, `EditTable`,
`CSATQuestion`, `LogCustomTelemetryEvent`, `OAuthInput`,
`InvokeConnectorAction` (inline connector call).

## Variables

| Prefix | Scope | Notes |
|--------|-------|-------|
| `Topic.` | Current topic | First assignment uses `variable: init:Topic.Name` |
| `Global.` | Conversation | Defined in `variables/*.mcs.yml`; `aIVisibility: UseInAIContext` or `Hidden` |
| `System.` | Built-in, read-only | See below |

Key system variables: `System.Activity.Text`, `System.Activity.ChannelId`
(compound values possible — `msteams:Copilot`), `System.Conversation.Id`,
`System.Conversation.InTestMode`, `System.FallbackCount`,
`System.Error.Message`/`.Code`, `System.Recognizer.IntentOptions`/
`.SelectedIntent`, and in `OnKnowledgeRequested`: `System.SearchQuery`,
`System.KeywordSearchQuery`, `System.SearchResults` (Content,
ContentLocation, Title). In `OnGeneratedResponse`:
`System.Response.FormattedText`, `System.ContinueResponse` (set `false`
to suppress).

## Power Fx — supported subset ONLY

Expressions use `=` prefix; string interpolation in activities uses `{}`
without `=`. Functions outside this list fail at runtime:

- **Math**: Abs, Acos, Acot, Asin, Atan, Atan2, Cos, Cot, Degrees, Exp,
  Int, Ln, Log, Mod, Pi, Power, Radians, Rand, RandBetween, Round,
  RoundDown, RoundUp, Sin, Sqrt, Sum, Tan, Trunc
- **Text**: Char, Concat, Concatenate, EncodeHTML, EncodeUrl, EndsWith,
  Find, Left, Len, Lower, Match, MatchAll, Mid, PlainText, Proper,
  Replace, Right, Search, Split, StartsWith, Substitute, Text, Trim,
  TrimEnds, UniChar, Upper, Value
- **Date/Time**: Date, DateAdd, DateDiff, DateTime, DateTimeValue,
  DateValue, Day, EDate, EOMonth, Hour, IsToday, Minute, Month, Now,
  Second, Time, TimeValue, TimeZoneOffset, Today, Weekday, WeekNum, Year
- **Logical**: And, Coalesce, If, IfError, IsBlank, IsBlankOrError,
  IsEmpty, IsError, IsMatch, IsNumeric, IsType, Not, Or, Switch
- **Table**: AddColumns, Column, ColumnNames, Count, CountA, CountIf,
  CountRows, Distinct, DropColumns, Filter, First, FirstN, ForAll, Index,
  Last, LastN, LookUp, Patch, Refresh, RenameColumns, Sequence,
  ShowColumns, Shuffle, Sort, SortByColumns, Summarize, Table
- **Aggregate**: Average, Max, Min, StdevP, VarP
- **Type conversion**: AsType, Boolean, Dec2Hex, Decimal, Float, GUID,
  Hex2Dec, JSON, ParseJSON
- **Other**: Blank, ColorFade, ColorValue, Error, Language, OptionSetInfo,
  RGBA, Trace, With

## Worked example — question topic with branching

```yaml
kind: AdaptiveDialog
beginDialog:
  kind: OnRecognizedIntent
  id: main
  intent:
    triggerQueries:
      - check order status
  actions:
    - kind: Question
      id: askOrderId
      variable: init:Topic.OrderId
      entity: StringPrebuiltEntity
      prompt: What is your order number?
    - kind: ConditionGroup
      id: gate
      conditions:
        - id: hasOrder
          condition: =!IsBlank(Topic.OrderId)
          actions:
            - kind: SendActivity
              id: confirm
              activity: "Looking up order {Topic.OrderId}…"
```

Prebuilt entities for `Question` nodes: `BooleanPrebuiltEntity`,
`NumberPrebuiltEntity`, `StringPrebuiltEntity`, `DateTimePrebuiltEntity`,
`EMailPrebuiltEntity`; closed-list custom entities for constrained choices.
