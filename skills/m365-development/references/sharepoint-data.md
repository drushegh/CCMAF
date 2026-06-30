# SharePoint Online Data Access (PnPjs, REST, Graph)

## Choosing the API

| Need | Use |
|------|-----|
| SP lists/libraries/items from SPFx | PnPjs `@pnp/sp` (fluent, batching, caching) or SP REST |
| Cross-service data (users, mail, Teams, files across sites) | Graph (or `@pnp/graph`) |
| SP data from external apps/services | Graph `sites` endpoints; `Sites.Selected` for per-site app grants |
| Complex list queries SP-side | REST with OData or CAML where REST can't express it |
| Tenant/site provisioning automation | PnP PowerShell / CLI for Microsoft 365 → `powershell-development` |

Graph's `sites` surface covers lists, list items, content types, columns
and drives — prefer it for non-SPFx callers; the classic REST API offers
finer-grained SP-specific operations.

## PnPjs setup in SPFx

```typescript
import { spfi, SPFx } from "@pnp/sp";
import "@pnp/sp/webs";
import "@pnp/sp/lists";
import "@pnp/sp/items";

// onInit:
const sp = spfi().using(SPFx(this.context));

const items = await sp.web.lists
  .getByTitle("Risks")
  .items
  .select("Id", "Title", "RiskScore")
  .filter("RiskScore gt 5")
  .top(100)();
```

- Selective imports keep bundles small (side-effect imports per area).
- Batching: `sp.batched()`; caching behaviours available per-request.
- PnPjs v3+ is behaviour-based — older v2 `sp.setup()` examples are
  outdated; check the project's PnPjs major version.

## Graph site/list access (external callers)

```http
GET /v1.0/sites/{hostname}:/sites/{site-path}
GET /v1.0/sites/{site-id}/lists/{list-id}/items?expand=fields($select=Title,RiskScore)
POST /v1.0/sites/{site-id}/lists/{list-id}/items   # create item (fields object)
```

- `Sites.Selected` application permission + per-site grant (via Graph
  `permissions` endpoint or PnP) is the enterprise-preferred pattern —
  avoids tenant-wide `Sites.Read.All`/`.ReadWrite.All`.
- List item fields come wrapped: `fields` must be expanded/selected.
- Large lists: same 5,000-item view threshold realities apply to
  unindexed `$filter` columns — filter on indexed columns or use delta.

## Content types and site columns

- Define declaratively where possible; provision via PnP provisioning
  templates, Graph `contentTypes`/`columns` endpoints, or REST.
- Content type hub publishing syncs types across site collections —
  changes propagate asynchronously; don't assume immediacy.
- Avoid renaming internal field names; display names are safe to change,
  internal names are contract.

## Throttling and resilience (SP-specific)

- SharePoint throttles per user-agent + tenant: decorate non-SPFx
  callers with a descriptive `User-Agent` (ISV pattern:
  `NONISV|Company|App/Version`).
- Honour `Retry-After`; batch and `$select` to reduce calls.
- For migrations/bulk writes prefer purpose-built paths (Graph delta for
  reads, batch endpoints for writes) over per-item hammering.
