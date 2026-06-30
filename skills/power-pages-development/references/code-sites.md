# Code Sites (Single-Page Applications)

GA since January 2026. Bring-your-own front end deployed into a Power
Pages site: **React, Vue, Angular, or Astro** with static builds — Vite/
Angular CLI output. **Server-rendered frameworks (Next.js, Nuxt, Remix,
SvelteKit) are not supported.** Platform security (table permissions, web
roles, site visibility, governance) applies unchanged.

## What you give up vs classic

- No out-of-box lists, basic forms, or Liquid — all data via the Web API
  (see web-api.md), all UI hand-built.
- Limited SEO (client-side rendering).
- Git integration stores **compiled output**, not source — keep the real
  source in your own repo with CI.
- No built-in profile page: set site setting
  `Authentication/Registration/ProfileRedirectEnabled = false` or
  post-login redirects 404 on `/profile`.

## Project shape and deployment

`powerpages.config.json` at the project root marks a code site.

```bash
pac pages download-code-site --path ./src --webSiteId <guid>
# build with your toolchain (npm run build)
pac pages upload-code-site --rootPath . --compiledPath ./dist --siteName "My Site"
```

Angular's compiled path is `dist/<project>/browser`; React/Vue/Astro use
`dist`. Same environment-confirmation discipline as any deployment:
`pac org who` before upload.

## User context and auth

Authenticated user info is exposed on the global portal object:

```javascript
const user = window["Microsoft"]?.Dynamic365?.Portal?.User;
const isAuthenticated = !!user?.userName;   // empty for anonymous
const roles = user?.userRoles ?? [];        // web role names
```

- Sign-in/out are server round-trips: `/Account/Login/ExternalLogin`
  (external providers, with `returnUrl`) or `/Account/Login/Login`
  (local). SPAs link/redirect to these — no token dance in the client.
- Role checks in components (`hasRole`, route guards) are **UX only**;
  enforcement is table permissions on the Web API. Build both: guards for
  experience, permissions for security.
- Multiple providers configure exactly as on classic sites (security.md);
  workforce Entra ID can derive its authority from the site's tenant,
  Entra External ID needs its explicit `ciamlogin.com` authority.

## Data layer pattern

One shared API client module (anti-forgery token cache + retry: full
pattern in web-api.md), then per-table typed services, then
framework-specific bindings (React hooks / Vue composables / Angular
services). Microsoft's official plugin generates exactly this shape —
follow it for consistency:

```text
src/shared/powerPagesApi.ts      // token + fetch wrapper
src/types/incident.ts            // entity types + mappers
src/services/incidentService.ts  // CRUD per table
src/hooks/useIncidents.ts        // framework binding
```

## Server-side logic

For secrets, validation that must not be bypassable, or third-party API
calls, code sites support server logic endpoints (JavaScript executed
server-side, with environment-variable/Key Vault-backed secrets) and
Power Automate cloud-flow integration. Decision rule: client Web API for
plain CRUD the user is permitted to do; server logic/flows for anything
involving secrets, elevation, or external systems.

## Tooling

- Official **Power Pages plugin** for Claude Code / GitHub Copilot CLI
  (`microsoft/power-platform-skills`, plugins/power-pages) automates
  create-site → datamodel → webapi → auth → webroles → deploy with
  review gates. Use it on greenfield code-site work rather than
  hand-rolling.
- No built-in unit/integration test harness — test locally/CI like any
  SPA. Playwright against a dev site covers the portal-specific parts
  (auth, permissions).

Docs: https://learn.microsoft.com/power-pages/configure/create-code-sites ·
https://learn.microsoft.com/power-pages/configure/create-code-site-using-claude-code
