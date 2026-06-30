# CCMAF Skills

A library of 52 production-grade agent skills for Claude Code and
compatible agent runtimes. Each skill packages senior-level engineering
standards for one technology domain — the conventions, decision
frameworks, pitfalls and verification rules an experienced practitioner
would enforce — so that an AI agent working in that domain behaves like
a disciplined specialist rather than a generalist with training-data
habits.

The library is the skills companion to the Claude Code Multi-Agent
Framework (CCMAF), but every skill is self-contained and usable
independently.

## How a skill works

Every skill follows the same anatomy:

```
<skill-name>/
  SKILL.md          # always loaded when the skill triggers
  references/       # topic files loaded on demand
    <topic-1>.md
    <topic-2>.md
    ...
```

**Triggering.** The YAML frontmatter in `SKILL.md` carries a
deliberately assertive `description` listing the file types, keywords
and situations that should activate the skill — agents match on it
even when the user never names the technology ("fix my flow" triggers
`power-platform-development`; a `.uproject` file triggers
`unreal-engine-development`).

**Progressive disclosure.** `SKILL.md` itself stays lean (roughly
85–180 lines): the non-negotiable standards, the key decision tables,
the high-frequency pitfalls, a working workflow, and an index telling
the agent which reference file to load for which task. The
`references/` files (typically five to seven per skill, 60–110 lines
each) hold the depth — API patterns, worked code examples,
configuration detail — and are read only when the task needs them.
This keeps context cost proportional to the work.

**Boundaries.** Skills cross-reference rather than duplicate. Each
`SKILL.md` ends with an explicit boundary section routing adjacent
concerns to sibling skills (the React skill owns component behaviour,
the frontend skill owns styling, the TypeScript skill owns typing).
An agent with several skills installed gets one coherent opinion, not
three overlapping ones.

