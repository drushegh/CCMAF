# Native Modules

Native modules (`.node` bindings) must be compiled against **Electron's**
Node ABI, not the system Node — and they can't be bundled into JS. Four
steps, every time you add one: externalise → rebuild → package config →
packaged-app test.

| Module | Purpose | Notes |
|---|---|---|
| `better-sqlite3` | SQLite | needs rebuild; needs `sandbox: false` if loaded via preload chain |
| `keytar` | OS keychain | macOS needs keychain entitlements |
| `sharp` | images | large multi-platform binaries |
| `node-pty` | terminals | platform-specific |

Sandbox compatibility: `electron-store` (pure JS) and `safeStorage` work
sandboxed; native modules generally don't. If sandbox must stay on,
consider WASM alternatives (`sql.js`) — otherwise document the
`sandbox: false` trade-off where it's set.

## 1. Externalise in the bundler

```typescript
// vite.config.ts (vite-plugin-electron) — main entry's vite options
const mainViteOptions = {
  build: {
    rollupOptions: {
      external: ["electron", "better-sqlite3", "electron-store"],
    },
  },
};
```

```bash
# esbuild equivalent
esbuild electron/main.ts --bundle --platform=node \
  --external:electron --external:better-sqlite3 --external:keytar --external:sharp
```

## 2. Rebuild for Electron

```bash
npm i -D electron-rebuild
npx electron-rebuild -f -w better-sqlite3
```

```json
{ "scripts": { "postinstall": "electron-rebuild" } }
```

`NODE_MODULE_VERSION mismatch` at runtime = this step was missed (or ran
against the wrong Electron version after an upgrade — re-run after every
Electron bump).

## 3. Package configuration (electron-builder)

```js
module.exports = {
  // native modules + their runtime deps must ship in files
  files: [
    "dist/**/*", "dist-electron/**/*", "package.json",
    "node_modules/better-sqlite3/**/*",
    "node_modules/keytar/**/*",
    "node_modules/bindings/**/*",
    "node_modules/file-uri-to-path/**/*",
  ],
  npmRebuild: true,            // rebuild natives during packaging

  // asar can't load .node files directly — unpack them…
  asar: true,
  asarUnpack: [
    "node_modules/better-sqlite3/**/*",
    "node_modules/keytar/**/*",
  ],
  // …or simplest for native-heavy apps: asar: false
};
```

macOS + keytar additionally needs keychain entitlements:

```xml
<key>com.apple.security.keychain-access-groups</key>
<array>
  <string>$(AppIdentifierPrefix)com.yourcompany.yourapp</string>
</array>
```

## 4. Verify packaged

`electron-builder --dir`, launch the output from Finder/Explorer, and
exercise the feature that touches the native module. Dev-mode success
proves nothing here.

## Module Specifics

```typescript
// better-sqlite3 — DB lives in userData, never the bundle
import Database from "better-sqlite3";
const db = new Database(process.env.ELECTRON_DB_PATH!);
db.pragma("journal_mode = WAL");
// Run migrations on first launch (check user_version / migrations table)

// electron-store — typed schema + safe encryption key
import Store from "electron-store";
import { machineIdSync } from "node-machine-id";
const store = new Store<StoreSchema>({
  name: "myapp-data",
  encryptionKey: machineIdSync().slice(0, 32),   // never a hardcoded literal
  defaults: { session: null, settings: { theme: "system" } },
});
```

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Cannot find module 'better-sqlite3'` after packaging | Not in `files` / bundled instead of external | Add to files + external lists |
| `NODE_MODULE_VERSION X … requires Y` | Built for wrong ABI | `electron-rebuild`; re-run after Electron upgrades |
| `Invalid ELF header` / wrong architecture | Binary for another platform/arch packaged | Rebuild per target arch; don't copy node_modules across platforms |
| keytar `spawn Unknown system error` (macOS) | Missing keychain entitlements / signing | Entitlements plist + hardened runtime + signing |
| Works with `asar: false`, fails with asar | `.node` file inside asar | `asarUnpack` the module |
