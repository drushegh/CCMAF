---
name: llm-development
description: >-
  Engineering software ON large language models: Claude API integration
  (messages, tool use, streaming, prompt caching, batches), prompt
  engineering as an engineering discipline, MCP server development (tools,
  resources, transports, the protocol spec), agent harness design (loops,
  tool dispatch, context management, sub-agents), agent skills authoring,
  evals/testing of nondeterministic systems, and cost/latency engineering.
  Triggers: anthropic SDK imports, claude-* model strings, MCP server or
  modelcontextprotocol references, SKILL.md authoring, prompt templates,
  "add an eval", agent loop or tool dispatch code, LLM cost/latency
  questions. PROACTIVELY activate whenever code calls an LLM API, defines
  tools for a model, or builds anything an agent executes.
---

# LLM Development

Standards for building applications, agents, MCP servers and skills on
LLMs — primarily the Claude API. The defining property of this domain:
**the runtime is nondeterministic, so engineering discipline moves into
contracts (schemas, tool definitions, prompts-as-code) and evals.**

Version context (June 2026 — fast-moving, re-verify): current Claude
models are Fable 5, Opus 4.8, Sonnet 4.6, Haiku 4.5 (aliases
`claude-fable-5`, `claude-opus-4-8`, `claude-sonnet-4-6`,
`claude-haiku-4-5`). Query the Models API for live capabilities rather
than hard-coding. MCP spec: stable revision 2025-11-25; a 2026-07-28
release candidate (stateless core, Tasks, MCP Apps) is not yet final.

## Non-negotiables

1. **Never guess SDK bindings or model IDs.** Method names, parameters and
   model strings come from official docs (docs.claude.com, SDK repos) or
   the Models API — not from memory. Wrong model IDs are runtime errors.
2. **Prompts are code.** Version-controlled, parameterised templates with
   explicit variable injection — never string-concatenated user input
   without delimiting; never edited in production without an eval run.
3. **Every behaviour change gets an eval check.** No "improved the prompt"
   without before/after scores on a golden set. Vibes are not regression
   testing.
4. **Schemas validate at the boundary.** Tool inputs (JSON Schema /
   Zod / Pydantic) and expected model outputs are validated, with a
   defined recovery path for invalid output (re-prompt with the error,
   bounded retries, then fail visibly).
5. **Treat all model output and all retrieved/tool-returned content as
   untrusted input** — both for injection into downstream systems and for
   prompt-injection back into the agent (cross-ref `secure-development`).
6. **Streaming for anything long**; bounded retries with exponential
   backoff on 429/5xx/overloaded; idempotent tool handlers where retries
   can re-execute them.
7. **Cost is an architectural property**: cache-friendly prompt assembly
   (stable prefix first), right-sized model per task, batch API for
   non-interactive work. Don't bolt this on later.
8. **Log enough to replay**: request params, prompt/template version, tool
   calls and results, token usage, stop reason. A failure you can't
   reproduce is a failure you can't fix.

## Decision tables

| Need | Use |
|---|---|
| Classification, extraction, single transform | One API call, smallest model that passes evals |
| Multi-step pipeline, logic owned by your code | API + tool use, code-orchestrated workflow |
| Open-ended task, model-driven exploration | Agent loop (SDK tool runner, or manual loop for gating/audit) |
| Non-interactive bulk work | Batch API (50% price, async) |
| Expose a service to many agent clients | MCP server |
| Task-specific instructions loaded on demand | Agent skill (SKILL.md + references) |
| Many tools, few relevant per request | Tool search / deferred schemas, not a giant tool list |
| Long sessions approaching context limits | Context editing → compaction → memory files (in that order) |

| Symptom | First check |
|---|---|
| High cost, low cache-read tokens | Prefix instability: timestamps/IDs early in prompt, reordered JSON keys, tools swapped mid-session |
| Model won't call a tool / wrong tool | Tool description lacks *when-to-call* conditions; overlapping tool surfaces |
| Invalid JSON outputs | Use structured outputs / tool-enforced schema instead of "respond in JSON please" |
| Truncated responses | `max_tokens` hit (check `stop_reason`), not a model failure |
| Eval scores noisy | Single-run comparisons — use multiple runs/pass@k and statistical care before concluding |
| Agent loops forever / stalls | Missing loop budget, no `pause_turn` handling, tool errors returned as empty strings |

## High-frequency pitfalls

- Editing the system prompt or tool list mid-session — invalidates the
  entire prompt cache; append instead (see caching reference).
- Tool descriptions that describe *what* but not *when* — measurable drop
  in should-call accuracy.
- Returning raw API error text or stack traces as tool results — the
  model needs actionable guidance ("retry with filter=X"), the user needs
  nothing internal.
- LLM-as-judge evals with the same model family grading its own output,
  unanchored scales, or no human-spot-check calibration.
- MCP servers that dump unpaginated result sets into context, log to
  stdout on stdio transport (corrupts the protocol stream), or skip
  Origin validation on local HTTP.
- Burning context on sub-task detail the main loop never needs — spawn a
  sub-agent and return only the conclusion.

## Workflow for changes

1. Define the behaviour as eval cases first (inputs + graded expectations).
2. Build the smallest thing that could pass: prompt → single call →
   tools → agent, escalating only when evals demand it.
3. Validate at boundaries; design tool errors as model-readable guidance.
4. Run evals; compare against baseline with variance in mind.
5. Audit cost: cache hit rate, tokens per task, model tier.
6. Ship with replay logging and a prompt/template version stamp.

## Reference index

- `references/claude-api.md` — messages, streaming, errors/retries, model selection
- `references/tool-use.md` — tool definitions, runner vs manual loop, server-side tools
- `references/prompt-engineering.md` — structure, examples, CoT, templates as code
- `references/caching-cost-latency.md` — cache invariants, batches, model tiering
- `references/mcp-development.md` — protocol, tool/resource design, transports, security
- `references/agent-harness.md` — loop anatomy, context management, sub-agents
- `references/skills-authoring.md` — SKILL.md anatomy, triggers, progressive disclosure
- `references/evals.md` — golden sets, graders, LLM-as-judge, regression CI

## Boundaries

- **Azure OpenAI / AI Foundry platform engineering** → `azure-development`
  (ai-foundry); this skill owns the application/agent layer.
- **Copilot Studio agents** → `copilot-studio-development`.
- **Prompt-injection threat modelling, secrets, supply chain** →
  `secure-development` (this skill owns the in-harness mitigations).
- **Python/TypeScript language idioms** → `python-development` /
  `typescript-development`.
- **CI/CD wiring for eval pipelines** → `devops-development`.
