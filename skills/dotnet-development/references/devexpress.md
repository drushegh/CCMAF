# DevExpress components

Pragmatic guidance for building .NET apps on the **DevExpress** commercial
component suite (used in this estate). This covers component selection,
licensing/feed setup and the engineering gotchas; data-access concerns route to
`ef-core`, web styling/markup to `frontend-development`.

Version context (June 2026 — re-verify): DevExpress ships on a `vYY.x` cadence
(current ~v25.2/v26.1) and supports .NET 9/10 and Visual Studio 2026. Pin to a
specific `v` and keep all DevExpress packages on the **same version** — mixing
versions across packages is a classic break.

## Product selection

| Need | DevExpress product |
|---|---|
| Windows desktop | **WinForms** (190+ controls) or **WPF** (130+ controls) |
| Web UI (Razor/components) | **Blazor** (server/WASM) or **ASP.NET Core / MVC** |
| Cross-platform mobile | **.NET MAUI** controls |
| Reporting | **Reporting / XtraReports** (Core, Blazor, WinForms, MVC) |
| Dashboards/BI | **BI Dashboard** |
| Office docs without Office installed | **Office File API** (Spreadsheet/Word/PDF) |
| ORM (non-EF) | **XPO** (eXpress Persistent Objects) |
| Rapid line-of-business app | **XAF** (generates Blazor + WinForms UI from your model) |

The **Universal Subscription** bundles all of the above. Choose the UI platform
first (desktop vs web), then pull only the controls you need.

## Licensing and NuGet — the #1 onboarding/CI trap

There are **two distinct credentials**, both required:

1. **NuGet feed authorization key** — your personal feed URL from
   `nuget.devexpress.com`; the key embedded in the URL acts as the password
   when restoring packages.
2. **DevExpress .NET license key** — registered in the project
   (`licenses.licx` / generated licensing code). The Unified Component
   Installer wires this up automatically on a dev box; with a bare NuGet
   restore you register it manually.

For CI/build agents: configure the DevExpress feed as an authenticated package
source (feed key as a secret, never committed) **and** supply the license key —
a green local build fails on CI when only one of the two is present. Don't
commit the feed URL/key or `licenses.licx` secrets to source control.

## XPO vs EF Core

Default to **EF Core** (`ef-core`) for new work — it's the mainstream, better-
documented, team-portable choice. Reach for **XPO** only when you're already in
an XPO/XAF codebase, need its specific change-tracking/metadata model, or are
maintaining a legacy DevExpress app. Don't introduce a second ORM into an
EF Core solution without a deliberate decision.

## Performance with large data

- Bind grids/lists to data using **server mode / instant feedback** data
  sources so paging, sorting and filtering execute in the database, not by
  loading every row into memory — the difference between a snappy grid and an
  OutOfMemory on a real dataset.
- Push filtering/sorting to the query (`ef-core` / `sql-development`), not the
  control, for server-mode sources.
- Virtualise long lists; avoid unbounded `DataSource = wholeTable`.

## XtraReports and XAF notes

- **XtraReports**: design reports as versioned artefacts; bind to a view model
  or a server-side data source, parameterise rather than hard-coding filters,
  and render server-side (Core/Blazor) for web. Export to PDF via the engine,
  not screen capture.
- **XAF**: model-driven — you define business objects (EF Core or XPO) and XAF
  generates the Blazor/WinForms UI plus security, reports and validation. High
  leverage for internal LOB apps; less suited where you need pixel-level bespoke
  UI. Its security module is a genuine differentiator for role-based data access.

## Boundaries

- Data modelling/queries behind the components → `ef-core` / `sql-development`.
- Web layout, theming and accessibility of the surrounding app →
  `frontend-development` / `accessibility-development` (DevExpress themes don't
  exempt you from a WCAG check).
- Build/release pipelines that need the feed + license → `devops-development`.
