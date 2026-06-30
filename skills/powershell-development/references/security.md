# PowerShell Security

## Credentials and secrets

- **SecretManagement + SecretStore** (or the Azure Key Vault extension
  vault) is the standard: `Get-Secret -Name X -Vault KV` — secrets
  never appear in script text, parameters default to `[PSCredential]`
  or `[SecureString]`, and nothing echoes them.
- Unattended automation authenticates with **managed identity**
  (`Connect-AzAccount -Identity`, `Connect-MgGraph -Identity`) on Azure
  compute, or **certificate-based service principals** elsewhere —
  never stored client secrets, never `ConvertTo-SecureString
  -AsPlainText` of a hardcoded literal (the anti-pattern analyzer
  catches).
- `Export-Clixml` of credentials is machine+user-bound DPAPI — fine for
  a dev convenience, not a deployment pattern.

## Execution policy — what it is and isn't

Execution policy is a **safety belt, not a security boundary**
(`-ExecutionPolicy Bypass` is always available). Set `RemoteSigned` as
the workstation default, sign what you ship, and don't design controls
that assume policy stops an attacker — that's what WDAC/CLM are for.

## Code signing (production)

`Set-AuthenticodeSignature` with a code-signing cert (internal CA or
public); timestamp (`-TimestampServer`) so signatures outlive the cert;
`AllSigned` policy on locked-down hosts. Signed scripts +
WDAC policy = scripts that can't be tampered with silently.

## The 2025-era hardening stack (for managed estates)

| Layer | What |
| --- | --- |
| **JEA** (Just Enough Administration) | Constrained remoting endpoints exposing only whitelisted cmdlets, running as a virtual account — admin tasks without admin handover |
| **WDAC** | Application control; in enforcement, PowerShell runs in CLM automatically |
| **Constrained Language Mode** | Blocks .NET invocation, Add-Type, COM — neuters most offensive tooling; full language only for signed/trusted scripts |
| **Script Block Logging** + transcription | Event 4104 — the forensic record; enable via policy on servers (deobfuscated content gets logged) |
| **AMSI** | Script content scanned by Defender at execution |

These matter in security reviews: name them, don't hand-wave
"PowerShell is locked down".

## Input validation

Validate at the parameter (`ValidatePattern`, `ValidateScript`,
`ValidateSet`) so bad input never reaches logic; treat any
string-interpolated invocation (`Invoke-Expression`, SQL strings,
`Start-Process` argument concatenation) as injection surface —
`Invoke-Expression` is effectively banned (analyzer rule); use splatting
and parameterised APIs.

## Remoting

PSRemoting over WinRM (domain) or SSH (cross-platform);
`Invoke-Command -ComputerName` with explicit `-Credential`; JEA
endpoints for delegated admin; second-hop needs CredSSP alternatives
(resource-based Kerberos delegation) — don't reflexively enable
CredSSP.

Docs: https://learn.microsoft.com/powershell/scripting/security/security-features ·
https://learn.microsoft.com/powershell/utility-modules/secretmanagement/overview ·
https://learn.microsoft.com/powershell/scripting/security/remoting/jea/overview
