# Versioning and evolution

Plan for change from the first release. The goal is to keep existing consumers
working while letting new ones adopt new features.

## Non-breaking vs breaking

**Non-breaking (additive — no new version needed):**

- Adding a new optional field to a response.
- Adding a new optional request parameter with a safe default.
- Adding a new endpoint, resource or enum value the client can ignore.

**Breaking (needs a new version):**

- Removing or renaming a field; changing its type, units or meaning.
- Making an optional request field required; tightening validation.
- Changing status codes, error semantics, or the structure of a resource.
- Changing default behaviour clients implicitly rely on.

Design responses so unknown fields are ignored by clients (tolerant reader),
which makes additive change safe.

## Versioning strategies

| Strategy | Example | Trade-off |
|---|---|---|
| **URI** | `/v1/orders`, `/v2/orders` | Simplest, explicit, easy to route and test, cache-friendly. Purists dislike that one resource gets multiple URIs; complicates HATEOAS links |
| **Header (custom)** | `Api-Version: 2` | Clean URLs; less visible, harder to test/discover, more routing logic |
| **Media type** | `Accept: application/vnd.contoso.v2+json` | Most "correct" REST, works well with HATEOAS; least obvious, more server logic, cache duplication |
| **Query string** | `/orders?api-version=2` | Easy to test; an optional param can be forgotten; some proxies don't cache query-string URIs |
| **None** | — | Fine for internal-only APIs where you control all clients and only add additively |

**Default recommendation:** **URI versioning** for public/partner APIs — it's
the most explicit and the easiest for consumers (and evaluators) to reason
about. Version at a major-version granularity (`v1`, `v2`), not per minor
change; additive changes stay within a version. Microsoft's REST API
guidelines and the `Asp.Versioning` library both support this cleanly on the
house stack (implementation detail → `dotnet-development`).

## Deprecation and sunset

Don't break consumers without warning. When a version or endpoint is on the
way out:

```http
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sat, 31 Jan 2026 23:59:59 GMT
Link: <https://api.example.com/docs/migrate-v2>; rel="deprecation"
```

- `Deprecation` (RFC 9745) signals the resource is deprecated; `Sunset`
  (RFC 8594) gives the date it stops working.
- Publish a migration guide and a realistic window (months, not days, for
  partner/government consumers).
- Track usage of deprecated versions so you can chase remaining callers before
  removal.

## Practical policy

State, per API: the versioning scheme, how long old major versions are
supported, what counts as breaking, and the deprecation process. Putting this
in the API's documentation is often a scored requirement in enterprise integrations.
