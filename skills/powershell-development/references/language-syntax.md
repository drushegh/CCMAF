# Language and Script Patterns

## Production skeleton

```powershell
#Requires -Version 7.0
#Requires -Modules @{ ModuleName = 'Az.Accounts'; ModuleVersion = '2.0' }

<#
.SYNOPSIS
    One line.
.DESCRIPTION
    What and why.
.PARAMETER Name
    Meaning, constraints.
.EXAMPLE
    PS> .\script.ps1 -Name "Contoso"
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$Name,

    [ValidateSet('Dev', 'Test', 'Prod')]
    [string]$Environment = 'Dev'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

try {
    Write-Verbose "Starting for $Name ($Environment)"
    if ($PSCmdlet.ShouldProcess($Name, 'Update record')) {
        # mutating work here
    }
}
catch {
    Write-Error "Failed: $($_.Exception.Message)"
    exit 1
}
finally {
    # cleanup
}
```

## Advanced functions

- `[CmdletBinding()]` makes a function a cmdlet: common parameters,
  `-Verbose`, `-ErrorAction` for free.
- Validation attributes do the boring checks declaratively:
  `ValidateSet`, `ValidatePattern`, `ValidateRange`, `ValidateScript`.
- Pipeline input via `ValueFromPipeline` /
  `ValueFromPipelineByPropertyName` + `begin/process/end` blocks —
  `process` runs per item.
- Return objects (`[PSCustomObject]@{...}`), one type per function;
  reserve `Write-Host` for genuinely human-only output, `Write-Output`
  is implicit.

## Error handling

- Terminating errors only are catchable: `$ErrorActionPreference =
  'Stop'` (or `-ErrorAction Stop` per call) turns non-terminating
  errors into catchable ones.
- Catch specifically where it matters:
  `catch [System.IO.FileNotFoundException] {}` before the generic
  `catch`.
- `$_` in catch = the ErrorRecord (`$_.Exception.Message`,
  `$_.ScriptStackTrace`); rethrow with bare `throw` to preserve it.
- `finally` always runs — disposals and disconnects live there.
- `trap` is legacy; don't introduce it.

## Pipeline and operators

- Filter early at the source (`Get-AzResource -ResourceGroupName X`,
  `-Filter` on AD/Graph cmdlets), `Select-Object` to shape,
  `Format-*` only terminal.
- `ForEach-Object -Parallel` (PS7) for I/O-bound fan-out — mind
  `$using:` scope and throttle limit; measure before assuming it's
  faster for CPU-bound work.
- PS7 niceties: ternary (`$x ? 'a' : 'b'`), null-coalescing (`$x ??
  'default'`, `$x ??= 'init'`), chain operators (`cmd && next ||
  fallback`), `?.` member access on possibly-null.

## Pitfalls (the silent ones)

- `$null` on the LEFT of comparisons: `$null -eq $value` (otherwise
  array semantics ruin it).
- Single-element pipelines unroll to a scalar — wrap with `@(...)` when
  a count/array is required.
- `-eq` against arrays filters instead of comparing.
- String interpolation needs `$()` for properties: `"$($user.Name)"`.
- Comparison operators are case-insensitive by default (`-ceq` for
  case-sensitive); `switch` matches insensitively too.
- `+=` on arrays re-allocates per iteration — use
  `[System.Collections.Generic.List[object]]` and `.Add()` in loops.

Docs: https://learn.microsoft.com/powershell/scripting/developer/cmdlet/cmdlet-development-guidelines ·
https://learn.microsoft.com/powershell/scripting/learn/deep-dives/everything-about-null
