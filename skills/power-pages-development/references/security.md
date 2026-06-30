# Power Pages Security: Permissions, Roles, Authentication

The enforcement chain: **authentication** identifies a contact → the
contact's **web roles** carry **table permissions** (record-level),
**column permissions** (field-level), **page permissions** (content-level)
→ every data surface (Web API, lists, forms, `fetchxml`, `entities`)
enforces them server-side. Client-side checks are UX only.

## Web roles

- At most **one anonymous** (`anonymoususersrole`) and **one
  authenticated** (`authenticatedusersrole`) role per site; every signed-in
  contact implicitly holds the authenticated role.
- Custom roles are explicitly associated to contacts (or accounts) and are
  the unit for differentiated access ("Case Managers", "Partners").
- `/_services/about` cache controls require a role holding **all website
  access permissions** — keep that role tight.

## Table permissions

Each permission: table + access type (scope) + privilege flags + web
role(s). Scopes (option set values in parentheses):

| Scope | Meaning | Use |
| --- | --- | --- |
| Global (756150000) | All records | **Last resort** — public read-only reference data |
| Contact (756150001) | Records linked to the signed-in contact via a relationship | **Default** for user-owned data |
| Account (756150002) | Records linked to the contact's parent account | Org-shared access |
| Parent (756150003) | Records reachable through a parent table permission + relationship | Child tables (order lines under orders) |
| Self (756150004) | The contact's own record | Profile pages |

Privileges: read, create, write, delete, **append** (other records may
link TO this table), **appendto** (this table's lookups may link to other
records). Two rules cover 90% of confusion:

- Setting a lookup on table A pointing at table B requires **appendto on
  A** and **append on B**.
- File/image uploads are PATCH ⇒ **write**; `$expand`-ed tables need their
  own **read**.

### Permission audit method (from Microsoft's official plugin)

When proposing or reviewing permissions, work per table with **evidence**:

1. Why does this table need permissions? (direct API target, `$expand`
   target, lookup target, or speculative — if speculative, leave it out.)
2. Which roles? Anonymous only if genuinely accessed pre-auth.
3. Scope: pick the **most restrictive that fits the code evidence**
   (contact-ID filters ⇒ Contact; child-via-parent access ⇒ Parent; no
   user filter on public data ⇒ Global, flagged).
   Never replace a Parent-scope permission with Contact/Account unless the
   child table has its own direct contact/account lookup, the relationship
   exists, and the business rule grants access on the child's own linkage.
4. Each CRUD/append flag `true` only with a found code pattern; default
   `false`.
5. Cross-check: append/appendto pairs consistent; every `$expand` covered
   by read; every Parent permission's parent exists; **merge identical
   permission tuples across roles into one permission with multiple
   roles** rather than duplicating per role.

Record the result as a reviewable table (table, role, scope, flags,
evidence) and get sign-off before creating anything.

## Column permissions

Column permission profiles restrict specific columns beyond the table
permission — use for sensitive fields (e.g. PPSN-class data) exposed on
tables that otherwise need broad read.

## Page permissions

Web page access control rules restrict page/content visibility by web
role, and "Restrict Read" inherits down the page tree. Use for protecting
authored content; they do not protect data reached via API — that's table
permissions.

## Authentication

Identity providers, configured via site settings
(`Authentication/<Protocol>/<Provider>/<Setting>`) or the design studio:

| Provider | Use when |
| --- | --- |
| **Microsoft Entra External ID** (OIDC, `ciamlogin.com` authority) | Recommended for customer-facing sites with self-service sign-up. Not the same thing as "Microsoft account" social login |
| **Microsoft Entra ID** | Internal/employee or B2B sites; site's parent tenant is auto-configured |
| Generic OIDC / SAML 2.0 / WS-Federation | Okta, Auth0, ADFS, etc. |
| Microsoft / Google / Facebook | Consumer social sign-in |
| Local authentication | Username/password in Dataverse — **not recommended**; legacy only |

Practical notes:

- Sign-in creates/binds a **contact** record. Claim-to-column mapping via
  `RegistrationClaimsMapping`; mind the email claim difference — workforce
  Entra ID emits `upn`, External ID and most OIDC providers emit `email`.
- Authentication setting changes can take minutes (server cache); restart
  the site or clear cache for immediate effect.
- For OIDC sign-out, prefer `RPInitiatedLogout=true` and set an explicit
  `PostLogoutRedirectUri` — without it users get stranded on the provider's
  logout page. `ExternalLogoutEnabled` is the legacy mechanism for
  WS-Fed/older providers.
- A site in **private** visibility mode requires Entra authentication —
  make the site public before disabling Entra auth, or you lock everyone
  out.

## Hardening checklist

- HTTP headers, CSP, CORS, cookie flags: Security workspace → Advanced
  settings (preview), or site settings via Portal Management.
- Run the built-in **security scan** (Security workspace) and the VS Code
  extension's **CodeQL screening** over downloaded site code.
- Front the site with **Azure Front Door / WAF** for edge caching and
  OWASP protection on production public sites.
- Review every Global-scope and every anonymous-role permission at each
  release; they are the portal equivalent of a public S3 bucket.

Docs: https://learn.microsoft.com/power-pages/security/power-pages-security ·
https://learn.microsoft.com/power-pages/security/table-permissions ·
https://learn.microsoft.com/power-pages/security/create-web-roles ·
https://learn.microsoft.com/power-pages/security/authentication/configure-site
