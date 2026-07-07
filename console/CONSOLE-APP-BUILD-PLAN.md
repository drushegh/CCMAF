# CONSOLE-APP-BUILD-PLAN.md — CCMAF Console as an installable, always-on app ("Option C")

**Status:** approved direction (decision settled — installable npm package `ccmaf-console`,
published from this monorepo; Hub promoted to the primary always-on app).
**Scope:** Stage 1 = package + publish (`npx ccmaf-console` works; answers TASK-072).
Stage 2 = Hub-as-app: fleet view + notifications first, sessionless verify, Add-project
picker, CHANNEL mailbox last.
**Source of truth for this plan:** the code as of 2026-07-06 at `F:/Git/Personal/CCMAF/console`
and the framework dev repo `f:/Git/Personal/claude-code-multi-agent-framework`.

---

## 1. Current architecture map (what actually exists)

Three process kinds + one driver script, all already built and tested (35 vitest files):

```
┌─ per-project Console server (one per project, detached node process)
│    src/server/main.ts            entry → startServer()
│    src/server/server.ts          buildServer(): Fastify on 127.0.0.1:<pinned port>,
│                                  serves SPA from dist/, registers all route plugins,
│                                  /api/health, /api/shutdown (token), self-registers in
│                                  the per-user registry, mtime self-reaper (env-gated)
│    src/server/project-root.ts    getProjectRoot(): walk up from cwd to `.claude/` sentinel
│    src/server/routes/*.ts        read APIs (fresh-from-disk, DEC-002 file-is-truth):
│                                    /api/dashboard /api/tasks /api/contracts /api/decisions
│                                    /api/specs /api/readme /api/verify[/:task] /api/telemetry
│                                    /api/gotchas /api/findings /api/framework /api/suggestions
│                                    /api/docs /api/events (SSE) /api/registry /api/settings
│                                  write APIs (Origin + per-launch X-Console-Token guard):
│                                    PUT /api/verify/:task (verdicts → auto-move-to-Done +
│                                    CR-spawn writeback into TASKS.md), tasks status/create,
│                                    comments, PUT /api/settings
│                                  hub surface it HOSTS for the tray (TASK-043):
│                                    GET /hub (flyout HTML), GET /api/hub/state,
│                                    POST /api/hub/{open,end,start,quit}
│    src/server/parsers/*.ts       PURE path→data parsers (tasks, decisions, contracts,
│                                  gotchas, findings, telemetry, specs, readme, suggestions)
│    src/server/watch/watcher.ts   createWatcher(): fs.watch over the read-set of THE ONE
│                                  project root (dir-watch, 250ms debounce) → SSE
│    src/server/security.ts        LAUNCH_TOKEN (per-process random), isValidToken,
│                                  isAllowedOrigin (loopback-only), resolveVerifyPath
│
├─ tray Hub (machine-global singleton, "parasitic" today)
│    src/server/hub/hub-main.ts    entry → runHub()
│    src/server/hub/hub.ts         systray2 tray icon; pid-lockfile singleton
│                                  (<stateDir>/hub.lock); 5s registry health-prune;
│                                  isHubCapable(port) probe (GET /api/hub/state);
│                                  "Open Hub" opens http://127.0.0.1:<some console>/hub
│                                  in a sized chromeless window; AUTO-EXITS when no
│                                  consoles remain (hasSeen + exit in rebuild())
│    src/server/hub/hub-page.ts    renderHubPage(token) — the flyout HTML (string template,
│                                  254 lines), served BY a project console, not the Hub
│    src/server/hub/hub-state.ts   readHubState(): registry → {running, stopped, settings}
│    src/server/hub/open.ts        chooseOpener/openConsoleUrl/openSizedWindow (chromeless
│                                  Chromium --app windows, per-URL singleton profiles),
│                                  bottomRightPosition (PowerShell work-area query)
│    src/server/hub/icon.ts        tray icon base64
│
├─ launcher CLI (the lifecycle verbs — also a library)
│    src/server/hub/launcher.ts    start|stop|open|restart --root <path>; exports
│                                  start()/stop()/open()/restart()/main() for reuse;
│                                  ensureRunning() spawns dist-server/main.js DETACHED
│                                  with cwd=root, polls registry+health 15s; stop =
│                                  POST /api/shutdown w/ shutdownToken, force-kill fallback
│    src/server/hub/registry.ts    per-user state dir (win %LOCALAPPDATA%/ccmaf-console,
│                                  mac ~/Library/Application Support/ccmaf-console,
│                                  linux XDG; override CCMAF_CONSOLE_STATE_DIR):
│                                    registry/<port>.json  (schemaVersion:1, project,
│                                      rootPath, port, pid, version, startedAt,
│                                      shutdownToken, autoStart)
│                                    ports.json            rootPath → pinned port
│                                      (assignPort base 6120 range 80; knownProjects())
│                                    settings.json         openMode/windowStyle/autoOpen
│                                    hub.lock              Hub pid singleton
│    src/server/hub/settings.ts    readSettings/writeSettings/normalizeSettings
│
└─ framework driver (in the FRAMEWORK repo, not this package)
     tools/console.mjs             thin driver for cold-start 10.5 / /wrapup:
                                   resolveConsoleDir() = CONSOLE_DIR || <repo>/console;
                                   ensureBuilt() (npm install+build in place, first run);
                                   spawns node <console>/dist-server/hub/launcher.js
                                   <verb> --root <repo>; sets CONSOLE_REAP_GRACE_MIN=60;
                                   duplicates hub.lock logic (hubRunning/ensureHub) to
                                   spawn dist-server/hub/hub-main.js if no Hub is live;
                                   duplicates registry read for the autoStart gate
```

