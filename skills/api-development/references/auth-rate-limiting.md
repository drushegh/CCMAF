# Authentication, authorisation and rate limiting

API-surface patterns. The identity-provider configuration, token validation
internals and threat model live in `azure-development` / `secure-development`;
this covers how the API *presents* auth and protects itself.

## Authentication schemes

| Scheme | Use when |
|---|---|
| **OAuth2 / OIDC bearer (JWT)** | Default for user- and app-delegated access. `Authorization: Bearer <token>`; validate issuer, audience, expiry, signature. Scopes/roles carry permissions. Entra ID on the house stack |
| **API keys** | Server-to-server or simple partner access. `X-API-Key: <key>` (a header, never the URL). Lower assurance — scope tightly, rotate, rate-limit per key |
| **mTLS** | High-assurance service-to-service / regulated integrations |

Prefer short-lived bearer tokens with refresh over long-lived static
credentials. Never put tokens or keys in query strings — they end up in logs,
history and caches.

## 401 vs 403 — get this right

- `401 Unauthorized` — **who are you?** No/invalid/expired credentials. Include
  a `WWW-Authenticate` header.
- `403 Forbidden` — **I know you, you can't do this.** Authenticated but the
  token lacks the required scope/role.
- Returning `404` to hide a resource's existence from unauthorised callers is a
  valid choice, but make it deliberate and consistent.

## Authorisation

- Enforce **least-privilege scopes/roles** per operation; check on the server
  every time — never trust the client to hide a button.
- Scope tokens to the narrowest set needed; separate read and write scopes.
- For resource ownership, verify the caller may act on *this* instance, not
  just that they hold the right scope.

## Rate limiting

Protect availability and signal limits to clients.

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
RateLimit: limit=1000, remaining=0, reset=60
```

- Return `429` with `Retry-After` when limiting.
- Surface budget on normal responses. The IETF `RateLimit`/`RateLimit-Policy`
  header fields are standardising; `X-RateLimit-Limit` / `-Remaining` /
  `-Reset` remain the widely-deployed de-facto form — pick one and document it.
- Limit per principal/API key (and optionally per IP); choose an algorithm
  (token bucket / sliding window) suited to burst tolerance.
- Distinguish throttling (`429`, retryable) from quota exhaustion (often `403`
  with a clear `problem+json` type).

## CORS (browser clients)

Only relevant for browser-based callers. Be explicit, not permissive:

- Allow specific origins, not `*`, when `Access-Control-Allow-Credentials` is
  true (the two are incompatible by spec).
- Allow only the methods and headers actually used.
- Handle the `OPTIONS` preflight; cache it with `Access-Control-Max-Age`.
- CORS is **not** a security control — it constrains browsers, not servers.
  Authn/authz still apply to every request.

## Transport and hygiene

- TLS only; redirect/refuse plaintext. HSTS at the edge.
- No secrets/PII in URLs; minimise sensitive data in responses (no over-
  exposure of fields).
- Validate and bound all input (sizes, types, enums) — injection and input
  handling taxonomy → `secure-development`.
