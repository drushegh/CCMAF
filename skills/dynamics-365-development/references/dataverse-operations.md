# Dataverse Operations

Distilled from Microsoft's official dataverse-skills plugin — the rules
that keep agents on-rails when querying and shaping Dataverse.

## Tool Hierarchy

**MCP tools (if connected) → official SDK → raw Web API — in that
order.** Improvised raw HTTP for operations the SDK supports is the #1
off-rails failure. Raw Web API is legitimately needed only for the gaps:
forms, views, global option sets, N:N `$ref`/`$expand`, `$apply`
aggregation, and unbound actions.

Auth is always the documented pattern (`pac auth create`, environment
service-principal config) — never parsed token caches, hand-rolled MSAL
flows, or hardcoded tokens.

## Casing — the 400-error generator

| Context | Casing |
|---|---|
| `$select`, `$filter`, `$orderby` | lowercase logical names (`contoso_name`) |
| `$expand`, `@odata.bind` | **case-sensitive Schema/Navigation names** (`contoso_AccountId@odata.bind`) |

`/* wrong */ "contoso_accountid@odata.bind"` silently 400s. When unsure,
check `$metadata` — don't guess.

## Querying

```http
GET [org]/api/data/v9.2/accounts?$select=name,creditlimit
    &$filter=statecode eq 0 and contains(name,'contoso')
    &$orderby=name&$top=50
```

- Always `$select` — unselected queries drag every column and memo over
  the wire (and through API limits).
- Aggregation: single-table → `$apply` server-side; never pull all
  records to aggregate client-side.
- Paging via `@odata.nextLink` / `Prefer: odata.maxpagesize` — iterate,
  don't `$top=5000` and hope.
- FetchXML remains first-class (views, reports, complex link-entity
  queries); OData for app code; pick one per query, not hybrids.
- Lookups format as `_<name>_value` in results; expand for related
  columns rather than N+1 retrieves.

## Data Operations

- Bulk writes via the SDK's batch-capable operations (e.g.
  `CreateMultiple`/`UpdateMultiple` family) — not record-at-a-time loops,
  and (from app code) not raw per-record POSTs. *(Inside plug-ins:
  neither — see plugins.md.)*
- Respect **service protection limits** (429s with `Retry-After`): honour
  the header, back off, and design imports to stay under entitlement.
- `Upsert` for integration-style idempotent writes keyed on alternate
  keys; define alternate keys for any external-system correlation.

## Metadata

- Tables/columns/relationships created programmatically follow the same
  publisher-prefix discipline (below) and land in an explicit solution —
  use the `MSCRM.SolutionName` header on Web API metadata creates, then
  **verify** (`pac solution list-components`): a typo'd header silently
  dumps components into the Default solution.
- Choice columns: prefer global option sets for reused choice lists.
- Schema changes are forever-ish — renames don't change logical names;
  design names before creating.

## Publisher Prefix Discipline

Never `new_`. Discovery flow before creating anything:

1. Query existing publishers (exclude Microsoft defaults).
2. Show them and **ask which to use** (or confirm creating one — 2–8
   lowercase chars, meaningful to the org).
3. The prefix is permanent on every component created with it; one
   publisher serves many solutions; never mix prefixes in a solution.

## Environment Safety (restating because it's the big one)

`pac org who` + explicit user confirmation of the target URL before the
first mutating operation of a session. PAC profile state, `.env`
contents, and memory of previous sessions are all unreliable indicators
of *current intent*.