Build today: `npm run build` (vite → `dist/`) + `npm run build:server` (tsc → `dist-server/`).
`server.ts` resolves the SPA at `resolve(__dirname, "../dist")` — dist/ is a sibling of
dist-server/, which holds inside an installed package too.

### Reusable as-is (do NOT rebuild)
- **registry.ts** — the persistent all-projects registry ALREADY EXISTS: `ports.json` is
  "every project this machine has ever consoled" (`knownProjects()`), `registry/*.json` is
  the live set. "Add project" is one `assignPort(root)` call away.
- **launcher.ts** — `start/stop/open/restart(root)` are exported functions; the Hub already
  imports `startProject`/`openProject` from it (hub-routes.ts). The Hub-as-supervisor story
  is these same calls, made from the Hub process.
- **parsers/** — pure `(path) → data`; the Hub can parse ANY project's board directly
  (stopped projects) without starting its server.
- **read APIs** — `/api/dashboard` (lane counts + handbackQueue), `/api/framework`
  (version, updateAvailable, doctorClean, healthcheckLastRun), `/api/verify` — everything
  the fleet view needs already exists per project.
- **verify write path** — PUT `/api/verify/:task` already does auto-move-to-Done + CR-spawn
  board writeback. "Sessionless verify" needs NO new verify code: it is exactly "project
  server up + browser at /verify + no agent session", which already works.
- **open.ts, settings.ts, security.ts, watcher.ts** (with one small parameterisation, §4c).

### Must change
- `package.json` — `private:true`, name `project-console`, no `bin`, no `files`, UI libs in
  runtime `dependencies` (server imports NONE of react/react-dom/react-router-dom/
  lucide-react/markdown-it — verified by grep; they are build-time only).
- `server.ts` `const VERSION = "0.1.0"` — hardcoded, must read package.json.
- `hub.ts` — auto-exit; "Open Hub" borrows a console's `/hub`; disabled when 0 consoles.
- `watcher.ts` — `buildReadSet()` bound to the singleton `getProjectRoot()`; needs a
  `rootPath` parameter for the Hub's per-project watchers.
- `launcher.ts` — does not honour the `autoStart:false` gate (only the driver does) and
  does not ensure the Hub (only the driver does). Both move INTO the launcher.
- `tools/console.mjs` (framework repo) — build-in-place, path-coupled to `<repo>/console`,
  duplicates hub.lock + registry logic. Slims to "resolve the installed CLI and call it".

---

## 2. Target architecture

**One installed npm package, three roles behind one bin:**

```
ccmaf-console (npm package, published from CCMAF monorepo /console)
  bin: ccmaf-console
    ├── `ccmaf-console hub`                → THE APP. Always-on machine singleton:
    │                                        tray icon + its OWN Fastify server
    │                                        (127.0.0.1:6119) serving the Hub UI +
    │                                        /api/hub/*. Never auto-exits. Supervises
    │                                        per-project servers via launcher functions.
    │                                        Runs per-project watchers → OS toasts.
    ├── `ccmaf-console start|stop|open|restart [--root]`
    │                                      → per-project lifecycle (existing launcher);
    │                                        `start` also ensures the Hub is running.
    └── `ccmaf-console serve`              → foreground per-project server (debug)

Process/ownership model:

  OS login ──(autostart, opt-in)──► HUB PROCESS (singleton via hub.lock)
                                      • systray icon ("Open Hub" → http://127.0.0.1:6119)
                                      • Fastify :6119 — Hub UI (fleet) + /api/hub/*
                                      • registry health-prune (owns registry hygiene)
                                      • per-project fs watchers → node-notifier toasts
                                      • starts/stops/restarts project servers on demand
                                            │ launcher.start(root) / stop(root)
                                            ▼
  PROJECT SERVER :6120+  (one per project, detached; unchanged role)
                                      • serves that project's SPA + read/write APIs
                                      • self-registers registry/<port>.json
                                      • reaped only when session-heartbeat-driven
                                            ▲
  CLAUDE SESSION (framework) ──► tools/console.mjs start/stop  (cold-start 10.5, /wrapup)
                                      • same launcher verbs, via the installed CLI
                                      • console-heartbeat hook touches registry mtime

  HUMAN (no session) ──► Hub UI :6119 → fleet view → click project →
                                      Hub starts its server if down → cockpit/verify opens
```

Key inversions from today:
- The Hub **owns its own UI** at `:6119` — it no longer needs any project console alive
  (`isHubCapable` probing and `/hub`-borrowing become legacy).
- The Hub is **primary**: it exists before and after any project console; project servers
  become its children-by-supervision (still detached processes — supervision is
  start/health/stop via the registry + launcher, not parent-child pids).
- The framework becomes **one of two equal clients** (the other is the human at the Hub UI)
  of the same launcher verbs.

Fixed Hub port: **6119** (one below the project pin base 6120, inside nothing else's range),
override `CCMAF_HUB_PORT`, actual bound port recorded in a new `<stateDir>/hub.json`
(`{schemaVersion, port, pid, version, startedAt, token}`) so the tray, driver, and consoles
discover it without hardcoding. `hub.lock` (pid) stays as the singleton mechanism;
`hub.json` is discovery.

Write-auth model (unchanged in kind): the Hub server mints its own per-launch token
(reuse `security.ts` `LAUNCH_TOKEN` — it is per-process, no project-root dependency at
import time) and injects it into the Hub UI page; Hub write endpoints use the same
Origin+token guard. The Hub UI never writes directly to project servers — project-level
writes happen in the project's own SPA (which carries that project's token). No new
cross-process token needed for Stages 1–2.

---

## 3. Stage 1 — packaging (make `npx ccmaf-console` work)

Shippable without touching the UI. Everything below is in `F:/Git/Personal/CCMAF/console`
unless marked FRAMEWORK.

### 3.1 `package.json` (exact diff)

```jsonc
{
  "name": "ccmaf-console",            // was "project-console"; VERIFIED free on npm (E404)
  "version": "0.2.0",                 // start the published line above the internal 0.1.0
  "description": "CCMAF Project Console — local dashboard, verify queue and machine Hub for CCMAF projects",
  "license": "MIT",                   // match repo LICENSE
  "repository": { "type": "git", "url": "git+https://github.com/drushegh/CCMAF.git", "directory": "console" },
  "type": "module",
  // REMOVE "private": true
  "bin": { "ccmaf-console": "bin/ccmaf-console.mjs" },
  "files": ["bin/", "dist/", "dist-server/", "README.md"],
  "engines": { "node": ">=20" },      // built-in fetch + AbortSignal.timeout are load-bearing
  "scripts": {
    // add:
    "prepack": "npm run build && npm run build:server"
    // (rest unchanged)
  },
  "dependencies": {
    // RUNTIME ONLY (server imports verified):
    "fastify": "^5.9.0",
    "@fastify/static": "^9.1.3",
    "systray2": "^2.1.4"
  },
  "devDependencies": {
    // MOVE HERE from dependencies (build-time only — bundled into dist/ by vite):
    // react, react-dom, react-router-dom, lucide-react, markdown-it
    // (+ existing devDeps unchanged)
  }
}
```

Why the dependency move matters: `npx ccmaf-console` installs `dependencies` only. With
react/vite-era libs out, the runtime install is fastify + static + systray2 — seconds, not
a minute. `prepack` guarantees dist/ + dist-server/ are current in every published tarball.

### 3.2 `bin/ccmaf-console.mjs` (new file)

```js
#!/usr/bin/env node
// Thin verb dispatcher over the built artefacts. No build logic — the package ships built.
const verb = (process.argv[2] || "help").toLowerCase();
switch (verb) {
  case "start": case "stop": case "open": case "restart": {
    const { main } = await import("../dist-server/hub/launcher.js");
    process.exit(await main(process.argv));      // launcher.main reads argv[2] as the verb — aligns as-is
  }
  case "hub":
    await import("../dist-server/hub/hub-main.js");  // runs runHub()
    break;
  case "serve":
    await import("../dist-server/main.js");          // foreground server (debug)
    break;
  case "version": case "--version": case "-v": {
    const { createRequire } = await import("node:module");
    console.log(createRequire(import.meta.url)("../package.json").version);
    break;
  }
  default:
    console.error("usage: ccmaf-console <start|stop|open|restart|hub|serve|version> [--root <path>]");
    process.exit(verb === "help" ? 0 : 2);
}
```

Note: `launcher.ts`'s `invokedDirectly` guard means importing it never auto-runs — the bin
calls the exported `main()` explicitly. No launcher change needed for dispatch.

### 3.3 Launcher absorbs the two driver-only behaviours (`src/server/hub/launcher.ts`)

1. **autoStart gate** (today only in `tools/console.mjs` lines 162–168): at the top of
   `start(root)`, `findByRoot(root)?.autoStart === false` → log "manual tray End — skipping
   respin" and return 0. Every caller (driver, Hub, bin) then honours the tray "End".
2. **ensureHub** (today only in the driver): after a successful `ensureRunning`, if no live
   Hub (`hub.lock` pid check — extract the driver's `hubRunning()` into a new exported
   `hubAlive()` in `registry.ts` next to `userStateDir()`), spawn
   `dist-server/hub/hub-main.js` detached (path via `resolve(__dirname, "hub-main.js")` —
   same dir). Print which case happened on stderr (stdout stays URL-only).

### 3.4 `server.ts` VERSION from package.json

Replace `const VERSION = "0.1.0"` with:
```ts
const require = createRequire(import.meta.url);
const VERSION: string = require("../package.json").version;   // dist-server/ → package root
```
`files` ships package.json automatically (npm always includes it), so the require resolves
in the installed layout. This makes `/api/health.version` and the registry `version` field
truthful — the Stage-2 skew handshake depends on it.

### 3.5 FRAMEWORK: `tools/console.mjs` resolution order (installed-package-first)

Replace `resolveConsoleDir()`/`ensureBuilt()` with a **command resolver**:

```
resolveConsoleCmd():
  1. CONSOLE_DIR set            → ["node", <CONSOLE_DIR>/dist-server/hub/launcher.js]   (dev override; build if missing — keep ensureBuilt for this path only)
  2. `ccmaf-console` on PATH    → ["ccmaf-console"]                                     (global install; shell:true on win32 for the .cmd shim)
  3. npx fallback               → ["npx", "-y", `ccmaf-console@${spec}`]                (spec from .console-version content, default "latest")
  4. bundled <repo>/console     → today's path incl. ensureBuilt                        (the CCMAF monorepo itself + vendored consumers)
```

PATH probe: `spawnSync(win32 ? "where" : "command", win32 ? ["ccmaf-console"] : ["-v", "ccmaf-console"], {shell:true})`,
status 0 → found. Delete the driver's duplicated `hubRunning`/`ensureHub`/autoStart-gate
blocks (now in the launcher, §3.3) and its private registry re-read (`findEntryByRoot`) —
the launcher handles all of it. The driver's remaining job: opt-in is the CALLER's gate
(unchanged), set `CONSOLE_REAP_GRACE_MIN` (unchanged), pick the command, relay stdout.

### 3.6 FRAMEWORK: cold-start step 10.5 (slimmed text)

New wording (CLAUDE.framework.md): *"If opted in (`.claude/.console-version` present, or
legacy `.claude/.console-enabled`), run `node tools/console.mjs start` (Bash tool). The
driver resolves the installed `ccmaf-console` package (PATH → npx → in-repo fallback) and
starts this project's console AND the machine tray Hub if none is running; it prints
`http://127.0.0.1:<port>` — report that URL. Idempotent; respects a manual tray "End".
`/wrapup` runs `stop`; after a console update use `restart`."* — drops: the build-in-place
paragraph, the Hub-started-vs-joined bookkeeping detail (the driver still logs it).

### 3.7 Publish + smoke (minimum viable)

1. `npm pack` in `console/` → `ccmaf-console-0.2.0.tgz` (prepack builds).
2. Smoke script `scripts/smoke-pack.mjs` (new, dev-only): create a temp fixture project
   (`.claude/TASKS.md` with 2 bracketed tasks), set `CCMAF_CONSOLE_STATE_DIR=<tmp>`,
   run `npx -y ./ccmaf-console-0.2.0.tgz start --root <fixture>`, assert stdout URL,
   `GET /api/health` → `app:"ccmaf-console"`, `GET /api/tasks` → 2 tasks,
   then `... stop --root <fixture>` → registry empty. Run via Git Bash/PowerShell.
3. `npm publish` (unscoped `ccmaf-console` is public by default; needs the npm account +
   2FA — HUMAN step). Then verify `npx -y ccmaf-console@latest version` on a clean dir.
4. Consumer proof: in the framework dev repo, delete nothing, just ensure `ccmaf-console`
   resolves from PATH (`npm i -g ccmaf-console`) and `node tools/console.mjs start` uses
   route 2.

**Stage-1 self-update answer (TASK-072):** the Console is delivered and updated as an npm
package — `npm i -g ccmaf-console` / `npm update -g ccmaf-console` (or per-use `npx @latest`).
`console/` never needs to be in `framework-manifest.txt`; adopters get console updates from
npm, decoupled from framework updates. `.console-version` content becomes the npm version
spec (§5).

---

## 4. Stage 2 — Hub-as-app (independently buildable chunks, in order)

### (a) Hub owns its own UI + stops auto-exiting — **M**

Files:
- **new `src/server/hub/hub-server.ts`** — `buildHubServer(opts: {port, distDir, stateInfo})`
  mirroring `buildServer`'s shape (factory + injected opts for tests). Registers:
  - `GET /` → Hub app HTML (Stage 2b's `dist/hub.html`; until then, serve
    `renderHubPage(LAUNCH_TOKEN)` from hub-page.ts — zero new UI needed to ship this chunk)
  - `GET /api/hub/state`, `POST /api/hub/{open,end,start,quit}` — MOVE the handler bodies
    from `src/server/routes/hub-routes.ts` into a shared module
    `src/server/hub/hub-actions.ts` (endByPort, open/start dispatch); both the Hub server
    and (for one transition release) the per-console hub-routes call them.
  - Same write-guard pattern: factor `makeWriteGuard` out of `server.ts` into
    `src/server/write-guard.ts`; Hub server uses its own process `LAUNCH_TOKEN`.
  - `POST /api/hub/restart {root}` (new) → `launcher.restart(root)` — needed by (f) skew.
  - CRITICAL: hub-server must never touch `project-root.ts`'s `getProjectRoot()` (it
    `process.exit(1)`s without a `.claude/`; the Hub runs from anywhere). Importing
    `security.ts` is safe (token is root-free); do not register any project route plugin.
- **`src/server/hub/hub.ts`** —
  - delete the auto-exit branch in `rebuild()` (`hasSeen` + "no consoles left — exiting");
  - start the Hub server on startup: `await startHubServer()` before `systray.ready()`;
    write `<stateDir>/hub.json` (schemaVersion, port, pid, version, startedAt); delete on exit
    next to `releaseSingleton()`;
  - `openHubWindow()` → always `openSizedWindow("http://127.0.0.1:<hubPort>/", …)`; delete
    `isHubCapable` + hubHost roulette; "Open Hub" always enabled;
  - keep: singleton lock, 5s health-prune (now the Hub's registry-hygiene duty), tray menu.
- **`src/server/hub/registry.ts`** — add `hubInfoPath()`, `readHubInfo()`, `writeHubInfo()`,
  `hubAlive()` (from §3.3).
- **autostart (opt-in)**: new `src/server/hub/autostart.ts` + bin flag
  `ccmaf-console hub --autostart on|off`: win32 → `schtasks /create /sc onlogon /tn
  CcmafConsoleHub /tr "\"<process.execPath>\" \"<abs hub-main.js>\""` (schtasks runs hidden;
  a Run-key node.exe would flash a console window); darwin → LaunchAgent plist; linux →
  `~/.config/autostart/ccmaf-hub.desktop`. Windows-first; others best-effort.

Acceptance: with ZERO project consoles running, `ccmaf-console hub` shows the tray, serves
`http://127.0.0.1:6119/` with the running/stopped project list, Start/Open/End work, and the
process survives the last console stopping. `hub.json` appears/disappears with the process.
Existing `tests/hub*.test.ts` updated; new `tests/hub-server.test.ts` (factory + temp state dir).

### (b) Fleet/portfolio view — **M**

Files:
- **vite.config.ts** — multi-page build:
  `build.rollupOptions.input = { main: "index.html", hub: "hub.html" }`; new root
  `hub.html` + `src/hub/main.tsx` + `src/hub/HubApp.tsx` (React, reuses `src/styles/*` and
  the existing pill/row look from hub-page.ts). Hub server serves `dist/hub.html` (token
  injected via the same `injectTokenIntoHtml`) + `@fastify/static` for `dist/assets`.
- **new `src/server/hub/fleet.ts`** — `readFleet(): Promise<FleetProject[]>`:
  - union of `readRegistry()` (running) + `knownProjects()` (ports.json) minus
    `settings.hiddenRoots` (§4e);
  - **running** → parallel `fetch` per project with 1500ms timeouts:
    `/api/dashboard` (taskCounts by lane/status + handbackQueue), `/api/framework`
    (updateAvailable, doctorClean, version, healthcheckLastRun), `/api/health` (version);
  - **stopped** → direct disk reads with the EXISTING pure parsers:
    `parseTasksFile(join(root, ".claude/TASKS.md"))` for lane counts; verify queue =
    `readdirSync(join(root, ".claude/console/verify"))` count of `(TASK|BUG)-\d+\.json`;
    flags = `existsSync(join(root, ".claude/.framework-update-available.md"))` /
    `.framework-doctor-findings.md`. (Do NOT import verify/io.ts or dashboard code — they
    are bound to the singleton project root.)
  - shape: `{ project, rootPath, running, port?, serverVersion?, lanes: {status,n}[],
    verifyPending, updateAvailable, doctorClean, lastActivity }`.
- **hub-server.ts** — `GET /api/hub/fleet` → `readFleet()` (no guard, read-only, loopback).
- **UI**: fleet grid — one card per project: name, running dot, lane mini-bars, verify-queue
  badge, doctor/update chips; actions Open / Start / End / Verify (deep link). Clicking a
  stopped project: `POST /api/hub/start {root}` → poll `/api/hub/fleet` until running →
  `POST /api/hub/open {port}`. All endpoints exist today except `/api/hub/fleet`.

Acceptance: Hub UI lists every project ever consoled on the machine, shows correct lane
counts for BOTH a running and a stopped project (test fixture), deep-links start-on-demand,
and degrades per-card (a hung server → card marked unreachable, others render). Unit tests:
`fleet.test.ts` with temp state dir + fixture projects, fetch mocked.

### (c) Desktop notifications — **M**

Files:
- **dependency**: `node-notifier` (^10) — SnoreToast on Windows (AppUserModelID handled),
  terminal-notifier on mac, notify-send on linux. Runtime dep (~ small). [Product decision
  #3 confirms; zero-dep PowerShell toast rejected as brittle.]
- **`src/server/watch/watcher.ts`** — parameterise: `createWatcher(rootPath?: string)`;
  `buildReadSet(root = getProjectRoot())` takes the root through `join(root, ".claude", …)`
  instead of `dotClaudePath`. The per-project server keeps calling `getWatcher()` (unchanged
  default). One added read-set entry under a flag is NOT needed — the read-set already
  watches `.claude/` top-level files incl. the doctor/update flags' directory, and
  `.claude/console/verify/` + `.claude/telemetry/` recursively.
- **new `src/server/hub/fleet-watch.ts`** — in the Hub process: one `createWatcher(root)`
  per fleet project (running or not; cap ~20 watchers, cheap dir handles). On change,
  compute a **pure notification plan** (unit-testable): diff previous→current snapshot of:
  1. verify seeds with pending items (`verifyPending` rose, or a new `<ID>.json` appeared)
     → toast `"<project>: TASK-123 ready to verify"`;
  2. `.claude/.framework-doctor-findings.md` appeared → `"<project>: doctor found problems"`
     (read first line; prefix CRITICAL if it contains one);
  3. `.claude/.framework-update-available.md` appeared → `"<project>: framework update available"`;
  4. agent/session finished → trigger = this project's registry entry deleted while its
     `.claude` kept changing recently (a `/wrapup` stop), OR a `Stop` event line appended to
     `.claude/telemetry/events.jsonl` — VERIFY the telemetry line shape against
     `analytics-routes.ts`'s parser before wiring; ship 1–3 first, 4 behind a follow-up flag.
  - dedupe: `<stateDir>/notify-state.json` `{ [root]: { [kind]: lastKeyNotified } }` so a
    Hub restart doesn't re-toast old state; quiet-hours/off toggle in settings.json
    (`notifications: "all" | "verify-only" | "off"`, default "all") via `normalizeSettings`.
- **click-through**: node-notifier click event → `openConsoleUrl` at the project's cockpit
  (`/verify` for kind 1). Windows-reliable; mac/linux best-effort.

Acceptance: with the Hub running and a fixture project, writing a new verify seed file
produces one OS toast within ~1s, clicking it opens that project's /verify; deleting +
re-creating the same seed does NOT re-toast (dedupe); settings "off" silences. Pure-plan
unit tests cover all triggers; the spawn layer is manual-smoked on Windows.

### (d) Sessionless verify — **S**

Falls out of (a)+(b); the residual work:
- Fleet card "Verify (n)" button → start-if-down (existing `/api/hub/start`) → open
  `http://127.0.0.1:<port>/verify`. Verdict writes use the project SPA's own token; the
  existing PUT handler already moves tasks to Done / spawns CR follow-ups on the board —
  no agent session involved anywhere.
- Policy note: Hub-started servers have NO `CONSOLE_REAP_GRACE_MIN` in env (launcher only
  forwards what it got; the Hub doesn't set it) → they are never self-reaped, by design
  ("manual/un-wired starts are never reaped"). The Hub's End button (and its health-prune
  for crashes) is the teardown. Document this in the lifecycle contract rewrite.
- Optional polish: a "verify inbox" list at the top of the fleet view (flatten every
  project's pending seeds, newest first) — same `/api/hub/fleet` data, UI-only.

Acceptance: with NO Claude session running anywhere, a human at the Hub can open a stopped
project's verify queue, record verdicts, and see the task move to Done in TASKS.md.

### (e) "Add project" picker + persistent all-projects registry — **S**

The persistent registry already exists (`ports.json`); this chunk is intake + curation:
- **hub-server.ts**: `POST /api/hub/add-project {root}` (write-guarded) → validate
  `existsSync(join(root, ".claude"))` → `assignPort(root)` (persists into ports.json →
  appears in `knownProjects()`/fleet immediately) → return the fleet entry. 400 with a
  clear message when `.claude/` is missing.
- **`POST /api/hub/pick-folder`** (write-guarded; Windows-first): spawn
  `powershell -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms;
  $d=New-Object System.Windows.Forms.FolderBrowserDialog; if($d.ShowDialog() -eq 'OK')
  {$d.SelectedPath}"` → returns the absolute path or 501 on non-Windows (UI falls back to
  paste-a-path). Same pattern as `bottomRightPosition()`'s PowerShell use.
- **hide/remove**: `settings.json` gains `hiddenRoots: string[]` (normalizeSettings);
  fleet filters them; UI "Hide" per card + "Show hidden" toggle. Never delete ports.json
  pins (they are the port-stability memory).
- UI: "Add project" button → native picker (or paste field) → POST → card appears.

Acceptance: adding `F:/Git/Personal/babynamey` via the picker shows its card with correct
board counts WITHOUT ever starting its server; hiding removes it from the default view;
ports.json contains the new pin.

### (f) Version-skew handshake — **S** (cross-cutting; land with (b))

- Registry `schemaVersion` already exists on entries; keep reads defensive (they are).
- Fleet compares Hub's own package version to each running server's `/api/health.version`
  → mismatch chip "server vX (hub vY) — restart to update" → `POST /api/hub/restart {root}`.
- Hub self-update check: once/day fetch
  `https://registry.npmjs.org/ccmaf-console/latest` → newer than own version → toast +
  banner "update: npm i -g ccmaf-console" (the Hub does NOT self-mutate; npm is the
  updater — Option C's premise). After update, the tray restarts via a "Restart Hub" menu
  item (re-exec `process.execPath hub-main.js` detached, then exit).
- Board `schemaVersion` files (verify seeds `schemaVersion:1`): the validator already
  rejects unknown majors per-file; fleet counts unreadable seeds as "unknown — update
  console" rather than crashing the card.

### (g) CHANNEL mailbox — LAST, design-gated ⚑

A cross-agent mailbox (project A's session leaves a message; project B's session reads it)
is new contract surface (file location, schema, who prunes). Sequenced last deliberately;
needs its own mini-design against `.claude/` conventions (likely
`<stateDir>/channel/<from>→<to>.jsonl` + a Hub UI tab + a framework hook to surface
inbound). Not planned in detail here — do not start before (a)–(f) ship. **L**.

---

## 5. What each stage does to the contracts/framework

| Surface | Stage 1 | Stage 2 |
| --- | --- | --- |
| `.claude/.console-version` | Semantics change: presence = opt-in (unchanged); **content = npm version spec** (`latest`, `0.2.x`, `^0.3`) consumed by the driver's npx route. The dead "Console git ref" wording is deleted. Empty/legacy content → `latest`. | unchanged |
| `console-heartbeat` hook | No code change. Meaning sharpens: the heartbeat keeps a **session-started** server alive (reaper armed by the driver's `CONSOLE_REAP_GRACE_MIN`). | Hub-started servers have no reaper → the hook is irrelevant to them; the Hub's health-prune + End own their lifecycle. Document both regimes in the contract. |
| Cold-start step 10.5 | Slimmed per §3.6 (no build-in-place paragraph; driver resolves installed CLI). | Add one line: "the Hub may already be running as the always-on app; `start` just joins it." |
| `contract:console-lifecycle` (ECOSYSTEM.md, already needs rewriting per TASK-072 AC3) | Rewrite the DRIVER block: resolution order CONSOLE_DIR → PATH bin → `npx ccmaf-console@<spec>` → bundled `<repo>/console`; delete the clone-into-`.claude/.console-app/` paragraph (already dead); launcher owns autoStart-gate + ensureHub. Add: delivery/self-update = npm (TASK-072 resolution). | Add: Hub server (`hub.json`, port 6119, `/api/hub/fleet`, restart endpoint), two lifecycle regimes (session-started+reaped vs hub-started+End), notifications settings key, `hiddenRoots`. Bump to `status:stable` once the e2e loop is confirmed. |
| `tools/console.mjs` | Shrinks ~40%: loses ensureHub/hubRunning/autoStart-gate/registry-mirror; gains the 4-step command resolver. Stays the framework's stable handle (`node tools/console.mjs <verb>`), so no command/hook/agent files need retraining. | No further change. |
| `contract:console-http-api` (Console repo docs) | — | Add `/api/hub/fleet`, `/api/hub/restart`, `/api/hub/add-project`, `/api/hub/pick-folder`; mark per-console `GET /hub` + `/api/hub/*` **deprecated, one-release back-compat**, then remove (also removes `isHubCapable`). |
| `framework-manifest.txt` | Explicitly does NOT gain `console/` — npm is the delivery channel (this is the TASK-072 decision made concrete). | unchanged |

---

## 6. Build order + proposed board tasks (TASK-090+)

Smallest-shippable-first; each task = one Verify story.

| Task | Title | Size | Depends on |
| --- | --- | --- | --- |
| TASK-090 | Package `ccmaf-console`: package.json (name/bin/files/engines/prepack, dep split), `bin/ccmaf-console.mjs`, VERSION-from-package.json, `scripts/smoke-pack.mjs` green | S | — |
| TASK-091 | Launcher absorbs autoStart-gate + ensureHub (`hubAlive()` in registry.ts); driver `tools/console.mjs` slims to the 4-step command resolver; cold-start 10.5 + `contract:console-lifecycle` rewritten (closes TASK-072) | M | 090 |
| TASK-092 | Publish v0.2.0 to npm + clean-machine `npx` smoke + README install section | S | 090, 091, **human: npm account** |
| TASK-093 | Hub server + own UI host: `hub-server.ts`, `hub-actions.ts` extraction, `write-guard.ts` factor-out, `hub.json`, no auto-exit, tray → :6119, `--autostart` flag | M | 090 (ships with 092+1 patch release) |
| TASK-094 | Fleet view: `fleet.ts` + `GET /api/hub/fleet`, vite second entry `hub.html`/`src/hub/`, fleet UI, skew chip + `POST /api/hub/restart` (§4f) | M | 093 |
| TASK-095 | Desktop notifications: node-notifier, `createWatcher(root)` parameterisation, `fleet-watch.ts` pure plan + dedupe state, settings toggle, click-through | M | 094 |
| TASK-096 | Sessionless verify polish: fleet Verify deep-link + verify inbox rollup + lifecycle-regime docs | S | 094 |
| TASK-097 | Add-project picker: add-project/pick-folder endpoints, `hiddenRoots`, UI intake | S | 094 |
| TASK-098 | Hub self-update check (npm registry poll, toast + banner, Restart Hub menu item); deprecate per-console `/hub` | S | 095 |
| TASK-099 | CHANNEL mailbox mini-design (design doc only, then split) ⚑DECISION | L | 093–098 shipped |

Publish cadence: v0.2.0 after TASK-092; v0.3.0 after 093+094 (the "app" release);
v0.3.x for 095–098.

**Human/product decisions needed before building** (blockers marked ⛔):
1. ⛔ npm publish account + 2FA for `ccmaf-console` (name verified available; alternative
   scoped `@drushegh/ccmaf-console` needs `publishConfig.access:"public"`). Blocks TASK-092 only.
2. `.console-version` content = npm version spec, default `latest` — confirm (recommended).
3. node-notifier as the toast dependency (bundles SnoreToast.exe ~1MB; AV false-positive
   risk noted) — confirm (recommended over PowerShell toast hacks).
4. Hub fixed port 6119 + `hub.json` discovery — confirm.
5. Autostart mechanism on Windows = Scheduled Task (hidden) not Run key (console flash) —
   confirm; and whether `hub --autostart on` should be offered during first `start`.
6. Add-project native picker via PowerShell FolderBrowserDialog (Windows-only, paste
   fallback elsewhere) — confirm.
7. Notification trigger #4 ("agent finished") exact signal — approve shipping 095 with
   triggers 1–3 and a follow-up for #4 after verifying the telemetry event shape.

## 7. Risks + test strategy

Risks:
- **systray2 health** (last-era native-binary wrapper; AV flags possible on
  tray_windows_release.exe and SnoreToast.exe). Mitigation: both are contained in
  node_modules of a user-install; document; if systray2 breaks on a future Node, the Hub
  server+UI still function (tray is a convenience layer — keep `hub.ts` failures non-fatal
  around `systray.ready()` in TASK-093: log + continue serving :6119).
- **npx cold latency**: mitigated by the dependency split (§3.1) — runtime tree is fastify
  + static + systray2 (+ node-notifier in Stage 2). Measure in the TASK-092 smoke; if >15s
  cold, recommend `npm i -g` as the documented default and npx as fallback.
- **Windows PATH for global bins**: `npm i -g` bin dir occasionally missing from PATH in
  Git Bash sessions → driver falls through to npx automatically (resolver order is the
  mitigation; test both routes in TASK-091 bats/smoke).
- **Port 6119 squatting**: hub-server falls back to next-free like `startServer` does and
  records the REAL port in `hub.json`; tray + driver read `hub.json`, never hardcode.
- **Skew during rollout**: old consoles (pre-0.3) lack nothing the Hub NEEDS (fleet uses
  only endpoints that exist since TASK-043); per-card degradation covers hangs; the
  deprecated `/hub` route keeps old trays working one release.
- **Watcher fan-out** (one fs.watch set per project × ~20 projects): dir-handles are cheap
  and `persistent:false`; cap + lazy-start (only watch non-hidden fleet projects).
- **Toast dedupe wrong** → notification spam: pure-plan unit tests + on-disk notify-state;
  "off" switch ships in the same task as the feature.

Test strategy:
- **Unit (vitest, exists)**: keep `npm run type-check && npm test` green every task. New
  suites: `hub-server.test.ts` (factory, temp `CCMAF_CONSOLE_STATE_DIR`), `fleet.test.ts`
  (fixture roots + mocked fetch), `fleet-watch.test.ts` (pure notification plan),
  `autostart.test.ts` (command construction only, no schtasks execution).
- **Pack smoke (new, Stage 1)**: `scripts/smoke-pack.mjs` per §3.7 — the release gate for
  every publish; runs on Windows Git Bash + (best-effort) WSL for the linux state-dir path.
- **App smoke (Stage 2, manual runbook in console/docs/)**: fresh state dir → `ccmaf-console
  hub` → tray appears → :6119 fleet renders 0 projects → add-project fixture → counts
  correct → start → cockpit opens → write verify seed → toast → click → /verify → verdict
  → task Done in fixture TASKS.md → End → hub still alive. Windows is the primary target;
  mac/linux paths are code-reviewed + unit-tested (state dirs, xdg-open/notify-send
  branches) but marked UNVERIFIED in the README until exercised.
- **Framework side**: bats additions where driver behaviour changed (resolver order,
  no-ensureHub), plus the real dogfood: opt this repo in and run cold-start 10.5 through
  the installed package (route 2), which is the actual TASK-091 acceptance.