**Accuracy discipline.** Skills were built from curated official and
community sources (source repositories and commits are pinned in the
maintainer's records) and verified mechanically where the tooling
allows: code blocks are parsed with real toolchains (node, esbuild,
Python compile, tree-sitter for C#/C++, yaml/toml parsers, `bash -n`).
Languages with no available parser (DAX, M, PowerShell, GDScript, KQL,
Swift, GLSL) received structural checks, and the affected skills say
so. Fast-moving platform facts — current product versions, regulatory
deadlines, deprecation dates — are date-stamped in the text with an
instruction to re-verify, rather than presented as timeless truth.

## Using the skills

Copy the skill directories you want into your project's
`.claude/skills/` (or your user-level skills location), or load the
repository as a plugin directory. No build step; skills are plain
Markdown. Each skill assumes an autonomous agent audience: "ask the
user" guidance from upstream sources has been adapted into
decide-and-flag behaviour.

### Load as a Claude Code plugin

These skills also ship as a Claude Code **plugin**: the manifests live in
[.claude-plugin/](.claude-plugin/) (`marketplace.json` + `plugin.json`) and the
plugin's `skills` array points at the skill directories in this folder, so the
whole library can load at once (each skill invoked automatically from its trigger
description; names are kebab-case for claude.ai marketplace sync). Point your
plugin marketplace at this `skills/` directory. No `version` is pinned, so updates
track `main` — consistent with "every commit is a release" (below).

## Framework integration (CCMAF)

These skills ship **bundled** with the
[Claude Code Multi-Agent Framework](https://github.com/drushegh/CCMAF) (in this
repo at `skills/`). The framework consumes them mechanically — its `skills-sync`
copies the ones you select from `skills/` into your project's `.claude/skills/`.
The following is the contract that consumption relies on (`contract:skills-sync`
in the framework's
ECOSYSTEM). **An agent session reading this repo to author or modify
skills must preserve these invariants:**

1. **One directory per skill at the repo root.** The directory name IS
   the skill's identity: it's the token consumers put in
   `SKILLS_SELECTED`, the ownership boundary the sync overwrites, and
   the name other skills use in cross-references. Renaming a directory
   is a breaking change for every consumer that selected it.
2. **Naming: `<domain>-development`**, lowercase, hyphenated. The
   framework's stack-detection (`skills-sync.sh --suggest`) emits these
   exact names; new skills should follow the convention so suggestions
   stay paste-able.
3. **`SKILL.md` is mandatory** with YAML frontmatter: `name:` equal to
   the directory name, and a `description:` under 1,024 characters
   listing concrete triggers. Everything else in the directory
   (`references/` etc.) ships verbatim on sync.
4. **Cross-references are advisory names, not hard links.** Skills route
   adjacent concerns to siblings by directory name (see *Boundaries*
   above) — a consumer who synced only one of the pair just gets less
   depth there, never breakage. The framework surfaces these as a
   "companion skills" advisory after each sync, so keep boundary
   sections naming real sibling directories (a typo'd name silently
   advertises nothing).
5. **Every commit to `main` is a release.** Consumers pin a SHA in
   `.claude/.skills-version`; the framework's `skills-check.sh` compares
   that pin to this repo's `main` HEAD at cold start and notifies them
   to re-sync. There is no tagging or branching ceremony — keep `main`
   always-shippable.
6. **Plain Markdown, LF line endings, no executable content.** Consumer
   framework audits (`config-security.sh`) scan synced skills for
   hidden-character and instruction-injection patterns — keep skills
   free of zero-width/bidi characters and "ignore your instructions"
   phrasing, even in examples.

How a framework project consumes this repo, end to end: the project
declares upstream + selection in `.claude/.skills-version` →
`skills-sync.sh` clones this repo and copies ONLY the selected
directories into `.claude/skills/` (dirty-checked, pin rewritten) →
`skills-check.sh` runs at every cold start and raises a flag when the
pin lags `main` (and, for projects that never opted in, suggests
matching skills from stack detection, throttled).

### Adding a new skill (checklist)

- Directory named `<domain>-development`; `SKILL.md` frontmatter `name`
  matches it exactly; description < 1,024 chars with assertive triggers.
- Lean `SKILL.md` (~85–180 lines) + `references/` topic files; every
  reference listed in SKILL.md's index exists on disk (and vice versa).
- Boundary section routes adjacent concerns to real sibling directory
  names only.
- UK English; date-stamp fast-moving claims with a re-verify
  instruction; verify code blocks with a real parser where one exists
  and say so where it doesn't.
- Add the skill to this README's catalogue section.
- If the new stack is detectable from project files, note it — the
  framework's `--suggest` detection map
  (`.claude/framework/update/skills-sync.sh`) should gain the mapping.
- Add the directory to the plugin manifest: append `"./<name>"` to the `skills`
  array in `.claude-plugin/plugin.json` (the array must equal `ls -d */SKILL.md`).

---

## Skill catalogue

### Languages and runtimes

**python-development** — Modern Python (3.11+) engineering standards:
idioms, the type system, asyncio and concurrency, error handling and
logging, architecture, project setup with pyproject.toml, pytest, and
performance/debugging practice. The largest of the language skills;
its workflow rules govern how an agent writes, tests and refactors any
`.py` file.
*References: architecture, async-concurrency, debugging,
errors-and-logging, idioms, performance, project-setup, testing,
type-system.*

**typescript-development** — TypeScript 5.x type-safety patterns and
engineering standards: the type system and generics, eliminating
`any`, runtime validation with Zod, Node backends, React typing,
functional patterns, tsconfig/tooling/monorepo setup, and systematic
tsc error fixing.
*References: error-fixing, functional-patterns, node-backend, react,
testing, tooling, type-system, validation-and-apis.*

**dotnet-development** — Modern .NET (8/9/10) and C#: ASP.NET Core
Web/minimal APIs, EF Core patterns, nullable reference types,
testing across the four frameworks, observability, performance,
solution/project setup including central package management, and
DevExpress component engineering (licensing/feed setup, XPO vs EF Core,
XtraReports, XAF).
*References: csharp-scripts, devexpress, ef-core,
nullable-reference-types, observability, performance, project-setup,
testing, webapi.*

**rust-development** — Rust 2024 edition (1.85+): type-driven API
design, ownership and lifetimes, error handling and lint discipline,
async/tokio, serde, and testing. Includes the reasoning for when
strictness profiles should and shouldn't be tightened per repository.
*References: api-design, async, errors-and-lints, ownership-projects,
serde, testing, type-design.*

**bash-development** — Production shell scripting: strict-mode and
quoting discipline, ShellCheck-aligned patterns, injection and
temp-file safety, cross-platform portability (Linux/macOS/WSL/Git
Bash/containers — including Windows-host quirks), and BATS testing.
*References: modern-bash, patterns, portability, security,
testing-debugging.*

**powershell-development** — PowerShell 7+ language and modules:
advanced functions and the pipeline, error handling, Pester 5 and
PSScriptAnalyzer, 5.1 compatibility, the JEA/signing/SecretManagement
security stack, and automation against Azure, Microsoft 365 and
Dataverse.
*References: automation-cloud, cross-platform, language-syntax,
modules-gallery, security, testing-quality.*

### Web and frontend

**frontend-development** — Visual craft for HTML, CSS and Tailwind v4:
design tokens and theming, semantic markup, distinctive (non-generic)
visual design, component styling architecture, and the accessibility
baseline for styling work.
*References: components, design-craft, html-css-foundations,
tailwind.*

**react-development** — React and Next.js engineering, distilled from
Vercel's official agent skills: render and data-fetching performance
(waterfalls, bundles, re-renders), composition patterns, React Server
Components and the App Router, and view transitions.
*References: composition, performance-data, performance-rendering,
rsc-and-nextjs, view-transitions.*

**threejs-development** — Browser 3D with three.js and React Three
Fiber: scene/camera/lighting fundamentals with correct colour
management, the glTF asset pipeline (Draco/KTX2/meshopt), performance
engineering (draw calls, instancing, LOD, dispose discipline), GLSL
and TSL shaders with the WebGL/WebGPU decision, and the pmndrs
ecosystem (drei, rapier, zustand).
*References: assets-loaders, interaction-animation, performance,
r3f-patterns, scene-fundamentals, shaders-webgpu.*

**remotion-development** — Making videos programmatically with Remotion,
the React framework for video: compositions and the Studio, frame-driven
animation (`useCurrentFrame`/`interpolate`/`spring`) and why CSS
transitions flicker on render, sequencing and `@remotion/transitions`,
assets/audio/video (`staticFile`, `OffthreadVideo`, `delayRender`),
data-driven and personalised video via input props and
`calculateMetadata` with zod-typed schemas, and every rendering path
(CLI, server-side `@remotion/renderer`, Remotion Lambda) plus embedding
with `@remotion/player`. Treats Remotion's **paid Company Licence**
(required for for-profit companies of 4+ employees) as an in-scope flag,
not a footnote. Owns the Remotion model; general React/Next routes to
react-development.
*References: animation, assets-and-media, data-and-props, licensing,
project-and-compositions, rendering-and-player,
sequencing-and-transitions.*

### Desktop and mobile

**electron-development** — Electron's main/preload/renderer model,
secure IPC via contextBridge, packaged-app path resolution (the
"works in dev, fails packaged" class of bugs), native modules,
electron-builder packaging/signing and auto-update.
*References: build-and-distribution, ipc-and-security, native-modules,
processes-and-paths.*

**tauri-development** — Tauri v2 desktop and mobile: Rust↔frontend
IPC, the capability/permission security model, configuration,
plugins, builds, signing and testing.
*References: config-and-builds, ipc, plugins-and-runtime, security,
testing-and-debugging.*

**android-development** — Kotlin and Jetpack Compose following
Google's NowInAndroid architecture: MVVM with unidirectional data
flow, offline-first data with Room, Hilt DI, modularisation and
Gradle, and testing.
*References: architecture, compose, data-room, modularization-gradle,
testing.*

**ios-development** — Swift and SwiftUI (UIKit interop where needed):
Swift concurrency and language standards, MVVM, Human Interface
Guidelines compliance and accessibility, persistence
(SwiftData/Core Data/Keychain), and App Store distribution.
*References: data-persistence, hig-accessibility, swift-standards,
swiftui-patterns, tooling-distribution.*

### Microsoft business platform

**dynamics-365-development** — D365 Customer Engagement / Dataverse
pro-code: plug-ins and the execution pipeline, client API scripting,
PCF code components, Web API/SDK operations, and solutions/ALM.
*References: client-scripting, dataverse-operations, pcf, plugins,
solutions-alm.*

**power-platform-development** — The low-code layer: canvas apps and
Power Apps YAML, Power Fx and delegation, Power Automate cloud flows,
maker-side Dataverse design, environment strategy, solutions and
platform ALM, and code apps.
*References: alm-environments, canvas-apps, code-apps,
dataverse-design, power-automate, power-fx-delegation.*

**power-pages-development** — Power Pages portals: Liquid templating,
the portal Web API, table permissions and web roles, basic/multistep
forms and lists, SPA code sites, site settings and caching, and
pac pages ALM.
*References: alm-deployment, code-sites, forms-lists, liquid,
security, web-api.*

**power-bi-development** — Semantic model design (star schema,
relationships, RLS), DAX authoring and performance tuning, Power
Query/M and query folding, TMDL/PBIP source formats, and
deployment/ALM.
*References: dax-authoring, dax-performance, deployment-reports,
power-query-m, semantic-modeling, tmdl-pbip.*

**fabric-development** — Microsoft Fabric: OneLake topology and
shortcuts, lakehouse/medallion architecture, Spark notebooks and
Delta optimisation (V-Order, OPTIMIZE/VACUUM), ingestion and
orchestration, Direct Lake, and capacity/CU administration.
*References: capacity-administration, delta-optimization,
ingestion-orchestration, lakehouse-medallion, spark-notebooks,
topology-onelake.*

**copilot-studio-development** — Copilot Studio agents, YAML-first:
topic/trigger/action schema authoring, generative orchestration
patterns (orchestrator variables, tool-call leak prevention,
deterministic MCP workarounds), knowledge sources and connector
actions, Teams/M365 Copilot channels and production hardening, agent
ALM/governance/DLP, testing and evals — plus the pro-code adjacency
(declarative agents, ATK/TypeSpec, M365 Agents SDK) and the
agent-type decision framework.
*References: alm-governance, knowledge-actions,
orchestration-patterns, pro-code-agents, teams-production,
testing-evals, yaml-authoring.*

**m365-development** — The Microsoft 365 platform for developers:
Microsoft Graph fundamentals (auth flow selection, OData, paging,
batching, delta queries, change notifications, throttling) and SDK
patterns in .NET/TS/Python, SPFx web parts and extensions (including
the v1.22 Heft toolchain boundary), Teams apps (manifest,
capabilities, SSO), SharePoint Online data access (PnPjs/REST/Graph),
and Office add-ins.
*References: graph-fundamentals, graph-sdks, office-addins,
sharepoint-data, spfx-development, teams-apps.*

### AI and agents

**llm-development** — Engineering software on LLMs, primarily the
Claude API: messages/streaming/error handling, tool use and agentic
loops, prompt engineering as a versioned-and-evaluated discipline,
prompt caching and cost/latency engineering, MCP server development
(spec 2025-11-25), agent harness patterns (context management,
sub-agents, safety gates), authoring agent skills themselves, and
evals for nondeterministic systems. Python/JSON examples parsed
mechanically; model and spec facts date-stamped June 2026.
*References: agent-harness, caching-cost-latency, claude-api, evals,
mcp-development, prompt-engineering, skills-authoring, tool-use.*

**comfyui-development** — Building, automating and extending ComfyUI,
the node-graph engine for diffusion image/video/audio generation: the
graph/execution model and the UI-vs-API JSON formats, the
txt2img/img2img/inpaint/LoRA/ControlNet/upscale pipelines with
samplers/schedulers and reproducibility, custom node development (the V3
`io.ComfyNode` schema and the still-supported V1
`INPUT_TYPES`/`NODE_CLASS_MAPPINGS` legacy), programmatic runs over the
HTTP+WebSocket API, model/asset management (comfy-cli, ComfyUI-Manager,
the Registry, `extra_model_paths`), and running ComfyUI for agents/MCP.
Treats the no-auth API and arbitrary-code custom nodes as a
remote-code-execution surface, and model/output licensing as a
commercial obligation to verify.
*References: api-automation, custom-nodes, generation-pipelines,
mcp-and-deployment, models-and-management, workflow-model.*

### Data and databases

**sql-development** — Relational database engineering for SQL Server /
Azure SQL (T-SQL) and PostgreSQL: schema design and data types,
workload-aware indexing, evidence-first query tuning (execution plans,
statistics, parameter sensitivity), window functions/CTEs/upserts,
transactions and concurrency, injection-safe dynamic SQL and RLS,
Azure SQL tiers and PG Flexible Server operations, and safe
expand–contract migrations. All SQL examples parsed with sqlglot
(T-SQL/Postgres dialects).
*References: advanced-queries, indexing, migrations, platform-azure,
query-tuning, schema-design, security, transactions-concurrency.*

**web-scraping-development** — Building web scrapers and crawlers
responsibly: the legal/ethical gate (robots.txt, ToS, rate limiting,
GDPR/PII) and API-first checking, HTTP scraping and HTML parsing (httpx,
BeautifulSoup, parsel/lxml), dynamic JS-rendered sites with Playwright
(and intercepting the underlying API), the Scrapy framework (spiders,
items, pipelines, middlewares, AutoThrottle, scrapy-playwright), and
resilience/anti-bot/operations (retries, caching, storage, scheduling,
knowing when to stop).
*References: dynamic-playwright, http-parsing, legality-ethics,
resilience-operations, scrapy-framework.*

### Cloud and operations

**azure-development** — Azure service selection and engineering:
Bicep/Terraform IaC and azd workflows, Functions/App Service/Container
Apps, Logic Apps (Standard vs Consumption, Sentinel playbooks), Entra ID
and managed identities, Key Vault, storage and messaging, AI Foundry,
Azure Machine Learning (workspace, MLflow, online/batch endpoints,
MLOps), and operations/reliability/cost discipline.
*References: ai-foundry, azure-ml, compute-services, data-messaging,
identity-security, infrastructure-iac, logic-apps,
operations-reliability.*

**containers-development** — Container engineering across the
lifecycle: multi-stage Dockerfiles (layer caching, non-root,
distroless/chiselled bases, BuildKit build secrets), .NET image
specifics (`$APP_UID`, chiselled/distroless, the .NET 10 Debian
removal), docker compose for local development, image and runtime
security (scanning, SBOM/provenance, signing, capability/read-only
hardening), registries and Azure Container Registry, the Azure
container-host decision (Container Apps vs AKS vs App Service vs ACI vs
Functions), and working-level Kubernetes manifests.
*References: azure-runtime, compose, dockerfiles, dotnet-images,
image-security, kubernetes, registries-acr.*

**kubernetes-development** — Platform-level Kubernetes: workload
controllers and scheduling, autoscaling (HPA/VPA/KEDA/cluster
autoscaler), Services/Ingress/Gateway API and default-deny
NetworkPolicy, ConfigMaps/Secrets with external secret stores,
RBAC/Pod Security Admission/admission control, storage (PV/PVC/CSI,
StatefulSet volumes), Helm and Kustomize packaging, GitOps (Argo CD/
Flux), operations/troubleshooting, and AKS specifics (workload
identity, node pools, CNI, add-ons, upgrades). Takes over from
containers-development once you're operating a cluster.
*References: aks, config-secrets, gitops-operations, networking,
packaging, security-rbac, storage, workloads-scheduling.*

**linux-development** — Linux as a development/workstation environment
plus the shared Linux foundations every other Linux task builds on: the
filesystem hierarchy and everything-is-a-file model, processes and
signals, the permission/ownership model, the shell environment and
dotfiles (login vs interactive, `$PATH`), package management
(apt/dnf/pacman, Flatpak/Snap), desktop basics, and WSL2 on Windows in
depth (wsl.conf/.wslconfig, systemd, networking, filesystem
performance). Owns the foundations; server operations route to
linux-administration.
*References: foundations, local-troubleshooting, packages-software,
shell-environment, workstation-desktop, wsl2.*

**linux-administration** — Operating Linux servers: systemd service
and timer management with unit hardening, networking and firewalls
(ip/ss, DNS, nftables/firewalld/ufw, SSH server hardening), users/sudo/
ACLs/capabilities and PAM at admin scale, performance troubleshooting by
the USE/saturation method (perf/strace), security hardening (SSH,
SELinux/AppArmor, CIS benchmarks, fail2ban, patching), logging and
observability (journald, log shipping, rotation, metrics/alerting), and
automation (cron vs timers, restore-tested backups, config as code).
Builds on the foundations in linux-development.
*References: automation, networking, observability-logging,
performance-troubleshooting, security-hardening, systemd-services,
users-permissions-pam.*

**devops-development** — CI/CD on Azure DevOps and GitHub Actions:
pipeline/workflow YAML, templates and reusable workflows, OIDC
federated credentials, environments and approvals, pipeline security
(SHA pinning, permission scoping), deployment patterns, and Power
Platform/Azure deployment automation.
*References: azure-pipelines, deployment-patterns, github-actions,
pipeline-security, power-platform-cicd.*

**sentinel-development** — Microsoft Sentinel SIEM/SOAR engineering
plus a general KQL language reference (Log Analytics, App Insights,
ADX, Fabric eventhouse): detection engineering (scheduled/NRT rules,
entity mapping, tuning, ingestion-delay handling), connectors and
ingestion cost control, hunting/watchlists/workbooks, automation
rules and Logic Apps playbooks, and Defender XDR/unified portal
integration with MITRE ATT&CK coverage mapping.
*References: automation-soar, data-ingestion-cost, defender-xdr-mitre,
detection-engineering, hunting-watchlists-workbooks, kql-language.*

### Cross-cutting

**api-development** — HTTP API design and engineering,
framework-agnostic: resource/REST design and HTTP semantics,
OpenAPI-first contracts (3.1/3.2), versioning and additive evolution
with deprecation/sunset, pagination (cursor/offset/Link) and filtering,
RFC 9457 `problem+json` errors, idempotency and caching/ETags,
authentication (OAuth2/OIDC, API keys) and rate limiting, and webhooks
(HMAC signing, retries, dedupe). Owns API design; framework
implementation routes to the language skill.
*References: auth-rate-limiting, errors-problem-details, openapi-contract,
pagination-filtering, rest-design, versioning-evolution, webhooks.*

**testing-development** — Cross-cutting test engineering above the
unit level: test strategy and the pyramid/trophy, end-to-end browser
testing with Playwright (role-based locators, web-first assertions,
fixtures, traces), load and performance testing (k6, Apache JMeter,
Azure Load Testing) with workload models and SLO gating, consumer-driven
contract testing (Pact) and regression discipline, and test-data
management (factories, testcontainers, synthetic data). Per-language
unit/integration mechanics stay in the language skills.
*References: contract-regression, e2e-playwright, load-performance,
test-data, test-strategy.*

**code-review-development** — Senior-level review of a code change,
diff or PR against one bar — the change must improve the codebase's
health (Google's standard of "approve once it's definitely better, even
if imperfect"). Covers the full reviewer discipline (design, correctness
and edge cases, security, performance, tests, readability,
contract/compatibility), a concrete defect-hunting checklist for the bug
classes linters miss, a severity rubric with explicit blocking vs
non-blocking decisions, comment craft using Conventional Comments, the
author side (small focused changes, descriptions, self-review,
responding to feedback), and how to use CI gating and AI/agent reviewers
without rubber-stamping. Owns code review; security depth, test strategy
and API-contract review route to sibling skills, and architecture and
document review are deliberately separate.
*References: ai-generated-code, author-side, automation-tooling-and-ai,
defect-hunting, giving-feedback, review-workflow,
severity-and-prioritisation, the-standard, what-to-look-for.*

**ux-design** — Interaction and perception reasoning for any UI,
independent of language or framework: the Laws of UX (Fitts, Hick,
Miller, Jakob, the Doherty threshold), Gestalt grouping and visual
hierarchy (the "awareness of space" engine), scan patterns,
affordances/signifiers/feedback (Norman), form and error-state UX,
navigation/findability, and touch/pointer ergonomics (target sizes,
thumb zones) — plus Nielsen's heuristics as a review method. The
predictive model for how a layout will actually behave; pairs with
ui-verification.
*References: affordances-feedback, forms-and-input, gestalt-and-layout,
heuristics-review, interaction-laws, mobile-touch-ergonomics.*

**ui-verification** — The render → view → critique → iterate loop:
actually rendering a UI, capturing it (Playwright) at real viewports,
looking at the image, and critiquing it against the ux-design and
accessibility rubrics instead of shipping a guess from the code. Covers
the state × viewport × theme capture matrix, the structured visual
review, automated visual regression (`toHaveScreenshot`, Percy/
Chromatic), and frame capture for canvas/3D — with honest limits on what
a still can show.
*References: 3d-and-non-web, render-and-capture, state-and-viewport-coverage,
the-critique-loop, visual-regression.*

**drawio-development** — Authoring draw.io / diagrams.net diagrams as
native, committable `.drawio` (mxGraphModel XML): the well-formedness
non-negotiables (root cells, the edge geometry child, no XML comments)
and layout discipline that stop diagrams breaking, per-type recipes
(ERD/UML/sequence/architecture/ML/flowchart), environment-aware delivery
(write the file, desktop-CLI export to PNG/SVG/PDF with embedded XML, or
an `app.diagrams.net` `#create=` URL), and a render → self-check →
iterate loop. Authors native XML; Mermaid/CSV input and the general
render-critique loop route to siblings; heavy tooling (auto-layout,
codebase→diagram, shape index, brand icons) routes to the MIT
`Agents365-ai/drawio-skill`.
*References: delivery-and-export, diagram-recipes, verify-and-iterate,
xml-reference; scripts: validate, encode_drawio_url.*

**secure-development** — Application security as a review framework:
OWASP Top 10 (2025) and ASVS 5.0, STRIDE/data-flow threat modelling,
input/output handling and the known-dangerous-sinks list, secrets and
cryptography hygiene, and dependency/supply-chain security. Includes
engineering-obligation references (explicitly not legal advice,
date-stamped) for NIS2, GDPR privacy-by-design, and the EU AI Act.
*References: eu-ai-act, gdpr, input-output-crypto, nis2,
owasp-frameworks, supply-chain, threat-modelling.*

**accessibility-development** — WCAG 2.2 AA as the working standard
with the EU/Irish statutory frame (EN 301 549, Web Accessibility
Directive, European Accessibility Act): ARIA and keyboard/focus
patterns, accessible forms/tables/charts, testing tooling (axe-core,
Playwright, screen readers), a structured audit checklist with a
severity rubric for reviewing existing UIs, and short
Microsoft-stack-specific notes (Power Apps/Pages, Power BI, SPFx).
*References: aria-keyboard, audit-checklist, eu-legal-framework,
forms-tables-charts, microsoft-stack-a11y, testing-tooling,
wcag-2-2.*

### Agent workflow

How an agent works, not what it builds — vendor-neutral process skills built on
open primitives (Markdown, Mermaid, git, ccusage, llms.txt), re-engineered here
from upstream ideas to be self-contained and composable with the rest of the
library.

**visual-plan** — Turning an implementation idea into a reviewable, **grounded**
implementation plan in plain Markdown — Mermaid diagrams, file maps, annotated
code/diffs and an explicit `[NEEDS CLARIFICATION]` open-questions gate — *before*
any code is written. The plan is the approval gate and the source of truth,
judgeable by a fresh reader without the chat history: research the real repo and
name real symbols (no invention), decide the one-way-door bets up front
(reversible vs irreversible), reuse before new, gate trivial work out, and run a
sceptical self-review pass. Heavy exportable diagrams route to drawio-development,
rendering/critiquing UI to ui-verification, layout reasoning to ux-design, and
reviewing the finished change to code-review-development.
*References: diagrams-and-wireframes, grounding-and-reuse,
open-questions-and-approval, plan-anatomy, self-review.*

**visual-recap** — Turning a completed change (PR, branch, commit or git diff)
into a high-altitude, **before/after** recap a reviewer reads to grasp the shape
of the work before the line-by-line diff: a file-tree of what moved, before/after
data-model and API-contract summaries, annotated diffs of the key files, a Mermaid
diagram for architecture/data-flow shifts, and a short outcome narrative. The
discipline is *true by construction* — every structured block is built
mechanically from the real diff via plain git/gh, never invented (a
confidently-wrong recap is worse than none) — with secrets scanned and redacted
and visibility gated for private repos. The line-by-line review routes to
code-review-development, secret-handling depth to secure-development, contract
semantics to api-development, migration safety to sql-development.
*References: before-after, diff-to-blocks, grounding-and-security, recap-anatomy.*

**stay-within-limits** — Keeping long-running or parallel multi-agent work inside
the platform's usage limits: budget against the 5-hour and weekly windows as a
first-class resource, read usage between waves, stop on a soft threshold before
the cap, checkpoint resumable state to disk, and schedule a self-contained,
idempotent wake only once the binding window has cleared. Built on open primitives
(ccusage, the first-party `/usage` and `/cost`, an OS scheduler) with no
hard-coded limit numbers and aware of prompt-cache TTL economics; the limit model
and tooling facts are date-stamped June 2026. Multi-agent harness design routes to
llm-development, the wake/checkpoint scripting to bash-development and
powershell-development.
*References: orchestration, pause-and-resume, usage-signals.*

**read-the-damn-docs** — Grounding claims in official, version-matched
documentation and the installed source — not training memory — whenever working
with a third-party API, library, framework, CLI, SDK or cloud service, or with
high-stakes auth/security/billing/migration work. Defines a documentation-source
hierarchy, pin-the-version-first discipline, a read-then-verify loop, and the open
doc-fetching landscape (llms.txt/llms-full.txt, Markdown endpoints,
Context7/DeepWiki MCPs — date-stamped June 2026). Treats unverified package recall
as a **security** hole, not just a quality one: package hallucination /
slopsquatting, the registry existence/version checks that defeat it, and reading
semver/changelogs for deprecation drift. Supply-chain depth routes to
secure-development, scholarly citation discipline to academic-research, and
per-ecosystem registries to the language skills.
*References: anti-hallucination, source-hierarchy-and-tools, verify-and-drift.*

### Research

**academic-research** — Full-lifecycle scholarly research, built
**citation-safe** (never fabricate a reference, dataset, quote or result):
scholarly discovery via the connected Consensus MCP and the free APIs
(OpenAlex, Crossref, Semantic Scholar, arXiv, Europe PMC), source appraisal
(quality dimensions, source tiers, retraction/predatory checks, the
fact-vs-inference discipline, triangulation), evidence synthesis (PICO/PRISMA,
thematic synthesis, evidence tables, gap analysis), research ideation with a
novelty gate, reproducible methods, academic writing, reviewer simulation, and
dissemination. Verify-before-cite is enforced by a bundled script. Owns the
scholarly/peer-reviewed and citation-integrity layer; general web research
routes to deep-research, and formatting the output to your docx/pptx tooling.
*References: discovery-and-search, source-appraisal-and-integrity,
synthesis-and-review, citations-and-referencing, ideation-and-novelty,
methods-and-reproducibility, writing-review-and-dissemination; scripts:
verify_citation.*

### 3D and game engines

**game-feel** — The craft of making interactive motion feel good,
engine-agnostic: Steve Swink's three building blocks (real-time control,
simulated space, polish), input responsiveness and forgiveness mechanics
(coyote time, jump buffering, variable jump height, corner correction),
physics tuning (realistic vs good-feeling — accel/friction/gravity
curves, asymmetric gravity), and juice (screenshake, hitstop, easing,
squash-and-stretch, camera). The engine skills own the API; this owns
why it feels right. Real-time feel needs a human in the loop.
*References: input-and-responsiveness, juice-and-feedback, physics-tuning,
the-three-blocks, tuning-and-verification.*

**blender-development** — The Blender knowledge layer: bpy scripting
(data-block model, `bpy.data` over `bpy.ops`, dependency graph,
performance), add-on/extension development on the
`blender_manifest.toml` platform, Geometry Nodes concepts, the asset
export pipeline to engines (glTF/FBX conventions per target), and
headless/CI automation.
*References: addons-extensions, automation-headless, bpy-scripting,
export-pipeline, geometry-nodes.*

**godot-development** — Godot 4.x: statically-typed GDScript and
Godot C#, scene/node composition architecture ("signals up, calls
down"), custom Resources for data-driven design, physics (Jolt
default since 4.6) with collision layer/mask discipline, and
export presets with headless CI.
*References: csharp-interop, gdscript, physics-2d-3d,
resources-export, scenes-nodes.*

