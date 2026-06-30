# Modules and the Gallery

## PSResourceGet (the current package manager)

`Microsoft.PowerShell.PSResourceGet` replaces PowerShellGet/
PackageManagement: `Find-PSResource`, `Install-PSResource`,
`Update-PSResource`, `Publish-PSResource`. Faster, NuGet v3, and the
one to standardise on for PS7 estates (legacy `Install-Module` still
works via compatibility).

- Pin versions in automation: `Install-PSResource Az -Version 14.x` —
  unpinned module drift breaks pipelines.
- `#Requires -Modules @{ ModuleName='X'; ModuleVersion='Y' }` makes the
  dependency explicit and fail-fast.
- Private feeds (Azure Artifacts) for internal modules:
  `Register-PSResourceRepository`; offline installs via
  `Save-PSResource` + copy.

## Module authoring

Layout: `MyModule/MyModule.psd1` (manifest) + `MyModule.psm1` +
`Public/`/`Private/` function files dot-sourced in the psm1.

- Manifest essentials: `ModuleVersion` (semver), `RequiredModules`,
  **explicit `FunctionsToExport`** (wildcards slow discovery and leak
  internals), `PrivateData.PSData` tags for Gallery search.
- One module = one coherent area; verbs from `Get-Verb` (analyzer
  flags non-approved verbs); nouns singular and prefixed
  (`Get-AcmeServerStatus`) to avoid collisions.
- Pester tests alongside (`tests/`), analyzer-clean, README with
  examples — then `Publish-PSResource` (API key, never committed).

## The big modules (operational notes)

| Module | Notes |
| --- | --- |
| **Az** | Meta-module of Az.* sub-modules — install only the sub-modules automation needs (`Az.Accounts`, `Az.Resources`, …); `Connect-AzAccount`; context per process, `Get-AzContext` before anything mutating |
| **Microsoft.Graph** | Huge — install per-workload sub-modules (`Microsoft.Graph.Users`); `Connect-MgGraph -Scopes` requests least privilege; `-Identity` for managed identity; `Invoke-MgGraphRequest` covers gaps |
| **PnP.PowerShell** | SharePoint/M365; app registration with cert auth for unattended |
| **Microsoft.Xrm.Data.PowerShell / Dataverse modules** | Dataverse data/admin ops — cross-ref dynamics-365-development for API discipline |
| **ExchangeOnlineManagement, Microsoft.Online.SharePoint.PowerShell** | Admin modules, often version-sensitive — pin them |

Az vs Azure CLI: Az for complex automation, objects, reusable modules;
`az` CLI for one-liners and bash-context scripts (see
azure-development).

## Versioning discipline

- `Get-InstalledPSResource` / `Get-Module -ListAvailable` before
  assuming; multiple versions coexist side-by-side —
  `Import-Module X -RequiredVersion` disambiguates.
- Windows PowerShell 5.1 and PS7 have **separate module paths** — a
  module installed in one is invisible to the other; the #1 "works in
  console, fails in task scheduler" cause (scheduler ran the other
  engine).
- In CI, restore modules in a pinned bootstrap step; never rely on
  agent-image module versions.

Docs: https://learn.microsoft.com/powershell/gallery/powershellget/overview ·
https://learn.microsoft.com/powershell/scripting/developer/module/writing-a-windows-powershell-module
