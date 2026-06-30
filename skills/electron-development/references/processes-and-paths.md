# Processes, Paths, and Spawning

Path resolution is the #1 cause of "works in dev, broken when installed".
When a packaged app launches from Finder/Explorer: `process.cwd()` is `/`
(macOS) or `C:\Windows\System32` (Windows), and bundled `__dirname` was
resolved at bundle time. Neither is usable for runtime files.

## The Two Roots

| Root | API | For |
|---|---|---|
| User data (writable) | `app.getPath('userData')` | database, uploads, cache, logs, generated files |
| App bundle (read-only) | `app.getAppPath()` | bundled assets, templates |

Also: `app.getPath('temp' | 'logs' | 'downloads' | ...)` for the standard
locations. **Never write inside the app bundle** — it's read-only when
installed (and signed).

## Startup Environment Pattern

Set canonical paths once in main, so all code (including a bundled server
running in the main process) reads the same truth:

```typescript
// electron/main.ts
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

function initializeEnvironment() {
  const userDataDir = app.getPath("userData");
  process.env.ELECTRON_USER_DATA = userDataDir;
  process.env.ELECTRON_APP_ROOT = app.getAppPath();
  process.env.ELECTRON_DB_PATH = path.join(userDataDir, "app.db");

  for (const dir of ["uploads", "generated", "cache", "logs"]) {
    fs.mkdirSync(path.join(userDataDir, dir), { recursive: true });
  }
}
```

Shared helpers with dev fallbacks keep the same code running in plain
Node during development:

```typescript
// src/shared/electron-paths.ts
export function getUserDataDir(): string {
  return process.env.ELECTRON_USER_DATA ?? path.resolve(process.cwd(), "data");
}
export function isElectron(): boolean {
  return !!process.env.ELECTRON_USER_DATA;
}
export function getSafeWorkingDir(): string {
  return isElectron() ? getUserDataDir() : process.cwd();
}
```

## Fixing the Usual Suspects

```typescript
// Database
const dbPath = process.env.ELECTRON_DB_PATH ?? path.join(getUserDataDir(), "app.db");

// Uploads / generated files → userData subdirs, never public/ in the bundle

// Spawning anything: give it an explicit cwd
spawn(bin, args, { cwd: getSafeWorkingDir() });

// Preload path: relative to compiled main, not source tree
new BrowserWindow({
  webPreferences: { preload: path.join(__dirname, "preload.cjs") },
});
```

Anti-patterns: `process.cwd()` anywhere in main-process runtime code;
`path.resolve('relative')`; writing next to the executable; serving
static files from bundle-relative guesses.

## Spawning CLI Tools — the PATH problem

GUI-launched apps don't inherit your shell's PATH (no `.zshrc`/`.bashrc`).
`spawn('claude')` that works in `npm run dev` fails when packaged.

```typescript
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CANDIDATE_DIRS = [
  "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin",
  path.join(os.homedir(), ".local/bin"),
  path.join(os.homedir(), ".npm-global/bin"),
];

export function findBinary(name: string): string | null {
  // 1. explicit well-known locations
  for (const dir of CANDIDATE_DIRS) {
    const candidate = path.join(dir, process.platform === "win32" ? `${name}.cmd` : name);
    if (fs.existsSync(candidate)) return candidate;
  }
  // 2. ask a login shell (gets the user's real PATH) — macOS/Linux
  try {
    const out = execFileSync(
      process.env.SHELL ?? "/bin/zsh",
      ["-ilc", `command -v ${name}`],
      { encoding: "utf8", timeout: 3000 },
    ).trim();
    if (out) return out;
  } catch { /* not found */ }
  return null;
}
```

Detect at startup, cache the absolute path, surface missing tools in the
UI rather than failing on first use. Always spawn by absolute path with
an explicit `cwd`.

## Process Hygiene

- Main process startup is user-perceived launch time — defer heavy
  init (DB migrations, network) until after the window shows, or show a
  splash state.
- Long CPU work doesn't belong in main (it blocks every window's IPC) —
  use a `utilityProcess`/worker or a child process.
- Single-instance apps: `app.requestSingleInstanceLock()` and focus the
  existing window on second launch (also required for reliable protocol
  handling — see ipc-and-security.md).
