# Plugins and Runtime Features

## The Plugin Pattern — three steps, always

```bash
cargo tauri add fs        # 1. install (adds crate + JS package + registers)
```

```rust
// 2. ensure registered in lib.rs builder (tauri add usually does this)
tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
```

```json
// 3. add permission to a capability — WITHOUT THIS IT SILENTLY FAILS
{ "permissions": ["fs:default"] }
```

Official plugins: fs, dialog, shell, http, store, clipboard-manager,
notification, global-shortcut, updater, deep-link, opener, process. Check
the platform-support matrix at `v2.tauri.app/plugin/<name>/` before using
on mobile — several are desktop-only.

## Updater

Signing is **mandatory** — unsigned artifacts are rejected; endpoints must
be HTTPS.

```bash
cargo tauri signer generate -w ~/.tauri/myapp.key   # private key + pubkey
TAURI_SIGNING_PRIVATE_KEY=... cargo tauri build      # produces installer + .sig
```

```json
// tauri.conf.json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": ["https://your-server.com/update/{{target}}/{{current_version}}"],
      "pubkey": "BASE64_PUBLIC_KEY"
    }
  }
}
```

Server response shape:

```json
{
  "version": "1.0.1",
  "pub_date": "2026-04-02T00:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "<.sig content>", "url": "https://…/MyApp_1.0.1_aarch64.dmg" },
    "windows-x86_64": { "signature": "<.sig content>", "url": "https://…/MyApp_1.0.1_x64-setup.exe" }
  }
}
```

```rust
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<String, String> {
    let update = app.updater().map_err(|e| e.to_string())?
        .check().await.map_err(|e| e.to_string())?;
    if let Some(update) = update {
        update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        Ok("Updated".into())
    } else {
        Ok("Already up to date".into())
    }
}
```

Capability: `updater:default`. Private key never in the repo —
`TAURI_SIGNING_PRIVATE_KEY` env in CI.

## System Tray (desktop-only)

```rust
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

tauri::Builder::default().setup(|app| {
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;
    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id.as_ref() == "quit" { app.exit(0); }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left,
                button_state: MouseButtonState::Up, .. } = event {
                if let Some(w) = tray.app_handle().get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
});
```

Linux tray needs `libappindicator`/`libayatana-appindicator`; behaviour
varies by desktop environment.

## Sidecars (bundled external binaries)

```json
// tauri.conf.json
{ "bundle": { "externalBin": ["binaries/my-sidecar"] } }
```

```json
// capability — note "sidecar": true
{ "permissions": [{
    "identifier": "shell:allow-execute",
    "allow": [{ "name": "my-sidecar", "args": true, "sidecar": true }]
}] }
```

```rust
use tauri_plugin_shell::ShellExt;

#[tauri::command]
async fn run_sidecar(app: tauri::AppHandle) -> Result<String, String> {
    let output = app.shell().sidecar("my-sidecar").map_err(|e| e.to_string())?
        .args(["--flag", "value"])
        .output().await.map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
```

Binaries are per-target-triple:
`my-sidecar-x86_64-pc-windows-msvc.exe`,
`my-sidecar-aarch64-apple-darwin`, etc.

## Deep Links

`cargo tauri add deep-link`; configure schemes under
`plugins.deep-link.desktop/mobile` in tauri.conf.json; permission
`deep-link:default`; handle via
`app.deep_link().on_open_url(|event| ...)`. Desktop registration is
automatic (Info.plist / registry / .desktop file); mobile configures the
platform manifests.

## Serving Local Files — asset protocol

Prefer the built-in `asset:` protocol over custom URI schemes:

```json
{ "app": { "security": { "assetScope": ["$APPDATA/assets/**"] } } }
```

```typescript
import { convertFileSrc } from "@tauri-apps/api/core";
const imgSrc = convertFileSrc("/path/to/image.png");
```
