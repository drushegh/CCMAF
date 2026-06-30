# Caching, cost and latency engineering

## The caching invariant

**Prompt caching is a prefix match. Any byte change anywhere in the
prefix invalidates everything after it.** Render order is
`tools` → `system` → `messages`; a breakpoint on the last system block
caches tools + system together.

Design prompt assembly around stability classes:

| Stability | Placement |
|---|---|
| Never changes (instructions, examples, tool defs) | Earliest; before the first breakpoint |
| Per-session (user profile, mounted context) | After the global prefix; own breakpoint |
| Per-turn (conversation history) | Breakpoint on the most recently appended turn |
| Per-request (timestamps, UUIDs, nonces) | Eliminate, or very end only |

```json
"system": [
  {"type": "text", "text": "<large stable prompt>",
   "cache_control": {"type": "ephemeral"}}
]
```

Multi-turn: marker on the last content block of the latest turn — hits
accrue incrementally as history grows. Shared-prefix/varying-suffix:
marker at the end of the **shared** part only.

## Silent invalidators (audit list)

- Timestamp or request ID interpolated into the system prompt header.
- JSON serialisation with unstable key order (sort keys!).
- Tool list mutated mid-session (add/remove/reorder) — use tool
  search/deferred loading, which appends instead of swapping.
- Model switch mid-session (cache is per-model) — give cheap sub-tasks to
  a sub-agent on the cheaper model instead.
- Editing the system prompt mid-session — append new operator
  instructions after history instead (mid-conversation system messages
  where supported — beta, model-gated — else a clearly marked block in
  the next user turn).
- A/B variants that differ at byte 1 — fork *after* the shared prefix.

Verify with response usage fields: `cache_read_input_tokens` should
dominate `cache_creation_input_tokens` on a warm path. Cache TTL is
short (minutes); within-burst reuse is what you're engineering for.

## Cost levers, in order of leverage

1. **Model tiering.** Route by task difficulty; smallest model that
   passes evals. Haiku-class for classification/sub-agents, Sonnet-class
   default, Opus/Fable-class only where evals show the gap. Tokeniser
   efficiency differs between tiers — compare cost per *task*, not per
   token.
2. **Caching** (above): cached reads are ~10% of input price; writes a
   ~25% premium — only pay it on prefixes that get reused.
3. **Batch API**: 50% off for anything that can wait (evals, backfills,
   nightly jobs).
4. **Context diet**: paginate tool results, sub-agents for exploration,
   programmatic tool calling so intermediates never enter context,
   context editing to drop stale tool results in long sessions.
5. **Output discipline**: `max_tokens` sized to the task; effort
   parameter (where supported) lowered for mechanical work; concise
   output formats (no "explain your answer" you'll never read).

Budgeting: count tokens before sending (`count_tokens` endpoint);
record `usage` per feature and per template version; alert on cost per
task drifting, not just total spend (total spend rises with success).

## Latency levers

| Lever | Effect |
|---|---|
| Streaming | Time-to-first-token becomes the perceived latency |
| Smaller model | Often the single biggest win — and TTFT compounds in multi-call flows |
| Cache hits | Large prefix reads skip prefill compute — directly cuts TTFT |
| Fewer round trips | Parallel tool calls; programmatic tool calling for call chains |
| Thinking/effort tuning | Adaptive thinking spends only when needed; cap effort for simple paths |
| Speculative work | Pre-warm the cache with a dummy request when a session predictably starts soon |

Set client timeouts generously for long generations or use streaming —
non-streaming requests with large `max_tokens` are the classic
self-inflicted timeout.

## Worked example: agent session shape

A CCMAF-style agent with 20 turns, 15k-token system+tools, 100k of
accumulated history: without caching every turn re-pays the whole prefix;
with a stable prefix + per-turn breakpoints, each turn pays full price
only for the new tokens (~10% for everything cached). That is routinely a
5–10× input-cost reduction — which is why prefix stability is a
non-negotiable, not an optimisation.
