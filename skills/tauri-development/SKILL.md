---
name: tauri-development
description: >-
  Tauri v2 cross-platform desktop and mobile development: Rust↔frontend IPC,
  the capability/permission security model, configuration, plugins, builds,
  signing, and testing, with detailed topic references loaded on demand. Use
  this skill whenever a Tauri project is created, edited, reviewed, or
  debugged — even if the user doesn't say "Tauri". Triggers include:
  tauri.conf.json, src-tauri, #[tauri::command], invoke()/emit()/Channel,
  capabilities or permissions files, tauri dev/build failures, white screen
  on launch, "command not found"/"permission denied" in a desktop app,
  bundling/signing/updater work, or converting a web app to desktop/mobile.
---

# Tauri Development

Consolidated Tauri v2 engineering for agents. The rules here always apply;
load `references/` files only when the task touches that topic.
Boundaries: Rust language standards live in rust-development; frontend
code in typescript-development/react-development/frontend-development.
This skill owns the Tauri layer — IPC, security model, config, packaging.

## Baseline: v2 Only — v1 APIs Are Removed

| v1 (never use) | v2 |
|---|---|
| `allowlist` in tauri.conf.json | capability files in `src-tauri/capabilities/` |
| `@tauri-apps/api/tauri` | `@tauri-apps/api/core` |
| `SystemTray` | `TrayIconBuilder` |
| `app.get_window()` | `app.get_webview_window()` |

## Project Structure Rules

```
src-tauri/
├── src/main.rs          # THIN passthrough only: fn main() { app_lib::run() }
├── src/lib.rs           # ALL logic: commands, state, builder — mobile builds
│                        #   replace main() with #[cfg_attr(mobile, tauri::mobile_entry_point)]
├── capabilities/        # permission grants (deny-by-default without them)
├── tauri.conf.json      # devUrl, beforeDevCommand, frontendDist, bundle, security
└── Cargo.toml           # [lib] crate-type = ["staticlib", "cdylib", "rlib"] — all three for mobile
```

## IPC — pick the right primitive

| Primitive | Direction | Use for |
|---|---|---|
| Command (`invoke`) | Frontend → Rust → response | Fetch/compute/mutate with a result and typed errors |
| Event (`emit`/`listen`) | Either way, fire-and-forget | Background notifications, multi-window broadcast — no acknowledgement |
| Channel (`Channel of T`) | Rust → Frontend stream | High-frequency progress/streaming, scoped to one invocation |

Core command rules: **every command registered in
`tauri::generate_handler![...]`** (missing = silent "command not found");
return `Result of T, E` with a `Serialize`-able error; **async commands take
owned types** (`String`, not `&str` — borrows can't cross await); JS
camelCase ↔ Rust snake_case argument conversion is automatic. Shared
state: `.manage(Mutex::new(AppState{...}))` + `State of Mutex of AppState`
— exact type match or panic. Details: [references/ipc.md](references/ipc.md).

## Security Model — deny by default

Three layers: **capability** (named permission collection bound to
specific `windows` labels) → **permission** (`fs:allow-read-file`) →
**scope** (constrains it to `$APPDATA/*` paths, URL patterns, command
args). Nothing works without explicit grants — even "safe" core
operations need `core:default`.

Rules: least privilege — scope `fs`/`http`/`shell` to specific
paths/URLs/binaries, never blanket grants; bind capabilities to the
windows that need them; **installing a plugin without adding its
permission string to a capability = silent runtime failure** — always
pair. Details: [references/security.md](references/security.md).

## Critical Pitfalls — always check

| Symptom | Root cause | Fix |
|---|---|---|
| "Command not found" | Not in `generate_handler![]` | Register it |
| "Permission denied" | Missing capability/permission | Add to `capabilities/*.json`, check window binding + scope |
| Plugin feature silently fails | Permission string missing | Add `pluginname:default` (or scoped) to capability |
| White screen on launch | Frontend not served/built | `devUrl` matches dev server port; `beforeDevCommand` runs; check DevTools |
| Compile error on async command | Borrowed `&str` parameter | Owned `String` |
| State panic | `State of T` type ≠ `.manage()` type | Exact type match |
| Works on desktop, breaks mobile | Desktop-only API (tray, multi-window, some plugins) | Check plugin platform matrix; `#[cfg(desktop)]`/`#[cfg(mobile)]` |
| Mobile build fails | Missing Rust targets | `rustup target add aarch64-linux-android …` / iOS targets |
| Updater fails in production | Unsigned artifacts or HTTP endpoint | `cargo tauri signer generate`, HTTPS only |
| IPC timeout | Blocking work in async command | `spawn_blocking` / async I/O (see rust-development) |

Never hardcode paths — use `app.path()` APIs (`$APPDATA`, `$HOME` vars in
scopes).

## Workflow (build order matters)

1. **Baseline first**: minimal runnable app, `tauri dev` green.
2. **One command round-trip**: smallest `#[tauri::command]` + `invoke`
   smoke test before adding state/async complexity.
3. **Then tighten security**: split capabilities per window/feature,
   minimum permissions, scoped access.
4. **Then plugins, incrementally**: install → register in builder → add
   permission → verify, one at a time.
5. **Then build/release**: `tauri build` per target; signing, notarisation,
   installers last. Details: [references/config-and-builds.md](references/config-and-builds.md).

## Agent Workflow Rules

1. **Inspect first**: `tauri.conf.json`, `capabilities/`, `Cargo.toml`,
   package manager in use (don't mix npm/pnpm/bun), and `npx tauri info`
   for version sanity.
2. **After any Rust command change**, run an `invoke` smoke test from the
   frontend — registration and serde mismatches fail at runtime, not
   compile time.
3. **Permission changes**: state which window/feature needs it and the
   narrowest scope that works; never widen to "make it work" without
   flagging it.
4. **Before completion**: `tauri dev` runs clean; `cargo clippy` on
   src-tauri (rust-development rules apply); frontend checks per its
   skill; for release work, a successful `tauri build` for at least the
   primary target.
5. **Report**: commands run, files changed, how to verify, and any
   security/platform risks (over-broad scopes, desktop-only APIs, signing
   gaps).

## Reference Index

| Load when the task involves... | File |
|---|---|
| Commands, events, channels, state, IPC errors, serde boundary, windows | [references/ipc.md](references/ipc.md) |
| Capabilities, permissions, scopes, CSP, multi-window security | [references/security.md](references/security.md) |
| tauri.conf.json, Cargo.toml, dev/build, bundles, signing, CI | [references/config-and-builds.md](references/config-and-builds.md) |
| Official plugins, updater, tray, sidecars, deep links, asset protocol | [references/plugins-and-runtime.md](references/plugins-and-runtime.md) |
| Unit/E2E testing, mocking IPC, DevTools, debugging, troubleshooting | [references/testing-and-debugging.md](references/testing-and-debugging.md) |
