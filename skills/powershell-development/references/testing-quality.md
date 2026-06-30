# Testing and Quality

## PSScriptAnalyzer (the linter)

`Invoke-ScriptAnalyzer -Path . -Recurse -Severity Warning,Error` in
every pipeline; `Invoke-Formatter` for style. Key rules that catch real
bugs: PSAvoidUsingPlainTextForPassword, PSAvoidUsingInvokeExpression,
PSUseShouldProcessForStateChangingFunctions, PSUseApprovedVerbs,
PSAvoidUsingCmdletAliases. Suppress only inline with
`[Diagnostics.CodeAnalysis.SuppressMessageAttribute(...)]` + a reason —
a settings file of blanket exclusions is lint theatre. Custom rules per
team standard via `-CustomRulePath`.

## Pester 5 (the test framework)

```powershell
BeforeAll { . $PSScriptRoot/../Public/Get-OrderStatus.ps1 }

Describe 'Get-OrderStatus' {
    Context 'when the order exists' {
        BeforeAll {
            Mock Invoke-RestMethod { @{ status = 'Open' } }
        }
        It 'returns the status object' {
            (Get-OrderStatus -Id 42).status | Should -Be 'Open'
        }
        It 'calls the API once' {
            Get-OrderStatus -Id 42
            Should -Invoke Invoke-RestMethod -Times 1 -Exactly
        }
    }
    Context 'when the API fails' {
        BeforeAll { Mock Invoke-RestMethod { throw 'boom' } }
        It 'throws a useful error' {
            { Get-OrderStatus -Id 42 } | Should -Throw '*boom*'
        }
    }
}
```

Pester 5 rules: discovery vs run phases — code at `Describe` top level
runs at discovery; put setup in `BeforeAll`/`BeforeEach`. Mock at the
module scope of the function under test (`-ModuleName`). Tags
(`-Tag Unit`) split fast unit from slow integration runs. Coverage via
`-CodeCoverage` config; CI output `-Output Detailed` + NUnit XML for
pipeline publishing.

## ShouldProcess discipline

State-changing functions declare
`[CmdletBinding(SupportsShouldProcess)]` and wrap mutations in
`if ($PSCmdlet.ShouldProcess($target, $action))`. This buys `-WhatIf`
and `-Confirm` for free — and agents (and humans) **run `-WhatIf`
before the real run** on anything destructive. `ConfirmImpact = 'High'`
auto-prompts.

## Performance habits

- Measure first: `Measure-Command`, or sampling with repeated runs —
  intuition about PowerShell perf is usually wrong.
- Collection building: `Generic.List` + `.Add()`, or capture pipeline
  output directly (`$results = foreach (...) {...}`) — never `+=` an
  array in a loop.
- Pipeline vs foreach: the pipeline costs per-item overhead; hot inner
  loops do better as `foreach` statements over pre-fetched data.
- `ForEach-Object -Parallel` helps I/O-bound fan-out (API calls per
  tenant); thread-session isolation means modules re-import per
  runspace — batch accordingly.
- Avoid repeated `Get-*` calls inside loops — fetch once, index with a
  hashtable.

## Review checklist (for agents reviewing scripts)

1. Skeleton present (help, CmdletBinding, validation, strict mode,
   error handling)?
2. Analyzer clean? Aliases? Invoke-Expression? Plaintext secrets?
3. Destructive paths behind ShouldProcess, tested with -WhatIf?
4. Objects out, formatting absent (except terminal display scripts)?
5. Pester tests for reusable functions; mocks for remote calls?
6. 5.1-vs-7 target declared and honoured (syntax, encoding, module
   paths)?

Docs: https://learn.microsoft.com/powershell/utility-modules/psscriptanalyzer/overview ·
https://pester.dev/docs/quick-start ·
https://learn.microsoft.com/powershell/scripting/dev-cross-plat/performance/script-authoring-considerations
