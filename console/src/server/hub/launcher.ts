/**
 * launcher.ts — Console launcher CLI: `start | stop | open` (TASK-038, DEC-025)
 *
 * The framework's integration handle:
 *   - cold-start/resume → `console start`  (idempotent; prints the URL on stdout)
 *   - `/wrapup`         → `console stop`   (graceful teardown of THIS project's console)
 *   - tray / manual     → `console open`   (open it per settings; default browser for now)
 *
 * Run: `node dist-server/hub/launcher.js <verb> [--root <path>]`
 * (npm: `npm run console -- <verb>`). Root defaults to the cwd's project root.
 *
 * Pure helpers are exported for tests; the CLI only runs when executed directly.
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getProjectRoot } from "../project-root.js";
import {
  findByRoot,
  deregisterConsole,
  type RegistryEntry,
} from "./registry.js";
import { readSettings, type ConsoleSettings } from "./settings.js";
import { openConsoleUrl } from "./open.js";

const APP_ID = "ccmaf-console";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
/** dist-server/hub/launcher.js → dist-server/main.js */
const SERVER_MAIN = resolve(__dirname, "../main.js");

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Read a `--flag value` argument from argv (undefined if absent). */
export function readArg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/** The project root to act on: `--root <path>`, else the cwd's project root. */
function resolveRoot(argv: string[]): string {
  const r = readArg(argv, "--root");
  return r ? resolve(r) : getProjectRoot();
}

/** Is a console for `root` actually live + answering on `port`? */
async function isHealthy(port: number, root: string): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!resp.ok) return false;
    const body = (await resp.json()) as { app?: string; projectRoot?: string };
    return (
      body.app === APP_ID && resolve(body.projectRoot ?? "") === resolve(root)
    );
  } catch {
    return false;
  }
}

/** Open a URL honouring the user's open-mode setting (browser / chromeless app). */
export function openUrl(url: string): void {
  openConsoleUrl(url, readSettings());
}

/**
 * Shape a console URL into the thing to actually open, honouring `windowStyle`
 * (TASK-041). `single` → the console itself; `tabbed` → that console's `/shell`
 * route (one window, a tab per console). `consoleUrl` is the origin only
 * (`http://127.0.0.1:<port>`); `activePort` (optional) preselects a tab. Pure.
 */
export function cockpitUrl(
  consoleUrl: string,
  settings: ConsoleSettings,
  activePort?: number,
): string {
  if (settings.windowStyle !== "tabbed") return consoleUrl;
  const q = activePort ? `?active=${activePort}` : "";
  return `${consoleUrl}/shell${q}`;
}

// ── Verbs ───────────────────────────────────────────────────────────────────

/**
 * Ensure a console for `root` is up; print + return its URL (null on failure).
 * No-op if one already answers health; otherwise spawn the server DETACHED (so
 * it outlives this launcher) and poll until it self-registers + answers health.
 */
async function ensureRunning(root: string): Promise<string | null> {
  const existing = findByRoot(root);
  if (existing && (await isHealthy(existing.port, root))) {
    const url = `http://127.0.0.1:${existing.port}`;
    console.log(url);
    return url;
  }

  // Spawn detached, headless. Drop CONSOLE_PORT so the PINNED port path is used
  // (an inherited override would defeat per-project pinning).
  const env = { ...process.env };
  delete env.CONSOLE_PORT;
  const child = spawn(process.execPath, [SERVER_MAIN], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const e = findByRoot(root);
    if (e && (await isHealthy(e.port, root))) {
      const url = `http://127.0.0.1:${e.port}`;
      console.log(url);
      return url;
    }
    await sleep(300);
  }
  console.error("[console] start: server did not come up within 15s");
  return null;
}

/** Ensure the console is up; open it too if `autoOpenOnStart` is set. */
export async function start(root: string): Promise<number> {
  const url = await ensureRunning(root);
  if (!url) return 1;
  const settings = readSettings();
  if (settings.autoOpenOnStart) openUrl(cockpitUrl(url, settings));
  return 0;
}

/**
 * Stop THIS project's console gracefully (POST /api/shutdown with its
 * shutdownToken); force-kill the pid + clean the registry as a fallback.
 */
export async function stop(root: string): Promise<number> {
  const e: RegistryEntry | null = findByRoot(root);
  if (!e) {
    console.log("[console] stop: no console registered for this project");
    return 0;
  }
  try {
    const resp = await fetch(`http://127.0.0.1:${e.port}/api/shutdown`, {
      method: "POST",
      headers: { "x-console-shutdown": e.shutdownToken },
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) {
      console.log(`[console] stopped ${e.project} (:${e.port})`);
      return 0;
    }
  } catch {
    /* fall through to force-kill */
  }
  // Graceful shutdown unreachable — force-kill, then clean the entry ourselves
  // (a hard kill may skip the server's own deregister, esp. on Windows).
  try {
    process.kill(e.pid);
  } catch {
    /* already gone */
  }
  deregisterConsole(e.port);
  console.log(`[console] force-stopped ${e.project} (:${e.port})`);
  return 0;
}

/**
 * Open this project's console per the user's open-mode (starts it first if it
 * isn't running). Opens exactly once (no double-open with autoOpenOnStart).
 */
export async function open(root: string): Promise<number> {
  const url = await ensureRunning(root);
  if (!url) return 1;
  openUrl(cockpitUrl(url, readSettings()));
  return 0;
}

/**
 * Restart THIS project's console: stop (if running) then start fresh. Use after a
 * rebuild / a Console version update — `start` alone is IDEMPOTENT and reuses a
 * still-healthy old process, so it never picks up new server code (the running
 * Node process doesn't hot-reload). `restart` guarantees the live process is the
 * current build. The framework should use this (not bare `start`) when it applies
 * a Console update.
 */
export async function restart(root: string): Promise<number> {
  await stop(root);
  await sleep(500); // let the port free + the registry entry clear before re-bind
  return start(root);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<number> {
  const verb = argv[2];
  const root = resolveRoot(argv);
  switch (verb) {
    case "start":
      return start(root);
    case "stop":
      return stop(root);
    case "open":
      return open(root);
    case "restart":
      return restart(root);
    default:
      console.error("usage: console <start|stop|open|restart> [--root <path>]");
      return 2;
  }
}

// Run only when executed directly (not when imported by tests).
const invokedDirectly =
  !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void main(process.argv).then((code) => process.exit(code));
}
