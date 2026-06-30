# Pagination, filtering and caching

## Pagination — always

Every collection endpoint paginates. Define a default page size (e.g. 20) and
enforce a maximum (e.g. 100) so a client can't request everything.

### Cursor (keyset) — preferred for large/changing data

Stable under inserts/deletes and fast at any depth (no large `OFFSET` scan).
The cursor is an opaque token encoding the last-seen sort key.

```json
{
  "items": [{ "id": 142, "name": "..." }],
  "nextCursor": "eyJpZCI6MTQyfQ",
  "hasMore": true
}
```

```
GET /orders?limit=20&cursor=eyJpZCI6MTQyfQ
```

### Offset — simple, small/stable data only

```json
{
  "items": [],
  "page": 2,
  "pageSize": 20,
  "total": 150,
  "pages": 8
}
```

Offset is convenient and supports "jump to page N", but deep pages get slow and
results drift when rows are inserted/deleted between requests.

### Link header (RFC 8288) — RESTful alternative

```http
Link: <https://api.example.com/orders?page=3>; rel="next",
      <https://api.example.com/orders?page=1>; rel="prev",
      <https://api.example.com/orders?page=8>; rel="last"
```

Pick one approach and use it consistently across the API.

## Filtering, sorting, field selection

Use query parameters; keep names consistent and documented in the OpenAPI spec.

```
GET /orders?status=open&customerId=3        # filtering
GET /orders?sort=-createdAt,total           # sort (leading - = descending)
GET /orders?fields=id,status,total          # sparse fieldset
GET /orders?q=invoice                        # free-text search
```

- Whitelist filterable/sortable fields — don't pass user input to the query
  layer unchecked (injection; query design → `sql-development`).
- Sparse fieldsets reduce payloads without needing a new endpoint.
- Document the default sort; an unstable default sort breaks cursor pagination.

## Caching and conditional requests

Reduce load and bandwidth with HTTP caching where data tolerates it.

```http
# Response
Cache-Control: public, max-age=60
ETag: "33a64df5"

# Subsequent request
If-None-Match: "33a64df5"
# -> 304 Not Modified (empty body) if unchanged
```

- `ETag` + `If-None-Match` for read caching (304 saves the payload).
- `ETag` + `If-Match` for **optimistic concurrency** on writes: a `PUT`/`PATCH`
  with a stale `If-Match` returns `412 Precondition Failed`, preventing
  lost updates.
- `Cache-Control: no-store` for sensitive/personal responses.
- Last-Modified/`If-Modified-Since` is a weaker alternative to ETags.

## Bulk operations

When clients need many writes, offer an explicit batch endpoint with per-item
results rather than encouraging chatty loops:

```json
{
  "results": [
    { "id": "1", "status": "created" },
    { "id": null, "status": "failed", "error": "Email already exists" }
  ]
}
```

Decide and document whether a batch is all-or-nothing (transactional) or
best-effort per item.
