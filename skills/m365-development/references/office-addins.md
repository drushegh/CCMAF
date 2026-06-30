# Office Add-ins (brief reference)

Web apps (HTML/CSS/JS) embedded in Word, Excel, PowerPoint, Outlook,
OneNote and Project via the Office JavaScript API (Office.js). Run
cross-platform: Windows, Mac, iPad, web. Add-ins can also expose custom
Copilot agents that read/write the open document (preview — verify
current status before proposing).

## Two manifest types (check which one first)

| | Unified manifest for Microsoft 365 | Add-in only manifest |
|---|---|---|
| Format | JSON, app-package based | XML, single file |
| Status | **Recommended for most new scenarios** | Legacy but widespread |
| Reach | Aligns add-ins with Teams-app distribution model | Office add-ins only |
| Sideload limits | Office on Windows 2304+; Excel/Word/PPT on Mac 16.103+; not iPad/Outlook-Mac (as of doc check, Jun 2026) | Broad |

Existing add-ins can run both manifests linked via the `"alternates"` /
`"hide"` mechanism to avoid duplicate UI (up to 24 h propagation).
Conversion guidance exists on MS Learn ("Convert an add-in to use the
unified manifest").

## Core model

- App package/manifest declares metadata, target hosts, permissions,
  ribbon/task-pane integration, icons, keyboard shortcuts.
- The web app calls Office.js to interact with document content; load it
  from the CDN (`https://appsforoffice.microsoft.com/lib/1/hosted/
  office.js`) — `/1/` always serves the current version.
- **Requirement sets** gate API availability (e.g. `DialogApi 1.2`,
  application-specific sets like `ExcelApi 1.x`). Declare hard
  requirements under `"extensions".requirements` (blocks install where
  unsupported); feature-gate softer dependencies at runtime
  (`Office.context.requirements.isSetSupported`).
- Scaffold with the Yeoman generator for Office Add-ins or Visual
  Studio templates; Agents Toolkit covers unified-manifest scenarios.

## Surfaces

Task panes, content add-ins (embedded objects in Excel/PowerPoint),
dialog boxes, Outlook add-ins (read/compose, pinnable task panes),
function commands (ribbon buttons running code without UI).

## Practical rules

- Target the broadest install base by requiring only essential
  requirement sets; degrade gracefully elsewhere.
- Volume-licensed perpetual Office lags subscription Office on API
  support — check the availability matrix when enterprise clients run
  perpetual versions.
- Distribution: central deployment via the M365 admin centre for org
  rollout; AppSource for public distribution.
- Auth: NAA (nested app authentication)/MSAL patterns evolve — verify
  the currently recommended Outlook/Office SSO approach on MS Learn
  before implementing.

## Boundaries

Deep Office.js per-host APIs are out of scope here — fetch the relevant
MS Learn host documentation (Excel/Word/Outlook API docs) when actually
building. Teams apps → `teams-apps.md`; Copilot agents →
`copilot-studio-development`.
