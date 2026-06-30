---
name: power-pages-development
description: >-
  Power Pages (formerly Power Apps portals) development: Liquid templating,
  portal Web API, table permissions and web roles, basic/multistep forms and
  lists, code sites (SPA), site settings, caching, and pac pages ALM. Use
  this skill whenever Power Pages or portal work is created, edited,
  reviewed, or debugged — even if the user says "portal", "ADX", or
  "external site". Triggers include: Liquid tags or web templates,
  /_api calls from a portal page, table permission or web role
  configuration, entity forms / basic forms / multistep forms / lists,
  pac pages download/upload, site settings (Webapi/*, Authentication/*),
  stale-content/cache complaints, Entra External ID sign-in, or React/Vue
  SPA code sites on Power Pages.
---

# Power Pages Development

Consolidated Power Pages engineering for agents, grounded in Microsoft Learn
and Microsoft's official power-platform-skills plugin. Covers both site
models: **classic configured sites** (Liquid, web templates, forms, lists)
and **code sites** (SPA, GA since Jan 2026). Dataverse plug-ins, PCF, and
solution mechanics belong to dynamics-365-development; canvas apps, Power
Automate, and broader ALM belong to power-platform-development.

## The Security Model Is Server-Side — Everything Else Is Decoration

The only access control that counts is **table permissions + web roles**
(plus page permissions and column permissions). Liquid `has_role` checks,
hidden buttons, and client-side role guards are UX conveniences an attacker
bypasses with one direct `/_api` call. Every data exposure decision is a
table-permission decision first. Corollaries:

- **No table permission, no data** — the Web API, lists, forms, and the
  `fetchxml` Liquid tag all enforce table permissions.
- **Scope discipline**: default to **Contact** scope for user-owned data;
  **Parent** for child tables; **Global is a last resort** for genuinely
  public read-only reference data. Never widen a Parent scope to
  Contact/Account without direct evidence on the child table itself.
- A site has **at most one anonymous and one authenticated** web role;
  custom roles are assigned to contacts.

## XSS Non-Negotiables (Liquid)

Always pipe untrusted data through `| escape`. Since release 9.3.8.x the
`user` and `request` objects are HTML-encoded by default
(`Site/EnableDefaultHtmlEncoding`) — do not disable it, and still escape
everything else (`params`, entity attributes, snippets rendered into
attributes). Treat the `liquid` filter (renders a string *as* Liquid) as
content-author-only — never apply it to user-supplied values.

## The Environment Confirmation Rule (MANDATORY)

Before the FIRST operation that touches a specific environment — `pac pages
upload`, site setting changes, table permission writes:

1. State the target environment/site (`pac auth list`, `pac pages list`).
2. Verify the active profile matches (`pac org who`).
3. Get explicit confirmation before proceeding.

Once confirmed for a session+environment, don't re-ask per operation.

## Caching Will Eat Your Afternoon

Server-side cache serves all pages. Configuration changes (site settings,
web templates, snippets) auto-invalidate within a **15-minute SLA**; data
changes made *through the site* invalidate that table's cache instantly,
but changes made by plug-ins/workflows or directly in Dataverse may take up
to 15 minutes. Before debugging "my change isn't showing": clear the cache
via design studio **Preview** or `{site-url}/_services/about` → **Clear
cache** (requires a web role with all website access permissions). Site
settings must be **Active** to take effect. Don't design features that
require sub-15-minute reflection of out-of-band Dataverse writes.

## Web API Quick Rules

- URL uses the **EntitySetName** (`/_api/accounts`); site settings use the
  **logical name** (`Webapi/account/enabled`). Mixing these up is the #1
  config failure.
- `Webapi/{table}/fields` is **mandatory** — missing it throws "No fields
  defined for this entity". Value: `*` or a comma-separated column list.
- No Bearer token. Session cookies authenticate; every mutating request
  needs a `__RequestVerificationToken` header fetched from
  `/_layout/tokenhtml`. Full client pattern: references/web-api.md.

## Site Model Choice

- **Classic configured site** (design studio + Portal Management app):
  metadata-driven pages, Liquid, basic/multistep forms, lists. Right
  default for content + forms-over-Dataverse portals.
- **Code site / SPA** (React, Vue, Angular, Astro — static builds only, no
  SSR): full front-end control, Web API for all data, no out-of-box forms
  or lists, limited SEO. Right for highly interactive UX. Same server-side
  security model applies. See references/code-sites.md.

## Agent Workflow Rules

- Inspect before changing: `pac pages list -v` (site + data model
  version), then `pac pages download` and read the YAML/HTML locally.
- Always pass `--modelVersion` (1 = standard `adx_`, 2 = enhanced `mspp_`)
  on download/upload; check which the site uses first.
- After any deployment or configuration upload, clear the server-side
  cache and verify on the live site, not just in the studio.
- Propose table permissions as a reviewable plan (table, role, scope, CRUD
  + append/appendto, evidence) before creating any. Audit method:
  references/security.md.
- Test with a user in each web role, including anonymous — most portal
  bugs are permission bugs wearing a UI costume.

## References

| File | Load when |
| --- | --- |
| references/liquid.md | Liquid objects/tags/filters, web templates, fetchxml |
| references/web-api.md | /_api CRUD, site settings, CSRF client pattern |
| references/security.md | Table permissions, web roles, page permissions, authentication |
| references/forms-lists.md | Basic forms, multistep forms, lists, form JavaScript |
| references/code-sites.md | SPA code sites, pac upload-code-site, auth/user context |
| references/alm-deployment.md | pac pages CLI, deployment profiles, enhanced data model, pipelines, cache ops |