**godot-shaders-development** — Godot 4.x shader programming in the
Godot Shading Language and compute GLSL: the language (data types,
render modes, uniforms/hints, varyings) with the 3.x→4.x migration
table that breaks most pasted snippets, spatial (PBR) shaders, 2D
canvas_item effects and screen reading, particle/sky/fog processor
shaders, GLSL compute via RenderingDevice (buffers, dispatch, readback),
and visual shaders with a performance/debugging playbook. No shader
parser exists in the sandbox, so shader code gets structural checks —
the skill says so. Owns shaders; engine/scene plumbing routes to
godot-development.
*References: canvas-item-shaders, compute-shaders, particles-sky-fog,
shading-language, spatial-shaders, visual-shaders.*

**godot-mcp-workflow** — Driving Godot and Blender from an agent over
MCP: the practical loop for `@coding-solo/godot-mcp` (npx) and
`ahujasid/blender-mcp` (uvx). What each server's tools can and cannot do
(godot-mcp is deliberately minimal — launch/run/debug-output/coarse
scaffolding, no viewport screenshot; blender-mcp can screenshot and runs
arbitrary Python), the scaffold→edit-files→run→read-debug-output loop,
working "blind" in Godot via observability and headless tests, the
Blender→glTF→Godot asset pipeline (axis/scale conventions), and the
safety rules for arbitrary code execution and version drift. Owns the
MCP workflow; engine and Blender knowledge route to godot-development,
godot-shaders-development and blender-development.
*References: asset-pipeline, blender-mcp-tools, godot-mcp-tools,
pitfalls-and-safety, the-development-loop.*

