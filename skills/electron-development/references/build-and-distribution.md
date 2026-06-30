# Build and Distribution

## Dev Stack — Vite dual entry

`vite-plugin-electron/simple` builds main (ESM `.mjs`), preload (CJS
`.cjs`), and the renderer together:

```typescript
// vite.config.ts (abridged to the parts that break)
electron({
  main: {
    entry: "electron/main.ts",
    vite: { build: {
      outDir: "dist-electron",
      rollupOptions: {
        external: ["electron", "better-sqlite3", "electron-store"],
        output: { format: "es", entryFileNames: "[name].mjs" },
      },
    } },
  },
  preload: {
    input: "electron/preload.ts",
    vite: { build: {
      outDir: "dist-electron",
      rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } },
    } },
  },
  renderer: {},
});
```

```json
// package.json
{
  "main": "dist-electron/main.mjs",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "package": "electron-builder"
  }
}
```

Preload stays CJS; main can be ESM — and the `BrowserWindow` preload path
must point at the compiled `.cjs`.

## electron-builder

```json
{
  "$schema": "https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/scheme.json",
  "appId": "com.yourcompany.myapp",
  "productName": "MyApp",
  "directories": { "output": "release" },
  "files": ["dist/**/*", "dist-electron/**/*"],
  "mac": {
    "category": "public.app-category.productivity",
    "icon": "build/icon.icns",
    "hardenedRuntime": true,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist",
    "target": [{ "target": "dmg", "arch": ["x64", "arm64"] }],
    "protocols": [{ "name": "MyApp", "schemes": ["myapp"] }]
  },
  "win": {
    "icon": "build/icon.ico",
    "target": [{ "target": "nsis", "arch": ["x64"] }]
  },
  "linux": {
    "icon": "build/icons",
    "target": ["AppImage"],
    "category": "Office"
  }
}
```

Native modules add `npmRebuild`/`asarUnpack` — see native-modules.md.
Custom protocol schemes must be declared here (`protocols`) as well as
registered at runtime.

```bash
npx electron-builder --dir     # fast unpacked build for testing
npx electron-builder --mac --win --linux
```

## Signing

- **macOS**: Developer ID cert + `hardenedRuntime: true` + entitlements +
  notarisation (env: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`, or an API key). Typical entitlements for
  Electron: `allow-jit`, `allow-unsigned-executable-memory`; add
  keychain groups for keytar.
- **Windows**: OV/EV code-signing cert or SmartScreen flags every
  install. Configure via electron-builder `win.certificateSubjectName`/
  env vars; cloud signing (Azure Trusted Signing etc.) increasingly
  standard for CI.
- **Linux**: no signing gate; pick targets per audience.
- Keys/certs via CI secrets only — never in the repo.

## Auto-Update (electron-updater)

Standard pattern (verify details against current electron-updater docs —
this section is convention, not vendored from a pinned source):

```typescript
import { autoUpdater } from "electron-updater";

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify();
});
autoUpdater.on("update-downloaded", () => {
  // prompt user, then:
  autoUpdater.quitAndInstall();
});
```

```json
// electron-builder publish config — GitHub Releases is the simplest
{ "publish": { "provider": "github", "owner": "yourorg", "repo": "myapp" } }
```

Requirements: **signed builds** (macOS requires it outright; Windows
unsigned updates trip SmartScreen), HTTPS endpoints, and matching
`version` bumps — electron-updater compares semver. Generic/S3/own-server
providers exist for non-GitHub distribution. Test the full loop with a
staged release before shipping: old version → publish new → update
applies → app relaunches.

## Production Checklist

- [ ] `electron-builder --dir` output launched from Finder/Explorer:
      paths, natives, protocol handler, IPC all work
- [ ] Icons present for all targets (icns/ico/pngs)
- [ ] Signing + (macOS) notarisation succeed in CI
- [ ] Auto-update loop tested end-to-end
- [ ] Security checklist passed (ipc-and-security.md)
- [ ] App version bumped; release notes; artefacts + checksums published
