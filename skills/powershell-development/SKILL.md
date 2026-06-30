---
name: powershell-development
description: >-
  PowerShell development: PowerShell 7+ scripting and modules, advanced
  functions and the pipeline, error handling, Pester testing,
  PSScriptAnalyzer, cross-platform and Windows PowerShell 5.1
  compatibility, security (JEA, signing, SecretManagement), and
  automation against Azure / Microsoft 365 / Dataverse. Use this skill
  whenever PowerShell work is created, edited, reviewed, or debugged —
  even if the user says "a script", ".ps1", "cmdlet", or "automate this
  on Windows". Triggers include: .ps1/.psm1/.psd1 files, param blocks,
  try/catch in PowerShell, Pester tests, PSGallery modules, Az or
  Microsoft.Graph automation, profile/encoding/path issues, Git Bash vs
  PowerShell confusion, execution policy, or signing questions.
---

# PowerShell Development

Consolidated PowerShell engineering for agents, sourced from
josiahsiegel's powershell-master plugin (outstanding, current to PS 7.5)
and MS Learn. Pipeline construction for CI/CD belongs to
devops-development; Azure service choices to azure-development.

## PowerShell 7+ Is the Default

Target PowerShell 7+ (`#Requires -Version 7.0`) unless a Windows-only
module forces 5.1 (GroupPolicy-era modules). The differences bite:
5.1 is UTF-16LE-default and Windows-only; 7+ is UTF-8, cross-platform,
parallel-capable, with ternary/null-coalescing. State which one a
script targets; "works in my console" is not a target.

## The Non-Negotiable Script Skeleton

Every production script: comment-based help, `[CmdletBinding()]`,
validated parameters, `$ErrorActionPreference = "Stop"`,
`Set-StrictMode -Version Latest`, try/catch/finally, `Write-Verbose`
for diagnostics, exit codes that mean something. Full skeleton:
references/language-syntax.md. Destructive operations implement
`SupportsShouldProcess` and honour `-WhatIf` — and agents run `-WhatIf`
first.

## The Environment Confirmation Rule (MANDATORY)

Scripts that touch live systems (Azure, M365, Dataverse, AD, remote
machines): state the target tenant/subscription/environment, verify the
connected context (`Get-AzContext`, `Get-MgContext`), and get explicit
confirmation before the first mutating run. Consultant machines hold
many tenants' credentials.

## Rules That Prevent the Classic Failures

- **No aliases in scripts** (`Where-Object`, not `?`) — aliases differ
  per platform and profile.
- **`Join-Path`/`[IO.Path]` for paths, never string concatenation**;
  `$IsWindows`/`$IsLinux` for platform branches; explicit
  `-Encoding utf8` on file cmdlets that must interop.
- **Never hardcode credentials** — SecretManagement +
  a vault (Key Vault provider on Azure), `[PSCredential]` parameters,
  certificate or managed-identity auth for unattended runs.
- **Filter left, format right**: filter at the source cmdlet
  (`-Filter`, server-side), `Where-Object` only when unavoidable,
  `Format-*` only at the very end (it destroys objects).
- Output **objects**, not formatted text — the caller decides
  presentation.
- Beware `$null` comparisons (`$null -eq $x`, null on the left) and
  automatic unrolling of single-element arrays — the two classic
  silent-logic bugs.

## Quality Gate

`Invoke-ScriptAnalyzer` clean (or rules consciously suppressed inline
with justification), Pester tests for any reusable function, `-WhatIf`
exercised for destructive paths. No sandbox PowerShell parser may be
available to agents — compensate with structural review and analyzer
runs on the host.

## References

| File | Load when |
| --- | --- |
| references/language-syntax.md | Writing scripts/functions: params, pipeline, errors |
| references/modules-gallery.md | Module authoring, PSResourceGet, Az/Graph/PnP |
| references/cross-platform.md | Windows+Linux scripts, 5.1 vs 7, encoding, Git Bash |
| references/security.md | Credentials, JEA, signing, logging, execution policy |
| references/testing-quality.md | Pester 5, PSScriptAnalyzer, ShouldProcess, performance |
| references/automation-cloud.md | Az / Microsoft.Graph / Dataverse automation patterns |
