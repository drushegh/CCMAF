# Agent harness patterns

The harness is the deterministic shell around a nondeterministic core:
it owns the loop, tool dispatch, context budget, safety gates and state.
Model quality is Anthropic's job; harness quality is yours.

## Loop anatomy

Responsibilities, in order:

1. **Budget**: max turns, max wall-clock, max spend per task — enforced
   in code, surfaced to the model only as guidance.
2. **Dispatch**: route `tool_use` blocks to handlers; parallel-safe tools
   run concurrently, stateful ones serialise; every result returns with
   its `tool_use_id`.
3. **Gating**: irreversible actions (sends, deletes, payments, deploys)
   pause for approval — this is why they're dedicated tools, not bash.
4. **Stop handling**: `end_turn` done; `max_tokens` continue or raise;
   `pause_turn` resend; `refusal` log and surface, never auto-retry the
   identical request.
5. **Replay logging**: prompt version, full message list (or a pointer),
   tool I/O, usage, stop reasons. Nondeterminism makes logs the only
   debugger you get.

## Context management over long runs

Escalate through three tiers (all composable):

| Tier | Mechanism | When |
|---|---|---|
| Prune | Context editing — drop stale tool results/thinking | Continuous, cheap |
| Summarise | Compaction — history folded into a summary block | Approaching the window |
| Persist | Memory files via harness-backed store | Across sessions |

Design tool results for pruning: big payloads go to files/artefacts and
return a path + summary into context, not 50 KB of JSON. The window is a
working set, not a database.

## Sub-agents

Spawn a sub-agent when a sub-task would flood the parent's context
(exploration, bulk reading, verification) or wants a different
model/toolset. Contract:

- Parent passes a **complete brief** (sub-agent shares no memory) and
  states the expected return shape ("conclusion + file paths, not
  transcripts").
- Sub-agent gets the narrowest tool surface that does the job — least
  privilege applies to agents, not just users.
- Cheaper model for mechanical sub-tasks (also dodges the
  cache-invalidation cost of switching models in the main loop).
- Parallel sub-agents only for independent work; merge results in the
  parent, never share mutable state between them.
- Cap recursion depth; sub-agents spawning sub-agents unboundedly is a
  cost incident with extra steps.

## State and persistence

- The message list is the only model-visible state — everything else
  (DB rows, files, queue items) must be re-presented explicitly each
  session. Don't assume the model "remembers" the previous run.
- Make harness state machine-recoverable: persist progress (completed
  steps, high-water marks) outside the transcript so a crashed run
  resumes rather than restarts — and tool handlers stay idempotent so
  resume-replays are safe.
- For multi-step business processes, encode the process in code
  (workflow) and use the model per step; reserve fully model-driven
  ordering for genuinely open-ended tasks. Deterministic where possible,
  agentic where valuable.

## Safety rails in the harness

- Allow-list tool surfaces per agent role; deny-by-default for new tools.
- Validate tool inputs *again* at the handler even though the schema was
  in the request — the model can emit values schemas don't catch
  (paths outside the workspace, SQL in a "name" field).
- Echo-check high-impact parameters: for irreversible actions, have the
  gate display exactly what will happen (recipient, amount, target),
  sourced from parsed arguments, not from the model's prose claim.
- Treat retrieved content and tool results as untrusted (prompt
  injection); operator instructions live in `system`/system-role
  messages, and the harness should detect instruction-shaped content
  arriving through data channels (cross-ref `secure-development`).
- Kill switch: a human-visible run ledger and a way to halt a runaway
  loop beats post-hoc apologies.

## Multi-agent orchestration (when you must)

Patterns that work: orchestrator–worker (parent decomposes, workers
execute, parent integrates); pipeline (fixed stage order, each stage an
agent with a narrow contract); critic/verifier (second model checks
first's output against criteria — different prompt, ideally different
model). Shared-everything agent "teams" chatting in a common transcript
demo well and debug terribly — prefer explicit handoffs with typed
payloads. Keep the number of agents the minimum the evals justify.
