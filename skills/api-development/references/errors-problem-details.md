# Error responses — RFC 9457 Problem Details

Use **one** machine-readable error format across the whole API. The standard
is **RFC 9457** (Problem Details for HTTP APIs; obsoletes RFC 7807). Media type
`application/problem+json`.

## The standard shape

```json
{
  "type": "https://api.example.com/problems/insufficient-funds",
  "title": "Insufficient funds",
  "status": 403,
  "detail": "Account 12345 has a balance of 30.00, needs 50.00.",
  "instance": "/accounts/12345/transactions/abc"
}
```

Standard members (all optional, but include `type`, `title`, `status`):

- `type` — a URI identifying the problem **type** (a stable, dereferenceable
  docs URL is ideal). Defaults to `about:blank` if omitted. This is the field
  clients should branch on — not the human text.
- `title` — short, human-readable summary, stable for a given `type`.
- `status` — the HTTP status code, duplicated in the body for convenience.
- `detail` — human-readable explanation specific to this occurrence.
- `instance` — URI identifying this specific occurrence.

## Extension members

Add domain fields at the top level (RFC 9457 allows extensions). Use them for
machine-actionable detail, e.g. per-field validation errors:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Your request is not valid.",
  "status": 422,
  "errors": [
    { "field": "email", "detail": "must be a valid email address" },
    { "field": "age", "detail": "must be a positive integer" }
  ]
}
```

Keep extension names consistent across the API; document them in the OpenAPI
contract (define a reusable `Problem` schema and reference it from every error
response).

## Mapping problems to status codes

- `400` — syntactically malformed request (bad JSON, wrong type).
- `401` — missing/invalid authentication.
- `403` — authenticated but not permitted.
- `404` — resource doesn't exist (decide deliberately whether to use 404 to
  hide existence from unauthorised callers).
- `409` — conflict with current state (duplicate, version clash).
- `412` — precondition failed (stale `If-Match`/ETag).
- `422` — well-formed but semantically invalid (validation).
- `429` — rate limited (pair with `Retry-After`).
- `500/503` — server fault / temporary unavailability.

## Discipline

- **Never leak internals** — no stack traces, SQL, file paths or framework
  exception text in `detail`. Log those server-side with a correlation ID and
  return that ID in an extension (`traceId`) so support can join them.
- **Consistency over cleverness** — the same shape everywhere; clients write
  one parser. Most stacks have built-in support (ASP.NET Core
  `Results.Problem`/`ProblemDetails`, FastAPI exception handlers) — wire it up
  once; implementation detail belongs to the language skill.
- **`type` URIs are part of your contract** — don't change their meaning; treat
  a new error type as an additive change and a removed one as breaking.
