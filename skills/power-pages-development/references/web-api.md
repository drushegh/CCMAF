# Power Pages (Portals) Web API

Client-side CRUD against Dataverse from portal pages: `/_api/<EntitySetName>`
(e.g. `/_api/accounts`). Distinct from the Dataverse Web API
(`/api/data/v9.2/...`) — the portals API runs in the user's session,
enforces **table permissions via web roles** plus optional **column
permissions**, and needs no OAuth token.

## Enabling: site settings (per table)

Use the table **logical name** here (the URL uses EntitySetName):

| Setting | Value |
| --- | --- |
| `Webapi/<table>/enabled` | `true` (default false) |
| `Webapi/<table>/fields` | **Mandatory.** `*` or `attr1,attr2,attr3` — columns modifiable via the API. Missing ⇒ "No fields defined for this entity" |
| `Webapi/error/innererror` | `true` during development for detailed errors |
| `Webapi/<table>/disableodatafilter` | escape hatch for OData filter issues (9.4.10.74+) |

Site settings must be **Active**, and the server-side cache may need
clearing before they bite. The table also needs a table permission for the
calling user's web role — settings expose the API, permissions grant data.

## Authentication: cookies + CSRF, no Bearer

The user's session cookie authenticates the call. Every **mutating**
request (POST/PATCH/DELETE) must carry a `__RequestVerificationToken`
header. Canonical client pattern (from Microsoft's official plugin):

```javascript
let cachedToken = null;

async function getAntiForgeryToken() {
  if (cachedToken) return cachedToken;
  const res = await fetch('/_layout/tokenhtml');
  const html = await res.text();
  const m = html.match(/value="([^"]+)"/);
  cachedToken = m ? m[1] : '';
  return cachedToken;
}

async function portalFetch(url, options = {}) {
  const headers = {
    __RequestVerificationToken: await getAntiForgeryToken(),
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
    ...options.headers,
  };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) throw new Error('Session expired - sign in again.');
  return response;
}
```

Retry rules that hold up in production:

- **403 with error code `90040107`** = anti-forgery token expired →
  invalidate the cached token, re-fetch, retry. Any other 403 is a real
  permission denial — do not retry.
- **401** = session expired → never retry; prompt re-authentication.
- **429 / 5xx** = transient → exponential backoff, capped retries.

## Operations

```text
GET    /_api/accounts?$select=name,telephone1&$filter=statecode eq 0&$top=10
GET    /_api/accounts(<guid>)?$select=name&$expand=primarycontactid($select=fullname)
POST   /_api/accounts            body: {"name":"Contoso"}
PATCH  /_api/accounts(<guid>)    body: {"telephone1":"01..."}
DELETE /_api/accounts(<guid>)
```

- Created record ID comes back in the `OData-EntityId`/`Location` header —
  parse the GUID from it; the body may be empty unless
  `Prefer: return=representation` is honoured.
- Lookups via `@odata.bind`:
  `{"primarycontactid@odata.bind": "/contacts(<guid>)"}` — requires
  append/appendto permissions (see security.md).
- `$expand`-ed tables need their own **read** table permission.
- File/image column uploads use PATCH ⇒ require **write** permission.
- Formatted values arrive via the `Prefer` annotations header as
  `field@OData.Community.Display.V1.FormattedValue`.

## Error handling

Errors follow `{"error": {"code": "0x...", "message": "..."}}`. Frequent
codes: `0x80048408` privilege check failed (table permission gap),
`0x80060888` entity already exists, `0x80040237` duplicate key. With
`Webapi/error/innererror` enabled you get stack-level detail — turn it off
in production.

## Design guidance

- Centralise the client (token cache + retry) in one module; per-table
  services on top. Don't scatter raw `fetch` calls.
- Anonymous users can call the API only if the anonymous web role holds a
  table permission — treat any Global-scope anonymous permission as a
  security review item.
- An audit-trail contact ID accompanies requests (null for anonymous);
  activity logging surfaces in the Microsoft 365 audit log if enabled.
- For logic that must not run client-side (secrets, validation,
  third-party calls), prefer a server-side route: Power Automate flow,
  Dataverse plug-in/custom API surfaced through a permitted table, or —
  on code sites — server logic endpoints (see code-sites.md).

Docs: https://learn.microsoft.com/power-pages/configure/web-api-overview ·
https://learn.microsoft.com/power-pages/configure/webapi-how-to
