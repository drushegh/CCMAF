---
name: electron-development
description: >-
  Electron desktop development: main/preload/renderer process model, secure
  IPC via contextBridge, packaged-app path resolution, native modules,
  electron-builder packaging/signing, and auto-update, with detailed topic
  references loaded on demand. Use this skill whenever an Electron project
  is created, edited, reviewed, or debugged — even if the user doesn't say
  "Electron". Triggers include: BrowserWindow, ipcMain/ipcRenderer,
  contextBridge or preload scripts, electron-builder/forge config,
  NODE_MODULE_VERSION mismatch, app works in dev but fails packaged,
  better-sqlite3/keytar in desktop apps, OAuth in a desktop app, code
  signing or auto-update for desktop distribution.
---

# Electron Development

Consolidated Electron engineering for agents. The rules here always apply;
load `references/` files only when the task touches that topic.
Boundaries: TypeScript/React standards live in their skills;
tauri-development is the sibling for Rust-based desktop. This skill owns
the Electron layer — processes, IPC, security, packaging.

## Process Model

```
MAIN (Node.js + Electron APIs)          — fs, native modules, dialogs, protocol handlers
  │  ipcMain.handle / webContents.send
PRELOAD (contextBridge)                 — the ONLY bridge; typed, allowlisted API
  │  window.electron.*
RENDERER (browser context, React/web)   — NO Node.js access, ever
```

All privileged work happens in main; the renderer asks via the typed
preload API. Details: [references/ipc-and-security.md](references/ipc-and-security.md).

## Security Non-Negotiables

```typescript
new BrowserWindow({
  webPreferences: {
    preload: join(__dirname, "preload.cjs"),
    contextIsolation: true,    // REQUIRED — isolates preload from renderer
    nodeIntegration: false,    // REQUIRED — no Node in renderer
    sandbox: true,             // default ON; disable ONLY for native modules, documented
  },
});
```

- **Never expose raw `ipcRenderer`** through contextBridge — expose
  specific, typed methods over an explicit channel allowlist.
- **Validate inputs in every `ipcMain` handler** — the renderer is
  untrusted (XSS in the webview becomes RCE if handlers are sloppy). No
  handler may execute arbitrary strings or traverse caller-supplied paths.
- **Secrets**: OS keychain (`keytar`/`safeStorage`) — never plaintext
  config or localStorage. No hardcoded encryption keys — derive
  (e.g. machine ID) or use safeStorage.
- External links via `shell.openExternal` after URL validation; block
  arbitrary navigation; CSP configured for production.

## Critical Pitfalls — always check

| Symptom | Root cause | Fix |
|---|---|---|
| Works in terminal, fails from Finder/Explorer | `process.cwd()` is `/` or `System32` when GUI-launched | `app.getPath('userData')` / `app.getAppPath()` — never cwd or bundle-time `__dirname` for runtime files |
| `NODE_MODULE_VERSION` mismatch | Native module built for system Node, not Electron's | `electron-rebuild` (postinstall) / `npmRebuild: true` |
| Native module won't load in package | Bundled into JS or trapped in asar | `external:` in bundler + `asarUnpack` (or `asar: false`) + include in `files` |
| `window.electron` undefined | Renderer ran before preload finished | Optional-chain + existence check in components |
| Crash on `sandbox: true` | Native `.node` module in preload chain | `sandbox: false` with documented trade-off, or pure-JS/WASM alternative |
| Spawned CLI not found in packaged app | GUI apps don't inherit shell PATH | Resolve absolute binary paths; check login-shell PATH explicitly |
| OAuth callback lost | State in memory, app restarted; protocol not registered | Persist state (electron-store), `setAsDefaultProtocolClient` + single-instance lock |

Details: [references/processes-and-paths.md](references/processes-and-paths.md)
and [references/native-modules.md](references/native-modules.md).

## IPC Quick Rules

- Request-response → `ipcRenderer.invoke` / `ipcMain.handle`. Events
  main→renderer → `webContents.send` / `on` (return the unsubscribe and
  call it on teardown). Fire-and-forget renderer→main → `send`/`on`.
- One typed `ElectronAPI` interface, exposed once
  (`contextBridge.exposeInMainWorld`), declared globally for TS, consumed
  through a guard hook (`isElectron`) so the renderer also runs in a plain
  browser during dev.
- Namespace channels (`auth:get-session`, `store:set`) and allowlist them
  in preload.

## Stack Baseline (greenfield)

Vite + `vite-plugin-electron` (dual entry: main → ESM `.mjs`, preload →
CJS `.cjs`), React + TypeScript renderer, `electron-builder` for
packaging, `electron-updater` for updates, `electron-store` for
preferences. Match whatever the repo already uses (Forge, webpack) —
don't migrate tooling unasked.

## Agent Workflow Rules

1. **Dev-mode green is not done.** The classic Electron failure class
   only appears in the packaged app launched from the GUI: paths, natives,
   PATH, protocol handlers. For anything touching those, verify with a
   packaged build (`electron-builder --dir` is enough) launched from
   Finder/Explorer, not the terminal.
2. **After IPC changes**: smoke-test the round-trip; check the channel is
   allowlisted in preload AND handled in main — a miss on either side
   fails silently or throws "Invalid channel".
3. **Adding a native module**: external in bundler → rebuild for Electron
   → asarUnpack/files entry → packaged-app test. All four, every time.
4. **Security review on every PR touching preload/main**: run the
   checklist in ipc-and-security.md; flag any widening of the exposed API
   surface.
5. **Before completion**: typecheck/lint/test per typescript-development;
   `npm run build` + package succeeds; no `console.log` debugging left in
   main (it lands in users' terminals/logs).

## Reference Index

| Load when the task involves... | File |
|---|---|
| contextBridge, IPC handlers, credentials/keychain, OAuth, security checklist | [references/ipc-and-security.md](references/ipc-and-security.md) |
| Path resolution, userData layout, spawning CLI tools, process env | [references/processes-and-paths.md](references/processes-and-paths.md) |
| better-sqlite3/keytar/sharp, rebuilds, asar, bundler externals | [references/native-modules.md](references/native-modules.md) |
| Vite config, electron-builder, signing/notarisation, auto-update, release checklist | [references/build-and-distribution.md](references/build-and-distribution.md) |
