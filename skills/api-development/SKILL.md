---
name: api-development
description: >-
  HTTP API design and engineering, framework-agnostic: resource/REST design,
  OpenAPI-first contracts, versioning and evolution, pagination/filtering,
  RFC 9457 problem+json errors, idempotency, caching, authentication
  (OAuth2/OIDC/API keys), rate limiting, and webhooks. Use whenever a task
  involves designing, reviewing or documenting a web API or its contract —
  endpoints, resource URIs, status codes, an OpenAPI/Swagger spec, API
  versioning or deprecation, error response shape, pagination, webhooks, or
  API auth. Triggers include openapi.yaml/swagger.json, "design an API",
  "REST endpoint", "version the API", "problem+json", "paginate", "webhook",
  "rate limit", "idempotency key". PROACTIVELY activate before defining any
  endpoint, URI scheme or error format. Owns API *design*; ASP.NET/FastAPI
  implementation mechanics belong to the language skill.
---

# API Development

Design discipline for HTTP APIs, independent of framework. The API is a
**contract** with consumers you don't control — design it as a deliberate,
versioned, documented interface, not a projection of your database. Default
style is **REST over JSON with an OpenAPI contract**; reach for alternatives
deliberately (table below).

Standards context (June 2026 — re-verify before asserting): **OpenAPI 3.2.0**
is the current stable spec (3.1 aligns with JSON Schema 2020-12; 4.0
"Moonwalk" is in development, not released). **RFC 9457** (Problem Details)
is the error standard — it obsoletes RFC 7807; the media type remains
`application/problem+json`. HTTP semantics are RFC 9110.

## Non-negotiables

1. **Model the domain, not the database.** Resources are nouns; the API is a
   contract that changes when behaviour changes, not when you refactor a
   table. Never expose internal schema or implementation detail.
2. **Use HTTP semantics correctly.** Verbs imply the action (`GET /orders`,
   not `GET /getOrders`); GET/PUT/DELETE are idempotent and GET is safe;
   status codes are meaningful (201+`Location` on create, 202 for accepted-
   but-async, 204 on delete, 4xx client, 5xx server).
3. **Contract-first with OpenAPI.** A reviewed, linted OpenAPI document is the
   source of truth, ideally before implementation. Generated-after-the-fact
   specs drift and lie.
4. **Errors are RFC 9457 `problem+json`.** One consistent machine-readable
   shape across the whole API — never bare strings or ad-hoc envelopes per
   endpoint.
5. **Version from day one; evolve additively.** Adding optional fields is
   non-breaking; removing/renaming/retyping is breaking and needs a new
   version + a deprecation/sunset path. Pick one versioning strategy and apply
   it everywhere.
6. **Paginate every collection.** No unbounded list endpoints. Default and
   maximum page size enforced.
7. **Secure by default.** TLS only; authenticate every non-public endpoint;
   `401` for "who are you" vs `403` for "not allowed"; least-privilege
   scopes; no secrets or PII in URLs (they land in logs).
8. **Idempotency for unsafe retries.** Support an `Idempotency-Key` on POSTs
   that create resources or move money, so a client retry can't double-act.

## Choosing the API style

| Style | Use when |
|---|---|
| **REST + JSON + OpenAPI** | Default. Resource-oriented CRUD, broad client compatibility, public/partner/government integration (OpenAPI is the expected contract) |
| **GraphQL** | Diverse clients needing to shape their own payloads; aggregating many back ends; over/under-fetching is the real pain. Cost: complexity, caching, query-depth/complexity limits, N+1 (DataLoader) |
| **gRPC** | Internal high-throughput, low-latency service-to-service; streaming; strict contracts via protobuf. Not for browsers without a proxy |
| **Async/event (webhooks, queues)** | Server-initiated notifications or long-running work — see `references/webhooks.md` |

## High-frequency pitfalls

- **Verbs in URIs / RPC-over-REST** (`/createOrder`, `/users/123/activate` as
  GET) — model state and use methods, or accept it's an action resource and
  document it.
- **Inconsistent error shapes** across endpoints — adopt `problem+json` once.
- **200 for everything** (errors in the body) — breaks clients and proxies.
- **Breaking changes shipped silently** — additive only within a version;
  signal removals with `Deprecation`/`Sunset` headers and a migration window.
- **Offset pagination on large/changing datasets** — page drift and slow deep
  pages; prefer cursor (keyset) pagination.
- **PII / API keys in query strings** — they're logged and cached; use headers
  and the body.
- **Auth confusion** — using 403 when unauthenticated, or 404 to hide
  existence without a deliberate decision.
- **No rate limiting** — expose `RateLimit` headers and return `429` with
  `Retry-After`.
- **Webhooks without signing or retries** — unsigned callbacks are forgeable;
  un-retried ones are lossy.

## Workflow for designing / reviewing an API

1. Identify resources, relationships and the operations consumers actually
   need (not the tables).
2. Draft the OpenAPI contract: URIs, methods, status codes, schemas,
   `problem+json` errors, examples. Lint it (Spectral).
3. Decide versioning, pagination, auth and rate-limit policy up front and make
   them uniform.
4. Review against the checklist in `references/openapi-contract.md` before code.
5. Implement to the contract (language skill); keep spec and code in sync.
6. Verify: contract tests, error paths, auth/authz, pagination edges.

## Reference index

Load on demand:

- `references/rest-design.md` — resources, URIs, methods, status codes, idempotency, HATEOAS, async (202)
- `references/versioning-evolution.md` — versioning strategies, breaking vs non-breaking, deprecation/sunset
- `references/pagination-filtering.md` — cursor/offset/Link pagination, filtering, sorting, sparse fieldsets, caching/ETag
- `references/errors-problem-details.md` — RFC 9457 problem+json, validation errors, status mapping
- `references/openapi-contract.md` — OpenAPI 3.1/3.2 design-first, schema, examples, linting, codegen, review checklist
- `references/auth-rate-limiting.md` — OAuth2/OIDC, API keys, scopes, 401 vs 403, rate limiting, CORS
- `references/webhooks.md` — event delivery, HMAC signing, retries/idempotency, CloudEvents

## Boundaries

- **Framework implementation** (ASP.NET Core controllers/minimal APIs, model
  binding, FastAPI, Express) → the language skill (`dotnet-development`,
  `python-development`, `typescript-development`). This skill owns the design.
- **Identity provider / OAuth server config, Entra ID app registrations** →
  `azure-development`; **auth threat model, token handling, injection** →
  `secure-development`. This skill owns the API-surface auth *patterns*.
- **API Management / gateway provisioning** (APIM, ingress) →
  `azure-development`.
- **Database/query design behind the API** → `sql-development`.
- **Pipelines that publish specs or run contract tests** → `devops-development`.
- **GraphQL/gRPC in depth** is noted at decision level here; flag a dedicated
  skill if a task needs that depth.
