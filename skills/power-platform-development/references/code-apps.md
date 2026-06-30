# Power Apps Code Apps

Standalone SPAs (React/Vue/TypeScript, Vite builds) running as first-class
Power Apps: platform identity, connectors, environment hosting — your
front end. Distinct from PCF (controls inside apps), from custom pages,
and from Power Pages code sites (external/anonymous audiences).

## The rules that prevent wasted days

- **Never write authentication code.** The Power Apps host handles Entra
  ID; the user is signed in before your code runs. No MSAL, no OAuth
  flows, no login pages.
- **Not PCF**: no `context.webAPI`, no `Xrm.WebApi`. Data access goes
  through the Power Apps client library (`@microsoft/power-apps`) and
  generated per-connector models/services.
- **Environment enablement is admin-gated** — `pac code push` fails with
  "does not allow this operation" until an admin enables code apps for
  the environment. Check this before scaffolding, not after.
- Published code is hosted on a **publicly accessible endpoint** — no
  secrets or sensitive data in the bundle; data stays behind
  authenticated connector calls.
- Cannot be embedded in model-driven apps (use web resources, custom
  pages, or PCF for that); can be embedded in Power BI via the Power Apps
  visual.

## Toolchain

```bash
npx degit github:microsoft/PowerAppsCodeApps/templates/vite my-app
cd my-app && npm install
pac auth create && pac env select --environment <env-id>
pac code init --displayname "My App"
npm run dev          # local play (open in the tenant's browser profile)
npm run build && pac code push
```

- `pac code add-data-source` / `delete-data-source` wire connectors and
  regenerate typed models/services; `power.config.json` holds the
  metadata (don't hand-edit it).
- **Transition note**: from SDK v1.0.4 the npm package ships its own CLI
  (`init`/`run`/`push`/`find-dataverse-api`) that is replacing the
  `pac code` commands — check which the project uses before mixing them.
- Dec 2025+ Chromium local-network restrictions can block localhost play;
  grant the browser permission (or policy) when local dev mysteriously
  can't connect.

## Known limitations (verify before committing a design)

- Not supported: Power Apps mobile / Power Apps for Windows, Power
  Platform Git integration, SharePoint forms integration, Power BI
  data integration (`PowerBIIntegration` function), SAS IP restriction.
- Service principals can't own code apps.
- The official starter template (microsoft/PowerAppsCodeApps) bundles
  React + Tailwind + TanStack Query + React Router + Zustand + Radix —
  a sane default stack for greenfield.

## When to choose what

| Scenario | Build |
| --- | --- |
| Internal forms-over-data, standard UX | Canvas app (faster, no code hosting concerns) |
| Internal app needing real front-end engineering (complex state, custom UI, npm ecosystem) | Code app |
| Custom control inside canvas/model-driven | PCF (dynamics-365-development) |
| External-facing site | Power Pages (power-pages-development) |

Docs: https://learn.microsoft.com/power-apps/developer/code-apps/overview ·
https://learn.microsoft.com/power-apps/developer/code-apps/architecture ·
https://learn.microsoft.com/power-platform/developer/cli/reference/code ·
https://learn.microsoft.com/power-apps/developer/code-apps/how-to/npm-quickstart
