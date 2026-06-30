# Tool use — definitions, loops, server-side tools

## Tool definitions are model UX

The model chooses tools from names + descriptions alone. Quality bar:

```json
{
  "name": "crm_search_accounts",
  "description": "Search CRM accounts by name, domain or owner. Call this whenever the user asks about a customer, prospect or account that isn't already in the conversation. Returns paginated summaries; use crm_get_account for full detail.",
  "input_schema": {
    "type": "object",
    "properties": {
      "query": {"type": "string", "description": "Name, domain or owner to search for"},
      "limit": {"type": "integer", "description": "Max results (default 20)"}
    },
    "required": ["query"]
  }
}
```

- Names: `snake_case`, action-oriented, service-prefixed
  (`github_create_issue`, not `create_issue`) — assume coexistence with
  other tool sets.
- Descriptions state **when to call**, not just what it does — recent
  models call tools more conservatively, and explicit trigger conditions
  measurably improve should-call accuracy. Cross-reference sibling tools.
- Constrain inputs: `enum` for closed sets, descriptions on every
  property, only genuinely required fields in `required`.
- `tool_choice`: `auto` (default) / `any` / forced specific tool / `none`;
  add `disable_parallel_tool_use: true` only when handlers can't take
  concurrent calls.

## Runner vs manual loop

SDK tool runners (Python/TS/Java/Go/Ruby/PHP, beta) generate schemas from
typed functions and run the call→execute→result loop for you — the
default for straightforward agents. Write the **manual loop** when the
harness must gate, audit or branch:

```python
messages = [{"role": "user", "content": task}]
for _ in range(MAX_TURNS):                      # always bound the loop
    r = client.messages.create(model=MODEL, max_tokens=4096,
                               tools=tools, messages=messages)
    if r.stop_reason == "tool_use":
        messages.append({"role": "assistant", "content": r.content})
        results = []
        for block in (b for b in r.content if b.type == "tool_use"):
            out, is_err = dispatch(block.name, block.input)   # your gate/audit here
            results.append({"type": "tool_result",
                            "tool_use_id": block.id,
                            "content": out, "is_error": is_err})
        messages.append({"role": "user", "content": results})
    elif r.stop_reason == "pause_turn":          # server-side tools paused
        messages.append({"role": "assistant", "content": r.content})
        # resend as-is; the server resumes — do NOT inject a "continue" turn
    else:
        break
```

Invariants: append the **full** assistant `content` (preserves tool_use
and thinking blocks); every `tool_result` carries its `tool_use_id`; tool
errors go back as `is_error: true` with **actionable text** ("date must
be ISO 8601; you sent '13/06/2026'"), never empty strings or stack traces.

## Bash-breadth vs dedicated tools

A bash tool gives the model maximum leverage but gives your harness an
opaque string. Promote an action to a dedicated tool when the harness
needs to **gate** it (irreversible actions behind approval), **enforce
invariants** (edit rejects stale writes), **render** it (structured UI),
or **parallelise** it (read-only tools marked safe). Start broad, promote
deliberately.

## Server-side tools and scaling patterns

| Feature | Use when |
|---|---|
| Code execution (server sandbox) | Run model-written code without hosting a sandbox |
| Web search / web fetch | Post-cutoff information with citations |
| Programmatic tool calling | Many sequential calls or large intermediates — model writes a script; only final output returns to context |
| Tool search / deferred schemas | Big tool inventories — schemas load on demand and *append* (cache-safe) instead of swapping |
| Memory tool | Cross-session persistence via harness-backed file store |

Server-side tools run a server sampling loop — handle `pause_turn` as
above. For client-side standard tools (bash, text editor, computer use),
Anthropic defines the schema, you own execution and its security
(cross-ref `secure-development` for sandboxing the blast radius).

## Multi-tool hygiene

- Keep the tool surface minimal per task; overlapping tools (two ways to
  search the same data) cause dithering and wrong-tool calls.
- Pagination on anything list-shaped: respect `limit`, return
  `has_more`/cursor metadata, default 20–50 items.
- Idempotency: retries and loop re-entry can re-execute handlers — make
  writes idempotent or guard with request keys.
- Parallel tool calls are the default; if handlers share state, serialise
  in the dispatcher rather than disabling parallelism globally.
