# OpenAPI contracts (design-first)

The OpenAPI document is the **contract** and the source of truth. Author and
review it (ideally before implementation), lint it in CI, generate docs and
clients from it, and keep it in sync with the code.

Versions (June 2026): **OpenAPI 3.2.0** is current stable (adds `QUERY` method,
streaming media types/SSE, structured tags); **3.1** aligns with JSON Schema
2020-12 (use full JSON Schema in component schemas). 4.0 "Moonwalk" is in
development — don't target it yet.

## Minimal contract shape

```yaml
openapi: 3.1.0
info:
  title: Orders API
  version: "1.0.0"
paths:
  /orders/{orderId}:
    get:
      summary: Get an order by ID
      operationId: getOrder
      parameters:
        - name: orderId
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: The order
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Order"
        "404":
          description: Not found
          content:
            application/problem+json:
              schema:
                $ref: "#/components/schemas/Problem"
components:
  schemas:
    Order:
      type: object
      required: [id, status]
      properties:
        id: { type: string }
        status: { type: string, enum: [open, paid, cancelled] }
        total: { type: number }
    Problem:
      type: object
      properties:
        type: { type: string, format: uri }
        title: { type: string }
        status: { type: integer }
        detail: { type: string }
        instance: { type: string, format: uri }
```

Define `Problem` once and `$ref` it from every error response. Reuse schemas,
parameters and responses via `components` — don't repeat yourself across paths.

## Design-first workflow

1. Write/extend the spec for the change; add request/response **examples**
   (they drive docs quality and mock servers).
2. **Lint** it — `spectral lint openapi.yaml` (style/consistency: naming,
   missing descriptions, error coverage). Enforce a ruleset in CI.
3. Generate interactive docs (Swagger UI / Redoc) and, where useful, client
   SDKs and server stubs (`openapi-generator`).
4. Validate implementation against the contract with **contract tests** /
   schema validation in the test suite.

ASP.NET note: .NET produces OpenAPI from code via `Microsoft.AspNetCore.
OpenApi`; that's fine, but treat the emitted document as a reviewed artefact
(lint it, diff it for breaking changes) — implementation detail →
`dotnet-development`.

## Breaking-change detection

Diff the spec between versions in CI (e.g. `oasdiff`) to catch breaking changes
before release — a removed field, a newly-required parameter or a changed type
should fail the build unless it's a deliberate new major version.

## Review checklist (before implementation)

- Resources are nouns; methods/status codes used per `rest-design.md`.
- Every collection endpoint paginates; filter/sort params documented.
- Every operation lists its error responses using the shared `Problem` schema.
- Versioning strategy applied uniformly; `info.version` set.
- Auth scheme defined (`securitySchemes`) and applied to protected operations.
- Examples present for non-trivial requests/responses.
- Naming/casing consistent; no internal/DB detail leaked.
- Spec lints clean; breaking-change diff reviewed.
