# SPFx Development (Web Parts and Extensions)

Source: sudharsank/spfx-enterprise-skills (saved in Reference skills —
14 specialist skills incl. Heft toolchain, theming, a11y, extensions) +
SPFx release notes on MS Learn.

## Toolchain and versions (check before advising)

- SPFx versions pin Node and tooling. v1.21 (Apr 2025): Node 22 only,
  TypeScript 5.x, gulp. **v1.22 (Dec 2025): Heft-based toolchain replaces
  gulp for new projects** (webpack remains the bundler underneath);
  monthly minor releases since Jan 2026 clear npm-audit noise from the
  dev-only toolchain. v1.23 adds list view command set capabilities and a
  preview CLI for SPFx.
- Identify a project's version from `.yo-rc.json` and `package.json`
  before giving toolchain advice; gulp guidance is wrong for 1.22+
  projects and vice versa.
- Scaffold: `npm install @microsoft/generator-sharepoint@latest --global`
  then Yeoman (`yo @microsoft/sharepoint`). Yeoman generator ≥1.13
  targets SharePoint Online only.
- Upgrades: use CLI for Microsoft 365 `spfx project upgrade` for
  step-by-step migration guidance; gulp→Heft migration has a dedicated
  MS Learn article.

## Architecture standards

- Web parts and extensions are **thin shells**: logic in `services/`
  (data access, domain), views in `components/` (pure React),
  reusable state in `hooks/`.
- Typed contracts for all external data (interfaces per entity).
- No static singletons bound to web part instances — pass context or
  services via props/React context (multiple instances per page share
  module state otherwise).
- Keep API contracts stable; scoped, reversible changes; test updates
  for changed logic paths.

## Data access inside SPFx

- `MSGraphClientV3` (from `@microsoft/sp-http`) for Graph;
  `AadHttpClient` for custom Entra-protected APIs — both ride the
  SharePoint Online client extensibility principal (admin approves
  scopes via API access page in the SP admin centre).
- PnPjs (`@pnp/sp`, `@pnp/graph`) for fluent SP/Graph access with
  batching and caching — see `sharepoint-data.md`.
- Web API permissions requested in `package-solution.json`
  (`webApiPermissionRequests`) — least privilege; each entry needs
  tenant admin approval.

## Component types

| Type | Use |
|------|-----|
| Web part | Page building block; also Teams tabs and Viva Connections cards (`supportedHosts`) |
| Application customizer | Header/footer/global script per site |
| Field customizer | Column rendering in lists |
| List view command set | Toolbar/context menu actions (extended in v1.23) |
| Form customizer | Custom list forms |
| Adaptive Card Extension (ACE) | Viva Connections dashboard cards |

## Performance and UX rules

- Bundle size: externalise shared libraries, audit with the bundle
  analyzer; lazy-load heavy components; avoid bundling Fluent UI twice.
- Theme awareness: consume the theme tokens (`ThemeProvider`/CSS custom
  properties) rather than hardcoding colours; respect section
  backgrounds.
- Accessibility: keyboard operability and ARIA on custom controls;
  property pane controls included. Detailed a11y standards →
  `accessibility-development` (sibling skill) once available.
- Cache where data tolerates it (PnPjs caching, sessionStorage) — page
  loads multiply web part renders.

## Packaging and deployment

- `package-solution.json` drives the `.sppkg`; deploy to the tenant or
  site collection app catalogue; `skipFeatureDeployment: true` for
  tenant-wide availability without per-site install.
- Pre-release validation: serve against a real SPO workbench, run the
  production bundle (`--ship`), and confirm permission requests appear
  correctly in the admin centre.
- CI/CD for SPFx → `devops-development` (sibling skill).