**unity-development** — Unity 6.x: MonoBehaviour lifecycle and
serialization rules (including the destroyed-object null trap),
ScriptableObject data architecture, prefabs/variants and additive
scene management, Addressables, the Input System and UI Toolkit/uGUI
decision, ECS/DOTS basics (core since 6.4) with an honest adoption
frame, and the build pipeline (Build Profiles, IL2CPP stripping,
batchmode CI).
*References: build-pipeline, csharp-scripting, ecs-dots, input-ui,
prefabs-scenes, scriptableobjects-data.*

**unreal-engine-development** — Unreal Engine 5: the Blueprints vs
C++ decision and the standard hybrid pattern, the gameplay framework
class roles, UCLASS/UPROPERTY reflection and garbage collection
rules, modules and plugins, decision-level rendering features
(Nanite, Lumen, Niagara), asset references and cooking/packaging with
UAT/BuildGraph CI, and networking/replication with GAS awareness.
*References: assets-build-packaging, blueprints-boundary,
cpp-patterns, gameplay-framework, networking-gas, rendering-features.*

---

## Conventions across the library

UK English throughout. Lean `SKILL.md` plus on-demand references.
Explicit cross-skill boundaries instead of duplication. Date-stamped
platform and regulatory claims with re-verify instructions. Pushy
trigger descriptions so skills activate from context, not just
keywords. Code blocks verified with real parsers wherever the
toolchain exists, and honestly labelled where it doesn't.

## Licence

See [LICENSE](LICENSE).
