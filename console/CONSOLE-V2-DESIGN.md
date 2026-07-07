# CONSOLE-V2-DESIGN.md — CCMAF Console v2: Scopes, Insight Features, and the Global Home

**Authored by:** Fable (claude-fable-5) — design pass only, 2026-07-07.
**Status:** build-ready design. No production file was modified in this pass.
**Companion doc:** `CONSOLE-APP-BUILD-PLAN.md` (Hub-as-app, TASK-090…099) — this design
EXTENDS that plan; it does not replace it. Where the two touch, §1.6 says exactly how.
**Source of truth read for this design:** the code at `F:/Git/Personal/CCMAF/console/src`
as of 2026-07-07, the live console at `127.0.0.1:6122`, the prior UI-review screenshot set,
and live `~/.claude` transcript/session data (verified shapes are marked ✅, guesses ⚠️).

---

## 0. The one-page summary

**The scope model: two levels, matching the two process kinds that already exist.**
The machine-global **Hub** (`:6119`, already planned as TASK-093/094) becomes the **Global
Home tab** — the first, pinned tab of the tabbed shell. Every **project tab** stays a
whole per-project console SPA (unchanged process model). Global functions live ONLY on
the Home tab; project functions live ONLY in project tabs; the three features that are
genuinely both (Sessions, Needs-you inbox, Burn) exist at both levels — the global level
is always the **cross-project rollup**, the project level is always the **full-fidelity
detail**. No per-page scope switcher, no scope badges as a primary mechanism: *the tab
you are in IS the scope*, and each surface's header names its scope so you always know.

**The shared substrate under the 10 features** (design once, reuse four ways):

| Substrate | Feeds features |
| --- | --- |
| S1 `transcript-insights.ts` — pure aggregators over the already-cached parsed JSONL | #2 burn, #3 ledger, #8 swimlane, #1 show-the-work |
| S2 `contract:console-deep-links` — stable URL grammar for turn/task/item anchors | #1, #7, #8, #10, notifications |
| S3 `/api/attention` — one ranked "needs a human" aggregator per project | #9 inbox, #6 ticker, Hub toasts (plan §4c) |
| S4 `/api/activity` — live-agents + latest-tool feed (server-side liveness scan) | #6 ticker, Hub fleet liveness, global Sessions |

Build order in five phases (§6): substrate → daily-loop small wins (ticker, inbox,
palette, resume) → transcript features (burn, ledger, show-the-work, gotcha-filing) →
heavy views (swimlane, time machine) → global surfaces (shell-on-Hub, global Sessions).

---

## 1. Global/Local information architecture

### 1.1 What is actually global today (the diagnosis)

The owner's instinct ("most is per-project but Sessions is global") is about **data
provenance**, and it is exactly right:

- Eleven of the twelve tabs read from **the project's own `.claude/` tree** (or `docs/`,
  `README.md`) via the per-project server bound to one `getProjectRoot()`
  (`src/server/project-root.ts`).
- **Sessions** reads from **`~/.claude/projects/<slug>/`** — the *user's machine-global
  transcript store* (`src/server/parsers/transcript-parser.ts:5-16`). The current view
  filters it to this project's slug, but the store, the mental model ("what has Claude
  been doing?"), and the liveness question ("what is running *right now*?") are
  machine-scoped. When four projects run parallel agents, no per-project console can
  answer "what's live anywhere?" — that is the itch.

There is also already a third, half-hidden global surface: the **`/shell` tabbed framer**
(`src/server/routes/shell-routes.ts`, `src/server/shell/shell-page.ts`) — one tab per
*running* console, served parasitically by whichever project console is alive, with a
self-healing re-host hack (`shell-page.ts:137-141`). And the build plan already commits
to a machine-global **Hub UI** with a fleet view (plan §4a/§4b). So the "global tab" the
owner is asking for is not a new invention — it is the Hub UI, promoted into the tab
strip, plus a proper home for the machine-scoped data that today leaks into project
consoles.

### 1.2 The recommended model — **Scoped Tabs: Global Home + Project Tabs**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◉ Home │ ● ccmaf :6122 │ ● babynamey :6121 │ ○ reqtool :6124 │  [+ Add]      │ ← tab strip (Hub-served)
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Tab 0 "Home" = the Hub's own UI (:6119) rendered INLINE (it owns the       │
│   shell page — no iframe for itself). Global functions only:                 │
│     · Needs-you inbox (fleet-wide rollup)      · Global Sessions (all        │
│     · Fleet grid (plan §4b cards)                projects, live-first)       │
│     · Burn (per-project rollup)                · Add project / settings      │
│                                                                              │
│   Tabs 1..N = one iframe per project console (exactly today's /shell         │
│   mechanics). Project functions only: Dashboard, Kanban, Sessions            │
│   (project-filtered), Verify, Status, Findings, Gotchas, Contracts,          │
│   Decisions, Spec, Docs, README — plus the new per-project features.         │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ ● 3 agents live (2 here · 1 babynamey) │ needs you: 4 │ ≈41k tok today   ⚡ │ ← ticker statusbar (§2.6)
└──────────────────────────────────────────────────────────────────────────────┘
```

Concretely:

1. **The shell moves to the Hub.** `GET /shell` (and `/api/registry`) migrate from the
   per-console server to the Hub server (`hub-server.ts`, TASK-093's new file). The Hub
   never exits (plan §4a), so the self-healing re-host hack dies with the migration.
   `http://127.0.0.1:6119/` *is* the shell: tab 0 renders the Hub app in place, tabs 1..N
   iframe project consoles as today. The per-console `/shell` route stays one release as
   a redirect to the Hub (same deprecation lane as per-console `/hub`, plan §5).
2. **Tab 0 is pinned, visually distinct, and not closable.** It gets a machine glyph
   (lucide `Monitor` or `Globe`), an accent-tinted pill treatment, and the label
   **Home** — never a project name. Project tabs keep name + port + running dot. A
   *stopped-but-known* project (from `ports.json` / `knownProjects()`) may appear as a
   ghost tab (hollow dot); clicking it start-on-demands via `POST /api/hub/start`
   (plan §4b already specifies this flow for fleet cards — the tab strip reuses it).
3. **Each surface names its scope in its own header.** The Hub header reads
   `CCMAF Hub — this machine`. The project console header — which today says the generic
   "Project Console / CCMAF Surface" (`src/app/components/Shell.tsx:125-126`) — changes
   to the **actual project name** from `/api/health` `.project` (the field exists,
   `src/server/types.ts:125`). This is the strongest scope signal available: you can
   never be inside a project console and wonder which scope you're in. (This also fixes
   a long-standing blandness: every project's console currently introduces itself with
   the same name.)
4. **"Both" features follow one invariant:** *global = rollup + jump-off; project =
   full fidelity.* Global Sessions lists sessions across all projects and monitors
   liveness, and drilling into one deep-links into that project's console tab (v2.0) —
   the full 3-pane viewer stays a project-level surface. The global inbox aggregates
   every project's `/api/attention` and each item deep-links into the owning project
   tab. Nothing global ever *writes* project state (verdicts, statuses, gotchas are
   recorded in the project's own SPA with that project's write token — the plan's §2
   write-auth model is preserved untouched).

### 1.3 Why this model (and not the others)

