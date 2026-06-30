# REST resource design

## Resources and URIs

Organise the API around **resources** (business nouns), with URIs that map to
entities and collections. Let HTTP methods carry the verb.

```
GET    /orders            # collection
POST   /orders            # create -> 201 + Location: /orders/123
GET    /orders/123        # item
PUT    /orders/123        # full replace (idempotent)
PATCH  /orders/123        # partial update
DELETE /orders/123        # remove
GET    /customers/3/orders  # relationship (shallow nesting)
```

- Plural nouns for collections (`/orders`, not `/order` or `/getOrders`).
- Keep nesting shallow (max ~2 levels). For deep relations, promote to a
  top-level resource: `/order-items/{id}/reviews`, not
  `/orders/{o}/items/{i}/reviews`.
- Consistent casing (kebab-case paths, the chosen case for JSON fields) across
  the whole surface.
- Don't mirror the database. The URI models the domain contract; it should
  change when behaviour changes, not when a table is refactored.

## HTTP methods and semantics (RFC 9110)

| Method | Purpose | Safe | Idempotent |
|---|---|---|---|
| GET | Retrieve | yes | yes |
| POST | Create / non-idempotent action | no | no |
| PUT | Create-or-replace at a known URI | no | yes |
| PATCH | Partial update | no | no* |
| DELETE | Remove | no | yes |

*PATCH is not inherently idempotent; a JSON Merge Patch (RFC 7396) usually is,
a JSON Patch (RFC 6902) with array ops may not be.

## Status codes that matter

- `200 OK` — successful GET/PATCH/PUT with a body.
- `201 Created` — POST created a resource; include a `Location` header.
- `202 Accepted` — accepted for **async** processing; return a status URL the
  client can poll (Asynchronous Request-Reply pattern).
- `204 No Content` — success with no body (typical DELETE).
- `400` malformed, `401` unauthenticated, `403` authenticated-but-forbidden,
  `404` absent, `409` state conflict, `412` precondition failed (ETag),
  `422` semantic/validation failure, `429` rate limited.
- `5xx` for server faults only — never for client mistakes.

## Idempotency for unsafe operations

`PUT` and `DELETE` are idempotent by definition. For `POST` that creates a
resource or has side effects (payments, orders), accept a client-supplied key
so a retry is safe:

```http
POST /orders
Idempotency-Key: 9f1c7e2a-...-keyper-client-attempt

# First call: process, store (key -> response). Retry with same key:
# return the stored response, do NOT act again.
```

Scope keys per endpoint + authenticated principal; expire them after a sensible
window (e.g. 24h).

## Async (long-running) operations

Return `202 Accepted` immediately with a way to track progress:

```http
HTTP/1.1 202 Accepted
Location: /operations/abc123
```

The client polls `GET /operations/abc123` (returns status, and on completion a
link to the created resource). Don't block the request thread on slow work.

## HATEOAS — pragmatically

Hypermedia links let clients navigate without hard-coding URIs. There's no
universal standard, so it's optional and team-decided; if you adopt it, be
consistent (a `links`/`_links` block with `rel`, `href`, `method`). Most
internal and many partner APIs ship without full HATEOAS — that's a legitimate
choice. What is *not* optional is consistency.

## Content negotiation

Honour `Accept`; default to JSON. Return `406 Not Acceptable` only when you
genuinely can't satisfy a requested type. Set `Content-Type` accurately
(including `application/problem+json` for errors). Keep field naming consistent
(pick `camelCase` or `snake_case` and never mix).
