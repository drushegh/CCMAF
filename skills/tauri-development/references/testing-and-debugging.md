# Testing and Debugging

## Frontend Unit Tests — mock the IPC

`@tauri-apps/api/mocks` simulates the Tauri runtime so frontend logic
tests run without the native app:

```typescript
import { mockIPC, mockWindows, clearMocks } from "@tauri-apps/api/mocks";
import { invoke } from "@tauri-apps/api/core";
import { vi, describe, it, expect, afterEach } from "vitest";

afterEach(() => clearMocks());          // always — mocks leak across tests

it("mocks a command", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "add") return (args as { a: number; b: number }).a + (args as { a: number; b: number }).b;
  });
  expect(await invoke("add", { a: 12, b: 15 })).toBe(27);
});

it("mocks events (v2.7+)", async () => {
  mockIPC(() => {}, { shouldMockEvents: true });
  // emit/listen now work against the mock bus
});

it("mocks windows", () => {
  mockWindows("main", "settings");      // first = current window
});
```

Vitest config: `environment: "jsdom"`; a setup file can stub
`window.__TAURI_INTERNALS__` for spying on raw invokes.

## Rust Unit Tests

Command logic is plain Rust — factor it out of the `#[tauri::command]`
wrapper and test it directly per rust-development's testing reference.
Keep the command layer thin (deserialise → call → serialise).

## E2E — tauri-driver + WebDriver

| Platform | Support | Driver |
|---|---|---|
| Windows | full | msedgedriver |
| Linux | full | WebKitWebDriver (`webkit2gtk-driver`, run under `xvfb` in CI) |
| **macOS** | **none** | WKWebView has no WebDriver tooling |

```bash
cargo install tauri-driver --locked
# Linux: sudo apt install webkit2gtk-driver xvfb
```

WebdriverIO config essentials: `hostname: '127.0.0.1'`, `port: 4444`,
`maxInstances: 1`, capability `browserName: 'wry'` with
`'tauri:options': { application: '../src-tauri/target/release/app' }`;
spawn `tauri-driver` in `onPrepare`, kill in `onComplete`. Build the app
(`tauri build` or debug build) before E2E runs. Selenium works on the
same driver if preferred.

CI: Linux runner with xvfb is the cheapest E2E lane; cover macOS with
unit/integration tests plus manual smoke tests.

## Debugging

```rust
// Dev-only code
#[cfg(debug_assertions)]
{
    let window = app.get_webview_window("main").unwrap();
    window.open_devtools();
}
```

- Rust side: `println!`/`dbg!` appear in the `tauri dev` terminal;
  `RUST_BACKTRACE=1 tauri dev` for traces. Prefer `tracing` for real
  logging (rust-development).
- WebView side: right-click → Inspect, or Ctrl+Shift+I / Cmd+Option+I.
  Engine differs per OS — WebKit (Linux/macOS), Edge Chromium (Windows):
  test webview-sensitive CSS/JS on each.
- Production diagnosis: `tauri build --debug` keeps devtools. The
  permanent `devtools` cargo feature uses private macOS APIs — **App
  Store rejection** — dev/debug builds only.
- VS Code: `vscode-lldb` extension; launch config runs
  `cargo build --manifest-path=./src-tauri/Cargo.toml` with the frontend
  dev server as `preLaunchTask`.

## Troubleshooting Flows

**`tauri dev` won't start**: run `beforeDevCommand` standalone → does the
frontend dev server boot? `devUrl` port matches? toolchains present
(`npx tauri info`)?

**White screen**: devUrl/port mismatch, frontend not building, or CSP
blocking — open DevTools and read the console.

**Command not found / returns undefined**: `#[tauri::command]` present →
in `generate_handler![]` → names match (JS camelCase ↔ Rust snake_case) →
command actually returns a value.

**Permission denied**: capability targets the right window label →
permission identifier spelled exactly → scope covers the actual
path/URL/args being used.

**Build fails**: run frontend build alone; check `frontendDist` matches
its output; retry with explicit `--target`; if only release signing
fails, isolate cert/key config.

**Report format** (from bifangknt, worth keeping): failed command + full
error snippet, platform + Rust + package-manager versions, minimal
reproduction command, then the fix.
