# Cloud and Platform Automation Patterns

## Azure (Az module)

- `Connect-AzAccount` (interactive), `-Identity` (managed identity on
  Azure compute), or cert-based SP for external automation.
  **`Get-AzContext` before anything mutating** — the environment
  confirmation rule made concrete; `Set-AzContext -Subscription` to be
  explicit, never rely on "whatever was last selected".
- Install per-need sub-modules (`Az.Accounts`, `Az.Resources`,
  `Az.Storage`...), pinned. `-WhatIf` works on most mutating Az cmdlets
  — use it.
- Idempotency: `Get-` then branch, or use `New-…
  -ErrorAction SilentlyContinue` + verification; better, push resource
  shape to IaC (azure-development) and keep PowerShell for data-plane
  and orchestration.
- Throttling: ARM limits per principal — batch with care,
  `-DefaultProfile` per context in parallel runs.

## Microsoft 365 (Microsoft.Graph)

- `Connect-MgGraph -Scopes 'User.Read.All'` — request the minimum;
  unattended = app registration + certificate or managed identity with
  **application** permissions admin-consented.
- Per-workload sub-modules; `Invoke-MgGraphRequest` for endpoints the
  cmdlets don't cover (beta included — flag beta usage as such).
- Page everything: Graph returns pages (`-All` on most `Get-Mg*`);
  unpaged loops silently truncate at 100.
- Throttling (429 + Retry-After) is normal at scale — the SDK retries,
  but design batch jobs to checkpoint and resume.

## Dataverse / Power Platform

- `Microsoft.PowerApps.Administration.PowerShell` +
  `Microsoft.PowerApps.PowerShell` for admin (environments, DLP);
  `Microsoft.Xrm.Data.PowerShell` for data/metadata convenience over
  the SDK.
- For anything substantial against Dataverse follow
  dynamics-365-development (casing, querying, solution discipline);
  pac CLI often beats raw PowerShell for ALM tasks — shell out to it
  rather than reimplementing.

## Scheduled and unattended execution

- Azure Automation runbooks / Functions (PowerShell worker) for cloud
  schedules — managed identity, modules declared per Automation
  account; Task Scheduler for on-prem (mind the 5.1-vs-7 engine and
  module path split — schedule `pwsh.exe`, not `powershell.exe`,
  for PS7 scripts).
- Log to a destination someone watches (App Insights via
  `Write-Information` + ingestion, or at minimum transcript files with
  rotation); exit codes drive the scheduler's failure signal.
- Long-running jobs: checkpoint progress (resume tokens, watermark
  files) — reruns must be safe.

## REST against anything else

`Invoke-RestMethod` with explicit `-ContentType`, `-TimeoutSec`, retry
wrapper (429/5xx + exponential backoff + jitter), and
`-ResponseHeadersVariable` when paging via Link headers.
`Invoke-WebRequest` only when raw response/headers/streams are needed.

## CI/CD touchpoint

GitHub Actions/Azure DevOps run PowerShell natively (`shell: pwsh`) —
analyzer + Pester as pipeline gates, modules restored pinned, federated
credentials to cloud. Pipeline construction details:
devops-development.

Docs: https://learn.microsoft.com/powershell/azure/ ·
https://learn.microsoft.com/powershell/microsoftgraph/ ·
https://learn.microsoft.com/power-platform/admin/powershell-getting-started
