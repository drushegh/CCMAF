# MCP server development

MCP (Model Context Protocol) standardises how clients (Claude, IDEs,
agent harnesses) connect to capability servers. Spec status (June 2026 —
re-verify at modelcontextprotocol.io): stable revision **2025-11-25**; a
**2026-07-28 release candidate** (stateless protocol core, Extensions,
Tasks, MCP Apps) is announced but not final — build against stable unless
a client demands otherwise. Fetch spec pages as markdown via the site's
`.md` suffix; SDK READMEs are the binding truth for APIs.

## What to expose

| Primitive | Use for |
|---|---|
| **Tools** | Actions and queries the model invokes (the workhorse) |
| **Resources** | Addressable content the *client/user* attaches to context (files, records) |
| **Prompts** | User-invoked templates (slash-command-like), with arguments |

Design tools first. The quality measure is task completion by a model,
not API coverage symmetry: balance comprehensive endpoint coverage
(composable) with a few workflow tools where one call replaces a brittle
five-call dance. When unsure, favour coverage.

## Tool design rules

- Names `{service}_{action}_{resource}` (`jira_create_issue`); servers
  named `{service}_mcp` (Python) / `{service}-mcp-server` (Node).
- Descriptions carry when-to-call conditions and cross-references; inputs
  via Zod (TS) / Pydantic (Python) with constraints and examples.
- Paginate every list (respect `limit`, return `has_more` +
  `next_cursor`, default 20–50); support `response_format` json|markdown
  where consumers differ.
- Declare annotations honestly — `readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint` — clients gate UX on them, but they
  are hints, not security.
- Errors are model-facing instructions: specific, actionable, no
  internals. Tool failures go in the result (`isError: true`), not as
  protocol errors.
- Define `outputSchema` / return `structuredContent` where the SDK
  supports it, alongside readable text.

## Stack and transports

Recommended: **TypeScript SDK** (or Python FastMCP), and:

| Transport | Use |
|---|---|
| **stdio** | Local, single-client (desktop/CLI integrations). Never write logs to stdout — it corrupts the protocol stream; log to stderr |
| **Streamable HTTP** | Remote, multi-client. Prefer stateless JSON responses (scales on ordinary HTTP infra); SSE transport is deprecated |

```python
# FastMCP sketch (Python)
from fastmcp import FastMCP
mcp = FastMCP("kb_mcp")

@mcp.tool()
async def kb_search(query: str, limit: int = 20) -> dict:
    """Search the knowledge base by keyword. Call when the user
    asks about articles or documentation."""
    rows, more = await search(query, limit)
    return {"items": rows, "count": len(rows), "has_more": more}

if __name__ == "__main__":
    mcp.run()   # stdio by default
```

## Security (non-negotiable)

- Remote servers: OAuth 2.1; validate tokens on every request and accept
  only tokens issued *for this server* (no passthrough of upstream
  tokens).
- Local HTTP: bind `127.0.0.1`, validate the `Origin` header (DNS
  rebinding), enable the SDK's protections.
- Secrets from environment/key vault, never in code or tool output;
  validate and sanitise all inputs (path traversal, command injection)
  — schema validation is the first line, not the only one.
- Treat tool *output* as a prompt-injection vector into the calling
  agent: don't echo untrusted upstream content as if it were
  instructions; document the trust level of each data source
  (cross-ref `secure-development`).
- Rate-limit and bound result sizes server-side; a misbehaving agent
  loop is indistinguishable from a DoS.

## Testing an MCP server

1. **Protocol smoke**: MCP Inspector (`npx @modelcontextprotocol/
   inspector`) — list tools, call each happy path.
2. **Unit**: handlers as plain functions — valid/invalid inputs, error
   text quality, pagination edges.
3. **Agent-in-the-loop evals**: realistic tasks via an actual client
   (or scripted mock client); measure task completion, wrong-tool calls
   and turns-to-completion, not just "no errors". This is where naming
   and description defects show up.
4. **Security**: auth bypass attempts, oversized inputs, traversal
   payloads, Origin spoofing.

Version the server; document tools with at least one worked example
each. Breaking schema changes are major versions — agents' learned usage
breaks like any API consumer.
