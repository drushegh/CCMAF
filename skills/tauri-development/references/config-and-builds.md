# Configuration and Builds

## tauri.conf.json — the keys that break things

```json
{
    "$schema": "./gen/schemas/desktop-schema.json",
    "productName": "my-app",
    "version": "1.0.0",
    "identifier": "com.example.myapp",
    "build": {
        "devUrl": "http://localhost:5173",
        "frontendDist": "../dist",
        "beforeDevCommand": "npm run dev",
        "beforeBuildCommand": "npm run build"
    },
    "app": {
        "windows": [{ "label": "main", "title": "My App", "width": 800, "height": 600 }],
        "security": {
            "csp": "default-src 'self'; img-src 'self' data:"
        }
    },
    "bundle": {
        "active": true,
        "targets": "all",
        "icon": ["icons/32x32.png", "icons/icon.icns", "icons/icon.ico"],
        "category": "Utility"
    }
}
```

- `devUrl` must equal the frontend dev server port (mismatch = white
  screen); `frontendDist` must equal the actual build output dir.
- Frontend must be SSG/static for bundling — e.g. Next.js needs
  `output: 'export'`; SSR doesn't ship in a Tauri bundle.
- Plugins may need their own `plugins.<name>` config blocks (store,
  updater, deep-link) — check `v2.tauri.app/plugin/<name>/`.
- Platform/profile overrides: `tauri.windows.conf.json` etc.; CLI
  `--config` for variants.

## Cargo.toml

```toml
[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]   # all three — mobile requires it

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

## Commands

```bash
npm create tauri-app@latest        # scaffold (also: pnpm/bun/cargo variants)
npx tauri dev                      # dev loop (runs beforeDevCommand)
npx tauri build                    # release bundle for host platform
npx tauri build --debug            # bundle with devtools enabled
npx tauri info                     # environment/version sanity check

# Mobile (after `tauri android init` / `tauri ios init`)
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim   # macOS only
npx tauri android dev / build
npx tauri ios dev / build
```

## Bundle Targets

| Platform | Formats | Notes |
|---|---|---|
| Windows | `.msi` (WiX), `.exe` (NSIS) | NSIS can cross-build from Linux/macOS via `cargo-xwin` |
| macOS | `.dmg`, `.app` | arm64 and x86_64 are separate bundles |
| Linux | `.deb`, `.rpm`, `.AppImage` | AppImage is portable/unsigned |

## Signing — required for serious distribution

- **Windows**: OV/EV code-signing cert, or unsigned builds trip
  SmartScreen. Configure via `bundle.windows.certificateThumbprint` or
  signing env vars. Self-signed = dev only.
- **macOS**: Apple Developer cert + notarisation for distribution outside
  the App Store. Env vars: `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD`, `APPLE_TEAM_ID` — `tauri build` handles both when
  set.
- **Linux**: no mandatory signing; pick formats per target distros.
- **Updater artifacts** have their own signature scheme — see
  plugins-and-runtime.md (mandatory, separate from OS code signing).

## CI Checklist

- Pin toolchains; install OS deps (Linux: `libwebkit2gtk`, appindicator
  libs for tray).
- Secrets via env: `TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`), Apple/
  Windows cert vars. Never commit keys.
- Build matrix per target platform; run `tauri build` per-OS (no
  full cross-compile except Windows-from-Linux via NSIS/cargo-xwin).
- Verify `beforeBuildCommand` produces `frontendDist` before `tauri build`
  runs.
