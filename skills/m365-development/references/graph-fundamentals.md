# Microsoft Graph Fundamentals

Base URL `https://graph.microsoft.com/v1.0/` (production); `/beta` is
preview-only. Graph Explorer (https://developer.microsoft.com/graph/
graph-explorer) for live testing; permissions reference at
https://learn.microsoft.com/graph/permissions-reference.

## Authentication decision tree

| Scenario | Flow | Permission type |
|----------|------|-----------------|
| Daemon/background service | Client credentials | Application |
| API acting for signed-in user | On-Behalf-Of (OBO) | Delegated |
| Azure-hosted app | Managed identity (`DefaultAzureCredential`) | Application |
| CLI / local script | Device code / interactive browser | Delegated |
| SPA (browser only) | Auth code + PKCE | Delegated |

Application permissions require admin consent; delegated permissions are
bounded by both the app grant AND the user's own access. 403s with valid
tokens are usually a delegated-vs-application mismatch.

## OData query parameters

`$select` (always use), `$filter`, `$search` (needs quotes:
`$search="displayName:Smith"`), `$orderby`, `$top`, `$skip`, `$count`,
`$expand`. Filter operators: `eq ne gt ge lt le and or not`,
`startsWith endsWith contains`, collection ops
`any/all` (`assignedLicenses/any(x:x/skuId eq '<guid>')`).

**Advanced (Entra directory) queries** — e.g. `$filter` on
`assignedLicenses/$count`, `endsWith`, `$search` on users/groups —
require BOTH the `ConsistencyLevel: eventual` header and `$count=true`.

## Pagination

Responses may include `@odata.nextLink`; follow it until absent. `$top`
controls page size (max varies, typically ≤999). SDKs provide
`PageIterator` — prefer it over manual loops.

## Batching

`POST /$batch` with up to 20 independent requests, each with an `id`.
Responses are unordered — correlate by `id`. Individual sub-requests can
fail (each carries its own status) — handle partial failure. Use for
dashboard-style fan-out reads.

## Delta queries (incremental sync)

First call `GET /<resource>/delta` → full set + `@odata.deltaLink`;
subsequent calls with the deltaLink return only changes. Supported on
users, groups, messages, events, Teams channels and more. Persist the
deltaLink durably between runs. A lost deltaLink means full re-sync.

## Change notifications (webhooks)

`POST /subscriptions` with `notificationUrl` (HTTPS):

- Creation handshake: echo the `validationToken` back as plain text 200.
- Subscriptions expire (mail/calendar typically 1–3 days; varies by
  resource) — renew before `expirationDateTime`.
- Implement `lifecycleNotificationUrl` to handle missed events and
  reauthorisation prompts.
- Need payload contents? "Change notifications with resource data"
  requires certificate-based encryption setup; default notifications
  carry only resource references (you call back for data).

## Throttling

429 (and some 503) responses carry `Retry-After` — honour it with
exponential backoff. Limits are per app + tenant + resource type. SDK
middleware retries automatically; don't disable it. Reduce pressure
with `$select`, delta queries, batching, and caching.

## Error handling expectations

- 401: token invalid/expired — re-acquire, don't retry blindly.
- 403: permission type/scope/conditional access — inspect
  `error.code` (`Authorization_RequestDenied` etc.).
- 404 on a known-good ID: check licence (e.g. no mailbox), tenant
  boundary, or eventual consistency on recently created objects.
- Log `request-id` + `client-request-id` headers for Microsoft support.