**Rejected A — single SPA with a project switcher** (one app, a dropdown re-scopes every
page). Rejected because it fights the process architecture: each console server is bound
to one project root (`getProjectRoot()` singleton, watcher read-set, per-launch write
token). A switcher would need every server to proxy every other project's data, or a fat
global server that re-implements all read routes per root — both destroy the clean
"file-is-truth, one server per root" model (DEC-002) and the per-project token security
story for writes. It also makes URLs ambiguous (which project's `/kanban`?).

**Rejected B — scope badges on a mixed shell** (keep tabs as-is; badge each page
"machine-wide" / "this project"). Rejected as the primary mechanism: badges *explain*
a confusing IA instead of removing it, cost horizontal chrome on every page, and do
nothing for the real gap (there is no global surface to see cross-project liveness at
all). We keep ONE badge-like affordance: pages that render machine-derived data inside a
project scope (project Sessions reads the user-global store) carry their existing
subtitle note ("read from Claude Code's transcripts") — already present,
`SessionsPage.tsx:640`.

**Rejected C — global versions of every tab** (Docs, Kanban, Contracts at machine level).
Rejected per the owner's own instinct: a cross-project Docs tree or a 12-project merged
Kanban is noise. The global level only earns a surface where the *question* is global:
"what needs me?", "what's running?", "what did today cost?", "which project do I open?".
Everything else global is a *card per project* (the fleet grid), not a merged view.

**Chosen D — scoped tabs** wins because it is the only model where (a) the mental model
equals the process model (one Hub process = one global tab; one project server = one
project tab), (b) the security boundary equals the UI boundary (write tokens never cross
tabs), (c) it is already 60% built/planned (shell framer exists; Hub UI + fleet =
TASK-093/094), and (d) it degrades gracefully — a project console opened directly at
`:6122` without the shell still works fully standalone, exactly as today.

### 1.4 The scope map — every current tab, every new feature

| Surface | Scope | Where it lives in the v2 shell | Notes |
| --- | --- | --- | --- |
| Dashboard | project | project tab, nav rail (slimmed, §5.3) | Global analogue = the fleet card (plan §4b) |
| Kanban | project | project tab | Global analogue = lane mini-bars on fleet cards |
| Sessions | **both** | project tab (full 3-pane, today's view) + **Home → Sessions** (global list/monitor, §1.5) | Same parser, two lenses |
| Verify | **both** | project tab (full verify UI) + global inbox rows (pending seeds per project) | Plan §4d's "verify inbox rollup" is absorbed into #9 |
| Status | project | project tab (rebuilt as DocPage, §5.1) | |
| Findings | project | project tab (DocPage) | Open criticals also feed `/api/attention` |
| Gotchas | project | project tab | Gains a write path via #7 |
| Contracts | project | project tab | Palette-indexed (#10) |
| Decisions | project | project tab (DocPage) | ⚑/Proposed entries feed `/api/attention` |
| Spec | project | project tab | |
| Docs | project | project tab | Owner is right: global Docs would be a mess |
| README | project | project tab | |
| #1 Show-the-work links | project | Verify items → Sessions deep links | Provenance travels in the seed file, so it survives scope hops |
| #2 Burn meter | **both** | project: session/agent chips + Dashboard tile; Home: per-project daily bars | One substrate (S1) |
| #3 What-changed ledger | project | Sessions tool rail "Files" segment | Per-agent by nature |
| #4 Board time-machine | project | Kanban toolbar toggle | Needs the project's git repo |
| #5 Resume-block button | project | Sessions header + palette action | Starter library is a project file |
| #6 Live ticker statusbar | **both** | project statusbar (this project's agents) / Home statusbar (fleet) | One component, two feeds |
| #7 File-as-Gotcha | project | Sessions tool rail error actions | Writes the project's GOTCHAS.md / board |
| #8 Session swimlane | project | Sessions center-pane "Timeline" mode | Reachable FROM global Sessions via deep link |
| #9 Needs-you inbox | **both** | project: header bell + flyout; Home: the hero panel of tab 0 | One aggregator (S3) |
| #10 ⌘K palette | **both** | per-surface instance; project palettes include "switch to project…" handoff | §2.10 |

### 1.5 Global Sessions (the one genuinely two-scope tab, designed properly)

**Home → Sessions** is a *monitor*, not a reader:

```
┌ Home / Sessions ────────────────────────────────────────────────────────────┐
│ ● LIVE NOW (3)                                                              │
│ ┌──────────────────────────────────────────────────────────────────────┐    │
│ │ ● ccmaf        cols start            ui-designer · Edit sessions.css │ →  │
│ │ ● ccmaf        cols start            reviewer · Read VerifyItem.tsx  │ →  │
│ │ ● babynamey    fix name filters      developer · Bash npm test       │ →  │
│ └──────────────────────────────────────────────────────────────────────┘    │
│ TODAY                                                                       │
│   ccmaf        Console v2 design           2h ago · 638 lines · 🤖 7        │
│   reqtool      requirement import fix      4h ago · 214 lines · 🤖 2        │
│ YESTERDAY …                                            [filter: ▾ project]  │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Data:** new Hub route `GET /api/hub/sessions` → `{ project, rootPath, port?,
  sessions: SessionSummary[] }[]`. Implementation is a thin loop over
  `knownProjects()` (ports.json, plan "Reusable as-is") calling the existing pure
  `listSessions(root)` — the transcript parser is already root-parameterised
  (`listSessions(getProjectRoot())`, `sessions-routes.ts:83`), so the Hub can list ANY
  project's sessions without starting its server. Live rows additionally carry the
  latest-tool subtitle from S4 (`/api/activity`, §2.6) when that project's server is up;
  for stopped projects liveness falls back to transcript mtime (the parser's existing
  `RUNNING_THRESHOLD_MS` heuristic).
- **Interaction:** clicking a session **deep-links into the owning project tab** —
  `shell` activates (or start-on-demands) that project's tab and navigates its iframe to
  `/sessions/<id>/root` (§2.10's `postMessage` channel carries the navigation). The
  full 3-pane viewer is NOT duplicated on the Hub in v2.0.
- **v2.1 option (door left open):** because the sessions routes only need a root, the
  Hub server MAY later mount the same route plugin per-project
  (`/api/hub/projects/:key/sessions/...`) and reuse the shared React components from the
  multi-page vite build (`hub.html` already planned, plan §4b) for in-place reading of
  *stopped* projects. Design decision: prefix any Hub session route with a project key
  from day one so this needs no URL migration.
- **Project-tab Sessions is unchanged in scope** — it stays this project's filtered
  view, which is what makes it *useful* (a global-only Sessions would bury the project
  you're working in among nine idle ones).

### 1.6 Reconciliation with CONSOLE-APP-BUILD-PLAN.md (delta list)

The plan stands. This design adds/adjusts exactly this:

| Plan item | v2 delta |
| --- | --- |
| §4a Hub server + own UI (TASK-093) | Unchanged, plus: hub-server also serves `/shell` (moved from per-console `shell-routes.ts`); per-console `/shell` becomes a 307 redirect for one release |
| §4b Fleet view (TASK-094) | The fleet grid becomes the **lower half of Home**; the top half is the global Needs-you inbox (#9). `readFleet()` gains `attention: AttentionSummary` per project (from S3, disk-parse fallback for stopped projects) |
| §4c Notifications (TASK-095) | The "pure notification plan" diffs the SAME `AttentionItem[]` shape as #9 — one ranking/shape, two consumers (toast + inbox). Trigger list unchanged |
| §4d Sessionless verify (TASK-096) | Its "verify inbox rollup at the top of the fleet view" is superseded by #9's global inbox (same data, richer ranking) |
| §4g CHANNEL mailbox (TASK-099) | Untouched; still last, still design-gated. The inbox deliberately reserves a future item kind `channel-message` |
| Tab strip | New: ghost tabs for known-stopped projects; pinned Home tab; `postMessage` navigation channel (§2.10) |

---

## 2. Per-feature design — all ten

Conventions used below — **Size:** S/M/L (re-estimated). **Tier:** Fable = judgment-heavy
design or novel visual/UX; Opus = medium logic, parser/aggregation work, multi-file
integration; Sonnet = mechanical build against this spec. Every feature lists its exact
data source and new/changed endpoints. All new read routes follow the house rules:
loopback-bound, fresh-from-disk or stat-keyed cache, no write token; all new write routes
go through the existing Origin + `X-Console-Token` guard (`security.ts`).

### Shared substrate first (build these before the features)

**S1 — `src/server/parsers/transcript-insights.ts`** (new; pure, testable, reuses the
stat-keyed `jsonlCache` in transcript-parser so a 70MB transcript is parsed once):

```ts
// per agent file (root or subagent):
collectUsage(lines): UsageRollup
  // { byModel: { [model]: { input, output, cacheRead, cacheWrite, turns } },
  //   series: { ts, outputCum }[] }        // sparkline-ready cumulative
collectFileTouches(lines): FileTouch[]
  // { path, tools: {Edit|Write|NotebookEdit|Read|Bash}: n, firstTs, lastTs,
  //   lastToolUseId, turnUuid }            // Bash matched heuristically (git mv/rm, redirects) — flag as "maybe"
collectToolEvents(lines): ToolEvent[]
  // { ts, toolUseId, name, isError, turnUuid, durMs? }   // durMs from result-line ts − use-line ts when both present
```

✅ Verified: assistant transcript lines carry `message.usage` with `input_tokens`,
`output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` (incl. the
1h/5m ephemeral split) and `message.model` (checked live against a 2.1.202 transcript).
Tool inputs (`file_path` etc.) are already retained untruncated per line (the
`ToolResultDetail` endpoint returns raw `input` today).

New read routes (`sessions-routes.ts`):

```
GET /api/sessions/:id/insights                → SessionInsights
     { usage: UsageRollup,                     // whole session incl. subagents
       agents: { [agentId]: { usage, files: FileTouch[] } } }
GET /api/sessions/:id/timeline                → SwimlaneData (see #8)
```

**S2 — `contract:console-deep-links`** (new ECOSYSTEM.md contract, machine-readable
block). The grammar, all already-implemented pieces marked ✓:

```
/sessions/:sessionId/:agentId?turn=<uuid>   ✓ exists (App.tsx:25-29 + deep-link chase, SessionsPage.tsx:203-250)
/verify/:task?item=<itemId>                 NEW (VerifyPage scrolls to + flashes the item)
/kanban?task=<TASK-ID>                      NEW (opens CardDetailPanel for that task)
/sessions/:sessionId?mode=timeline&t=<iso>  NEW (#8: timeline mode, centered at time t)
Cross-scope: stored references are ALWAYS { rootPath?, sessionId, agentId, turnUuid }
tuples — never absolute URLs (ports are reassignable); the shell resolves rootPath→port
via /api/registry at click time.
```

**S3 — `GET /api/attention`** (new route `attention-routes.ts`, per project):

```ts
interface AttentionItem {
  kind: "verify" | "decision" | "doctor" | "bug" | "update" | "review";
  rank: number;            // computed: P0 bug=0, doctor CRITICAL=1, verify=2, P1 bug=3,
                           // flagged decision=4, review criticals=5, update=6 (+age tiebreak)
  title: string; detail: string;
  link: string;            // in-project route per S2
  count?: number;          // e.g. pending items in a verify seed
  since: string | null;    // ISO — drives "waiting 2d" chips
}
```

Sources (all existing parsers/flags): verify seeds with pending items (`verify/io.ts`),
`.claude/.framework-doctor-findings.md` + `.framework-update-available.md` flags
(existence + first line), open P0/P1 bugs (tasks-parser, bug lane, not Done), DECISIONS
entries with `Proposed` status or `⚑` in title (decisions-parser — add the ⚑ scan;
currently absent, verified by grep), review `openCriticals` (findings-parser). Pure
function `computeAttention(root): AttentionItem[]` so the Hub reuses it for stopped
projects AND the fleet-watch notification plan (plan §4c) diffs it.

**S4 — `GET /api/activity`** (poll, 5s client cadence; SSE unnecessary at this rate):

```ts
{ live: { sessionId, agentId, agentType, description,
          latestTool: { name, summary, ts } | null }[] }
```

Server-side implementation is the existing liveness scan (`listSessions` + tree status)
plus a tail-window read (limit 3) per live agent — exactly what `useLiveSubtitles`
(`SessionsPage.tsx:889-943`) does today from the client, moved server-side so the
statusbar (#6), the nav-rail subtitles, and the Hub's fleet liveness all share one scan.
`useLiveSubtitles` then consumes this endpoint instead of N `fetchAgentWindow` calls.

---

### 2.1 Feature #1 — Show-the-work links (Verify → the turns that built it)

**Purpose.** A Verify story is trustworthy when the human can see *how* it was built.
Each verify item gets a "Show the work" affordance that lands in the Sessions view at
the exact turns where that use-case was implemented/tested.

**The mechanism — provenance stamped at seed time.** `VerifyItem` already carries an
open `provenance?: Record<string, unknown>` field (`src/server/verify/schema.ts:74`).
Formalise it (widening, back-compat — absent stays legal):

```jsonc
"provenance": {
  "sessions": [ { "sessionId": "…", "agentId": "…", "turnUuid": "…",
                  "label": "developer: implemented parser" } ],
  "commits":  [ "3a058a8" ]            // optional, for future git cross-links
}
```

*Framework-side change (small, separate task):* the `/test` runbook + tester agent
instructions add "stamp provenance when emitting the seed" — the Tester knows its own
sessionId/agentId (transcript context) and the builder's Task tool_use ids. Contract
`contract:verify-handback` gains the optional field. Console never *requires* it.

**UX.**
- In `VerifyItem.tsx`, when provenance exists: a quiet link-row under the expected/notes
  block — `⛏ Show the work · developer: implemented parser` (one row per session ref,
  max 3, overflow "+2 more"). Click → `/sessions/<sid>/<aid>?turn=<uuid>` (S2 ✓ — the
  deep-link chase with "keep loading earlier" already handles turns outside the loaded
  window, `SessionsPage.tsx:203-250`).
- **Fallback when absent (all legacy seeds):** the row degrades to
  `⌕ Find in sessions` → `/sessions` with the search overlay pre-armed to the task ID
  (`SearchOverlay` accepts an initial query prop — small change). Honest label, still
  useful.
- From the swimlane (#8), the same turn anchor highlights the corresponding tick.

**Data/API.** No new endpoints. Schema widening in `verify/schema.ts` (validate shape
loosely: array of objects with string sessionId/turnUuid; unknown keys pass through) +
`VerifyItem.tsx` UI + SearchOverlay initial-query prop.
**Depends on:** S2. Enhanced by #8.
**Size:** S (console) + S (framework runbook/contract). **Priority:** P1 — this is the
verify-trust feature. **Tier:** Opus (schema + framework contract text), Sonnet (UI row).

### 2.2 Feature #2 — Burn meter (tokens & cost from transcripts)

**Purpose.** Answer "what did this session/agent/day cost?" from ground truth (transcript
`message.usage`), without trusting any hook to have recorded it.

**Canonical unit is TOKENS; cost is an estimate.** The console ships a
`src/server/pricing.json` — `{ patterns: [{ match: "claude-opus-*", inMTok, outMTok,
cacheWriteMTok, cacheReadMTok }...], asOf: "<date>" }`. ⚠️ The builder MUST populate
rates from Anthropic's current pricing page at build time (do not trust any model's
memory, including mine) and the UI always labels cost `≈ $x.xx est.` with a tooltip
"estimate — pricing.json as of <asOf>; tokens are exact". Unknown model → tokens only.
A consumer can override via `.claude/console/pricing.json` (project-owned, read first).

**Where it surfaces (three altitudes, one substrate S1):**

1. **Session header chip** (in `ConversationPane`'s header row, next to the existing
   turns/model meta): `⚡ 412k in · 38k out · ≈$4.10` — whole session incl. agents.
   Hover: per-model breakdown table + cache split (read vs write — the cache columns are
   what make agent-heavy sessions look cheap or expensive; show them, don't bury them).
2. **Per-agent**: the nav-rail agent row meta (`NavRail.tsx:323-329`) gains a compact
   `38k` output-token figure for finished agents (replacing nothing — sits next to
   messageCount); the ToolRail header shows the active agent's rollup. The swimlane (#8)
   scales lane bar thickness by output tokens (§2.8).
3. **Dashboard tile** "Burn (today)" (one more vitals tile — fits the existing 10-up
   `stat-card` grid): sum across today's sessions; click → Sessions.
4. **Home (global)**: fleet cards gain a `≈$ / today` mini-figure; the Home inbox column
   footer shows the machine total. Hub computes it per-project via the same pure
   functions over each root's transcript dir (only for the *visible* fleet; lazily).

**Data/API.** `GET /api/sessions/:id/insights` (S1). For "today" rollups:
`GET /api/burn?since=<iso>` → `{ byModel, totals, bySession: [{id, title, out, est}] }`
— implemented by iterating `listSessions` + per-file cached usage; bounded by the
existing `HEAD_SCAN_BYTES`-style discipline (usage lines are spread through the file, so
this endpoint reads full files — acceptable because jsonlCache makes repeats free; cap at
sessions active within the window).
**Depends on:** S1. **Size:** M. **Priority:** P1 (owner's daily question). **Tier:**
Opus (aggregators + route), Sonnet (chips/tiles).

### 2.3 Feature #3 — What-changed ledger (files touched per agent)

**Purpose.** "What did that agent actually touch?" — per-agent file list with counts,
recency, quick-open in VS Code, and an honest working-tree delta.

**UX — a second segment in the ToolRail.** The right rail header becomes a two-segment
control: `Tools | Files` (state per agent, default Tools — zero change to the existing
ledger). The Files segment:

```
┌ FILES · developer ────────────────────────────┐
│ src/app/sessions/NavRail.tsx      ✎4 ⊕1  2m ↗ │
│ src/styles/sessions.css           ✎2     8m ↗ │
│ src/server/types.ts               ✎1    15m ↗ │
│ ─ read-only ─                                 │
│ src/app/pages/SessionsPage.tsx    👁3         │
│───────────────────────────────────────────────│
│ working tree now: +214 −38 across 6 files  ⓘ  │
└───────────────────────────────────────────────┘
```

- Rows: path (middle-truncated, full on hover), badges ✎ edits / ⊕ writes / 👁 reads,
  last-touch ago. Click row → jumps the conversation to the *last* touching turn (S2
  anchor from `FileTouch.turnUuid`). The `↗` icon = **Open in VS Code** via
  `vscode://file/<absolute path>` (an `<a href>`; works from Edge/Chrome app windows;
  inside the shell iframe use `target="_blank"` — ⚠️ builder must verify the protocol
  prompt behavior in the chromeless `--app` window; fallback: a copy-path button).
  Paths from transcripts are absolute or cwd-relative — resolve against the session's
  recorded `cwd`.
- Bash-derived touches (heuristic: `>`/`>>` redirects, `git mv`, `rm`, `sed -i`) render
  in a "via shell (heuristic)" group with a dashed badge — never presented as exact.
- **Diffstat honesty:** a per-agent true diffstat does not exist (agents interleave in
  one working tree). The footer shows the *current working-tree* numstat
  (`git diff --numstat` + `git status --porcelain`, new `GET /api/worktree` route,
  read-only execFile, feature-hides when not a repo) labelled "working tree now" — with
  the ⓘ tooltip explaining it is the tree's delta, not this agent's. No fake precision.

**Data/API.** S1 `collectFileTouches` via `/api/sessions/:id/insights`; new
`GET /api/worktree` (also reused by #4's git plumbing).
**Depends on:** S1, S2. **Size:** M. **Priority:** P2. **Tier:** Opus (parser heuristics
+ worktree route), Sonnet (rail segment UI).

### 2.4 Feature #4 — Board time-machine (Kanban across git history)

**Purpose.** "Board as of Friday" — replay `.claude/TASKS.md` through its git history.

**Feasibility is already in place:** `parseTasksMd(content: string)` is exported
separately from the file reader (`tasks-parser.ts:44`) — the server can parse any
historical blob without touching disk.

**Data/API** (new `history-routes.ts`, read-only, `execFile("git", …, {cwd: root})`,
never shell-interpolated; both endpoints 404 cleanly when git/`.git` is absent →
feature auto-hides):

```
GET /api/tasks/history?limit=200
  → { commits: [{ sha, date, subject }] }       // git log --format=%H%x09%cI%x09%s -- .claude/TASKS.md
GET /api/tasks/at/:sha
  → TaskBoard + { sha, date, subject }          // git show <sha>:.claude/TASKS.md → parseTasksMd
     (:sha validated ^[0-9a-f]{7,40}$ — same strict-param discipline as sessions routes)
```

**UX.** A `History` toggle (clock icon) in the Kanban toolbar next to the existing
`TaskFilterBar`. Toggling on slides a scrubber strip under the toolbar:

```
◀ ────●──────────────────────────── ▶   Fri 03 Jul 14:22 · "board: TASK-088 done"  [× Now]
```

- The slider's stops are the commit list (newest right). Drag/arrow-keys move between
  commits; the board re-renders from `/api/tasks/at/:sha`. Debounce fetches (150ms).
- **Time-travel state is unmistakable:** the board area gets a sepia-quiet treatment —
  cards drop their accent borders, a persistent banner chip `Viewing <date> (<sha7>) —
  read-only` replaces the filter bar summary, and ALL write affordances (status select
  in `CardDetailPanel`, comments) are disabled. Live SSE refreshes are suspended while
  time-travelling (the view is pinned to a sha).
- **Diff-vs-now glow:** cards whose status differs from the present board get a soft
  underline chip `now: Done`. Cheap: the present board is already in memory; key by ID.
- Keyboard: `←/→` steps commits while the scrubber is focused; `Esc` returns to Now.

**Depends on:** nothing new besides the git routes (shares plumbing with #3's
`/api/worktree`). **Size:** M. **Priority:** P3 (delightful, not daily-critical).
**Tier:** Opus (routes + state wiring), the scrubber visual is spec'd here → Sonnet.

### 2.5 Feature #5 — Resume-block button + starter library

**Purpose.** One click to carry a session across the context-window boundary — copy a
paste-ready resume block; keep per-project starter prompts on file.

**UX.**
- **Copy resume block:** a button in the Sessions header actions (`sess-actions`,
  `SessionsPage.tsx:642-674`) and on each session row's hover actions (`⧉`). Generates
  markdown to the clipboard:

  ```
  ▶ Resume — <session title>
  claude --resume <sessionId>        (in f:\Git\Personal\…)
  Context: <title / firstPrompt, one line>
  Board: <in-progress task IDs from /api/tasks, e.g. TASK-090 In Progress>
  Last activity: <lastActivity human> · <agentCount> agents · <messageCount> lines
  ```

  Assembled client-side from data already on the page (SessionSummary + tasks fetch).
  A toast `Copied resume block` confirms (reuse the toast pattern from verify saves).
- **Starter library:** a small `Starters` popover (book icon) beside it — a list of
  named prompt blocks with `⧉ copy` per row, `+ New from clipboard`, inline rename/
  delete. Persisted to **`.claude/console/starters.json`** (project-owned, survives
  machines via git — deliberately NOT machine settings.json):

  ```jsonc
  { "schemaVersion": 1, "starters": [ { "id": "s1", "name": "Cold start + report",
      "body": "cols start…", "updatedAt": "…" } ] }
  ```

**Data/API.** `GET/PUT /api/starters` (new `starters-routes.ts`; PUT write-guarded like
verify; file created on first save; absent → `{starters:[]}`).
**Depends on:** nothing. **Size:** S. **Priority:** P2 (small, high daily value).
**Tier:** Sonnet end-to-end (this spec is sufficient).

### 2.6 Feature #6 — Live ticker statusbar

**Purpose.** The bottom bar (`Shell.tsx:212-217`, currently a dead `Terminal · Console`
label) becomes the peripheral-vision instrument: who's working, what needs me, what's it
costing — without leaving the current tab.

**Layout (project console variant):**

```
└ ● 2 agents live — ui-designer: Edit sessions.css ▸ │ ⚑ needs you: 3 │ ≈9.2k tok/hr │ ⇅ live ┘
   └───────────── zone A (activity) ────────────────┘ └── zone B ────┘ └── zone C ──┘ └ zone D ┘
```

- **Zone A — activity:** `● N agents live — <agentType>: <latest tool summary>`.
  Multiple live agents rotate every 6s with a subtle vertical slide (respects
  `prefers-reduced-motion`: no animation, shows count only + latest on hover). Idle
  state: `○ idle — last activity 2h ago`. Click → `/sessions` (the live session).
  Data: S4 `/api/activity`, polled 5s only while the tab is visible
  (`document.visibilitychange` gates the timer).
- **Zone B — attention:** `⚑ needs you: N` (amber when N>0, hidden at 0). Click →
  opens the inbox flyout (#9). Same fetch the bell uses — no extra request.
- **Zone C — burn:** rolling `≈tokens/hr` over the trailing hour (from #2's
  `/api/burn?since=`), or today's total on hover. Hidden until #2 ships (zones are
  independent).
- **Zone D — link state:** the SSE/health dot (green `live`, amber `reconnecting…`) —
  finally giving the existing events stream a visible health indicator.
- **Hub/Home variant:** zone A aggregates the fleet (`3 live — 2 ccmaf · 1 babynamey`,
  click → Home Sessions); zone B is the global inbox count; zone C machine burn.
- Visual: stays `--shell-statusbar-h: 26px` (theme.css token), `--font-size-meta`,
  text `--text-subtle` with status accents only on the dots/counts. The ticker must
  *never* pulse or glow for routine activity — motion is reserved for zone B
  transitioning 0→N (single 300ms fade). It is furniture, not a notification channel.

**Component:** `src/app/components/StatusTicker.tsx`, rendered by `Shell.tsx` footer;
props = scope feed. **Depends on:** S3, S4. **Size:** S (given S3/S4). **Priority:**
P1 — the cheapest always-on payoff. **Tier:** Sonnet (component) after Opus lands S4.

### 2.7 Feature #7 — File-as-Gotcha from a turn

**Purpose.** Institutional memory capture at the moment of discovery: a tool error in a
transcript becomes a cited GOTCHAS.md entry (or a board bug) in two clicks.

**UX.**
- Error entries in the ToolRail (and error chips in the conversation) get a hover/
  overflow action `⚑ File…` → opens a right-side drawer (reuse `CardDetailPanel`'s
  drawer shell pattern):

```
┌ File finding ──────────────────────────────┐
│ (•) Gotcha   ( ) Bug                       │
│ Title  [Bash: bats fails under Git Bash…]  │  ← pre-filled: tool + first error line
│ Category [Environment ▾]  Confidence [Med ▾]│  ← gotcha mode only
│ Severity [P2 ▾]                             │  ← bug mode only
│ Problem                                    │
│ [tool input + error excerpt, editable]     │
│ Cited turn: sessions/6f3a…/dev-a12 ¶       │  ← S2 tuple, read-only chip
│              [Cancel] [File gotcha ⚑]      │
└────────────────────────────────────────────┘
```

- **Gotcha mode** appends to `.claude/GOTCHAS.md`. ⚠️ CRITICAL FORMAT CONSTRAINT: the
  entry MUST match the doctor-enforced grammar — `**Field:**` markers and the `·`
  (U+00B7) separators exactly as `state-structure` checks them (CLAUDE.framework.md
  "Board entries are machine-read"). The server owns the serialisation (never the
  client): `POST /api/gotchas` with `{title, category, confidence, body, citation}` →
  gotchas writer mirrors `gotchas-parser.ts`'s read grammar. Round-trip test:
  parse(write(x)) ≡ x, plus a bats-level doctor pass on a fixture.
- **Bug mode** reuses the existing task-create write path (`tasks-write-routes.ts`) into
  the bug lane as `Reported` with severity; the citation tuple lands in the bug body as
  a `Source:` line. The verify PUT handler already proves board-write mechanics
  (auto-move + CR spawn) — same writeback module (`tasks/writeback.ts`).
- The filed entry's citation renders in GotchasPage as a `¶ view turn` deep link (S2).

**Data/API.** `POST /api/gotchas` (new, write-guarded); existing task-create route.
**Depends on:** S2. **Size:** M (the writer + round-trip tests are the real work).
**Priority:** P2. **Tier:** Opus (grammar-safe writer), Sonnet (drawer UI).

### 2.8 Feature #8 — Session swimlane timeline

**Purpose.** The shape of a session at a glance: which agents ran, when, in parallel
with what, where the errors cluster — and click-to-jump into any moment.

**Placement.** A center-pane **mode switch** in Sessions: `Conversation | Timeline`
segment in the pane header (route-reflected: `?mode=timeline`, S2). The nav rail and
tool rail stay — the timeline replaces only the conversation scroller, so the mental
model ("the center is the session") holds.

**Layout (SVG, no new deps):**

```
        10:12      10:20      10:28      10:36      10:44      10:52
root    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━▶ (live)
        ·   ··  ▮   ·  ·        ▮▮   ·   ·▮   ··        ✕    ·  ·
ui-des     ┌─━━━━━━━━━━━━━━━━━┐
           │ ····▮···▮▮·······│                    ← lane bar; ticks = tool events
dev        │        └─━━━━━━━━━━━━━━━━━┐
           │          ···✕···▮·········│           ← ✕ = error tick (red + hatch)
review     └────────────────────━━━━━━━━━━━┐
                                 ··▮····▮··│
        └────────────── brush: [▓▓▓▓░░░░░░░░] ─────────────┘
```

- **Lanes:** root first, then agents in spawn order, indented under their spawner with a
  thin connector elbow from the spawning turn's x-position (the tree linkage —
  `meta.toolUseId` → spawner's tool_use — already exists in `readSessionTree`).
- **Bars:** span `startedAt → lastActivity`; live agents' bars run to "now" with a
  pulsing right edge (the only motion; reduced-motion → static arrow). Bar fill =
  the agent-hue tokens that already exist (`--hue-dev`, `--hue-test`, … theme.css:127)
  at 30% mix; bar **thickness** encodes output tokens (3 steps: <5k, <25k, ≥25k) — the
  burn substrate making parallel bursts legible.
- **Ticks:** one dot per tool event (S1 `collectToolEvents`), y-jittered in-lane, color
  by tool class (edit=accent, read=muted, bash=info); errors = ✕ glyph, `--status-error`
  + the hatch geometry rule (the accent-collision defence, §3.2). Dense regions bin to
  a `▮` density block when >1 event per 2px — never overplot.
- **Interactions:** hover = tooltip (tool, summary, ts); click tick → switch to
  Conversation mode at that turn (S2 anchor, existing flash treatment); click bar →
  that agent's conversation tail; brush at bottom zooms (drag-select re-ranges x);
  `Esc` resets zoom. Cursor-sync: entering Timeline from a conversation turn centers
  on that turn's timestamp (`?t=`).
- **Empty/degenerate states:** single-agent short session → lanes collapse to root+1
  with a note "no subagents — timeline shows tool activity"; sessions >8h get a
  log-warped x-axis option OFF by default (keep linear; long idle gaps compress via
  gap-snipping markers `⌇` — two hours of nothing becomes a 12px snip glyph).

**Data/API.** `GET /api/sessions/:id/timeline` →
`{ agents: [{ id, agentType, parentId, spawnTurnUuid, startedAt, endedAt|null,
outputTokens, events: ToolEvent[] }], gaps: [{fromTs,toTs}] }` (S1 aggregation +
existing tree). Payload capped: events binned server-side past 2 000/agent.
**Depends on:** S1, S2; enriched by #2. **Size:** L (the one genuinely hard view).
**Priority:** P2 (P1 *after* #1 ships — provenance links land here).
**Tier:** **Fable-designed (this spec + the follow-up visual QA), Opus build.** The
build is mechanical SVG given this spec; the risk is taste (density, motion restraint)
— route the finished view through ux-critic with this section as the rubric.

### 2.9 Feature #9 — Needs-you inbox

**Purpose.** One ranked answer to "what needs a human?" — replacing today's scattered
signals (verify queue on Dashboard, doctor chip, P0s in Kanban, flagged decisions
nowhere).

**UX — two faces, one feed (S3):**
- **Project console:** a bell icon in the header (`console-header-right`, beside
  AccentPicker) with a count badge; click → right-anchored flyout panel (portal,
  mirrors AccentPicker's placement mechanics `AccentPicker.tsx:48-74`):

```
┌ Needs you (4) ────────────────────────────────┐
│ 🔴 P0 BUG-031  hub reap kills live console    │ → kanban?task=BUG-031
│ 🟠 DOCTOR      2 CRITICAL findings            │ → status (doctor section)
│ 🟣 VERIFY      TASK-090 · 2/6 pending  3d ⏳   │ → verify/TASK-090
│ 🔵 DECISION ⚑  CHANNEL mailbox design gate    │ → decisions#DEC-…
│ ── done for now — nothing else needs you ──   │
└───────────────────────────────────────────────┘
```

  Rows: severity glyph (color + icon, never color alone), kind chip, title, age chip
  when `since` > 24h. Click deep-links (S2) and the flyout closes. Empty state is a
  positive: `✓ Nothing needs you — 3 agents are working` (ties into S4).
- **Home (global):** the inbox IS the hero of tab 0 — a full-height left column, items
  grouped by project with project-name headers, the fleet grid to its right. Each item
  deep-links through the shell into the owning project tab (§2.10 channel). This
  fulfils and supersedes plan §4d's "verify inbox rollup".
- **Relationship to notifications (plan §4c):** the Hub's toast plan diffs successive
  `AttentionItem[]` snapshots — a NEW item of rank ≤3 toasts; the inbox is the pull
  view of the same truth. One ranking to tune, not two.

**Data/API.** S3 per project; Hub-side `GET /api/hub/attention` = fleet map of the same
(running → fetch project server; stopped → `computeAttention(root)` direct).
**Depends on:** S3. **Size:** M. **Priority:** **P0 — build first among the ten.** It
gives every other feature a place to surface and answers the owner's actual daily
question. **Tier:** Opus (aggregator + ranking), Sonnet (flyout + Home column).

### 2.10 Feature #10 — ⌘K command palette

**Purpose.** Fuzzy-jump to anything; run quick actions; hop scopes — the connective
tissue over all of v2.

**UX.** `Ctrl/⌘K` anywhere (project console AND Home). A centered glass overlay
(`--radius-overlay`, `--shadow-float` tokens):

```
┌──────────────────────────────────────────────┐
│ ⌕ nav rail order___                          │
│ ── Tasks ──                                  │
│ ▸ TASK-092  Publish v0.2.0 to npm     In Prog│
│ ── Sessions ──                               │
│ ▸ cols start · 2h ago · 7 agents             │
│ ── Actions ──                                │
│ ▸ ⧉ Copy resume block (current session)      │
│ ▸ ◐ Toggle theme        ▸ 🎨 Accent: mono …  │
│ ── Projects ──                               │
│ ▸ ⇄ Switch to babynamey                      │
└──────────────────────────────────────────────┘
```

- **Sources (project instance):** static nav pages; `/api/tasks` (ID + title + status);
  `/api/sessions` (title + ago); `/api/docs` tree filenames; contracts (IDs);
  decisions (IDs + titles); gotchas titles; **actions**: copy resume (#5), file
  gotcha from last error (#7), toggle timeline (#8), open time-machine (#4), theme/
  accent, "open in VS Code" (project root). All endpoints are existing cheap reads;
  fetch lazily on first open, refresh if >30s stale. Fuzzy = a 40-line subsequence
  scorer (`src/app/lib/fuzzy.ts`) — bonus for word starts and ID prefixes; NO dependency.
- **Cross-scope handoff:** "Switch to <project>" and global-inbox deep links post
  `window.parent.postMessage({ type: "ccmaf:navigate", rootPath, route }, "*")`; the
  shell (Hub-served) validates the origin against the registry's loopback ports,
  activates/starts the tab, then forwards the route into that iframe (same message
  shape, child-ward). Standalone (un-framed) consoles fall back to
  `window.open("http://127.0.0.1:<port>/<route>")` via `/api/registry`. This channel is
  specified once here and reused by #9's global inbox and §1.5's global Sessions —
  document as part of `contract:console-deep-links` (S2).
- **Home instance sources:** projects (open/start/hide), global sessions, global inbox
  items, Hub actions (add project, notifications toggle, restart hub).
- Keyboard: arrows/enter, `Tab` cycles source groups, `Esc` closes; recent-picks float
  a "Recent" group (localStorage, last 8).

**Component:** `src/app/components/CommandPalette.tsx` + `fuzzy.ts`, mounted in
`Shell.tsx`; Hub mounts the same component with a different source registry (the
component takes `sources: PaletteSource[]` — each `{label, fetch(), toEntry()}` — so
scope = injected list, one component).
**Depends on:** S2; actions grow as features ship (register-pattern keeps it open).
**Size:** M. **Priority:** P1. **Tier:** Opus (component + handoff protocol), Sonnet
(source adapters).

---

## 3. Theming

### 3.1 The Mono accent ("Noir") — black as the brand color

**Intent.** A seventh accent where the *chrome is achromatic*: near-black ground, ink
accent, zero hue anywhere except status semantics — the premium "stealth" look. The
existing parameterisation makes this almost free: the ground already follows
`--surface-hue` + `--surface-chroma-scale` (theme.css:265-284), and every accent surface
derives from the `--p-accent*` ladder.

**The one real design decision:** "black accent" cannot mean literal black *on the dark
theme* (black-on-near-black is invisible). Mono therefore flips the accent to the **ink
pole opposite the ground**: dark theme → the accent family is *silver/white* (reads as
"black theme" because the WORLD is black); light theme → the accent family is *near-black
ink*. Filled controls become white-chip-on-black / black-chip-on-white — the classic
monochrome-luxury move, and `--on-accent` flips accordingly (the yellow/orange accents
already prove this pattern, theme.css:692,726).

**Tokens (new block in theme.css, same grade-for-grade recipe as the other accents):**

```css
/* ── Mono (noir — achromatic ground, ink accent; premium monochrome) ── */
:root[data-accent="mono"] {
  --surface-hue: 300;              /* irrelevant at zero chroma; keep for var() sanity */
  --surface-chroma-scale: 0;       /* TRUE neutral ladder — the whole point */
  --p-accent: oklch(0.87 0 0);          /* silver — text/icon grade */
  --p-accent-strong: oklch(0.62 0 0);   /* graphite — fill/gradient/glow grade */
  --p-accent-bright: oklch(0.95 0 0);   /* lifted hover text */
  --accent-fill: oklch(0.92 0 0);       /* filled buttons: white chip… */
  --accent-fill-hi: oklch(0.97 0 0);
  --on-accent: oklch(0.18 0 0);         /* …with near-black ink — ~13:1 */
  --accent-grad-to: oklch(0.78 0 0);
  --aurora-companion: oklch(0.5 0 0);   /* gray answer — the aurora survives as sheen */
  /* No status hue sits on an achromatic accent — all four stay untouched and
     actually gain salience against the neutral ground. */
}
:root[data-theme="light"][data-accent="mono"] {
  --surface-chroma-scale: 0;
  --p-accent: oklch(0.3 0 0);           /* ink — text/icon grade on paper-white */
  --p-accent-strong: oklch(0.4 0 0);
  --p-accent-bright: oklch(0.2 0 0);
  --accent-fill: oklch(0.22 0 0);       /* black chip… */
  --accent-fill-hi: oklch(0.3 0 0);
  --on-accent: white;                   /* …white ink — ~14:1 */
  --aurora-companion: oklch(0.62 0 0);
}
```

**Keeping it premium (the depth problem).** Pure-neutral darks can read flat — the
Nocturne language leans on hue undertone for warmth. Mono compensates with *luminance*
depth: the aurora recomputes automatically from the graphite `--p-accent-strong` into a
soft silver bloom (verify it stays ≤ its current intensity — it will, same mix
percentages), and the existing `--card-sheen` white gradients carry the glass. No token
beyond the block above should need touching; if the canvas still reads dead in QA,
raise `--dot-grid-color` to `white 6.5%` *scoped to mono only* — do not touch the shared
value.

**Status legibility on mono** is the best of all accents (four hues on an achromatic
field), but the *quantity* of colored elements now visually pops — QA the Dashboard
(most status-dense page) to confirm it reads intentional, not circus. Mitigation if
needed: mono scopes pill *backgrounds* down (`--pill-*-bg` at 8% instead of 10-12%),
keeping fg/border grades.

**Picker:** add `"mono"` to `ACCENTS` (`useAccent.ts:19-26`) — order: after purple,
before blue (the two "brand" choices first) — label `Noir` (`AccentPicker.tsx:26-33`),
swatch = a half-black/half-white diagonal split circle (`data-swatch="mono"` CSS,
`linear-gradient(135deg, oklch(0.15 0 0) 50%, oklch(0.95 0 0) 50%)`) so it reads
correctly in both themes.

### 3.2 Accent-vs-status legibility (closing the prior finding)

theme.css already does the heavy lifting (per-accent semantic-hue push + the geometry
rules, theme.css:577-593). The review still flagged green/yellow — the residual gaps and
their fixes:

1. **Make the geometry rule universal, not Sessions-local.** The "status never rides on
   hue alone" defence (running=solid disc vs done=hollow; error hatch) lives only in
   sessions.css today. Promote to a global rule set in `components.css`:
   every `StatusPill`/badge always pairs color with its glyph (Check/AlertTriangle/
   XCircle/Info — already imported everywhere), Kanban column headers keep their icons
   (`KanbanPage.tsx:45-63` already does), and Dashboard tiles' tone borders gain a
   2px *left inset bar* for warn/danger (shape channel) — cheap, token-only.
2. **Yellow accent × warn:** the current push (amber 75 → orange 55, theme.css:703) is
   directionally right but lands near the orange *accent's* 55. Since only one accent is
   active at a time this is fine within yellow — the remaining confusion is warn-vs-
   accent-gold at small sizes. Push warn chroma above the accent's (0.14 → 0.17) and
   keep the icon rule; verify at 12px pill size specifically.
3. **Green accent × ok:** the ΔL+Δhue push (0.85/125 vs accent 0.77/158) passes at chip
   size; the failure mode was *tiny* live-dots. The solid-vs-hollow rule covers dots;
   extend it to the Kanban "Done" column count badge (hollow ring + check when accent
   is green — pure CSS on `[data-accent="green"]`).
4. **QA gate:** re-run the prior review's accent sweep (the `s4-*` CDP scripts in the
   scratchpad) across all **7** accents × 2 themes on Dashboard + Kanban + Sessions;
   acceptance = every status signal identifiable with the page grayscaled (the
   geometry channel test).

---

## 4. Sessions refinements

### 4.1 Most-recent agent at the top

`orderAgents` (`NavRail.tsx:89-116`) currently emits spawn/insertion order with live
pinned first among siblings. Change the sibling comparator: within each partition
(live, done), sort by `lastActivity` DESC (null last, id tiebreak for stability).
Hierarchy is preserved — children still nest under their spawner; only sibling order
flips. Result: the newest agent activity is always the top row under the session, which
matches the owner's request AND the reading pattern (you almost always want the agent
that just did something). `agentCycleOrder` inherits the same order, so `[`/`]` cycling
follows recency too — document that in the kbd hint tooltip. One subtlety: while a wave
of agents is live, re-sorting on every poll makes rows jump under the cursor — freeze
ordering for 5s after any pointer activity over the rail (simple `lastPointerTs` guard).

### 4.2 Collapsible session groups (fixing the caret bug)

Today the caret is a passive `<span>` inside the session button and `expanded` is
hard-wired to `selected` (`NavRail.tsx:159,247-249`) — so the arrow *looks* interactive
but isn't. Design:

- Promote the caret to a real nested `<button aria-expanded>` (stopPropagation) toggling
  a `collapsedSessions: Set<string>` owned by SessionsPage (persist in sessionStorage).
- `expanded = selected && !collapsed.has(id)`; selecting a *different* session auto-
  expands it (clears its collapsed flag) — selection implies interest; collapsing the
  selected session keeps selection (center pane unchanged) but frees rail space.
- Keyboard: `←/→` on a focused session row collapse/expand (standard tree-view keys);
  add `role="tree"`/`treeitem` semantics while touching this.
- Day-group headers (`sess-nav-day`) become collapsible with the same affordance —
  "Yesterday (12)" collapsing is the actual space-saver on busy machines. Live-now
  group is never collapsible.

### 4.3 Rename-aware titles

Current resolution: `session.title ?? session.firstPrompt ?? id` (`NavRail.tsx:237-238`),
where `title` comes from the transcript's `summary` line only. ✅ Verified live:
`~/.claude/sessions/<pid>.json` carries `{ sessionId, name, nameSource }` — the VS Code
extension's session name lives here (`nameSource: "derived"` for auto-names; ⚠️ the
value for a *manual rename* — presumably `"user"` or `"custom"` — must be verified by
the builder with one rename, and whether the file persists after the process exits).

Design — a **title-source ladder** in `listSessions`:

```
1. sessions-index name where nameSource ≠ "derived"   (best-effort overlay; pid files
   are live-session-scoped, so treat as a cache: also PERSIST the seen name into the
   summary shape so it survives the pid file vanishing)
2. transcript summary/ai-title line                    (today's source ✓)
3. firstPrompt snippet                                 (today's fallback ✓)
4. id prefix                                           (today's last resort ✓)
```

Add `titleSource: "rename" | "summary" | "prompt" | "id"` to `SessionSummary`; the rail
shows a subtle `✎` glyph on renamed sessions (tooltip "renamed in editor"). Persistence
of overlay names: a tiny sidecar `<stateDir>/session-names.json` (`{ [sessionId]:
{name, seenAt} }`) written by the parser layer when it observes a non-derived name —
machine-local, never in the project repo. The SSE liveness path already re-fetches the
list, so a rename appears within one poll. This design also future-proofs: any richer
rename source Claude Code adds later slots in as ladder rung 1.

---

## 5. Leftover UX polish (from the prior review)

### 5.1 Wall-of-markdown pages → one `DocPage` pattern

Status/Findings (and Decisions' body-heavy view) render raw `<Markdown>` walls
(`StatusPage.tsx:37-39` is the template). Build ONE component and apply it three times:

- **`src/app/components/DocPage.tsx`:** content column (72ch max) + right **TOC rail**
  (sticky, from h2/h3, scroll-spy highlight, hidden <1100px behind a `≡ On this page`
  popover); h2 sections render as **collapsible cards** (default expanded, chevron in
  the heading row; collapsed state per-page in sessionStorage); a header meta row:
  `Last updated <ago> · <bytes> · STATUS.md` — requires `mtimeMs` added to the
  `StateDoc` payload (`state-routes.ts`, one `statSync`).
- DecisionsPage keeps its parsed-entry cards but adopts the TOC rail (entries = TOC
  items) and default-collapses bodies beyond the newest 10 (matching the cold-start
  "top 10" reading rule — a nice framework echo).

### 5.2 Empty/loading consistency

`EmptyState` exists (`PageLayout.tsx:35-44`) but pages mix it with bare `LoadingState`
text. Add `Skeleton.tsx` (shimmer bars: `skeleton-line`, `skeleton-card`, `skeleton-
tile` variants, ~40 lines CSS respecting reduced-motion) and a per-page skeleton shape
(Dashboard = tile grid ghosts; Kanban = 3 column ghosts; Sessions already has
`sess-nav-skeleton` — align its look). Rule: *first* load = skeleton; *refetch* = keep
last data (the `useLastReady` pattern from SessionsPage.tsx:83-87 — promote it into
`pages/lib.tsx` and use everywhere); error = `ErrorState` with retry. This is a sweep
task — mechanical against this rule.

### 5.3 Dashboard hero chrome (~230px → 56px)

The `dashboard-hero` block (`DashboardPage.tsx:664+` — big "Project Console" title,
description, progress brief) duplicates what the v2 header now says (project name, §1.2
item 3) and pushes vitals below the fold. Replace with a **context strip**: one 56px
row — sprint-goal one-liner (the hero's only unique payload) + branch chip + doctor/
update chips + spec link, all existing data. The `hero-stats` pills (tasks/contracts
counts) are redundant with the tiles directly below — delete. Net: vitals and the
handback queue rise above the fold at 800px height, which is the VS Code side-panel
reality.

### 5.4 Accent-vs-status collisions — §3.2 (designed there).

### 5.5 Kanban below 1100px

Today the column grid squeezes until cards wrap illegibly. Two breakpoints (CSS-only,
`kanban-dnd.css`):

- **≤1100px:** the column row becomes a horizontal **scroll-snap track** (`overflow-x:
  auto; scroll-snap-type: x mandatory`, columns `min-width: 248px; scroll-snap-align:
  start`), lane tabs + filter bar stay sticky above; a subtle right-edge fade signals
  more columns. Matches the Sessions drawer breakpoint constant
  (`RAIL_DRAWER_QUERY`, SessionsPage.tsx:80) — keep the two in sync.
- **≤720px (webview floor):** single-column accordion — each status a collapsible
  section header with count, In Progress expanded by default.

### 5.6 Done-lane render-all

Done (and bug-lane Done) renders every card ever finished — 60+ DOM cards of pure
history (91 tasks in the live console today). Cap the *Done* column at the newest 25
with a terminal `Show all 60 →` card (expands in place; virtualise only if a project
ever exceeds ~300 — don't pre-engineer). Older-than-cap cards also drop their per-card
buttons (pure text rows) — cheaper and visually de-emphasised, which is honest: Done is
an archive, not work.

---

## 6. Recommended build sequence

Preconditions: TASK-090/091/092 (packaging/publish) proceed independently per the build
plan. Phases below are the v2 feature stream; P4 additionally needs TASK-093/094 (Hub
server + fleet). Each phase = independently shippable; each bullet = one board task
(Verify-story-sized, per the one-task-per-feature rule).

**Phase 0 — Substrate (unblocks everything) — Opus**
1. S1 `transcript-insights.ts` + `/api/sessions/:id/insights` (+ unit tests over
   fixture JSONL) — unblocks #2 #3 #8 #1.
2. S3 `/api/attention` + `computeAttention(root)` pure core — unblocks #9 #6, feeds
   plan §4c.
3. S4 `/api/activity` (+ `useLiveSubtitles` cutover) — unblocks #6, global Sessions.
4. S2 `contract:console-deep-links` (ECOSYSTEM block) + the two small new anchors
   (`/verify/:task?item=`, `/kanban?task=`) + header project-name fix (§1.2.3) — Sonnet-
   buildable, Opus writes the contract.

**Phase 1 — The daily loop (small, high-frequency wins) — mostly Sonnet on Opus rails**
5. #9 Needs-you inbox (project bell + flyout) — **P0 of the ten**.
6. #6 Live ticker statusbar (project variant).
7. #10 ⌘K palette (project instance + fuzzy lib + postMessage protocol) — Opus.
8. #5 Resume block + starters (`/api/starters`) — Sonnet.
9. §5.2 skeleton/empty sweep + §5.3 dashboard context strip + §5.6 Done cap — Sonnet.

**Phase 2 — Transcript insight features — Opus logic, Sonnet UI**
10. #2 Burn meter (chips + tile + `/api/burn`; pricing.json populated from Anthropic's
    published pricing at build time — never from memory).
11. #3 What-changed ledger (Files rail segment + `/api/worktree`).
12. #1 Show-the-work (console side; + the framework-side seed-stamping task in the
    dev repo: /test runbook + `contract:verify-handback` widening).
13. #7 File-as-Gotcha (grammar-safe writer + round-trip/doctor tests) — Opus.

**Phase 3 — Heavy views**
14. #8 Swimlane timeline (build to §2.8; ux-critic pass against that section) — Opus
    build, Fable/ux-critic acceptance.
15. #4 Board time-machine (git routes + scrubber) — Opus.
16. §5.1 DocPage (Status/Findings/Decisions) + §5.5 Kanban breakpoints — Sonnet.

**Phase 4 — Global surfaces (after TASK-093/094 land) — Opus**
17. Shell-on-Hub migration + pinned Home tab + ghost tabs + navigation postMessage.
18. Home tab v1: global inbox column (Hub `/api/hub/attention`) + fleet grid
    (TASK-094's, re-laid per §2.9) + Hub palette + Hub ticker.
19. Global Sessions list/monitor (`/api/hub/sessions`, deep-link handoff).
20. Theming: Mono accent + §3.2 legibility hardening + 7-accent QA sweep — Sonnet
    (tokens are fully specified) with screenshot QA.

Dependency picture: `0.1→{10,11,12,14}; 0.2→{5,6}; 0.3→{6,19}; 0.4→{everything
linking}; 17→{18,19}`. Phases 1–3 are entirely per-project — they need no Hub work and
can start immediately after Phase 0.

**Sizing recap of the ten:** #1 S+S · #2 M · #3 M · #4 M · #5 S · #6 S(+S4) · #7 M ·
#8 L · #9 M · #10 M — consistent with the owner's table except #8 (L confirmed) and
#6/#1 (cheaper than estimated thanks to shared substrate).

---

## 7. Open questions for the owner (blocking nothing in Phases 0–3)

1. **Home-tab content weighting** — this design makes the global inbox the hero of tab
   0 with the fleet grid second; the build plan implied fleet-first. Confirm (affects
   Phase 4 layout only).
2. **Ghost tabs for stopped projects** in the strip: include (recommended — one-click
   start) or keep stopped projects Home-only to keep the strip short? Default if silent:
   include, capped to pinned/favourite projects once >6 tabs.
3. **Rename persistence** (§4.3 ⚠️): builder must verify the `nameSource` value for a
   manual VS Code rename and pid-file lifetime; if renames turn out not to persist
   anywhere, accept the sidecar-cache design (works while the console sees the live
   session once) or drop rung 1.
4. **Pricing data** (#2 ⚠️): confirm "tokens exact, cost estimated via shipped
   pricing.json + project override" is acceptable; the alternative (tokens only, no $)
   is one deleted column.
5. **`vscode://file` links** (#3 ⚠️): acceptable protocol-handler UX in the chromeless
   app window must be smoke-tested; fallback is copy-path.
6. Mono accent name: **Noir** (picker label) — veto welcome.
