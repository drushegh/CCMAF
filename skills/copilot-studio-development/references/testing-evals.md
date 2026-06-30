# Testing and Evaluation

Layered approach: validate YAML → test interactively → batch test the
published agent → evaluate orchestration behaviour over time.

## 1. Static validation (always, before any push)

The authoritative validator is the **Copilot Studio LSP** — the same
engine as the VS Code Copilot Studio extension. It checks YAML structure,
Power Fx expressions, schema compliance (kinds, required fields, IDs,
scopes) and cross-file references. The official plugin
(microsoft/skills-for-copilot-studio) wraps it as a `validate` skill
against an agent workspace; the VS Code extension provides the same
diagnostics interactively. Minimum bar when the LSP is unavailable:
YAML parses, kinds exist in the schema reference, Power Fx uses only the
supported subset, IDs unique, inputs declared in both `inputs` and
`inputType.properties`.

## 2. Interactive testing

- **Test panel** (Studio UI): authoring loop against the draft;
  `System.Conversation.InTestMode = true` lets topics branch for test
  runs. Tests the *draft*, not what users see.
- **Demo website**: stakeholder testing of the *published* agent (no/manual
  auth only). Not production.
- **Programmatic single-utterance checks** against the published agent:
  - **Direct Line v3** — agents with no auth or manual auth.
  - **Copilot Studio Client SDK (M365)** — agents with integrated
    Entra ID auth; requires an app registration.
  Both exist as ready scripts in the official plugin repo.

## 3. Batch testing — Power CAT Copilot Studio Kit

The [Copilot Studio Kit](https://github.com/microsoft/Power-CAT-Copilot-Studio-Kit)
runs test sets against a **published** agent via Dataverse APIs, producing
pass/fail with latencies. Prerequisites: Kit installed in the environment,
a test set defined, an app registration with Dataverse permissions.
Use for regression suites before promoting through environments.

## 4. Evals for generative behaviour

Generative orchestration is non-deterministic — point-in-time manual tests
are not sufficient evidence of correctness. Build an eval set:

- Scenario prompts paired with deterministic checks (expected routing /
  topic selection, expected knowledge source, expected tool invocation,
  response-content assertions, schema validation of any authored output).
- Track results across agent changes (instructions edits change routing
  behaviour in non-obvious ways; modelDescription edits double so).
- For declarative agents in M365 Copilot, **developer mode** (`-developer
  on` in Copilot chat) exposes the orchestration debug card: capabilities
  run, actions matched, latency and request/response status — use it to
  diagnose *why* an eval failed.

## Evaluation focus by agent type (MS Learn guidance)

| Aspect | Declarative agent | Custom engine agent |
|--------|-------------------|---------------------|
| Focus | Configuration effectiveness | System correctness |
| Orchestration | Instructions + capability selection | Own orchestration logic |
| Knowledge | Retrieval behaviour | Full RAG pipeline |
| Tools | Action matching/parameters | Tool chain directly |
| Safety | Built-in guardrails | Custom safeguards you must test |
| Performance | Instruction/workflow tuning | Latency, cost, efficiency |

## Promotion gate

Wire batch tests + evals into the ALM flow: green in test environment →
deploy managed to production → re-run smoke evals against production
channels (channel rendering differs — see `teams-production.md`).
Pipeline mechanics → `devops-development`.
